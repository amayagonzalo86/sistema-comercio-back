import { MigrationInterface, QueryRunner } from 'typeorm';

/** Promociones automáticas, descuentos en ventas y consentimiento de marketing (Ley 25.326). */
export class CreatePromotionsAndMarketingConsent1791000000019 implements MigrationInterface {
  name = 'CreatePromotionsAndMarketingConsent1791000000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE promotions (
        id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(36) NOT NULL,
        name VARCHAR(120) NOT NULL,
        description VARCHAR(500) NULL,
        type ENUM('PERCENTAGE','BUY_X_PAY_Y') NOT NULL,
        percent_basis_points INT UNSIGNED NULL,
        buy_quantity INT UNSIGNED NULL,
        pay_quantity INT UNSIGNED NULL,
        product_ids JSON NULL,
        categories JSON NULL,
        brands JSON NULL,
        branch_ids JSON NULL,
        weekdays JSON NULL,
        min_quantity DECIMAL(12,3) NULL,
        starts_at DATE NULL,
        ends_at DATE NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_by_user_id VARCHAR(36) NOT NULL,
        created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        KEY IDX_promotions_tenant_active (tenant_id, is_active, starts_at, ends_at),
        CONSTRAINT FK_promotions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT CK_promotions_rule CHECK (
          (type = 'PERCENTAGE' AND percent_basis_points BETWEEN 1 AND 10000)
          OR (type = 'BUY_X_PAY_Y' AND buy_quantity > pay_quantity AND pay_quantity >= 1)
        )
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`
      ALTER TABLE sale_items
        ADD COLUMN discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN promotion_id VARCHAR(36) NULL,
        ADD COLUMN promotion_name VARCHAR(120) NULL
    `);
    await queryRunner.query('ALTER TABLE sales ADD COLUMN discount_total DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER net_taxed_total');
    await queryRunner.query(`
      ALTER TABLE persons
        ADD COLUMN marketing_consent TINYINT(1) NOT NULL DEFAULT 0,
        ADD COLUMN marketing_consent_at TIMESTAMP(6) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE persons DROP COLUMN marketing_consent_at, DROP COLUMN marketing_consent');
    await queryRunner.query('ALTER TABLE sales DROP COLUMN discount_total');
    await queryRunner.query('ALTER TABLE sale_items DROP COLUMN promotion_name, DROP COLUMN promotion_id, DROP COLUMN discount_amount');
    await queryRunner.query('DROP TABLE promotions');
  }
}
