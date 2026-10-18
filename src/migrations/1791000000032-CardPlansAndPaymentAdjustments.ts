import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cobro con descuento de efectivo automático y planes de tarjeta.
 * - card_plans: tarjetas que carga el encargado/titular (tarjeta, banco o cualquier banco, cuotas, recargo,
 *   días de la semana y vigencia). Ej.: "Visa Banco de Tierra del Fuego · 12 cuotas sin interés" solo los jueves.
 * - sale_payments: plan usado, cuotas y el descuento/recargo de ese pago ("Ventas en efectivo (−5 %)").
 * - sale_items.payment_adjustment y sales.payment_adjustment_total: ajuste por medio de pago incluido en los importes.
 */
export class CardPlansAndPaymentAdjustments1791000000032 implements MigrationInterface {
  name = 'CardPlansAndPaymentAdjustments1791000000032';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`card_plans\` (
        \`id\` varchar(36) NOT NULL,
        \`tenant_id\` varchar(36) NOT NULL,
        \`name\` varchar(80) NOT NULL,
        \`card_brand\` enum ('VISA', 'MASTERCARD', 'AMEX', 'CABAL', 'NARANJA', 'MAESTRO', 'OTHER') NOT NULL DEFAULT 'OTHER',
        \`bank_name\` varchar(80) NULL,
        \`payment_method\` enum ('CREDIT_CARD', 'DEBIT_CARD') NOT NULL DEFAULT 'CREDIT_CARD',
        \`installments\` smallint UNSIGNED NOT NULL DEFAULT 1,
        \`surcharge_percentage\` decimal(7,2) NOT NULL DEFAULT 0,
        \`weekdays\` varchar(20) NULL,
        \`valid_from\` date NULL,
        \`valid_to\` date NULL,
        \`is_active\` tinyint NOT NULL DEFAULT 1,
        \`sort_order\` int NOT NULL DEFAULT 0,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\` datetime(6) NULL,
        INDEX \`IDX_card_plans_tenant_active\` (\`tenant_id\`, \`is_active\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
    await queryRunner.query('ALTER TABLE `sale_payments` ADD `card_plan_id` varchar(36) NULL');
    await queryRunner.query('ALTER TABLE `sale_payments` ADD `installments` smallint UNSIGNED NULL');
    await queryRunner.query('ALTER TABLE `sale_payments` ADD `adjustment_label` varchar(150) NULL');
    await queryRunner.query("ALTER TABLE `sale_payments` ADD `adjustment_amount` decimal(14,2) NOT NULL DEFAULT 0");
    await queryRunner.query("ALTER TABLE `sale_items` ADD `payment_adjustment` decimal(14,2) NOT NULL DEFAULT 0");
    await queryRunner.query("ALTER TABLE `sales` ADD `payment_adjustment_total` decimal(14,2) NOT NULL DEFAULT 0");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `sales` DROP COLUMN `payment_adjustment_total`');
    await queryRunner.query('ALTER TABLE `sale_items` DROP COLUMN `payment_adjustment`');
    await queryRunner.query('ALTER TABLE `sale_payments` DROP COLUMN `adjustment_amount`');
    await queryRunner.query('ALTER TABLE `sale_payments` DROP COLUMN `adjustment_label`');
    await queryRunner.query('ALTER TABLE `sale_payments` DROP COLUMN `installments`');
    await queryRunner.query('ALTER TABLE `sale_payments` DROP COLUMN `card_plan_id`');
    await queryRunner.query('DROP TABLE `card_plans`');
  }
}
