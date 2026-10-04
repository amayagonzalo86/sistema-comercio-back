import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInventoryLedger1791000000003 implements MigrationInterface {
  name = 'CreateInventoryLedger1791000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE inventory_movements (
        id bigint unsigned NOT NULL AUTO_INCREMENT,
        tenant_id varchar(36) NOT NULL,
        product_id varchar(36) NOT NULL,
        branch_id varchar(36) NOT NULL,
        movement_type enum('OPENING','ADJUSTMENT','PURCHASE','SALE','RETURN','TRANSFER_IN','TRANSFER_OUT') NOT NULL,
        quantity_delta decimal(12,3) NOT NULL,
        quantity_before decimal(12,3) NOT NULL,
        quantity_after decimal(12,3) NOT NULL,
        reason varchar(255) NOT NULL,
        reference_type varchar(50) NULL,
        reference_id varchar(36) NULL,
        idempotency_key varchar(100) NOT NULL,
        actor_user_id varchar(36) NULL,
        created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_inventory_movements_tenant_idempotency (tenant_id, idempotency_key),
        KEY IDX_inventory_movements_stock_cursor (tenant_id, product_id, branch_id, id),
        KEY IDX_inventory_movements_tenant_time (tenant_id, created_at),
        CONSTRAINT FK_inventory_movements_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT FK_inventory_movements_product FOREIGN KEY (tenant_id, product_id) REFERENCES products (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT FK_inventory_movements_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      INSERT INTO inventory_movements (
        tenant_id, product_id, branch_id, movement_type, quantity_delta,
        quantity_before, quantity_after, reason, reference_type, reference_id,
        idempotency_key, actor_user_id, created_at
      )
      SELECT tenant_id, product_id, branch_id, 'OPENING', stock, 0, stock,
        'Saldo inicial importado durante la migración', 'LEGACY_IMPORT', id,
        CONCAT('legacy-opening:', id), NULL, created_at
      FROM product_branches
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const operationalMovements = await queryRunner.query(
      "SELECT id FROM inventory_movements WHERE movement_type <> 'OPENING' LIMIT 1",
    );
    if (operationalMovements.length > 0) {
      throw new Error(
        'No se puede revertir el libro de inventario después de registrar movimientos operativos.',
      );
    }
    await queryRunner.query('DROP TABLE inventory_movements');
  }
}
