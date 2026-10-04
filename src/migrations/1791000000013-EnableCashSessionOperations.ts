import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnableCashSessionOperations1791000000013 implements MigrationInterface {
  name = 'EnableCashSessionOperations1791000000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE cash_sessions DROP CHECK CK_cash_sessions_close_state',
    );
    await queryRunner.query(`
      ALTER TABLE cash_sessions
        ADD COLUMN opening_request_fingerprint char(64) NULL,
        ADD COLUMN close_idempotency_key varchar(100) NULL,
        ADD COLUMN close_request_fingerprint char(64) NULL,
        ADD UNIQUE KEY UQ_cash_sessions_tenant_close_key (tenant_id, close_idempotency_key)
    `);

    // Existing open sessions begin with their opening float as the expected drawer balance.
    await queryRunner.query(
      "UPDATE cash_sessions SET expected_amount = opening_amount WHERE status = 'OPEN' AND expected_amount IS NULL",
    );
    await queryRunner.query(
      'ALTER TABLE cash_sessions MODIFY expected_amount decimal(14,2) NOT NULL',
    );
    await queryRunner.query(`
      ALTER TABLE cash_sessions
        ADD CONSTRAINT CK_cash_sessions_close_state CHECK (
          (status = 'OPEN'
            AND closed_at IS NULL
            AND closed_by_user_id IS NULL
            AND counted_amount IS NULL
            AND difference_amount IS NULL
            AND close_idempotency_key IS NULL
            AND close_request_fingerprint IS NULL)
          OR
          (status = 'CLOSED'
            AND closed_at IS NOT NULL
            AND closed_by_user_id IS NOT NULL
            AND counted_amount IS NOT NULL
            AND difference_amount IS NOT NULL
            AND close_idempotency_key IS NOT NULL
            AND close_request_fingerprint IS NOT NULL)
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE cash_sessions DROP CHECK CK_cash_sessions_close_state',
    );
    await queryRunner.query(
      'ALTER TABLE cash_sessions MODIFY expected_amount decimal(14,2) NULL',
    );
    await queryRunner.query(
      "UPDATE cash_sessions SET expected_amount = NULL WHERE status = 'OPEN'",
    );
    await queryRunner.query(
      'ALTER TABLE cash_sessions DROP INDEX UQ_cash_sessions_tenant_close_key, DROP COLUMN close_request_fingerprint, DROP COLUMN close_idempotency_key, DROP COLUMN opening_request_fingerprint',
    );
    await queryRunner.query(`
      ALTER TABLE cash_sessions
        ADD CONSTRAINT CK_cash_sessions_close_state CHECK (
          (status = 'OPEN' AND closed_at IS NULL AND closed_by_user_id IS NULL AND expected_amount IS NULL AND counted_amount IS NULL AND difference_amount IS NULL)
          OR (status = 'CLOSED' AND closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL AND expected_amount IS NOT NULL AND counted_amount IS NOT NULL AND difference_amount IS NOT NULL)
        )
    `);
  }
}
