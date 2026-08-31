import { MigrationInterface, QueryRunner } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

export class CreateRolesTableAndRelation1700000000001
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Crear tabla de roles
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`roles\` (
        \`id\` VARCHAR(36) NOT NULL,
        \`name\` VARCHAR(50) NOT NULL,
        \`description\` VARCHAR(255) NULL,
        \`is_active\` TINYINT NOT NULL DEFAULT 1,
        \`created_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\` DATETIME(6) NULL,
        UNIQUE INDEX \`idx_roles_name\` (\`name\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. Crear tabla intermedia users_roles
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`users_roles\` (
        \`user_id\` VARCHAR(36) NOT NULL,
        \`role_id\` VARCHAR(36) NOT NULL,
        INDEX \`idx_users_roles_user_id\` (\`user_id\`),
        INDEX \`idx_users_roles_role_id\` (\`role_id\`),
        PRIMARY KEY (\`user_id\`, \`role_id\`),
        CONSTRAINT \`fk_users_roles_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`fk_users_roles_role\` FOREIGN KEY (\`role_id\`) REFERENCES \`roles\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. Seed de roles con UUIDs pre-generados en Node.js (Garantía de inserción uniforme)
    const defaultRoles = [
      {
        id: uuidv4(),
        name: 'SUPER_ADMIN',
        description: 'Acceso total a la plataforma ERP y configuraciones multitenant',
      },
      {
        id: uuidv4(),
        name: 'ADMIN',
        description: 'Gestión general de la sucursal y configuraciones de empresa',
      },
      {
        id: uuidv4(),
        name: 'MANAGER',
        description: 'Control de operaciones, reportes y supervisión',
      },
      {
        id: uuidv4(),
        name: 'SELLER',
        description: 'Generación de cotizaciones y ventas',
      },
      {
        id: uuidv4(),
        name: 'CASHIER',
        description: 'Operaciones de caja POS, cobros y aperturas/cierres',
      },
      {
        id: uuidv4(),
        name: 'WAREHOUSE',
        description: 'Gestión de inventario y movimientos de almacén',
      },
      {
        id: uuidv4(),
        name: 'USER',
        description: 'Acceso básico al sistema',
      },
    ];

    for (const role of defaultRoles) {
      await queryRunner.query(
        `INSERT INTO \`roles\` (\`id\`, \`name\`, \`description\`) 
         VALUES (?, ?, ?) 
         ON DUPLICATE KEY UPDATE \`description\` = VALUES(\`description\`);`,
        [role.id, role.name, role.description],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`users_roles\`;`);
    await queryRunner.query(`DROP TABLE IF EXISTS \`roles\`;`);
  }
}