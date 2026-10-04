import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSupplierPayablesAndPayments1791000000009 implements MigrationInterface {
  name = 'CreateSupplierPayablesAndPayments1791000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE supplier_payables (
        id varchar(36) NOT NULL,
        tenant_id varchar(36) NOT NULL,
        branch_id varchar(36) NOT NULL,
        supplier_person_id varchar(36) NOT NULL,
        purchase_receipt_id varchar(36) NOT NULL,
        currency char(3) NOT NULL,
        original_amount decimal(14,2) NOT NULL,
        due_date date NULL,
        created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_supplier_payables_tenant_id (tenant_id, id),
        UNIQUE KEY UQ_supplier_payables_tenant_receipt (tenant_id, purchase_receipt_id),
        KEY IDX_supplier_payables_tenant_supplier_due (tenant_id, supplier_person_id, due_date, created_at),
        KEY IDX_supplier_payables_tenant_branch_created (tenant_id, branch_id, created_at, id),
        CONSTRAINT FK_supplier_payables_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        CONSTRAINT FK_supplier_payables_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT FK_supplier_payables_supplier FOREIGN KEY (tenant_id, supplier_person_id) REFERENCES persons(tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT FK_supplier_payables_receipt FOREIGN KEY (tenant_id, purchase_receipt_id) REFERENCES purchase_receipts(tenant_id, id) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE supplier_payments (
        id varchar(36) NOT NULL,
        tenant_id varchar(36) NOT NULL,
        branch_id varchar(36) NOT NULL,
        supplier_person_id varchar(36) NOT NULL,
        currency char(3) NOT NULL,
        method enum('CASH','BANK_TRANSFER','CHECK','CARD','OTHER') NOT NULL,
        amount decimal(14,2) NOT NULL,
        external_reference varchar(100) NULL,
        idempotency_key varchar(100) NOT NULL,
        request_fingerprint char(64) NOT NULL,
        actor_user_id varchar(36) NOT NULL,
        created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_supplier_payments_tenant_id (tenant_id, id),
        UNIQUE KEY UQ_supplier_payments_tenant_idempotency (tenant_id, idempotency_key),
        KEY IDX_supplier_payments_tenant_supplier_created (tenant_id, supplier_person_id, created_at),
        CONSTRAINT FK_supplier_payments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        CONSTRAINT FK_supplier_payments_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT FK_supplier_payments_supplier FOREIGN KEY (tenant_id, supplier_person_id) REFERENCES persons(tenant_id, id) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE supplier_payment_allocations (
        id varchar(36) NOT NULL,
        tenant_id varchar(36) NOT NULL,
        payment_id varchar(36) NOT NULL,
        payable_id varchar(36) NOT NULL,
        amount decimal(14,2) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY UQ_supplier_payment_allocations_tenant_payment_payable (tenant_id, payment_id, payable_id),
        KEY IDX_supplier_payment_allocations_tenant_payable (tenant_id, payable_id),
        CONSTRAINT FK_supplier_payment_allocations_payment FOREIGN KEY (tenant_id, payment_id) REFERENCES supplier_payments(tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT FK_supplier_payment_allocations_payable FOREIGN KEY (tenant_id, payable_id) REFERENCES supplier_payables(tenant_id, id) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      INSERT INTO supplier_payables (
        id, tenant_id, branch_id, supplier_person_id, purchase_receipt_id, currency, original_amount, created_at
      )
      SELECT UUID(), tenant_id, branch_id, supplier_person_id, id, currency, total, created_at
      FROM purchase_receipts
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE supplier_payment_allocations');
    await queryRunner.query('DROP TABLE supplier_payments');
    await queryRunner.query('DROP TABLE supplier_payables');
  }
}
