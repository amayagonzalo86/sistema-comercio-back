import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cuentas corrientes de clientes.
 * - persons: cuenta habilitada, límite de crédito y plazo de pago.
 * - tenants: interés mensual por mora.
 * - price_lists: condición ACCOUNT_ONLY (lista de cuenta corriente, ej. +10 %).
 * - sale_payments: medio ACCOUNT. cash_movements: tipo COLLECTION (cobranza en efectivo).
 * - customer_account_entries / allocations: libro de la cuenta e imputaciones.
 * - customer_receipts / customer_receipt_payments: recibos de cobranza.
 * - customer_credit_authorizations: excepciones del encargado al límite de crédito.
 * - received_checks: cheques recibidos también en recibos (sale_id opcional).
 */
export class CustomerAccounts1791000000037 implements MigrationInterface {
  name = 'CustomerAccounts1791000000037';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `persons` ADD `credit_enabled` tinyint NOT NULL DEFAULT 0');
    await queryRunner.query('ALTER TABLE `persons` ADD `credit_limit` decimal(14,2) NULL');
    await queryRunner.query('ALTER TABLE `persons` ADD `credit_term_days` smallint UNSIGNED NOT NULL DEFAULT 30');
    await queryRunner.query('ALTER TABLE `tenants` ADD `late_interest_monthly` decimal(5,2) NOT NULL DEFAULT 0');
    await queryRunner.query(
      "ALTER TABLE `price_lists` MODIFY `payment_condition` enum ('ANY', 'CASH_ONLY', 'ACCOUNT_ONLY') NOT NULL DEFAULT 'ANY'",
    );
    await queryRunner.query(
      "ALTER TABLE `sale_payments` MODIFY `method` enum ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'BANK_TRANSFER', 'QR', 'CHECK', 'ACCOUNT', 'OTHER') NOT NULL",
    );
    await queryRunner.query(
      "ALTER TABLE `cash_movements` MODIFY `type` enum ('OPENING', 'SALE', 'REFUND', 'INCOME', 'EXPENSE', 'ADJUSTMENT', 'COLLECTION') NOT NULL",
    );

