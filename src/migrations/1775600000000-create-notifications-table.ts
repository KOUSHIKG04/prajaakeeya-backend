import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Creates the `notifications` table used by NotificationsService to fan
 * out in-app notifications when an aspirant registers in a user's saved
 * constituency, or schedules a meeting / visit / other event.
 */
export class CreateNotificationsTable1775600000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    const stmts = [
      `CREATE TABLE IF NOT EXISTS "notifications" (
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
      `CREATE INDEX IF NOT EXISTS "idx_notifications_user_created"
         ON "notifications" ("user_id", "created_at" DESC)`,
      `CREATE INDEX IF NOT EXISTS "idx_notifications_user_unread"
         ON "notifications" ("user_id", "is_read")`,
    ];
    for (const sql of stmts) {
      await queryRunner.query(sql);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const stmts = [
      `DROP INDEX IF EXISTS "idx_notifications_user_unread"`,
      `DROP INDEX IF EXISTS "idx_notifications_user_created"`,
      `DROP TABLE IF EXISTS "notifications"`,
    ];
    for (const sql of stmts) {
      await queryRunner.query(sql);
    }
  }
}
