import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSalesModule1791000000004 implements MigrationInterface {
  name = 'CreateSalesModule1791000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE sales (
        id varchar(36) NOT NULL,
        tenant_id varchar(36) NOT NULL,
        branch_id varchar(36) NOT NULL,
        customer_person_id varchar(36) NULL,
        currency char(3) NOT NULL,
        subtotal decimal(14,2) NOT NULL,
        tax_total decimal(14,2) NOT NULL,
        total decimal(14,2) NOT NULL,
        fiscal_status enum('NOT_ISSUED','PENDING','AUTHORIZED','REJECTED','FAILED') NOT NULL DEFAULT 'NOT_ISSUED',
        idempotency_key varchar(100) NOT NULL,
        request_fingerprint char(64) NOT NULL,
        actor_user_id varchar(36) NOT NULL,
        created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_sales_tenant_id (tenant_id, id),
        UNIQUE KEY UQ_sales_tenant_idempotency (tenant_id, idempotency_key),
        KEY IDX_sales_tenant_branch_created (tenant_id, branch_id, created_at),
        CONSTRAINT FK_sales_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT FK_sales_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT FK_sales_customer FOREIGN KEY (tenant_id, customer_person_id) REFERENCES persons (tenant_id, id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE sale_items (
        id varchar(36) NOT NULL,
        tenant_id varchar(36) NOT NULL,
        sale_id varchar(36) NOT NULL,
        product_id varchar(36) NOT NULL,
        sku_snapshot varchar(50) NOT NULL,
        name_snapshot varchar(150) NOT NULL,
        quantity decimal(12,3) NOT NULL,
        unit_price decimal(12,2) NOT NULL,
        tax_rate decimal(5,2) NOT NULL,
        net_amount decimal(14,2) NOT NULL,
        tax_amount decimal(14,2) NOT NULL,
        total decimal(14,2) NOT NULL,
        PRIMARY KEY (id),
        KEY IDX_sale_items_tenant_sale (tenant_id, sale_id),
        CONSTRAINT FK_sale_items_sale FOREIGN KEY (tenant_id, sale_id) REFERENCES sales (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT FK_sale_items_product FOREIGN KEY (tenant_id, product_id) REFERENCES products (tenant_id, id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE sale_payments (
        id varchar(36) NOT NULL,
        tenant_id varchar(36) NOT NULL,
        sale_id varchar(36) NOT NULL,
        method enum('CASH','DEBIT_CARD','CREDIT_CARD','BANK_TRANSFER','QR','OTHER') NOT NULL,
        amount decimal(14,2) NOT NULL,
        currency char(3) NOT NULL,
        external_reference varchar(100) NULL,
        created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        KEY IDX_sale_payments_tenant_sale (tenant_id, sale_id),
        CONSTRAINT FK_sale_payments_sale FOREIGN KEY (tenant_id, sale_id) REFERENCES sales (tenant_id, id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const existingSales = await queryRunner.query('SELECT id FROM sales LIMIT 1');
    if (existingSales.length > 0) {
      throw new Error(
        'No se puede revertir ventas con operaciones registradas; conserve el historial contable.',
      );
    }
    await queryRunner.query('DROP TABLE sale_payments');
    await queryRunner.query('DROP TABLE sale_items');
    await queryRunner.query('DROP TABLE sales');
  }
}
