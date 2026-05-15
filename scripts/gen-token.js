/**
 * Local-only utility: mint a JWT for one or more user IDs without going
 * through the OTP / Google / EPIC login flows. Plain JS to bypass ts-node
 * strict-mode pain — run with `node scripts/gen-token.js 56 68`.
 *
 * Uses the live JWT_SECRET from .env so tokens validate against your API.
 */
const dotenv = require("dotenv");
const { Client } = require("pg");
const jwt = require("jsonwebtoken");

dotenv.config();

async function main() {
  const argv = process.argv.slice(2);
  const expiresIdx = argv.indexOf("--expires");
  const explicitExpires = expiresIdx >= 0 ? argv[expiresIdx + 1] : undefined;
  // Strip the --expires flag AND its value only when present.
  const skipIndices = new Set();
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
      "Usage: node scripts/gen-token.js <userId> [<userId>...] [--expires 7d]",
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

  const ssl =
    /sslmode=(require|no-verify|verify-ca|verify-full|prefer)/i.test(url)
      ? { rejectUnauthorized: false }
      : false;
  const client = new Client({ connectionString: url, ssl });

  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, role, "wardId", is_blocked AS "isBlocked",
              token_version AS "tokenVersion", name, email, phone
         FROM users
        WHERE id = ANY($1::int[])
        ORDER BY id`,
      [ids],
    );

    const found = new Set(rows.map((r) => r.id));
    for (const id of ids) {
      if (!found.has(id)) console.error(`  ✗ user id ${id} not found`);
    }

    for (const u of rows) {
      const payload = {
        sub: u.id,
        role: u.role,
        wardId: u.wardId,
        isBlocked: u.isBlocked,
        tokenVersion: u.tokenVersion ?? 0,
      };
      const token = jwt.sign(payload, secret, { expiresIn });

      console.log("─".repeat(72));
      console.log(`user #${u.id}  role=${u.role}  wardId=${u.wardId ?? "null"}`);
      console.log(
        `        name="${u.name ?? ""}"  email=${u.email ?? "-"}  phone=${u.phone ?? "-"}`,
      );
      if (u.isBlocked) {
        console.log(
          "        ⚠ user is BLOCKED — the API will reject this token",
        );
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
