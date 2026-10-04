import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthRateLimits1791000000005 implements MigrationInterface {
  name = 'CreateAuthRateLimits1791000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE auth_rate_limits (
        scope_hash char(64) NOT NULL,
        attempt_count int unsigned NOT NULL DEFAULT 0,
        window_started_at timestamp(6) NOT NULL,
        updated_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (scope_hash),
        KEY IDX_auth_rate_limit_window (window_started_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE auth_rate_limits');
  }
}
