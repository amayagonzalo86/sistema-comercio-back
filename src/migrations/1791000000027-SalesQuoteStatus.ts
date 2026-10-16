import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Los presupuestos X ya no se borran: quedan como historial con su estado.
 * ACTIVE (vigente 24 h) → EXPIRED (venció) | CONVERTED (pasó a pedido) | DISCARDED (descartado).
 */
export class SalesQuoteStatus1791000000027 implements MigrationInterface {
  name = 'SalesQuoteStatus1791000000027';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `sales_quotes` ADD `status` enum ('ACTIVE', 'EXPIRED', 'CONVERTED', 'DISCARDED') NOT NULL DEFAULT 'ACTIVE'");
    await queryRunner.query('ALTER TABLE `sales_quotes` ADD `converted_order_id` varchar(36) NULL');
    await queryRunner.query('ALTER TABLE `sales_quotes` ADD `closed_at` timestamp(6) NULL');
    await queryRunner.query('ALTER TABLE `sales_quotes` ADD `closed_by_user_id` varchar(36) NULL');
    await queryRunner.query("UPDATE `sales_quotes` SET `status` = 'EXPIRED', `closed_at` = `expires_at` WHERE `expires_at` <= UTC_TIMESTAMP(6)");
    await queryRunner.query('CREATE INDEX `IDX_sales_quotes_status` ON `sales_quotes` (`tenant_id`, `status`, `expires_at`)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX `IDX_sales_quotes_status` ON `sales_quotes`');
    await queryRunner.query('ALTER TABLE `sales_quotes` DROP COLUMN `closed_by_user_id`');
    await queryRunner.query('ALTER TABLE `sales_quotes` DROP COLUMN `closed_at`');
    await queryRunner.query('ALTER TABLE `sales_quotes` DROP COLUMN `converted_order_id`');
    await queryRunner.query('ALTER TABLE `sales_quotes` DROP COLUMN `status`');
  }
}
