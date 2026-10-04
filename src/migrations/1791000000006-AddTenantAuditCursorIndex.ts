import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenantAuditCursorIndex1791000000006 implements MigrationInterface {
  name = 'AddTenantAuditCursorIndex1791000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX IDX_audit_tenant_id ON audit_events (tenant_id, id)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IDX_audit_tenant_id ON audit_events',
    );
  }
}
