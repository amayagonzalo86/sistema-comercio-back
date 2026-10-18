import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Descuento de pago contado por medio de pago.
 * - price_lists.discount_methods: medios que, además del efectivo, reciben la lista de pago contado
 *   (ej.: "DEBIT_CARD,QR"). null = solo efectivo. La tarjeta de crédito nunca la recibe.
 * - La lista principal tiene que valer para cualquier medio de pago: si una empresa marcó como principal una lista
 *   "solo efectivo", pasa a principal su primera lista común activa (o se crea «Precio de lista» sin ajuste).
 *   Así el cobro parte del precio de lista y aplica el descuento solo al pagar en efectivo.
 */
export class CashDiscountMethods1791000000033 implements MigrationInterface {
  name = 'CashDiscountMethods1791000000033';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `price_lists` ADD `discount_methods` varchar(100) NULL');
    const wrongDefaults = (await queryRunner.query(
      "SELECT id, tenant_id AS tenantId FROM price_lists WHERE is_default = 1 AND payment_condition = 'CASH_ONLY' AND deleted_at IS NULL",
    )) as Array<{ id: string; tenantId: string }>;
    for (const wrong of wrongDefaults) {
      await queryRunner.query('UPDATE price_lists SET is_default = 0 WHERE id = ?', [wrong.id]);
      const candidates = (await queryRunner.query(
        `SELECT id FROM price_lists
          WHERE tenant_id = ? AND payment_condition = 'ANY' AND is_active = 1 AND deleted_at IS NULL
          ORDER BY sort_order ASC, name ASC LIMIT 1`,
        [wrong.tenantId],
      )) as Array<{ id: string }>;
      if (candidates.length > 0) {
        await queryRunner.query('UPDATE price_lists SET is_default = 1 WHERE id = ?', [candidates[0].id]);
      } else {
        await queryRunner.query(
          `INSERT INTO price_lists (id, tenant_id, name, description, percentage, payment_condition, is_default, is_active, sort_order)
           VALUES (UUID(), ?, 'Precio de lista', 'Precio de la sucursal, sin descuentos ni recargos.', 0.00, 'ANY', 1, 1, 0)`,
          [wrong.tenantId],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `price_lists` DROP COLUMN `discount_methods`');
  }
}
