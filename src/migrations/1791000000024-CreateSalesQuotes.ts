import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Presupuestos "X" (no válidos como factura): los emite el vendedor, valen 24 horas y luego se borran.
 * Dentro de ese plazo, quien lo emitió puede pasarlo a pedido de venta para cobrarlo en caja.
 */
export class CreateSalesQuotes1791000000024 implements MigrationInterface {
  name = 'CreateSalesQuotes1791000000024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE sales_quotes (
        id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(36) NOT NULL,
        branch_id VARCHAR(36) NOT NULL,
        number INT UNSIGNED NOT NULL,
        seller_user_id VARCHAR(36) NOT NULL,
        customer_person_id VARCHAR(36) NULL,
        notes VARCHAR(300) NULL,
        currency CHAR(3) NOT NULL,
        voucher_class CHAR(1) NULL,
        vat_regime VARCHAR(20) NOT NULL,
        subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
        tax_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        discount_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        total DECIMAL(14,2) NOT NULL DEFAULT 0,
        \`lines\` JSON NOT NULL,
        expires_at TIMESTAMP(6) NOT NULL,
        idempotency_key VARCHAR(100) NOT NULL,
        request_fingerprint CHAR(64) NOT NULL,
        created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_sales_quotes_tenant_idempotency (tenant_id, idempotency_key),
        KEY IDX_sales_quotes_tenant_number (tenant_id, number),
        KEY IDX_sales_quotes_seller (tenant_id, seller_user_id, created_at),
        KEY IDX_sales_quotes_expires (expires_at),
        CONSTRAINT FK_sales_quotes_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT FK_sales_quotes_branch FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE sales_quotes');
  }
}
