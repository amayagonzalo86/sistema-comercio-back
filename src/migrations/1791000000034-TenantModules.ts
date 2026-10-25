import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Venta por módulos: plan base + módulos que activa la plataforma por empresa.
 * - tenant_modules: módulo contratado, activo o no, vencimiento opcional y notas.
 * - Las empresas que ya existen conservan todo lo que usaban: quedan con todos los módulos activos.
 */
const MODULES = ['MULTI_BRANCH', 'PURCHASES', 'INVENTORY_CONTROL', 'REPORTS', 'MARKETING', 'PRESALE'];

export class TenantModules1791000000034 implements MigrationInterface {
  name = 'TenantModules1791000000034';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`tenant_modules\` (
        \`id\` varchar(36) NOT NULL,
        \`tenant_id\` varchar(36) NOT NULL,
        \`module\` varchar(40) NOT NULL,
        \`enabled\` tinyint NOT NULL DEFAULT 1,
        \`valid_until\` date NULL,
        \`notes\` varchar(300) NULL,
        \`updated_by_user_id\` varchar(36) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`UQ_tenant_modules_tenant_module\` (\`tenant_id\`, \`module\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
    for (const module of MODULES) {
      await queryRunner.query(
        `INSERT INTO tenant_modules (id, tenant_id, module, enabled, notes)
         SELECT UUID(), t.id, ?, 1, 'Activado al pasar a módulos (la empresa ya lo usaba).' FROM tenants t`,
        [module],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `tenant_modules`');
  }
}
