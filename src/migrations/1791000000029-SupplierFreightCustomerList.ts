import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * - products.supplier_person_id: proveedor habitual (etiquetas y aumentos por proveedor). Se completa con el
 *   proveedor de la última compra recibida de cada producto.
 * - product_branches.freight_percentage / freight_amount: flete sobre el costo. Costo total = costo + % + $;
 *   el margen de ganancia se calcula sobre el costo total.
 * - persons.price_list_id: lista de precios habitual del cliente (el punto de venta la propone al elegirlo).
 */
export class SupplierFreightCustomerList1791000000029 implements MigrationInterface {
  name = 'SupplierFreightCustomerList1791000000029';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `products` ADD `supplier_person_id` varchar(36) NULL');
    await queryRunner.query('CREATE INDEX `IDX_products_tenant_supplier` ON `products` (`tenant_id`, `supplier_person_id`)');
    await queryRunner.query("ALTER TABLE `product_branches` ADD `freight_percentage` decimal(6,2) NOT NULL DEFAULT '0.00'");
    await queryRunner.query("ALTER TABLE `product_branches` ADD `freight_amount` decimal(12,2) NOT NULL DEFAULT '0.00'");
    await queryRunner.query('ALTER TABLE `persons` ADD `price_list_id` varchar(36) NULL');
    await queryRunner.query(`
      UPDATE products p
      JOIN (
        SELECT ranked.tenant_id, ranked.product_id, ranked.supplier_person_id
        FROM (
          SELECT r.tenant_id, i.product_id, r.supplier_person_id,
                 ROW_NUMBER() OVER (PARTITION BY r.tenant_id, i.product_id ORDER BY r.created_at DESC, r.id DESC) AS rn
          FROM purchase_receipt_items i
          JOIN purchase_receipts r ON r.id = i.purchase_receipt_id
        ) ranked
        WHERE ranked.rn = 1
      ) last_supplier ON last_supplier.tenant_id = p.tenant_id AND last_supplier.product_id = p.id
      SET p.supplier_person_id = last_supplier.supplier_person_id
      WHERE p.supplier_person_id IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `persons` DROP COLUMN `price_list_id`');
    await queryRunner.query('ALTER TABLE `product_branches` DROP COLUMN `freight_amount`');
    await queryRunner.query('ALTER TABLE `product_branches` DROP COLUMN `freight_percentage`');
    await queryRunner.query('DROP INDEX `IDX_products_tenant_supplier` ON `products`');
    await queryRunner.query('ALTER TABLE `products` DROP COLUMN `supplier_person_id`');
  }
}
