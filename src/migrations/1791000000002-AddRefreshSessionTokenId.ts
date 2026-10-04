import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshSessionTokenId1791000000002 implements MigrationInterface {
  name = 'AddRefreshSessionTokenId1791000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE user_sessions ADD COLUMN token_id varchar(36) NULL',
    );
    await queryRunner.query(
      'UPDATE user_sessions SET token_id = UUID(), is_valid = 0 WHERE token_id IS NULL',
    );
    await queryRunner.query(
      'ALTER TABLE user_sessions MODIFY token_id varchar(36) NOT NULL, ADD UNIQUE KEY UQ_user_sessions_token_id (token_id)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE user_sessions DROP INDEX IDX_user_sessions_token_id, DROP COLUMN token_id',
    );
  }
}
