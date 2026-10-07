import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * IVA configurable por producto y por venta, datos fiscales de clientes y lista blanca IP por sucursal.
 *
 * Compatibilidad: los productos existentes quedan como GRAVADOS con precio NETO (price_includes_vat = 0),
 * que es exactamente como los calculaba la versión anterior. Las ventas históricas conservan sus importes;
 * su neto gravado se completa con el subtotal y la clase de comprobante queda NULL (no se infiere).
 */
export class AddVatComplianceAndBranchIpAllowlist1791000000014 implements MigrationInterface {
  name = 'AddVatComplianceAndBranchIpAllowlist1791000000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Productos: tratamiento de IVA y si el precio cargado ya lo incluye.
    await queryRunner.query(
      "ALTER TABLE products ADD COLUMN vat_treatment ENUM('TAXED','EXEMPT','NOT_TAXED') NOT NULL DEFAULT 'TAXED' AFTER tax_rate",
    );
    await queryRunner.query(
      'ALTER TABLE products ADD COLUMN price_includes_vat TINYINT(1) NOT NULL DEFAULT 0 AFTER vat_treatment',
    );
    // Un producto exento o no gravado no puede tener alícuota distinta de cero.
    await queryRunner.query(
      "ALTER TABLE products ADD CONSTRAINT CK_products_vat_treatment_rate CHECK (vat_treatment = 'TAXED' OR tax_rate = 0)",
    );

    // Personas: tipo de documento ARCA y condición frente al IVA.
    await queryRunner.query(
      'ALTER TABLE persons ADD COLUMN document_type SMALLINT UNSIGNED NULL AFTER national_id',
    );
    await queryRunner.query(
      "ALTER TABLE persons ADD COLUMN vat_condition VARCHAR(40) NOT NULL DEFAULT 'CONSUMIDOR_FINAL' AFTER document_type",
    );

    // Sucursales: lista blanca opcional de IP/CIDR.
    await queryRunner.query('ALTER TABLE branches ADD COLUMN allowed_ip_ranges JSON NULL');

    // Ventas: desglose fiscal y snapshots de condición de IVA.
    await queryRunner.query(`
      ALTER TABLE sales
        ADD COLUMN net_taxed_total DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER tax_total,
        ADD COLUMN exempt_total DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER net_taxed_total,
        ADD COLUMN not_taxed_total DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER exempt_total,
        ADD COLUMN voucher_class CHAR(1) NULL AFTER not_taxed_total,
        ADD COLUMN vat_charge_mode VARCHAR(30) NULL AFTER voucher_class,
        ADD COLUMN issuer_vat_condition VARCHAR(40) NULL AFTER vat_charge_mode,
        ADD COLUMN customer_vat_condition VARCHAR(40) NULL AFTER issuer_vat_condition,
        ADD COLUMN vat_exemption_reason VARCHAR(30) NULL AFTER customer_vat_condition,
        ADD COLUMN vat_exemption_note VARCHAR(200) NULL AFTER vat_exemption_reason
    `);
    await queryRunner.query('UPDATE sales SET net_taxed_total = subtotal');
    await queryRunner.query(
      'CREATE INDEX IDX_sales_tenant_voucher_created ON sales (tenant_id, voucher_class, created_at)',
    );

    // Ítems de venta: tratamiento, alícuota ARCA e importes exento/no gravado.
    await queryRunner.query(`
      ALTER TABLE sale_items
        ADD COLUMN vat_treatment VARCHAR(20) NULL AFTER tax_amount,
        ADD COLUMN arca_vat_rate_id SMALLINT UNSIGNED NULL AFTER vat_treatment,
        ADD COLUMN price_includes_vat TINYINT(1) NOT NULL DEFAULT 0 AFTER arca_vat_rate_id,
        ADD COLUMN exempt_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER price_includes_vat,
        ADD COLUMN not_taxed_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER exempt_amount
    `);
    await queryRunner.query("UPDATE sale_items SET vat_treatment = 'TAXED'");
    await queryRunner.query(`
      UPDATE sale_items SET arca_vat_rate_id = CASE tax_rate
        WHEN 0 THEN 3 WHEN 2.5 THEN 9 WHEN 5 THEN 8 WHEN 10.5 THEN 4 WHEN 21 THEN 5 WHEN 27 THEN 6
        ELSE NULL END
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE sale_items
        DROP COLUMN not_taxed_amount,
        DROP COLUMN exempt_amount,
        DROP COLUMN price_includes_vat,
        DROP COLUMN arca_vat_rate_id,
        DROP COLUMN vat_treatment
    `);
    await queryRunner.query('DROP INDEX IDX_sales_tenant_voucher_created ON sales');
    await queryRunner.query(`
      ALTER TABLE sales
        DROP COLUMN vat_exemption_note,
        DROP COLUMN vat_exemption_reason,
        DROP COLUMN customer_vat_condition,
        DROP COLUMN issuer_vat_condition,
        DROP COLUMN vat_charge_mode,
        DROP COLUMN voucher_class,
        DROP COLUMN not_taxed_total,
        DROP COLUMN exempt_total,
        DROP COLUMN net_taxed_total
    `);
    await queryRunner.query('ALTER TABLE branches DROP COLUMN allowed_ip_ranges');
    await queryRunner.query('ALTER TABLE persons DROP COLUMN vat_condition');
    await queryRunner.query('ALTER TABLE persons DROP COLUMN document_type');
    await queryRunner.query('ALTER TABLE products DROP CHECK CK_products_vat_treatment_rate');
    await queryRunner.query('ALTER TABLE products DROP COLUMN price_includes_vat');
    await queryRunner.query('ALTER TABLE products DROP COLUMN vat_treatment');
  }
}
