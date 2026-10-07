import { MigrationInterface, QueryRunner } from 'typeorm';

/** Factura electrónica ARCA: puntos de venta, comprobantes, tickets WSAA y datos de impresión del emisor. */
export class CreateElectronicInvoicing1791000000020 implements MigrationInterface {
  name = 'CreateElectronicInvoicing1791000000020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE fiscal_profiles
        ADD COLUMN activity_start_date DATE NULL,
        ADD COLUMN commercial_address VARCHAR(255) NULL
    `);
    await queryRunner.query(`
      CREATE TABLE fiscal_points_of_sale (
        id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(36) NOT NULL,
        branch_id VARCHAR(36) NOT NULL,
        number INT UNSIGNED NOT NULL,
        environment ENUM('HOMOLOGATION','PRODUCTION') NOT NULL,
        is_active TINYINT NOT NULL DEFAULT 1,
        created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_fiscal_pos_tenant_env_number (tenant_id, environment, number),
        UNIQUE KEY UQ_fiscal_pos_tenant_env_branch (tenant_id, environment, branch_id),
        CONSTRAINT FK_fiscal_pos_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT FK_fiscal_pos_branch FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE fiscal_documents (
        id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(36) NOT NULL,
        branch_id VARCHAR(36) NOT NULL,
        source_type ENUM('SALE','SALE_RETURN') NOT NULL,
        source_id VARCHAR(36) NOT NULL,
        environment ENUM('HOMOLOGATION','PRODUCTION') NOT NULL,
        voucher_class CHAR(1) NOT NULL,
        voucher_type SMALLINT UNSIGNED NOT NULL,
        point_of_sale INT UNSIGNED NOT NULL,
        number INT UNSIGNED NULL,
        status ENUM('PENDING','AUTHORIZED','REJECTED','ERROR') NOT NULL DEFAULT 'PENDING',
        cae VARCHAR(14) NULL,
        cae_expiration DATE NULL,
        issue_date DATE NOT NULL,
        doc_type SMALLINT UNSIGNED NOT NULL,
        doc_number VARCHAR(20) NOT NULL,
        receiver_condition_id SMALLINT UNSIGNED NOT NULL,
        total DECIMAL(14,2) NOT NULL,
        net_taxed DECIMAL(14,2) NOT NULL,
        vat_total DECIMAL(14,2) NOT NULL,
        exempt DECIMAL(14,2) NOT NULL,
        not_taxed DECIMAL(14,2) NOT NULL,
        vat_rates JSON NOT NULL,
        associated_document_id VARCHAR(36) NULL,
        observations JSON NULL,
        error_message VARCHAR(1000) NULL,
        attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        actor_user_id VARCHAR(36) NOT NULL,
        authorized_at TIMESTAMP(6) NULL,
        created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_fiscal_documents_source (tenant_id, source_type, source_id),
        UNIQUE KEY UQ_fiscal_documents_number (tenant_id, environment, point_of_sale, voucher_type, number),
        KEY IDX_fiscal_documents_tenant_issued (tenant_id, issue_date),
        CONSTRAINT FK_fiscal_documents_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE arca_tickets (
        id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(36) NOT NULL,
        service VARCHAR(20) NOT NULL,
        environment ENUM('HOMOLOGATION','PRODUCTION') NOT NULL,
        sealed_token TEXT NOT NULL,
        sealed_sign TEXT NOT NULL,
        expires_at TIMESTAMP(6) NOT NULL,
        updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_arca_tickets_tenant_service_env (tenant_id, service, environment),
        CONSTRAINT FK_arca_tickets_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE arca_tickets');
    await queryRunner.query('DROP TABLE fiscal_documents');
    await queryRunner.query('DROP TABLE fiscal_points_of_sale');
    await queryRunner.query('ALTER TABLE fiscal_profiles DROP COLUMN commercial_address, DROP COLUMN activity_start_date');
  }
}
