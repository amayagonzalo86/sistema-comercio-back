import { MigrationInterface, QueryRunner } from 'typeorm';

/** Datos que la empresa imprime en facturas y presupuestos: WhatsApp, web, leyenda, condición y descuento contado. */
export class TenantPrintSettings1791000000042 implements MigrationInterface {
  name = 'TenantPrintSettings1791000000042';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `tenants` ' +
        'ADD `print_whatsapp` varchar(30) NULL, ' +
        'ADD `print_website` varchar(120) NULL, ' +
        'ADD `invoice_legend` varchar(300) NULL, ' +
        'ADD `quote_condition` varchar(80) NULL, ' +
        "ADD `quote_cash_discount` decimal(5,2) NOT NULL DEFAULT '0.00'",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `tenants` DROP COLUMN `quote_cash_discount`, DROP COLUMN `quote_condition`, DROP COLUMN `invoice_legend`, ' +
        'DROP COLUMN `print_website`, DROP COLUMN `print_whatsapp`',
    );
  }
}
