import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El presupuesto guarda las formas de pago que ofrecía al emitirse (descuento de efectivo de la lista de efectivo y
 * cuotas sin interés vigentes). El % de descuento manual de la empresa deja de usarse: sale de la lista de efectivo.
 */
export class QuotePaymentTerms1791000000043 implements MigrationInterface {
  name = 'QuotePaymentTerms1791000000043';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `sales_quotes` ADD `payment_terms` json NULL');
    await queryRunner.query('ALTER TABLE `tenants` DROP COLUMN `quote_cash_discount`');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `tenants` ADD `quote_cash_discount` decimal(5,2) NOT NULL DEFAULT '0.00'");
    await queryRunner.query('ALTER TABLE `sales_quotes` DROP COLUMN `payment_terms`');
  }
}
