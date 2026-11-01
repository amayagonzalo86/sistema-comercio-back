import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Equipos autorizados: cada navegador se identifica con una llave propia (no por IP) y la plataforma lo aprueba.
 * - tenants.device_approval_required: la empresa exige equipos aprobados (apagado por defecto).
 * - trusted_devices: equipos registrados por empresa.
 * - user_sessions.device_id: equipo de cada sesión (se revalida al renovar el acceso).
 */
export class TrustedDevices1791000000040 implements MigrationInterface {
  name = 'TrustedDevices1791000000040';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `tenants` ADD `device_approval_required` tinyint NOT NULL DEFAULT 0');
    await queryRunner.query(`
      CREATE TABLE \`trusted_devices\` (
        \`id\` varchar(36) NOT NULL,
        \`tenant_id\` varchar(36) NOT NULL,
        \`key_thumbprint\` char(64) NOT NULL,
        \`public_key\` varchar(400) NOT NULL,
        \`name\` varchar(80) NOT NULL,
        \`status\` enum ('PENDING', 'APPROVED', 'REVOKED') NOT NULL DEFAULT 'PENDING',
        \`user_agent\` varchar(255) NULL,
        \`requested_by_user_id\` varchar(36) NULL,
        \`approved_by_user_id\` varchar(36) NULL,
        \`approved_at\` timestamp(6) NULL,
        \`revoked_by_user_id\` varchar(36) NULL,
        \`revoked_at\` timestamp(6) NULL,
        \`last_seen_at\` timestamp(6) NULL,
        \`last_ip\` varchar(45) NULL,
        \`last_user_id\` varchar(36) NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`UQ_trusted_devices_tenant_key\` (\`tenant_id\`, \`key_thumbprint\`),
        INDEX \`IDX_trusted_devices_tenant_status\` (\`tenant_id\`, \`status\`, \`last_seen_at\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
    await queryRunner.query('ALTER TABLE `user_sessions` ADD `device_id` varchar(36) NULL');
    await queryRunner.query('CREATE INDEX `IDX_user_sessions_device` ON `user_sessions` (`device_id`)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX `IDX_user_sessions_device` ON `user_sessions`');
    await queryRunner.query('ALTER TABLE `user_sessions` DROP COLUMN `device_id`');
    await queryRunner.query('DROP TABLE `trusted_devices`');
    await queryRunner.query('ALTER TABLE `tenants` DROP COLUMN `device_approval_required`');
  }
}
