import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import type { Request, Response } from "express";
import {
  tokenVersionCacheKey,
  READ_THROUGH_CACHE_TTL_MS,
} from "../../auth/strategies/jwt.strategy";
import { sessionCookieExtractor } from "../../auth/session-cookie";
import { AuthUser } from "../decorators/current-user.decorator";
import { User } from "../../users/user.entity";

/** Shape of the verified SSE JWT payload (subset of fields we rely on). */
interface SseJwtPayload {
  sub: number;
  role?: string;
  wardId?: number;
  tokenVersion?: number;
  isBlocked?: boolean;
}

/**
 * Auth guard for Server-Sent Events routes.
 *
 * The browser `EventSource` API cannot set request headers, so the JWT is read
 * from the `token` query param (falling back to a Bearer header for non-browser
 * clients). On success the decoded identity is attached to `req.user`.
 *
 * It also sets `X-Accel-Buffering: no` so SSE bytes stream immediately through
 * buffering proxies (nginx / ALB).
 *
 * Mirrors `JwtStrategy`: signature + expiry are pinned to HS256, and the same
 * `isBlocked` / Redis `tokenVersion` revocation checks run so a blocked or
 * revoked user cannot hold an SSE stream open until the token expires.
 */
@Injectable()
export class SseJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader("X-Accel-Buffering", "no");

    const header: string | undefined = req.headers?.authorization;
    const token: string | undefined =
      // Cookie first — set automatically by the browser, keeps the JWT out of
      // the URL (a `?token=` query leaks into access logs / Referer).
      sessionCookieExtractor(req) ||
      (req.query?.token as string) ||
      (header?.startsWith("Bearer ") ? header.slice(7) : undefined);

    if (!token) throw new UnauthorizedException("Missing token");

    let payload: SseJwtPayload;
    try {
      payload = this.jwtService.verify<SseJwtPayload>(token, {
        secret: process.env.JWT_SECRET,
        algorithms: ["HS256"],
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }

    // Revocation checks, identical to JwtStrategy.validate() — including the
    // DB read-through on a cache miss so a blocked/revoked user can't open an
    // SSE stream just because the cache is cold.
    if (payload.isBlocked) {
      throw new UnauthorizedException("User is blocked");
    }
    const key = tokenVersionCacheKey(payload.sub);
    const presented = payload.tokenVersion ?? 0;
    let current = await this.cache.get<number>(key);
    if (current === undefined || current === null) {
      try {
        const user = await this.userRepo.findOne({
          where: { id: payload.sub },
          select: {
            id: true,
            tokenVersion: true,
            isBlocked: true,
            isSelfDeleted: true,
          },
        });
        if (!user || user.isBlocked || user.isSelfDeleted) {
          throw new UnauthorizedException("Session has been revoked");
        }
        current = user.tokenVersion ?? 0;
        await this.cache.set(key, current, READ_THROUGH_CACHE_TTL_MS);
      } catch (err) {
        if (err instanceof UnauthorizedException) throw err;
        // DB unreachable — degrade to the token's own claims (don't lock out).
        current = presented;
      }
    }
    if (
      current !== undefined &&
      current !== null &&
      presented < Number(current)
    ) {
      throw new UnauthorizedException("Session has been revoked");
    }

    req.user = {
      id: payload.sub,
      role: payload.role,
      wardId: payload.wardId,
    };
    return true;
  }
}
