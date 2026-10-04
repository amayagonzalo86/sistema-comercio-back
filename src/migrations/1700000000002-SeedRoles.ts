import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'node:crypto';

export class SeedRoles1700000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const roles = [
      {
        name: 'SUPER_ADMIN',
        description:
          'Acceso total a la plataforma ERP y configuraciones multitenant',
      },
      {
        name: 'ADMIN',
        description:
          'Gestión general de la sucursal y configuraciones de empresa',
      },
      {
        name: 'MANAGER',
        description: 'Control de operaciones, reportes y supervisión',
      },
      {
        name: 'SELLER',
        description: 'Generación de cotizaciones y ventas',
      },
      {
        name: 'CASHIER',
        description: 'Operaciones de caja POS, cobros y aperturas/cierres',
      },
      {
        name: 'WAREHOUSE',
        description: 'Gestión de inventario y movimientos de almacén',
      },
      {
        name: 'USER',
        description: 'Acceso básico al sistema',
      },
    ];

    for (const role of roles) {
      await queryRunner.query(
        `
        INSERT INTO roles (
          id,
          name,
          description,
          is_active
        )
        VALUES (?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE
          description = VALUES(description),
          is_active = 1
        `,
        [
          randomUUID(),
          role.name,
          role.description,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM roles
      WHERE name IN (
        'SUPER_ADMIN',
        'ADMIN',
        'MANAGER',
        'SELLER',
        'CASHIER',
        'WAREHOUSE',
        'USER'
      )
    `);
  }
}