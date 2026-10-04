import { MigrationInterface, QueryRunner } from 'typeorm';

const LEGACY_TENANT_ID = '00000000-0000-4000-8000-000000000001';

export class AddTenantScopeToCatalog1791000000001 implements MigrationInterface {
  name = 'AddTenantScopeToCatalog1791000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'INSERT IGNORE INTO tenants (id, slug, legal_name, status, time_zone, currency_code) VALUES (?, ?, ?, ?, ?, ?)',
      [LEGACY_TENANT_ID, 'legacy-default', 'Empresa migrada', 'ACTIVE', 'America/Argentina/Buenos_Aires', 'ARS'],
    );

    await queryRunner.query(
      'INSERT IGNORE INTO tenant_memberships (id, tenant_id, user_id, role, status, accepted_at) ' +
        'SELECT UUID(), ?, u.id, ' +
        'CASE ' +
        "WHEN MAX(CASE WHEN r.name = 'SUPER_ADMIN' THEN 1 ELSE 0 END) = 1 THEN 'OWNER' " +
        "WHEN MAX(CASE WHEN r.name = 'ADMIN' THEN 1 ELSE 0 END) = 1 THEN 'ADMIN' " +
        "WHEN MAX(CASE WHEN r.name = 'MANAGER' THEN 1 ELSE 0 END) = 1 THEN 'MANAGER' " +
        "WHEN MAX(CASE WHEN r.name = 'CASHIER' THEN 1 ELSE 0 END) = 1 THEN 'CASHIER' " +
        "WHEN MAX(CASE WHEN r.name = 'SELLER' THEN 1 ELSE 0 END) = 1 THEN 'SELLER' " +
        "WHEN MAX(CASE WHEN r.name IN ('WAREHOUSE', 'STOCK_CLERK') THEN 1 ELSE 0 END) = 1 THEN 'INVENTORY' " +
        "ELSE 'VIEWER' END, 'ACTIVE', CURRENT_TIMESTAMP(6) " +
        'FROM users u ' +
        'LEFT JOIN users_roles ur ON ur.user_id = u.id ' +
        'LEFT JOIN roles r ON r.id = ur.role_id ' +
        'GROUP BY u.id',
      [LEGACY_TENANT_ID],
    );

    await queryRunner.query('ALTER TABLE branches ADD COLUMN tenant_id varchar(36) NULL');
    await queryRunner.query(
      'UPDATE branches SET tenant_id = ? WHERE tenant_id IS NULL',
      [LEGACY_TENANT_ID],
    );
    await queryRunner.query(
      'ALTER TABLE branches MODIFY tenant_id varchar(36) NOT NULL, ' +
        'ADD UNIQUE KEY UQ_branches_tenant_code (tenant_id, code), ' +
        'ADD KEY IDX_branches_tenant_status (tenant_id, status), ' +
        'ADD CONSTRAINT FK_branches_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT',
    );

    await queryRunner.query('ALTER TABLE products ADD COLUMN tenant_id varchar(36) NULL');
    await queryRunner.query(
      'UPDATE products SET tenant_id = ? WHERE tenant_id IS NULL',
      [LEGACY_TENANT_ID],
    );
    await queryRunner.query(
      'ALTER TABLE products MODIFY tenant_id varchar(36) NOT NULL, ' +
        'ADD UNIQUE KEY UQ_products_tenant_sku (tenant_id, sku), ' +
        'ADD KEY IDX_products_tenant_barcode (tenant_id, barcode), ' +
        'ADD CONSTRAINT FK_products_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT',
    );

    // Remove the old global unique SKU index after the tenant-scoped key exists.
    const productIndexes: Array<{
      Key_name: string;
      Column_name: string;
      Non_unique: number;
    }> = await queryRunner.query('SHOW INDEX FROM products');
    const indexesByName = new Map<string, typeof productIndexes>();
    for (const index of productIndexes) {
      indexesByName.set(index.Key_name, [
        ...(indexesByName.get(index.Key_name) ?? []),
        index,
      ]);
    }
    for (const [name, indexes] of indexesByName) {
      if (
        name !== 'PRIMARY' &&
        indexes.length === 1 &&
        indexes[0].Column_name === 'sku' &&
        indexes[0].Non_unique === 0
      ) {
        await queryRunner.query('ALTER TABLE products DROP INDEX ' + name);
      }
    }

    await queryRunner.query(
      'ALTER TABLE product_branches ADD COLUMN tenant_id varchar(36) NULL',
    );
    await queryRunner.query(
      "UPDATE product_branches pb LEFT JOIN branches b ON b.id = pb.branch_id " +
        "SET pb.tenant_id = COALESCE(b.tenant_id, '" +
        LEGACY_TENANT_ID +
        "') WHERE pb.tenant_id IS NULL",
    );
    await queryRunner.query(
      'ALTER TABLE product_branches MODIFY tenant_id varchar(36) NOT NULL, ' +
        'ADD KEY IDX_product_branches_tenant_branch (tenant_id, branch_id), ' +
        'ADD CONSTRAINT FK_product_branches_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT',
    );

    await queryRunner.query(
      'ALTER TABLE price_lists ADD COLUMN tenant_id varchar(36) NULL',
    );
    await queryRunner.query(
      'UPDATE price_lists SET tenant_id = ? WHERE tenant_id IS NULL',
      [LEGACY_TENANT_ID],
    );
    await queryRunner.query(
      'ALTER TABLE price_lists MODIFY tenant_id varchar(36) NOT NULL, ' +
        'ADD KEY IDX_price_lists_tenant_active (tenant_id, is_active), ' +
        'ADD CONSTRAINT FK_price_lists_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE price_lists DROP FOREIGN KEY FK_price_lists_tenant, DROP INDEX IDX_price_lists_tenant_active, DROP COLUMN tenant_id',
    );
    await queryRunner.query(
      'ALTER TABLE product_branches DROP FOREIGN KEY FK_product_branches_tenant, DROP INDEX IDX_product_branches_tenant_branch, DROP COLUMN tenant_id',
    );
    await queryRunner.query(
      'ALTER TABLE products DROP FOREIGN KEY FK_products_tenant, DROP INDEX IDX_products_tenant_barcode, DROP INDEX UQ_products_tenant_sku, DROP COLUMN tenant_id',
    );
    await queryRunner.query(
      'ALTER TABLE branches DROP FOREIGN KEY FK_branches_tenant, DROP INDEX IDX_branches_tenant_status, DROP INDEX UQ_branches_tenant_code, DROP COLUMN tenant_id',
    );
  }
}
