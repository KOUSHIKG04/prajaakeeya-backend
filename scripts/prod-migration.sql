-- ============================================================================
-- Production migration script
-- ============================================================================
-- Applies all schema changes for: notifications system + saved-constituency
-- resolution on /auth/me.
--
-- SAFE TO RE-RUN: every statement uses IF NOT EXISTS, so this script is
-- idempotent. Running it twice does nothing on the second pass.
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/prod-migration.sql
--
-- Or via the SSH tunnel:
--   ssh -i ~/Downloads/prajaakeeya-api.pem \
--     -L 5433:prajaakeeya.ct6c8ekusl63.ap-south-1.rds.amazonaws.com:5432 \
--     ubuntu@<EC2_IP> -N &
--   psql "postgresql://USER:PASS@localhost:5433/prajaakeeya?sslmode=require" \
--     -f scripts/prod-migration.sql
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Add four saved-constituency columns to users
-- ----------------------------------------------------------------------------
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "lok_sabha_constituency_id" int;
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "state_assembly_constituency_id" int;
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "municipal_corporation_constituency_id" int;
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "gram_panchayat_constituency_id" int;

-- Indexes on the two hot-path columns (municipal + gram panchayat are the
-- main read paths today; others can be indexed later if needed).
CREATE INDEX IF NOT EXISTS idx_users_msc
  ON "users" ("municipal_corporation_constituency_id");
CREATE INDEX IF NOT EXISTS idx_users_gpc
  ON "users" ("gram_panchayat_constituency_id");

-- ----------------------------------------------------------------------------
-- 2. Create notifications table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "notifications" (
  "id"                SERIAL PRIMARY KEY,
  "created_at"        TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMP NOT NULL DEFAULT now(),
  "user_id"           INTEGER NOT NULL,
  "type"              VARCHAR(64) NOT NULL,
  "title"             VARCHAR NOT NULL,
  "body"              TEXT NOT NULL,
  "aspirant_id"       INTEGER NULL,
  "aspirant_name"     VARCHAR NULL,
  "election_id"       INTEGER NULL,
  "constituency_id"   INTEGER NULL,
  "constituency_name" VARCHAR NULL,
  "meeting_id"        INTEGER NULL,
  "visit_id"          INTEGER NULL,
  "metadata"          JSONB NULL,
  "is_read"           BOOLEAN NOT NULL DEFAULT false,
  "read_at"           TIMESTAMP NULL,
  CONSTRAINT "fk_notifications_user"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_notifications_user_created"
  ON "notifications" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_notifications_user_unread"
  ON "notifications" ("user_id", "is_read");

-- ----------------------------------------------------------------------------
-- 3. Backfill: copy aspirants' constituencyId onto the matching user column
-- ----------------------------------------------------------------------------
-- Without this, existing aspirants won't have a saved constituency on their
-- user row, and /auth/me would have to fall back to deriving it each time.
-- This populates the user-level field so it's first-class data.
-- Safe to re-run: only fills rows where the column is currently NULL.

UPDATE users u
SET lok_sabha_constituency_id = a."constituencyId"
FROM aspirants a, elections e
WHERE a."userId" = u.id
  AND a."electionId" = e.id
  AND e.type = 'lok_sabha'
  AND u.lok_sabha_constituency_id IS NULL
  AND a."constituencyId" IS NOT NULL;

UPDATE users u
SET state_assembly_constituency_id = a."constituencyId"
FROM aspirants a, elections e
WHERE a."userId" = u.id
  AND a."electionId" = e.id
  AND e.type = 'state_assembly'
  AND u.state_assembly_constituency_id IS NULL
  AND a."constituencyId" IS NOT NULL;

UPDATE users u
SET municipal_corporation_constituency_id = a."constituencyId"
FROM aspirants a, elections e
WHERE a."userId" = u.id
  AND a."electionId" = e.id
  AND e.type = 'municipal_corporation'
  AND u.municipal_corporation_constituency_id IS NULL
  AND a."constituencyId" IS NOT NULL;

UPDATE users u
SET gram_panchayat_constituency_id = a."constituencyId"
FROM aspirants a, elections e
WHERE a."userId" = u.id
  AND a."electionId" = e.id
  AND e.type = 'gram_panchayat'
  AND u.gram_panchayat_constituency_id IS NULL
  AND a."constituencyId" IS NOT NULL;

COMMIT;

-- ============================================================================
-- Verification (run after COMMIT — these are read-only)
-- ============================================================================
SELECT 'users columns' AS check, column_name
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN (
    'lok_sabha_constituency_id',
    'state_assembly_constituency_id',
    'municipal_corporation_constituency_id',
    'gram_panchayat_constituency_id'
  )
ORDER BY column_name;

SELECT 'notifications table' AS check,
       to_regclass('notifications') IS NOT NULL AS exists;

SELECT 'notifications indexes' AS check, indexname
FROM pg_indexes
WHERE tablename = 'notifications'
ORDER BY indexname;

SELECT 'aspirants backfilled' AS check,
       COUNT(*) FILTER (WHERE u.municipal_corporation_constituency_id IS NOT NULL) AS municipal_filled,
       COUNT(*) FILTER (WHERE u.lok_sabha_constituency_id IS NOT NULL) AS lok_sabha_filled,
       COUNT(*) FILTER (WHERE u.state_assembly_constituency_id IS NOT NULL) AS assembly_filled,
       COUNT(*) FILTER (WHERE u.gram_panchayat_constituency_id IS NOT NULL) AS gp_filled
FROM users u
WHERE u.id IN (SELECT "userId" FROM aspirants WHERE "userId" IS NOT NULL);