    await queryRunner.query(`
      CREATE TABLE \`customer_account_entries\` (
        \`id\` varchar(36) NOT NULL,
        \`tenant_id\` varchar(36) NOT NULL,
        \`branch_id\` varchar(36) NOT NULL,
        \`customer_person_id\` varchar(36) NOT NULL,
        \`kind\` enum ('SALE', 'DEBIT_NOTE', 'CREDIT_NOTE', 'RETURN', 'RECEIPT', 'REJECTED_CHECK') NOT NULL,
        \`direction\` enum ('DEBIT', 'CREDIT') NOT NULL,
        \`source_type\` varchar(30) NOT NULL,
        \`source_id\` varchar(36) NOT NULL,
        \`sale_id\` varchar(36) NULL,
        \`description\` varchar(200) NOT NULL,
        \`amount\` decimal(14,2) NOT NULL,
        \`amount_applied\` decimal(14,2) NOT NULL DEFAULT 0,
        \`currency\` char(3) NOT NULL,
        \`due_date\` date NULL,
        \`interest_through\` date NULL,
        \`actor_user_id\` varchar(36) NOT NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        INDEX \`IDX_account_entries_customer\` (\`tenant_id\`, \`customer_person_id\`, \`created_at\`),
        INDEX \`IDX_account_entries_customer_due\` (\`tenant_id\`, \`customer_person_id\`, \`direction\`, \`due_date\`),
        UNIQUE INDEX \`UQ_account_entries_source\` (\`tenant_id\`, \`source_type\`, \`source_id\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE \`customer_account_allocations\` (
        \`id\` varchar(36) NOT NULL,
        \`tenant_id\` varchar(36) NOT NULL,
        \`credit_entry_id\` varchar(36) NOT NULL,
        \`debit_entry_id\` varchar(36) NOT NULL,
        \`amount\` decimal(14,2) NOT NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        INDEX \`IDX_account_allocations_debit\` (\`tenant_id\`, \`debit_entry_id\`),
        INDEX \`IDX_account_allocations_credit\` (\`tenant_id\`, \`credit_entry_id\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE \`customer_credit_authorizations\` (
        \`id\` varchar(36) NOT NULL,
        \`tenant_id\` varchar(36) NOT NULL,
        \`customer_person_id\` varchar(36) NOT NULL,
        \`max_amount\` decimal(14,2) NOT NULL,
        \`reason\` varchar(200) NOT NULL,
        \`expires_at\` timestamp(6) NOT NULL,
        \`authorized_by_user_id\` varchar(36) NOT NULL,
        \`used_sale_id\` varchar(36) NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        INDEX \`IDX_credit_authorizations_customer\` (\`tenant_id\`, \`customer_person_id\`, \`expires_at\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE \`customer_receipts\` (
        \`id\` varchar(36) NOT NULL,
        \`tenant_id\` varchar(36) NOT NULL,
        \`number\` int UNSIGNED NOT NULL,
        \`branch_id\` varchar(36) NOT NULL,
        \`customer_person_id\` varchar(36) NOT NULL,
        \`total\` decimal(14,2) NOT NULL,
        \`currency\` char(3) NOT NULL,
        \`cash_session_id\` varchar(36) NULL,
        \`notes\` varchar(300) NULL,
        \`idempotency_key\` varchar(100) NOT NULL,
        \`request_fingerprint\` char(64) NOT NULL,
        \`actor_user_id\` varchar(36) NOT NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`UQ_customer_receipts_tenant_number\` (\`tenant_id\`, \`number\`),
        UNIQUE INDEX \`UQ_customer_receipts_tenant_idempotency\` (\`tenant_id\`, \`idempotency_key\`),
        INDEX \`IDX_customer_receipts_customer\` (\`tenant_id\`, \`customer_person_id\`, \`created_at\`),
        INDEX \`IDX_customer_receipts_session\` (\`tenant_id\`, \`cash_session_id\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE \`customer_receipt_payments\` (
        \`id\` varchar(36) NOT NULL,
        \`tenant_id\` varchar(36) NOT NULL,
        \`receipt_id\` varchar(36) NOT NULL,
        \`position\` smallint UNSIGNED NOT NULL DEFAULT 0,
        \`method\` enum ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'BANK_TRANSFER', 'QR', 'CHECK', 'OTHER') NOT NULL,
        \`amount\` decimal(14,2) NOT NULL,
        \`external_reference\` varchar(100) NULL,
        INDEX \`IDX_customer_receipt_payments_receipt\` (\`tenant_id\`, \`receipt_id\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    await queryRunner.query('ALTER TABLE `received_checks` MODIFY `sale_id` varchar(36) NULL');
    await queryRunner.query('ALTER TABLE `received_checks` MODIFY `sale_payment_id` varchar(36) NULL');
    await queryRunner.query('ALTER TABLE `received_checks` ADD `receipt_id` varchar(36) NULL');
    await queryRunner.query('ALTER TABLE `received_checks` ADD `receipt_payment_id` varchar(36) NULL');
    await queryRunner.query('ALTER TABLE `received_checks` ADD `customer_person_id` varchar(36) NULL');
    await queryRunner.query('CREATE INDEX `IDX_received_checks_receipt` ON `received_checks` (`tenant_id`, `receipt_id`)');
    // Cheques ya cargados: el cliente es el de la venta.
    await queryRunner.query(
      `UPDATE received_checks c JOIN sales s ON s.id = c.sale_id AND s.tenant_id = c.tenant_id
          SET c.customer_person_id = s.customer_person_id WHERE c.customer_person_id IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX `IDX_received_checks_receipt` ON `received_checks`');
    await queryRunner.query('ALTER TABLE `received_checks` DROP COLUMN `customer_person_id`');
    await queryRunner.query('ALTER TABLE `received_checks` DROP COLUMN `receipt_payment_id`');
    await queryRunner.query('ALTER TABLE `received_checks` DROP COLUMN `receipt_id`');
    await queryRunner.query('DELETE FROM `received_checks` WHERE `sale_id` IS NULL');
    await queryRunner.query('ALTER TABLE `received_checks` MODIFY `sale_payment_id` varchar(36) NOT NULL');
    await queryRunner.query('ALTER TABLE `received_checks` MODIFY `sale_id` varchar(36) NOT NULL');
    await queryRunner.query('DROP TABLE `customer_receipt_payments`');
    await queryRunner.query('DROP TABLE `customer_receipts`');
    await queryRunner.query('DROP TABLE `customer_credit_authorizations`');
    await queryRunner.query('DROP TABLE `customer_account_allocations`');
    await queryRunner.query('DROP TABLE `customer_account_entries`');
    await queryRunner.query("DELETE FROM `cash_movements` WHERE `type` = 'COLLECTION'");
    await queryRunner.query(
      "ALTER TABLE `cash_movements` MODIFY `type` enum ('OPENING', 'SALE', 'REFUND', 'INCOME', 'EXPENSE', 'ADJUSTMENT') NOT NULL",
    );
    await queryRunner.query("UPDATE `sale_payments` SET `method` = 'OTHER' WHERE `method` = 'ACCOUNT'");
    await queryRunner.query(
      "ALTER TABLE `sale_payments` MODIFY `method` enum ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'BANK_TRANSFER', 'QR', 'CHECK', 'OTHER') NOT NULL",
    );
    await queryRunner.query("UPDATE `price_lists` SET `payment_condition` = 'ANY', `is_active` = 0 WHERE `payment_condition` = 'ACCOUNT_ONLY'");
    await queryRunner.query("ALTER TABLE `price_lists` MODIFY `payment_condition` enum ('ANY', 'CASH_ONLY') NOT NULL DEFAULT 'ANY'");
    await queryRunner.query('ALTER TABLE `tenants` DROP COLUMN `late_interest_monthly`');
    await queryRunner.query('ALTER TABLE `persons` DROP COLUMN `credit_term_days`');
    await queryRunner.query('ALTER TABLE `persons` DROP COLUMN `credit_limit`');
    await queryRunner.query('ALTER TABLE `persons` DROP COLUMN `credit_enabled`');
  }
}
