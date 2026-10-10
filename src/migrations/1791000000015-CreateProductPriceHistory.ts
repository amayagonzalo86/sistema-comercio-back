import { MigrationInterface, QueryRunner } from 'typeorm';

/** Historial de costos y precios por producto y sucursal (ajustes manuales y masivos). */
export class CreateProductPriceHistory1791000000015 implements MigrationInterface {
  name = 'CreateProductPriceHistory1791000000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE product_price_history (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        tenant_id VARCHAR(36) NOT NULL,
        product_id VARCHAR(36) NOT NULL,
        branch_id VARCHAR(36) NOT NULL,
        old_cost_price DECIMAL(12,2) NOT NULL,
        new_cost_price DECIMAL(12,2) NOT NULL,
        old_selling_price DECIMAL(12,2) NOT NULL,
        new_selling_price DECIMAL(12,2) NOT NULL,
        reason VARCHAR(200) NOT NULL,
        batch_id VARCHAR(36) NULL,
        actor_user_id VARCHAR(36) NOT NULL,
        created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        KEY IDX_price_history_product (tenant_id, product_id, created_at),
        KEY IDX_price_history_batch (tenant_id, batch_id),
        CONSTRAINT FK_price_history_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);
    // Búsquedas del catálogo por categoría y marca.
    await queryRunner.query('CREATE INDEX IDX_products_tenant_category ON products (tenant_id, category)');
    await queryRunner.query('CREATE INDEX IDX_products_tenant_brand ON products (tenant_id, brand)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IDX_products_tenant_brand ON products');
    await queryRunner.query('DROP INDEX IDX_products_tenant_category ON products');
    await queryRunner.query('DROP TABLE product_price_history');
  }
}
