/**
 * Production migration runner — applies all schema changes for the
 * notifications system + saved-constituency resolution on /auth/me.
 *
 * Idempotent — safe to re-run. Reads DATABASE_URL from .env.
 *
 * Usage on the EC2 box:
 *   cd /home/ec2-user/prajaakeeya-api
 *   node scripts/prod-migration.js
 *
 * Optional env vars:
 *   RDS_SSL_INSECURE=true    skip cert verification (default if set)
 *   RDS_CA_PATH=/opt/rds/global-bundle.pem   use the AWS RDS CA bundle
 *   DRY_RUN=true             run inside a transaction that rolls back at the
 *                            end (verifies SQL succeeds without persisting)
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Client } = require("pg");

function resolveSsl() {
  if (process.env.RDS_SSL_INSECURE === "true") {
    return { rejectUnauthorized: false };
  }
  const caPath = process.env.RDS_CA_PATH || "/opt/rds/global-bundle.pem";
  if (fs.existsSync(caPath)) return { ca: fs.readFileSync(caPath).toString() };
  // Fallback: connection has sslmode=require in URL but no CA → relax,
  // since this script's whole purpose is one-shot DDL.
  return { rejectUnauthorized: false };
}

const DDL_STEPS = [
  {
    label: "users.lok_sabha_constituency_id",
    sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lok_sabha_constituency_id" int`,
  },
  {
    label: "users.state_assembly_constituency_id",
    sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "state_assembly_constituency_id" int`,
  },
  {
    label: "users.municipal_corporation_constituency_id",
    sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "municipal_corporation_constituency_id" int`,
  },
  {
    label: "users.gram_panchayat_constituency_id",
    sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gram_panchayat_constituency_id" int`,
  },
  {
    label: "idx_users_msc",
    sql: `CREATE INDEX IF NOT EXISTS idx_users_msc
            ON "users" ("municipal_corporation_constituency_id")`,
  },
  {
    label: "idx_users_gpc",
    sql: `CREATE INDEX IF NOT EXISTS idx_users_gpc
            ON "users" ("gram_panchayat_constituency_id")`,
  },
  {
    label: "notifications table",
    sql: `CREATE TABLE IF NOT EXISTS "notifications" (
            "id" SERIAL PRIMARY KEY,
            "created_at" TIMESTAMP NOT NULL DEFAULT now(),
            "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
            "user_id" INTEGER NOT NULL,
            "type" VARCHAR(64) NOT NULL,
            "title" VARCHAR NOT NULL,
            "body" TEXT NOT NULL,
            "aspirant_id" INTEGER NULL,
            "aspirant_name" VARCHAR NULL,
            "election_id" INTEGER NULL,
            "constituency_id" INTEGER NULL,
            "constituency_name" VARCHAR NULL,
            "meeting_id" INTEGER NULL,
            "visit_id" INTEGER NULL,
            "metadata" JSONB NULL,
            "is_read" BOOLEAN NOT NULL DEFAULT false,
            "read_at" TIMESTAMP NULL,
            CONSTRAINT "fk_notifications_user"
              FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
          )`,
  },
  {
    label: "idx_notifications_user_created",
    sql: `CREATE INDEX IF NOT EXISTS "idx_notifications_user_created"
            ON "notifications" ("user_id", "created_at" DESC)`,
  },
  {
    label: "idx_notifications_user_unread",
    sql: `CREATE INDEX IF NOT EXISTS "idx_notifications_user_unread"
            ON "notifications" ("user_id", "is_read")`,
  },
];

const BACKFILL_STEPS = [
  ["lok_sabha", "lok_sabha_constituency_id"],
  ["state_assembly", "state_assembly_constituency_id"],
  ["municipal_corporation", "municipal_corporation_constituency_id"],
  ["gram_panchayat", "gram_panchayat_constituency_id"],
].map(([electionType, column]) => ({
  label: `backfill ${column} (${electionType})`,
  sql: `
    UPDATE users u
    SET ${column} = a."constituencyId"
    FROM aspirants a, elections e
    WHERE a."userId" = u.id
      AND a."electionId" = e.id
      AND e.type = '${electionType}'
      AND u.${column} IS NULL
      AND a."constituencyId" IS NOT NULL
  `,
}));

const VERIFY_QUERIES = [
  {
    label: "users columns",
    sql: `
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users'
        AND column_name LIKE '%constituency_id%'
      ORDER BY column_name
    `,
  },
  {
    label: "notifications table exists",
    sql: `SELECT to_regclass('notifications') IS NOT NULL AS exists`,
  },
  {
    label: "notifications indexes",
    sql: `
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'notifications'
      ORDER BY indexname
    `,
  },
  {
    label: "aspirant backfill counts",
    sql: `
      SELECT
        COUNT(*) FILTER (WHERE u.lok_sabha_constituency_id IS NOT NULL) AS lok_sabha,
        COUNT(*) FILTER (WHERE u.state_assembly_constituency_id IS NOT NULL) AS state_assembly,
        COUNT(*) FILTER (WHERE u.municipal_corporation_constituency_id IS NOT NULL) AS municipal,
        COUNT(*) FILTER (WHERE u.gram_panchayat_constituency_id IS NOT NULL) AS gram_panchayat
      FROM users u
      WHERE u.id IN (SELECT "userId" FROM aspirants WHERE "userId" IS NOT NULL)
    `,
  },
];

async function run(client, steps) {
  for (const step of steps) {
    const startedAt = Date.now();
    const res = await client.query(step.sql);
    const ms = Date.now() - startedAt;
    const rowInfo =
      typeof res.rowCount === "number" && res.command === "UPDATE"
        ? ` (${res.rowCount} rows)`
        : "";
    console.log(`  ✓ ${step.label}${rowInfo} — ${ms}ms`);
  }
}

(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set (check .env)");
  }
  const dryRun = process.env.DRY_RUN === "true";
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: resolveSsl(),
  });

  console.log(
    `Connecting to ${
      process.env.DATABASE_URL.replace(/:[^@/]*@/, ":***@") // hide password
    }`,
  );
  console.log(dryRun ? "DRY RUN — will roll back at the end\n" : "");
  await client.connect();

  try {
    await client.query("BEGIN");

    console.log("1) Schema changes");
    await run(client, DDL_STEPS);

    console.log("\n2) Backfill saved constituencies from aspirants");
    await run(client, BACKFILL_STEPS);

    if (dryRun) {
      await client.query("ROLLBACK");
      console.log("\nDRY RUN complete — rolled back.");
    } else {
      await client.query("COMMIT");
      console.log("\nMigration committed.");
    }

    console.log("\n3) Verification");
    for (const v of VERIFY_QUERIES) {
      const r = await client.query(v.sql);
      console.log(`  ${v.label}:`);
      r.rows.forEach((row) => console.log("    ", row));
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("\nFAILED — rolled back:", err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
