import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roles múltiples por empresa: además del rol principal (`role`), una membresía puede tener
 * roles adicionales. Los permisos del usuario son la unión de todos.
 */
export class MembershipAdditionalRoles1791000000022 implements MigrationInterface {
  name = 'MembershipAdditionalRoles1791000000022';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `tenant_memberships` ADD `additional_roles` json NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `tenant_memberships` DROP COLUMN `additional_roles`');
  }
}
