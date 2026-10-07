import { MigrationInterface, QueryRunner } from 'typeorm';

/** Devoluciones de ventas, costo histórico por ítem (márgenes) y estado de devolución de la venta. */
export class CreateSaleReturns1791000000018 implements MigrationInterface {
  name = 'CreateSaleReturns1791000000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE sale_items ADD COLUMN unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0');
    // Ventas históricas: se aproxima el costo con el costo actual del producto en la sucursal.
    await queryRunner.query(`
      UPDATE sale_items si
        JOIN sales s ON s.id = si.sale_id
        JOIN product_branches pb ON pb.tenant_id = si.tenant_id AND pb.product_id = si.product_id AND pb.branch_id = s.branch_id
      SET si.unit_cost = pb.cost_price
    `);
    await queryRunner.query(`
      ALTER TABLE sales
        ADD COLUMN return_status ENUM('NONE','PARTIAL','FULL') NOT NULL DEFAULT 'NONE' AFTER fiscal_status,
        ADD COLUMN refunded_total DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER return_status
    `);
    await queryRunner.query('CREATE INDEX IDX_sales_tenant_created ON sales (tenant_id, created_at)');
    await queryRunner.query('CREATE INDEX IDX_sales_tenant_customer ON sales (tenant_id, customer_person_id, created_at)');
    await queryRunner.query(`
      CREATE TABLE sale_returns (
        id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(36) NOT NULL,
        number INT UNSIGNED NOT NULL,
        sale_id VARCHAR(36) NOT NULL,
        branch_id VARCHAR(36) NOT NULL,
        reason VARCHAR(200) NOT NULL,
        restock TINYINT(1) NOT NULL DEFAULT 1,
        refund_method ENUM('CASH','ORIGINAL_METHOD','STORE_CREDIT') NOT NULL,
        cash_session_id VARCHAR(36) NULL,
        external_reference VARCHAR(100) NULL,
        subtotal DECIMAL(14,2) NOT NULL,
        tax_total DECIMAL(14,2) NOT NULL,
        total DECIMAL(14,2) NOT NULL,
        currency CHAR(3) NOT NULL,
        fiscal_status VARCHAR(20) NOT NULL DEFAULT 'NOT_ISSUED',
        idempotency_key VARCHAR(100) NOT NULL,
        request_fingerprint CHAR(64) NOT NULL,
        actor_user_id VARCHAR(36) NOT NULL,
        created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_sale_returns_tenant_number (tenant_id, number),
        UNIQUE KEY UQ_sale_returns_tenant_idempotency (tenant_id, idempotency_key),
        KEY IDX_sale_returns_sale (tenant_id, sale_id),
        KEY IDX_sale_returns_branch_created (tenant_id, branch_id, created_at),
        CONSTRAINT FK_sale_returns_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT FK_sale_returns_sale FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`
      CREATE TABLE sale_return_items (
        id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(36) NOT NULL,
        sale_return_id VARCHAR(36) NOT NULL,
        sale_item_id VARCHAR(36) NOT NULL,
        product_id VARCHAR(36) NOT NULL,
        quantity DECIMAL(12,3) NOT NULL,
        net_amount DECIMAL(14,2) NOT NULL,
        tax_amount DECIMAL(14,2) NOT NULL,
        exempt_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        not_taxed_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        total DECIMAL(14,2) NOT NULL,
        unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        KEY IDX_sale_return_items_return (tenant_id, sale_return_id),
        KEY IDX_sale_return_items_sale_item (tenant_id, sale_item_id),
        CONSTRAINT FK_sale_return_items_return FOREIGN KEY (sale_return_id) REFERENCES sale_returns (id) ON DELETE CASCADE,
        CONSTRAINT FK_sale_return_items_sale_item FOREIGN KEY (sale_item_id) REFERENCES sale_items (id) ON DELETE RESTRICT,
        CONSTRAINT CK_sale_return_items_quantity CHECK (quantity > 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE sale_return_items');
    await queryRunner.query('DROP TABLE sale_returns');
    await queryRunner.query('DROP INDEX IDX_sales_tenant_customer ON sales');
    await queryRunner.query('DROP INDEX IDX_sales_tenant_created ON sales');
    await queryRunner.query('ALTER TABLE sales DROP COLUMN refunded_total, DROP COLUMN return_status');
    await queryRunner.query('ALTER TABLE sale_items DROP COLUMN unit_cost');
  }
}
