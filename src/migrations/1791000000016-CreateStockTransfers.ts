import { MigrationInterface, QueryRunner } from 'typeorm';

/** Secuencias de documentos por empresa y transferencias de stock entre sucursales. */
export class CreateStockTransfers1791000000016 implements MigrationInterface {
  name = 'CreateStockTransfers1791000000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE document_sequences (
        tenant_id VARCHAR(36) NOT NULL,
        name VARCHAR(40) NOT NULL,
        value INT UNSIGNED NOT NULL DEFAULT 0,
        PRIMARY KEY (tenant_id, name),
        CONSTRAINT FK_document_sequences_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE stock_transfers (
        id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(36) NOT NULL,
        number INT UNSIGNED NOT NULL,
        origin_branch_id VARCHAR(36) NOT NULL,
        destination_branch_id VARCHAR(36) NOT NULL,
        status ENUM('SENT','RECEIVED','CANCELLED') NOT NULL DEFAULT 'SENT',
        notes VARCHAR(500) NULL,
        sent_by_user_id VARCHAR(36) NOT NULL,
        received_by_user_id VARCHAR(36) NULL,
        received_at TIMESTAMP(6) NULL,
        receipt_notes VARCHAR(500) NULL,
        cancelled_by_user_id VARCHAR(36) NULL,
        cancelled_at TIMESTAMP(6) NULL,
        cancel_reason VARCHAR(200) NULL,
        idempotency_key VARCHAR(100) NOT NULL,
        request_fingerprint CHAR(64) NOT NULL,
        created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_stock_transfers_tenant_idempotency (tenant_id, idempotency_key),
        UNIQUE KEY UQ_stock_transfers_tenant_number (tenant_id, number),
        KEY IDX_stock_transfers_origin (tenant_id, origin_branch_id, status, created_at),
        KEY IDX_stock_transfers_destination (tenant_id, destination_branch_id, status, created_at),
        CONSTRAINT FK_stock_transfers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT FK_stock_transfers_origin FOREIGN KEY (origin_branch_id) REFERENCES branches (id) ON DELETE RESTRICT,
        CONSTRAINT FK_stock_transfers_destination FOREIGN KEY (destination_branch_id) REFERENCES branches (id) ON DELETE RESTRICT,
        CONSTRAINT CK_stock_transfers_distinct_branches CHECK (origin_branch_id <> destination_branch_id)
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE stock_transfer_items (
        id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(36) NOT NULL,
        transfer_id VARCHAR(36) NOT NULL,
        product_id VARCHAR(36) NOT NULL,
        sku_snapshot VARCHAR(50) NOT NULL,
        name_snapshot VARCHAR(150) NOT NULL,
        quantity_sent DECIMAL(12,3) NOT NULL,
        quantity_received DECIMAL(12,3) NULL,
        unit_cost DECIMAL(12,2) NOT NULL,
        PRIMARY KEY (id),
        KEY IDX_stock_transfer_items_transfer (tenant_id, transfer_id),
        KEY IDX_stock_transfer_items_product (tenant_id, product_id),
        CONSTRAINT FK_stock_transfer_items_transfer FOREIGN KEY (transfer_id) REFERENCES stock_transfers (id) ON DELETE CASCADE,
        CONSTRAINT FK_stock_transfer_items_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
        CONSTRAINT CK_stock_transfer_items_quantities CHECK (quantity_sent > 0 AND (quantity_received IS NULL OR (quantity_received >= 0 AND quantity_received <= quantity_sent)))
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE stock_transfer_items');
    await queryRunner.query('DROP TABLE stock_transfers');
    await queryRunner.query('DROP TABLE document_sequences');
  }
}
