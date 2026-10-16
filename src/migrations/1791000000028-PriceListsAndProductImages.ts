import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Listas de precios administrables y foto del producto.
 * - price_lists: porcentaje con signo (descuento o recargo sobre el precio de la sucursal), condición de pago
 *   (cualquiera o solo efectivo), orden y baja lógica (las ventas guardan el nombre y el porcentaje aplicados).
 * - sales / sales_orders / sales_quotes: lista de precios usada.
 * - products: imagen.
 * Las empresas que todavía no tienen listas reciben tres de ejemplo: Precio de lista (principal), Ventas en
 * efectivo (−5 %, solo efectivo) y Lista gobierno (+300 %). Se pueden editar o eliminar.
 */
export class PriceListsAndProductImages1791000000028 implements MigrationInterface {
  name = 'PriceListsAndProductImages1791000000028';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `price_lists` MODIFY `percentage` decimal(7,2) NOT NULL DEFAULT '0.00'");
    await queryRunner.query("ALTER TABLE `price_lists` ADD `payment_condition` enum ('ANY', 'CASH_ONLY') NOT NULL DEFAULT 'ANY'");
    await queryRunner.query('ALTER TABLE `price_lists` ADD `sort_order` int NOT NULL DEFAULT 0');
    await queryRunner.query('ALTER TABLE `price_lists` ADD `deleted_at` datetime(6) NULL');

    await queryRunner.query('ALTER TABLE `sales` ADD `price_list_id` varchar(36) NULL');
    await queryRunner.query('ALTER TABLE `sales` ADD `price_list_name` varchar(150) NULL');
    await queryRunner.query('ALTER TABLE `sales` ADD `price_list_percentage` decimal(7,2) NULL');
    await queryRunner.query('ALTER TABLE `sales_orders` ADD `price_list_id` varchar(36) NULL');
    await queryRunner.query('ALTER TABLE `sales_quotes` ADD `price_list_id` varchar(36) NULL');

    await queryRunner.query('ALTER TABLE `products` ADD `image_path` varchar(120) NULL');

    const tenants = (await queryRunner.query(
      'SELECT t.id FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM price_lists pl WHERE pl.tenant_id = t.id)',
    )) as Array<{ id: string }>;
    const seeds: Array<[string, string, string, string, number, number]> = [
      ['Precio de lista', 'Precio de la sucursal, sin descuentos ni recargos.', '0.00', 'ANY', 1, 10],
      ['Ventas en efectivo', 'Descuento por pago en efectivo.', '-5.00', 'CASH_ONLY', 0, 20],
      ['Lista gobierno', 'Recargo para ventas a organismos públicos.', '300.00', 'ANY', 0, 30],
    ];
    for (const tenant of tenants) {
      for (const [name, description, percentage, condition, isDefault, sortOrder] of seeds) {
        await queryRunner.query(
          `INSERT INTO price_lists (id, tenant_id, name, description, percentage, payment_condition, is_default, is_active, sort_order)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, 1, ?)`,
          [tenant.id, name, description, percentage, condition, isDefault, sortOrder],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `products` DROP COLUMN `image_path`');
    await queryRunner.query('ALTER TABLE `sales_quotes` DROP COLUMN `price_list_id`');
    await queryRunner.query('ALTER TABLE `sales_orders` DROP COLUMN `price_list_id`');
    await queryRunner.query('ALTER TABLE `sales` DROP COLUMN `price_list_percentage`');
    await queryRunner.query('ALTER TABLE `sales` DROP COLUMN `price_list_name`');
    await queryRunner.query('ALTER TABLE `sales` DROP COLUMN `price_list_id`');
    await queryRunner.query('ALTER TABLE `price_lists` DROP COLUMN `deleted_at`');
    await queryRunner.query('ALTER TABLE `price_lists` DROP COLUMN `sort_order`');
    await queryRunner.query('ALTER TABLE `price_lists` DROP COLUMN `payment_condition`');
    await queryRunner.query("ALTER TABLE `price_lists` MODIFY `percentage` decimal(5,2) NOT NULL DEFAULT '0.00'");
  }
}
