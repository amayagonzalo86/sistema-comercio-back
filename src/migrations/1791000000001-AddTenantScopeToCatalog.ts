import { MigrationInterface, QueryRunner } from 'typeorm';

const LEGACY_TENANT_ID = '00000000-0000-4000-8000-000000000001';

export class AddTenantScopeToCatalog1791000000001 implements MigrationInterface {
  name = 'AddTenantScopeToCatalog1791000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE tenant_memberships MODIFY role enum('OWNER','ADMIN','MANAGER','ACCOUNTANT','CASHIER','INVENTORY','SELLER','VIEWER') NOT NULL",
    );
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

    await queryRunner.query('ALTER TABLE persons ADD COLUMN tenant_id varchar(36) NULL');
    await queryRunner.query(
      'UPDATE persons SET tenant_id = ? WHERE tenant_id IS NULL',
      [LEGACY_TENANT_ID],
    );
    await queryRunner.query(
      'ALTER TABLE persons MODIFY tenant_id varchar(36) NOT NULL, ' +
        'DROP INDEX idx_persons_national_id, DROP INDEX idx_persons_email, ' +
        'ADD UNIQUE KEY UQ_persons_tenant_national_id (tenant_id, national_id), ' +
        'ADD UNIQUE KEY UQ_persons_tenant_email (tenant_id, email), ' +
        'ADD KEY IDX_persons_tenant_active (tenant_id, is_active), ' +
        'ADD CONSTRAINT FK_persons_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT',
    );

    await queryRunner.query('ALTER TABLE branches ADD COLUMN tenant_id varchar(36) NULL');
    await queryRunner.query(
      'UPDATE branches SET tenant_id = ? WHERE tenant_id IS NULL',
      [LEGACY_TENANT_ID],
    );
    const duplicateBranchCode = await queryRunner.query(
      'SELECT code FROM branches GROUP BY code HAVING COUNT(*) > 1 LIMIT 1',
    );
    if (duplicateBranchCode.length > 0) {
      throw new Error(
        'No se puede migrar: existen códigos de sucursal duplicados. Corrija branches.code antes de reintentar.',
      );
    }

    await queryRunner.query(
      'ALTER TABLE branches MODIFY tenant_id varchar(36) NOT NULL, ' +
        'ADD UNIQUE KEY UQ_branches_tenant_code (tenant_id, code), ' +
        'ADD UNIQUE KEY UQ_branches_tenant_id (tenant_id, id), ' +
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
        'ADD UNIQUE KEY UQ_products_tenant_id (tenant_id, id), ' +
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
    const duplicateProductBranches = await queryRunner.query(
      'SELECT product_id, branch_id FROM product_branches GROUP BY product_id, branch_id HAVING COUNT(*) > 1 LIMIT 1',
    );
    if (duplicateProductBranches.length > 0) {
      throw new Error(
        'No se puede migrar: existen productos duplicados por sucursal en product_branches. Depure esas filas antes de reintentar.',
      );
    }
    await queryRunner.query(
      'ALTER TABLE product_branches MODIFY tenant_id varchar(36) NOT NULL, ' +
        'ADD UNIQUE KEY UQ_product_branches_tenant_product_branch (tenant_id, product_id, branch_id), ' +
        'ADD KEY IDX_product_branches_tenant_branch (tenant_id, branch_id), ' +
        'ADD CONSTRAINT FK_product_branches_tenant_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id) ON DELETE CASCADE, ' +
        'ADD CONSTRAINT FK_product_branches_tenant_product FOREIGN KEY (tenant_id, product_id) REFERENCES products (tenant_id, id) ON DELETE CASCADE',
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
    const duplicateLegacyPersonIdentifiers = await queryRunner.query(
      'SELECT national_id FROM persons WHERE national_id IS NOT NULL GROUP BY national_id HAVING COUNT(*) > 1 LIMIT 1',
    );
    const duplicateLegacyEmails = await queryRunner.query(
      'SELECT email FROM persons WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1 LIMIT 1',
    );
    if (duplicateLegacyPersonIdentifiers.length > 0 || duplicateLegacyEmails.length > 0) {
      throw new Error(
        'No se puede revertir: hay datos personales duplicados entre empresas; consolídelos antes de quitar el aislamiento.',
      );
    }
    await queryRunner.query(
      'ALTER TABLE persons DROP FOREIGN KEY FK_persons_tenant, DROP INDEX IDX_persons_tenant_active, DROP INDEX UQ_persons_tenant_email, DROP INDEX UQ_persons_tenant_national_id, ADD UNIQUE KEY idx_persons_email (email), ADD UNIQUE KEY idx_persons_national_id (national_id), DROP COLUMN tenant_id',
    );
    await queryRunner.query(
      'ALTER TABLE price_lists DROP FOREIGN KEY FK_price_lists_tenant, DROP INDEX IDX_price_lists_tenant_active, DROP COLUMN tenant_id',
    );
    await queryRunner.query(
      'ALTER TABLE product_branches DROP FOREIGN KEY FK_product_branches_tenant_branch, DROP FOREIGN KEY FK_product_branches_tenant_product, DROP INDEX IDX_product_branches_tenant_branch, DROP INDEX UQ_product_branches_tenant_product_branch, DROP COLUMN tenant_id',
    );
    await queryRunner.query(
      'ALTER TABLE products DROP FOREIGN KEY FK_products_tenant, DROP INDEX IDX_products_tenant_barcode, DROP INDEX UQ_products_tenant_id, DROP INDEX UQ_products_tenant_sku, DROP COLUMN tenant_id',
    );
    await queryRunner.query(
      'ALTER TABLE branches DROP FOREIGN KEY FK_branches_tenant, DROP INDEX IDX_branches_tenant_status, DROP INDEX UQ_branches_tenant_id, DROP INDEX UQ_branches_tenant_code, DROP COLUMN tenant_id',
    );
  }
}
