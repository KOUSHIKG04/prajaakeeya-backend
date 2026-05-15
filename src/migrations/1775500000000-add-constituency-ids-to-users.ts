import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds the four constituency-id columns that were added to the User entity
 * in commit 016c66a but never accompanied by a migration. With
 * `synchronize: false` now enforced in production, these columns must be
 * created by a migration or every read/write through `PUT /users/me` etc.
 * will 500 with "column ... does not exist".
 */
export class AddConstituencyIdsToUsers1775500000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    const stmts = [
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lok_sabha_constituency_id" int`,
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "state_assembly_constituency_id" int`,
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "municipal_corporation_constituency_id" int`,
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gram_panchayat_constituency_id" int`,
      // Lookups by constituency are likely future hot paths; index the two
      // most-used (municipal + gp), leave the others bare for now.
      `CREATE INDEX IF NOT EXISTS idx_users_msc
         ON "users" ("municipal_corporation_constituency_id")`,
      `CREATE INDEX IF NOT EXISTS idx_users_gpc
         ON "users" ("gram_panchayat_constituency_id")`,
    ];
    for (const sql of stmts) {
      await queryRunner.query(sql);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const stmts = [
      `DROP INDEX IF EXISTS idx_users_msc`,
      `DROP INDEX IF EXISTS idx_users_gpc`,
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "lok_sabha_constituency_id"`,
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "state_assembly_constituency_id"`,
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "municipal_corporation_constituency_id"`,
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "gram_panchayat_constituency_id"`,
    ];
    for (const sql of stmts) {
      await queryRunner.query(sql);
    }
  }
}
