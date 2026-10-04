import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceCashTenantMembership1791000000012 implements MigrationInterface {
  name = 'EnforceCashTenantMembership1791000000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE cash_registers DROP FOREIGN KEY FK_cash_register_creator',
    );
    await queryRunner.query(
      'ALTER TABLE cash_registers ADD CONSTRAINT FK_cash_register_creator_membership FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES tenant_memberships(tenant_id, user_id) ON DELETE RESTRICT',
    );

    await queryRunner.query(
      'ALTER TABLE cash_sessions DROP FOREIGN KEY FK_cash_sessions_opened_by',
    );
    await queryRunner.query(
      'ALTER TABLE cash_sessions ADD CONSTRAINT FK_cash_sessions_opened_by_membership FOREIGN KEY (tenant_id, opened_by_user_id) REFERENCES tenant_memberships(tenant_id, user_id) ON DELETE RESTRICT',
    );

    await queryRunner.query(
      'ALTER TABLE cash_sessions DROP FOREIGN KEY FK_cash_sessions_closed_by',
    );
    await queryRunner.query(
      'ALTER TABLE cash_sessions ADD CONSTRAINT FK_cash_sessions_closed_by_membership FOREIGN KEY (tenant_id, closed_by_user_id) REFERENCES tenant_memberships(tenant_id, user_id) ON DELETE RESTRICT',
    );

    await queryRunner.query(
      'ALTER TABLE cash_sessions ADD CONSTRAINT CK_cash_sessions_nonnegative_amounts CHECK (opening_amount >= 0 AND (expected_amount IS NULL OR expected_amount >= 0) AND (counted_amount IS NULL OR counted_amount >= 0))',
    );

    await queryRunner.query(
      'ALTER TABLE cash_movements DROP FOREIGN KEY FK_cash_movements_actor',
    );
    await queryRunner.query(
      'ALTER TABLE cash_movements ADD CONSTRAINT FK_cash_movements_actor_membership FOREIGN KEY (tenant_id, actor_user_id) REFERENCES tenant_memberships(tenant_id, user_id) ON DELETE RESTRICT',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE cash_movements DROP FOREIGN KEY FK_cash_movements_actor_membership',
    );
    await queryRunner.query(
      'ALTER TABLE cash_movements ADD CONSTRAINT FK_cash_movements_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT',
    );

    await queryRunner.query(
      'ALTER TABLE cash_sessions DROP FOREIGN KEY FK_cash_sessions_closed_by_membership',
    );
    await queryRunner.query(
      'ALTER TABLE cash_sessions ADD CONSTRAINT FK_cash_sessions_closed_by FOREIGN KEY (closed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT',
    );

    await queryRunner.query(
      'ALTER TABLE cash_sessions DROP FOREIGN KEY FK_cash_sessions_opened_by_membership',
    );
    await queryRunner.query(
      'ALTER TABLE cash_sessions ADD CONSTRAINT FK_cash_sessions_opened_by FOREIGN KEY (opened_by_user_id) REFERENCES users(id) ON DELETE RESTRICT',
    );

    await queryRunner.query(
      'ALTER TABLE cash_sessions DROP CHECK CK_cash_sessions_nonnegative_amounts',
    );

    await queryRunner.query(
      'ALTER TABLE cash_registers DROP FOREIGN KEY FK_cash_register_creator_membership',
    );
    await queryRunner.query(
      'ALTER TABLE cash_registers ADD CONSTRAINT FK_cash_register_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT',
    );
  }
}
