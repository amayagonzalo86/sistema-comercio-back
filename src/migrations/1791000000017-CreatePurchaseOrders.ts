import { MigrationInterface, QueryRunner } from 'typeorm';

/** Pedidos de compra a proveedores y vínculo de las recepciones con su pedido. */
export class CreatePurchaseOrders1791000000017 implements MigrationInterface {
  name = 'CreatePurchaseOrders1791000000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE purchase_orders (
        id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(36) NOT NULL,
        number INT UNSIGNED NOT NULL,
        supplier_person_id VARCHAR(36) NOT NULL,
        branch_id VARCHAR(36) NOT NULL,
        status ENUM('DRAFT','SENT','PARTIALLY_RECEIVED','RECEIVED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
        expected_date DATE NULL,
        notes VARCHAR(500) NULL,
        currency CHAR(3) NOT NULL,
        estimated_total DECIMAL(14,2) NOT NULL DEFAULT 0,
        created_by_user_id VARCHAR(36) NOT NULL,
        sent_at TIMESTAMP(6) NULL,
        closed_at TIMESTAMP(6) NULL,
        cancel_reason VARCHAR(200) NULL,
        created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_purchase_orders_tenant_number (tenant_id, number),
        KEY IDX_purchase_orders_tenant_status (tenant_id, status, created_at),
        KEY IDX_purchase_orders_supplier (tenant_id, supplier_person_id, created_at),
        KEY IDX_purchase_orders_branch (tenant_id, branch_id, created_at),
        CONSTRAINT FK_purchase_orders_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT FK_purchase_orders_supplier FOREIGN KEY (supplier_person_id) REFERENCES persons (id) ON DELETE RESTRICT,
        CONSTRAINT FK_purchase_orders_branch FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`
      CREATE TABLE purchase_order_items (
        id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(36) NOT NULL,
        purchase_order_id VARCHAR(36) NOT NULL,
        product_id VARCHAR(36) NOT NULL,
        sku_snapshot VARCHAR(50) NOT NULL,
        name_snapshot VARCHAR(150) NOT NULL,
        quantity_ordered DECIMAL(12,3) NOT NULL,
        quantity_received DECIMAL(12,3) NOT NULL DEFAULT 0,
        unit_cost DECIMAL(12,2) NOT NULL,
        tax_rate DECIMAL(5,2) NOT NULL DEFAULT 21,
        PRIMARY KEY (id),
        KEY IDX_purchase_order_items_order (tenant_id, purchase_order_id),
        KEY IDX_purchase_order_items_product (tenant_id, product_id),
        CONSTRAINT FK_purchase_order_items_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders (id) ON DELETE CASCADE,
        CONSTRAINT FK_purchase_order_items_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
        CONSTRAINT CK_purchase_order_items_quantities CHECK (quantity_ordered > 0 AND quantity_received >= 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query('ALTER TABLE purchase_receipts ADD COLUMN purchase_order_id VARCHAR(36) NULL AFTER supplier_person_id');
    await queryRunner.query('CREATE INDEX IDX_purchase_receipts_order ON purchase_receipts (tenant_id, purchase_order_id)');
    await queryRunner.query(
      'ALTER TABLE purchase_receipts ADD CONSTRAINT FK_purchase_receipts_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders (id) ON DELETE RESTRICT',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE purchase_receipts DROP FOREIGN KEY FK_purchase_receipts_order');
    await queryRunner.query('DROP INDEX IDX_purchase_receipts_order ON purchase_receipts');
    await queryRunner.query('ALTER TABLE purchase_receipts DROP COLUMN purchase_order_id');
    await queryRunner.query('DROP TABLE purchase_order_items');
    await queryRunner.query('DROP TABLE purchase_orders');
  }
}
