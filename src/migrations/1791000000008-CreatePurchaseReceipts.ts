import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePurchaseReceipts1791000000008 implements MigrationInterface {
  name = 'CreatePurchaseReceipts1791000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE purchase_receipts (
        id varchar(36) NOT NULL,
        tenant_id varchar(36) NOT NULL,
        branch_id varchar(36) NOT NULL,
        supplier_person_id varchar(36) NOT NULL,
        currency char(3) NOT NULL,
        source_document_type varchar(30) NULL,
        source_document_number varchar(80) NULL,
        subtotal decimal(14,2) NOT NULL,
        tax_total decimal(14,2) NOT NULL,
        total decimal(14,2) NOT NULL,
        idempotency_key varchar(100) NOT NULL,
        request_fingerprint char(64) NOT NULL,
        actor_user_id varchar(36) NOT NULL,
        created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_purchase_receipts_tenant_id (tenant_id, id),
        UNIQUE KEY UQ_purchase_receipts_tenant_idempotency (tenant_id, idempotency_key),
        KEY IDX_purchase_receipts_tenant_branch_created (tenant_id, branch_id, created_at),
        CONSTRAINT FK_purchase_receipts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        CONSTRAINT FK_purchase_receipts_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT FK_purchase_receipts_supplier FOREIGN KEY (tenant_id, supplier_person_id) REFERENCES persons(tenant_id, id) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE purchase_receipt_items (
        id varchar(36) NOT NULL,
        tenant_id varchar(36) NOT NULL,
        purchase_receipt_id varchar(36) NOT NULL,
        product_id varchar(36) NOT NULL,
        sku_snapshot varchar(50) NOT NULL,
        name_snapshot varchar(150) NOT NULL,
        quantity decimal(12,3) NOT NULL,
        unit_cost decimal(12,2) NOT NULL,
        tax_rate decimal(5,2) NOT NULL,
        net_amount decimal(14,2) NOT NULL,
        tax_amount decimal(14,2) NOT NULL,
        total decimal(14,2) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY UQ_purchase_receipt_items_tenant_receipt_product (tenant_id, purchase_receipt_id, product_id),
        KEY IDX_purchase_receipt_items_tenant_product (tenant_id, product_id),
        CONSTRAINT FK_purchase_receipt_items_receipt FOREIGN KEY (tenant_id, purchase_receipt_id) REFERENCES purchase_receipts(tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT FK_purchase_receipt_items_product FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE purchase_receipt_items');
    await queryRunner.query('DROP TABLE purchase_receipts');
  }
}
