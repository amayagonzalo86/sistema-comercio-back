import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Caja: cierres X (parciales, la caja sigue abierta) y Z (cierre definitivo) con su resumen guardado.
 * - cash_session_reports: cada cierre conserva la foto de la caja en ese momento (ventas por medio de pago,
 *   movimientos, efectivo esperado, contado y diferencia). X se numera por sesión; Z, por caja.
 * - sales.cash_session_id: caja en la que se cobró la venta (también con tarjeta, QR o transferencia),
 *   para que el cierre sume todos los medios de pago.
 * - cash_sessions.closing_notes: observaciones del cierre Z.
 */
export class CashReportsAndSaleSession1791000000031 implements MigrationInterface {
  name = 'CashReportsAndSaleSession1791000000031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`cash_session_reports\` (
        \`id\` varchar(36) NOT NULL,
        \`tenant_id\` varchar(36) NOT NULL,
        \`branch_id\` varchar(36) NOT NULL,
        \`cash_register_id\` varchar(36) NOT NULL,
        \`cash_session_id\` varchar(36) NOT NULL,
        \`type\` enum ('X', 'Z') NOT NULL,
        \`number\` int NOT NULL,
        \`expected_amount\` decimal(14,2) NOT NULL,
        \`counted_amount\` decimal(14,2) NULL,
        \`difference_amount\` decimal(14,2) NULL,
        \`summary\` json NOT NULL,
        \`notes\` varchar(500) NULL,
        \`idempotency_key\` varchar(100) NOT NULL,
        \`request_fingerprint\` char(64) NOT NULL,
        \`actor_user_id\` varchar(36) NOT NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`UQ_cash_reports_tenant_key\` (\`tenant_id\`, \`idempotency_key\`),
        UNIQUE INDEX \`UQ_cash_reports_session_type_number\` (\`tenant_id\`, \`cash_session_id\`, \`type\`, \`number\`),
        INDEX \`IDX_cash_reports_tenant_register_type\` (\`tenant_id\`, \`cash_register_id\`, \`type\`, \`number\`),
        INDEX \`IDX_cash_reports_tenant_branch_created\` (\`tenant_id\`, \`branch_id\`, \`created_at\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
    await queryRunner.query('ALTER TABLE `sales` ADD `cash_session_id` varchar(36) NULL');
    await queryRunner.query('CREATE INDEX `IDX_sales_tenant_cash_session` ON `sales` (`tenant_id`, `cash_session_id`)');
    await queryRunner.query('ALTER TABLE `cash_sessions` ADD `closing_notes` varchar(500) NULL');
    // Ventas anteriores con cobro en efectivo: se asocian a la caja donde entró el efectivo.
    await queryRunner.query(`
      UPDATE sales s
      JOIN (
        SELECT p.sale_id, MIN(m.cash_session_id) AS cash_session_id
        FROM cash_movements m
        JOIN sale_payments p ON p.id = m.source_id AND m.source_type = 'SALE_PAYMENT'
        GROUP BY p.sale_id
      ) linked ON linked.sale_id = s.id
      SET s.cash_session_id = linked.cash_session_id
      WHERE s.cash_session_id IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `cash_sessions` DROP COLUMN `closing_notes`');
    await queryRunner.query('DROP INDEX `IDX_sales_tenant_cash_session` ON `sales`');
    await queryRunner.query('ALTER TABLE `sales` DROP COLUMN `cash_session_id`');
    await queryRunner.query('DROP TABLE `cash_session_reports`');
  }
}
