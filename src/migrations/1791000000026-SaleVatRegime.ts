import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Régimen de IVA con el que se hizo cada venta (foto al momento de vender).
 * Define qué leyendas lleva el comprobante: en Tierra del Fuego (Ley 19.640) no corresponde el apartado
 * del Régimen de Transparencia Fiscal al Consumidor (Ley 27.743), sino la leyenda de operación exenta.
 * Las ventas existentes exentas por Ley 19.640 quedan marcadas como Tierra del Fuego.
 */
export class SaleVatRegime1791000000026 implements MigrationInterface {
  name = 'SaleVatRegime1791000000026';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `sales` ADD `vat_regime` enum ('GENERAL', 'TIERRA_DEL_FUEGO') NOT NULL DEFAULT 'GENERAL'");
    await queryRunner.query("UPDATE `sales` SET `vat_regime` = 'TIERRA_DEL_FUEGO' WHERE `vat_exemption_reason` = 'TIERRA_DEL_FUEGO'");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `sales` DROP COLUMN `vat_regime`');
  }
}
