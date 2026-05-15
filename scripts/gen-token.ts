/**
 * Local-only utility: mint a JWT for one or more user IDs without going
 * through the OTP / Google / EPIC login flows. Uses the live JWT_SECRET
 * from .env so the token validates against your running API.
 *
 * Usage (from project root):
 *   npx ts-node scripts/gen-token.ts 56 68
 *   npx ts-node scripts/gen-token.ts 56 68 --expires 7d
 *
 * Reads: DATABASE_URL, JWT_SECRET, JWT_EXPIRES_IN (defaults to 24h).
 * Prints: one JWT per user + a copy-paste curl line for /api/auth/me.
 */
import * as dotenv from "dotenv";
// pg has no bundled types; this script doesn't need them.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Client } = require("pg") as { Client: new (cfg: any) => any };
import * as jwt from "jsonwebtoken";

dotenv.config();

interface UserRow {
  id: number;
  role: string;
  wardId: number | null;
  isBlocked: boolean;
  tokenVersion: number;
  name: string | null;
  email: string | null;
  phone: string | null;
}

async function main() {
  const argv = process.argv.slice(2);
  const expiresIdx = argv.indexOf("--expires");
  const explicitExpires =
    expiresIdx >= 0 ? argv[expiresIdx + 1] : undefined;
  // Strip the --expires flag AND its value only when present.
  const skipIndices = new Set<number>();
  if (expiresIdx >= 0) {
    skipIndices.add(expiresIdx);
    skipIndices.add(expiresIdx + 1);
  }
  const ids = argv
    .filter((_, i) => !skipIndices.has(i))
    .map((a) => Number(a))
    .filter((n) => Number.isInteger(n) && n > 0);

  if (!ids.length) {
    console.error(
      "Usage: npx ts-node scripts/gen-token.ts <userId> [<userId>...] [--expires 7d]",
    );
    process.exit(1);
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error("JWT_SECRET is not set in .env");
    process.exit(1);
  }
  const expiresIn = explicitExpires || process.env.JWT_EXPIRES_IN || "24h";

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set in .env");
    process.exit(1);
  }

  // Local Postgres typically doesn't need SSL; remote does. Honour sslmode in
  // the URL the same way the app does.
  const ssl =
    /sslmode=(require|no-verify|verify-ca|verify-full|prefer)/i.test(url)
      ? { rejectUnauthorized: false }
      : false;
  const client = new Client({ connectionString: url, ssl: ssl as any });

  await client.connect();
  try {
    const { rows } = (await client.query(
      `SELECT id, role, "wardId", is_blocked AS "isBlocked",
              token_version AS "tokenVersion", name, email, phone
         FROM users
        WHERE id = ANY($1::int[])
        ORDER BY id`,
      [ids],
    )) as { rows: UserRow[] };

    const found = new Set(rows.map((r: UserRow) => r.id));
    for (const id of ids) {
      if (!found.has(id)) {
        console.error(`  ✗ user id ${id} not found`);
      }
    }

    for (const u of rows) {
      const payload = {
        sub: u.id,
        role: u.role,
        wardId: u.wardId,
        isBlocked: u.isBlocked,
        tokenVersion: u.tokenVersion ?? 0,
      };
      const token = jwt.sign(payload, secret, { expiresIn } as any);

      console.log("─".repeat(72));
      console.log(`user #${u.id}  role=${u.role}  wardId=${u.wardId ?? "null"}`);
      console.log(
        `        name="${u.name ?? ""}"  email=${u.email ?? "-"}  phone=${u.phone ?? "-"}`,
      );
      if (u.isBlocked) {
        console.log("        ⚠ user is BLOCKED — the API will reject this token");
      }
      console.log(`expires:  ${expiresIn}`);
      console.log(`token:    ${token}`);
      console.log(
        `\ncurl example:\n  curl -H 'Authorization: Bearer ${token}' http://localhost:3000/api/auth/me\n`,
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
