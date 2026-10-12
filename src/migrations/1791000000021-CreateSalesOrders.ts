import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Preventa: el vendedor arma un pedido de venta (con número) y el cliente lo paga en caja.
 * Las ventas guardan el pedido de origen y el vendedor, para comisiones y reportes.
 */
export class CreateSalesOrders1791000000021 implements MigrationInterface {
  name = 'CreateSalesOrders1791000000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE sales_orders (
        id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(36) NOT NULL,
        branch_id VARCHAR(36) NOT NULL,
        number INT UNSIGNED NOT NULL,
        customer_person_id VARCHAR(36) NULL,
        seller_user_id VARCHAR(36) NOT NULL,
        status ENUM('PENDING','CHARGED','CANCELLED') NOT NULL DEFAULT 'PENDING',
        notes VARCHAR(300) NULL,
        currency CHAR(3) NOT NULL,
        voucher_class CHAR(1) NULL,
        estimated_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        items_count INT UNSIGNED NOT NULL DEFAULT 0,
        sale_id VARCHAR(36) NULL,
        charged_by_user_id VARCHAR(36) NULL,
        charged_at TIMESTAMP(6) NULL,
        cancelled_by_user_id VARCHAR(36) NULL,
        cancelled_at TIMESTAMP(6) NULL,
        cancel_reason VARCHAR(200) NULL,
        idempotency_key VARCHAR(100) NOT NULL,
        request_fingerprint CHAR(64) NOT NULL,
        created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_sales_orders_tenant_number (tenant_id, number),
        UNIQUE KEY UQ_sales_orders_tenant_idempotency (tenant_id, idempotency_key),
        KEY IDX_sales_orders_queue (tenant_id, branch_id, status, created_at),
        KEY IDX_sales_orders_seller (tenant_id, seller_user_id, created_at),
        CONSTRAINT FK_sales_orders_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT FK_sales_orders_branch FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE sales_order_items (
        id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(36) NOT NULL,
        sales_order_id VARCHAR(36) NOT NULL,
        product_id VARCHAR(36) NOT NULL,
        sku_snapshot VARCHAR(50) NOT NULL,
        name_snapshot VARCHAR(150) NOT NULL,
        quantity DECIMAL(12,3) NOT NULL,
        unit_price DECIMAL(12,2) NOT NULL,
        discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        total DECIMAL(14,2) NOT NULL,
        PRIMARY KEY (id),
        KEY IDX_sales_order_items_order (tenant_id, sales_order_id),
        CONSTRAINT FK_sales_order_items_order FOREIGN KEY (sales_order_id) REFERENCES sales_orders (id) ON DELETE CASCADE,
        CONSTRAINT FK_sales_order_items_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);
    await queryRunner.query('ALTER TABLE sales ADD COLUMN sales_order_id VARCHAR(36) NULL AFTER customer_person_id');
    await queryRunner.query('ALTER TABLE sales ADD COLUMN seller_user_id VARCHAR(36) NULL AFTER sales_order_id');
    await queryRunner.query('CREATE INDEX IDX_sales_tenant_seller ON sales (tenant_id, seller_user_id, created_at)');
    await queryRunner.query('CREATE INDEX IDX_sales_tenant_order ON sales (tenant_id, sales_order_id)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IDX_sales_tenant_order ON sales');
    await queryRunner.query('DROP INDEX IDX_sales_tenant_seller ON sales');
    await queryRunner.query('ALTER TABLE sales DROP COLUMN seller_user_id');
    await queryRunner.query('ALTER TABLE sales DROP COLUMN sales_order_id');
    await queryRunner.query('DROP TABLE sales_order_items');
    await queryRunner.query('DROP TABLE sales_orders');
  }
}
