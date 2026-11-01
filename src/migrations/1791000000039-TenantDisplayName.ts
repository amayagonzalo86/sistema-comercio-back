import { MigrationInterface, QueryRunner } from 'typeorm';

/** Nombre que se muestra en el sistema (encabezado del menú), asignado por el operador de la plataforma. */
export class TenantDisplayName1791000000039 implements MigrationInterface {
  name = 'TenantDisplayName1791000000039';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `tenants` ADD `display_name` varchar(60) NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `tenants` DROP COLUMN `display_name`');
  }
}
