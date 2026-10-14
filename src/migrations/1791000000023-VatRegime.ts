import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Régimen de IVA por empresa y por sucursal. Tierra del Fuego (Ley 19.640): las ventas se registran
 * exentas de IVA automáticamente, sin que el vendedor tenga que cargar la causa legal en cada venta.
 */
export class VatRegime1791000000023 implements MigrationInterface {
  name = 'VatRegime1791000000023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `tenants` ADD `default_vat_regime` enum ('GENERAL', 'TIERRA_DEL_FUEGO') NOT NULL DEFAULT 'GENERAL'");
    await queryRunner.query("ALTER TABLE `branches` ADD `vat_regime` enum ('GENERAL', 'TIERRA_DEL_FUEGO') NULL");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `branches` DROP COLUMN `vat_regime`');
    await queryRunner.query('ALTER TABLE `tenants` DROP COLUMN `default_vat_regime`');
  }
}
