import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plan base ampliado: control de mercadería, tablero y reportes, multisucursal, compras y proveedores y preventa
 * pasan a estar incluidos para todas las empresas. El único módulo que se vende aparte es Marketing y fidelización,
 * así que se borran los registros de los demás módulos (las empresas no pierden nada: ahora son parte del plan base).
 */
export class OnlyMarketingModule1791000000035 implements MigrationInterface {
  name = 'OnlyMarketingModule1791000000035';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM `tenant_modules` WHERE `module` <> 'MARKETING'");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const module of ['MULTI_BRANCH', 'PURCHASES', 'INVENTORY_CONTROL', 'REPORTS', 'PRESALE']) {
      await queryRunner.query(
        `INSERT INTO tenant_modules (id, tenant_id, module, enabled, notes)
         SELECT UUID(), t.id, ?, 1, 'Restaurado al revertir el plan base ampliado.' FROM tenants t
          WHERE NOT EXISTS (SELECT 1 FROM tenant_modules m WHERE m.tenant_id = t.id AND m.module = ?)`,
        [module, module],
      );
    }
  }
}
