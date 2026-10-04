import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTenantCashManagement1791000000011 implements MigrationInterface {
  name = 'CreateTenantCashManagement1791000000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE cash_registers (
        id varchar(36) NOT NULL,
        tenant_id varchar(36) NOT NULL,
        branch_id varchar(36) NOT NULL,
        code varchar(32) NOT NULL,
        name varchar(120) NOT NULL,
        is_active tinyint(1) NOT NULL DEFAULT 1,
        created_by_user_id varchar(36) NOT NULL,
        created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_cash_register_tenant_id (tenant_id, id),
        UNIQUE KEY UQ_cash_register_tenant_branch_code (tenant_id, branch_id, code),
        UNIQUE KEY UQ_cash_register_tenant_branch_id (tenant_id, branch_id, id),
        KEY IDX_cash_register_tenant_branch_active (tenant_id, branch_id, is_active),
        CONSTRAINT FK_cash_register_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        CONSTRAINT FK_cash_register_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT FK_cash_register_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE cash_sessions (
        id varchar(36) NOT NULL,
        tenant_id varchar(36) NOT NULL,
        branch_id varchar(36) NOT NULL,
        cash_register_id varchar(36) NOT NULL,
        status enum('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
        open_register_id varchar(36) GENERATED ALWAYS AS (
          CASE WHEN status = 'OPEN' THEN cash_register_id ELSE NULL END
        ) STORED,
        currency char(3) NOT NULL,
        opening_amount decimal(14,2) NOT NULL,
        expected_amount decimal(14,2) NULL,
        counted_amount decimal(14,2) NULL,
        difference_amount decimal(14,2) NULL,
        opening_idempotency_key varchar(100) NOT NULL,
        opened_by_user_id varchar(36) NOT NULL,
        closed_by_user_id varchar(36) NULL,
        opened_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        closed_at timestamp(6) NULL,
        created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_cash_sessions_tenant_id (tenant_id, id),
        UNIQUE KEY UQ_cash_sessions_tenant_opening_key (tenant_id, opening_idempotency_key),
        UNIQUE KEY UQ_cash_sessions_one_open_per_register (tenant_id, open_register_id),
        KEY IDX_cash_sessions_tenant_branch_status (tenant_id, branch_id, status, opened_at),
        KEY IDX_cash_sessions_tenant_register_opened (tenant_id, cash_register_id, opened_at),
        CONSTRAINT FK_cash_sessions_register FOREIGN KEY (tenant_id, branch_id, cash_register_id)
          REFERENCES cash_registers(tenant_id, branch_id, id) ON DELETE RESTRICT,
        CONSTRAINT FK_cash_sessions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        CONSTRAINT FK_cash_sessions_opened_by FOREIGN KEY (opened_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT FK_cash_sessions_closed_by FOREIGN KEY (closed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE cash_movements (
        id varchar(36) NOT NULL,
        tenant_id varchar(36) NOT NULL,
        branch_id varchar(36) NOT NULL,
        cash_session_id varchar(36) NOT NULL,
        type enum('OPENING','SALE','REFUND','INCOME','EXPENSE','ADJUSTMENT') NOT NULL,
        direction enum('IN','OUT') NOT NULL,
        amount decimal(14,2) NOT NULL,
        currency char(3) NOT NULL,
        reason varchar(240) NOT NULL,
        source_type varchar(40) NULL,
        source_id varchar(36) NULL,
        external_reference varchar(100) NULL,
        idempotency_key varchar(100) NOT NULL,
        request_fingerprint char(64) NOT NULL,
        actor_user_id varchar(36) NOT NULL,
        created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_cash_movements_tenant_id (tenant_id, id),
        UNIQUE KEY UQ_cash_movements_tenant_session_idempotency (tenant_id, cash_session_id, idempotency_key),
        KEY IDX_cash_movements_tenant_session_created (tenant_id, cash_session_id, created_at, id),
        KEY IDX_cash_movements_tenant_branch_created (tenant_id, branch_id, created_at, id),
        CONSTRAINT FK_cash_movements_session FOREIGN KEY (tenant_id, branch_id, cash_session_id)
          REFERENCES cash_sessions(tenant_id, branch_id, id) ON DELETE RESTRICT,
        CONSTRAINT FK_cash_movements_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        CONSTRAINT FK_cash_movements_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE cash_movements');
    await queryRunner.query('DROP TABLE cash_sessions');
    await queryRunner.query('DROP TABLE cash_registers');
  }
}
