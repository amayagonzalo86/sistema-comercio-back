import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSaasCore1791000000000 implements MigrationInterface {
  name = 'CreateSaasCore1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tenants (
        id varchar(36) NOT NULL,
        slug varchar(80) NOT NULL,
        legal_name varchar(200) NOT NULL,
        trade_name varchar(200) NULL,
        tax_id varchar(11) NULL,
        status enum('TRIAL','ACTIVE','SUSPENDED','CLOSED') NOT NULL DEFAULT 'TRIAL',
        time_zone varchar(64) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
        currency_code char(3) NOT NULL DEFAULT 'ARS',
        created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_tenants_slug (slug),
        UNIQUE KEY UQ_tenants_tax_id (tax_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE tenant_memberships (
        id varchar(36) NOT NULL,
        tenant_id varchar(36) NOT NULL,
        user_id varchar(36) NOT NULL,
        role enum('OWNER','ADMIN','MANAGER','ACCOUNTANT','CASHIER','INVENTORY','VIEWER') NOT NULL,
        status enum('INVITED','ACTIVE','SUSPENDED') NOT NULL DEFAULT 'INVITED',
        accepted_at timestamp(6) NULL,
        created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_tenant_membership_tenant_user (tenant_id, user_id),
        KEY IDX_tenant_membership_user_status (user_id, status),
        CONSTRAINT FK_membership_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT FK_membership_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE audit_events (
        id bigint unsigned NOT NULL AUTO_INCREMENT,
        tenant_id varchar(36) NOT NULL,
        actor_user_id varchar(36) NULL,
        event_type varchar(80) NOT NULL,
        aggregate_type varchar(80) NOT NULL,
        aggregate_id varchar(100) NOT NULL,
        request_id varchar(100) NULL,
        ip_address varchar(45) NULL,
        user_agent varchar(512) NULL,
        metadata json NULL,
        created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        KEY IDX_audit_tenant_time (tenant_id, created_at),
        KEY IDX_audit_tenant_aggregate (tenant_id, aggregate_type, aggregate_id, created_at),
        KEY IDX_audit_request (request_id),
        CONSTRAINT FK_audit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE fiscal_profiles (
        id varchar(36) NOT NULL,
        tenant_id varchar(36) NOT NULL,
        tax_id varchar(11) NOT NULL,
        legal_name varchar(200) NOT NULL,
        vat_condition_code varchar(40) NOT NULL,
        gross_income_registration varchar(32) NULL,
        environment enum('HOMOLOGATION','PRODUCTION') NOT NULL DEFAULT 'HOMOLOGATION',
        certificate_secret_ref varchar(255) NULL,
        private_key_secret_ref varchar(255) NULL,
        is_active tinyint NOT NULL DEFAULT 0,
        created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_fiscal_profile_tenant_tax_env (tenant_id, tax_id, environment),
        KEY IDX_fiscal_profile_tenant_status (tenant_id, is_active),
        CONSTRAINT FK_fiscal_profile_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE fiscal_profiles');
    await queryRunner.query('DROP TABLE audit_events');
    await queryRunner.query('DROP TABLE tenant_memberships');
    await queryRunner.query('DROP TABLE tenants');
  }
}
