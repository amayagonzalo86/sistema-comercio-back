import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Datos que se imprimen en el encabezado de facturas, remitos y presupuestos:
 * - Empresa (perfil fiscal): localidad, provincia y teléfono del domicilio comercial.
 * - Sucursal: localidad y provincia del local.
 * - Cliente: localidad, provincia y número de cuenta (correlativo por empresa).
 *
 * Los clientes y proveedores existentes reciben un número de cuenta por orden de alta; las personas
 * vinculadas a usuarios (empleados) no llevan cuenta.
 */
export class PrintableDocumentData1791000000025 implements MigrationInterface {
  name = 'PrintableDocumentData1791000000025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `fiscal_profiles` ADD `commercial_city` varchar(100) NULL');
    await queryRunner.query('ALTER TABLE `fiscal_profiles` ADD `commercial_province` varchar(60) NULL');
    await queryRunner.query('ALTER TABLE `fiscal_profiles` ADD `phone` varchar(50) NULL');

    await queryRunner.query('ALTER TABLE `branches` ADD `city` varchar(100) NULL');
    await queryRunner.query('ALTER TABLE `branches` ADD `province` varchar(60) NULL');

    await queryRunner.query('ALTER TABLE `persons` ADD `city` varchar(100) NULL');
    await queryRunner.query('ALTER TABLE `persons` ADD `province` varchar(60) NULL');
    await queryRunner.query('ALTER TABLE `persons` ADD `account_number` int UNSIGNED NULL');

    await queryRunner.query(`
      UPDATE persons p
      JOIN (
        SELECT candidate.id, ROW_NUMBER() OVER (PARTITION BY candidate.tenant_id ORDER BY candidate.created_at, candidate.id) AS rn
        FROM persons candidate
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.person_id = candidate.id)
      ) numbered ON numbered.id = p.id
      SET p.account_number = numbered.rn
    `);
    await queryRunner.query('CREATE UNIQUE INDEX `UQ_persons_tenant_account` ON `persons` (`tenant_id`, `account_number`)');
    await queryRunner.query(`
      INSERT INTO document_sequences (tenant_id, name, value)
      SELECT tenant_id, 'PERSON_ACCOUNT', MAX(account_number)
      FROM persons
      WHERE account_number IS NOT NULL
      GROUP BY tenant_id
      ON DUPLICATE KEY UPDATE value = GREATEST(document_sequences.value, VALUES(value))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM document_sequences WHERE name = 'PERSON_ACCOUNT'");
    await queryRunner.query('DROP INDEX `UQ_persons_tenant_account` ON `persons`');
    await queryRunner.query('ALTER TABLE `persons` DROP COLUMN `account_number`');
    await queryRunner.query('ALTER TABLE `persons` DROP COLUMN `province`');
    await queryRunner.query('ALTER TABLE `persons` DROP COLUMN `city`');
    await queryRunner.query('ALTER TABLE `branches` DROP COLUMN `province`');
    await queryRunner.query('ALTER TABLE `branches` DROP COLUMN `city`');
    await queryRunner.query('ALTER TABLE `fiscal_profiles` DROP COLUMN `phone`');
    await queryRunner.query('ALTER TABLE `fiscal_profiles` DROP COLUMN `commercial_province`');
    await queryRunner.query('ALTER TABLE `fiscal_profiles` DROP COLUMN `commercial_city`');
  }
}
