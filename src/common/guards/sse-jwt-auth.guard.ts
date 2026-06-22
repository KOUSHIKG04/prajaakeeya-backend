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
import { tokenVersionCacheKey } from "../../auth/strategies/jwt.strategy";

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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    res.setHeader("X-Accel-Buffering", "no");

    const header: string | undefined = req.headers?.authorization;
    const token: string | undefined =
      (req.query?.token as string) ||
      (header?.startsWith("Bearer ") ? header.slice(7) : undefined);

    if (!token) throw new UnauthorizedException("Missing token");

    let payload: any;
    try {
      payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
        algorithms: ["HS256"],
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }

    // Revocation checks, identical to JwtStrategy.validate().
    if (payload.isBlocked) {
      throw new UnauthorizedException("User is blocked");
    }
    const cached = await this.cache.get<number>(
      tokenVersionCacheKey(payload.sub),
    );
    const presented = payload.tokenVersion ?? 0;
    if (cached !== undefined && cached !== null && presented < Number(cached)) {
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
