import { MigrationInterface, QueryRunner } from 'typeorm';

export class MaterializeSupplierPayableBalance1791000000010 implements MigrationInterface {
  name = 'MaterializeSupplierPayableBalance1791000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE supplier_payables ADD COLUMN amount_paid decimal(14,2) NOT NULL DEFAULT 0.00 AFTER original_amount',
    );
    await queryRunner.query(`
      UPDATE supplier_payables payable
      LEFT JOIN (
        SELECT tenant_id, payable_id, SUM(amount) AS paid_amount
        FROM supplier_payment_allocations
        GROUP BY tenant_id, payable_id
      ) allocations
        ON allocations.tenant_id = payable.tenant_id
        AND allocations.payable_id = payable.id
      SET payable.amount_paid = COALESCE(allocations.paid_amount, 0.00)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE supplier_payables DROP COLUMN amount_paid');
  }
}
