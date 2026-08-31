import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRolesTableAndRelation1700000000001
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Crear tabla de roles
    await queryRunner.query(`
      CREATE TABLE \`roles\` (
        \`id\` VARCHAR(36) NOT NULL,
        \`code\` VARCHAR(50) NOT NULL,
        \`name\` VARCHAR(100) NOT NULL,
        \`description\` VARCHAR(255) NULL,
        \`is_active\` TINYINT NOT NULL DEFAULT 1,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\` DATETIME(6) NULL,
        UNIQUE INDEX \`idx_roles_code\` (\`code\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. Crear tabla intermedia users_roles
    await queryRunner.query(`
      CREATE TABLE \`users_roles\` (
        \`user_id\` VARCHAR(36) NOT NULL,
        \`role_id\` VARCHAR(36) NOT NULL,
        INDEX \`idx_users_roles_user_id\` (\`user_id\`),
        INDEX \`idx_users_roles_role_id\` (\`role_id\`),
        PRIMARY KEY (\`user_id\`, \`role_id\`),
        CONSTRAINT \`fk_users_roles_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`fk_users_roles_role\` FOREIGN KEY (\`role_id\`) REFERENCES \`roles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. Seed inicial de roles predeterminados
    await queryRunner.query(`
      INSERT INTO \`roles\` (\`id\`, \`code\`, \`name\`, \`description\`) VALUES
      (UUID(), 'SUPER_ADMIN', 'Super Administrador', 'Acceso total a la plataforma ERP y configuraciones multitenant'),
      (UUID(), 'ADMIN', 'Administrador', 'Gestión general de la sucursal y configuraciones de empresa'),
      (UUID(), 'MANAGER', 'Gerente', 'Control de operaciones, reportes y supervisión'),
      (UUID(), 'SELLER', 'Vendedor', 'Generación de cotizaciones y ventas'),
      (UUID(), 'CASHIER', 'Cajero', 'Operaciones de caja POS, cobros y aperturas/cierres'),
      (UUID(), 'STOCK_CLERK', 'Encargado de Depósito', 'Gestión de inventario y movimientos de almacén'),
      (UUID(), 'USER', 'Usuario Base', 'Acceso básico al sistema');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`users_roles\``);
    await queryRunner.query(`DROP TABLE \`roles\``);
  }
}