import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Notas de crédito y débito por importe, y cheque como medio de pago.
 * - sale_adjustments: nota de crédito (bonificación, diferencia de precio) o de débito (intereses, cheque
 *   rechazado) sobre una venta facturada, con su liquidación (caja, otro medio o pendiente).
 * - fiscal_documents.source_type: SALE_ADJUSTMENT (ND 2/7/12 y NC 3/8/13 asociadas a la factura).
 * - sale_payments.method: CHECK. received_checks: cartera de cheques con su estado.
 */
export class AdjustmentNotesAndChecks1791000000036 implements MigrationInterface {
  name = 'AdjustmentNotesAndChecks1791000000036';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`sale_adjustments\` (
        \`id\` varchar(36) NOT NULL,
        \`tenant_id\` varchar(36) NOT NULL,
        \`number\` int UNSIGNED NOT NULL,
        \`sale_id\` varchar(36) NOT NULL,
        \`branch_id\` varchar(36) NOT NULL,
        \`kind\` enum ('CREDIT', 'DEBIT') NOT NULL,
        \`concept\` varchar(150) NOT NULL,
        \`reason\` varchar(200) NOT NULL,
        \`tax_rate\` decimal(5,2) NOT NULL DEFAULT 0,
        \`arca_vat_rate_id\` smallint UNSIGNED NULL,
        \`net_amount\` decimal(14,2) NOT NULL,
        \`tax_amount\` decimal(14,2) NOT NULL,
        \`exempt_amount\` decimal(14,2) NOT NULL DEFAULT 0,
        \`total\` decimal(14,2) NOT NULL,
        \`currency\` char(3) NOT NULL,
        \`settlement\` enum ('CASH', 'OTHER', 'NONE') NOT NULL,
        \`cash_session_id\` varchar(36) NULL,
        \`external_reference\` varchar(100) NULL,
        \`fiscal_status\` varchar(20) NOT NULL DEFAULT 'NOT_ISSUED',
        \`idempotency_key\` varchar(100) NOT NULL,
        \`request_fingerprint\` char(64) NOT NULL,
        \`actor_user_id\` varchar(36) NOT NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`UQ_sale_adjustments_tenant_number\` (\`tenant_id\`, \`number\`),
        UNIQUE INDEX \`UQ_sale_adjustments_tenant_idempotency\` (\`tenant_id\`, \`idempotency_key\`),
        INDEX \`IDX_sale_adjustments_sale\` (\`tenant_id\`, \`sale_id\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE \`received_checks\` (
        \`id\` varchar(36) NOT NULL,
        \`tenant_id\` varchar(36) NOT NULL,
        \`branch_id\` varchar(36) NOT NULL,
        \`sale_id\` varchar(36) NOT NULL,
        \`sale_payment_id\` varchar(36) NOT NULL,
        \`bank\` varchar(80) NOT NULL,
        \`number\` varchar(30) NOT NULL,
        \`pay_date\` date NOT NULL,
        \`drawer_name\` varchar(150) NULL,
        \`drawer_tax_id\` varchar(11) NULL,
        \`amount\` decimal(14,2) NOT NULL,
        \`currency\` char(3) NOT NULL,
        \`status\` enum ('IN_PORTFOLIO', 'DEPOSITED', 'CASHED', 'REJECTED') NOT NULL DEFAULT 'IN_PORTFOLIO',
        \`status_note\` varchar(300) NULL,
        \`status_changed_at\` timestamp(6) NULL,
        \`status_changed_by_user_id\` varchar(36) NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_received_checks_tenant_status_date\` (\`tenant_id\`, \`status\`, \`pay_date\`),
        INDEX \`IDX_received_checks_sale\` (\`tenant_id\`, \`sale_id\`),
        UNIQUE INDEX \`UQ_received_checks_payment\` (\`tenant_id\`, \`sale_payment_id\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(
      "ALTER TABLE `sale_payments` MODIFY `method` enum ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'BANK_TRANSFER', 'QR', 'CHECK', 'OTHER') NOT NULL",
    );
    await queryRunner.query(
      "ALTER TABLE `fiscal_documents` MODIFY `source_type` enum ('SALE', 'SALE_RETURN', 'SALE_ADJUSTMENT') NOT NULL",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `fiscal_documents` MODIFY `source_type` enum ('SALE', 'SALE_RETURN') NOT NULL");
    await queryRunner.query("ALTER TABLE `sale_payments` MODIFY `method` enum ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'BANK_TRANSFER', 'QR', 'OTHER') NOT NULL");
    await queryRunner.query('DROP TABLE `received_checks`');
    await queryRunner.query('DROP TABLE `sale_adjustments`');
  }
}
