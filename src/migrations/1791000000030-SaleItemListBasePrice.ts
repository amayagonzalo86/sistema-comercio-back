import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Precio de la sucursal antes de aplicar la lista de precios, por línea de venta.
 * Permite mostrar en el ticket y en la factura el descuento de la lista (ej.: "Ventas en efectivo −5 %").
 * Las ventas anteriores quedan en NULL (se imprimen como hasta ahora, sin el detalle del descuento de lista).
 */
export class SaleItemListBasePrice1791000000030 implements MigrationInterface {
  name = 'SaleItemListBasePrice1791000000030';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `sale_items` ADD `list_base_price` decimal(12,2) NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `sale_items` DROP COLUMN `list_base_price`');
  }
}
