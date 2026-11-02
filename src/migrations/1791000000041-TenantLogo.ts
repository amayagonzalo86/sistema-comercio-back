import { MigrationInterface, QueryRunner } from 'typeorm';

/** Logo de la empresa (menú, pestaña del navegador y comprobantes no fiscales). */
export class TenantLogo1791000000041 implements MigrationInterface {
  name = 'TenantLogo1791000000041';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `tenants` ADD `logo_path` varchar(60) NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `tenants` DROP COLUMN `logo_path`');
  }
}
