import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ArcaEnvironment } from '../../platform/entities/fiscal-profile.entity';
import { TenantEntity } from '../../platform/entities/tenant.entity';

export enum FiscalDocumentStatus {
  /** Número reservado, solicitud en curso. */
  PENDING = 'PENDING',
  AUTHORIZED = 'AUTHORIZED',
  /** ARCA rechazó la solicitud (ver errorMessage); se puede corregir y reintentar. */
  REJECTED = 'REJECTED',
  /** Falla de comunicación: se reconcilia consultando a ARCA antes de reintentar. */
  ERROR = 'ERROR',
}

export enum FiscalSourceType {
  SALE = 'SALE',
  SALE_RETURN = 'SALE_RETURN',
}

/** Comprobante electrónico autorizado (o en proceso) ante ARCA. */
@Entity('fiscal_documents')
@Index('UQ_fiscal_documents_source', ['tenantId', 'sourceType', 'sourceId'], { unique: true })
@Index('UQ_fiscal_documents_number', ['tenantId', 'environment', 'pointOfSale', 'voucherType', 'number'], { unique: true })
@Index('IDX_fiscal_documents_tenant_issued', ['tenantId', 'issueDate'])
export class FiscalDocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_fiscal_documents_tenant' })
  tenant?: TenantEntity;

  @Column({ name: 'branch_id', type: 'varchar', length: 36 })
  branchId!: string;

  @Column({ name: 'source_type', type: 'enum', enum: FiscalSourceType })
  sourceType!: FiscalSourceType;

  @Column({ name: 'source_id', type: 'varchar', length: 36 })
  sourceId!: string;

  @Column({ type: 'enum', enum: ArcaEnvironment })
  environment!: ArcaEnvironment;

  @Column({ name: 'voucher_class', type: 'char', length: 1 })
  voucherClass!: string;

  /** Código ARCA: 1 Factura A, 3 NC A, 6 Factura B, 8 NC B, 11 Factura C, 13 NC C. */
  @Column({ name: 'voucher_type', type: 'smallint', unsigned: true })
  voucherType!: number;

  @Column({ name: 'point_of_sale', type: 'int', unsigned: true })
  pointOfSale!: number;

  @Column({ type: 'int', unsigned: true, nullable: true })
  number?: number | null;

  @Column({ type: 'enum', enum: FiscalDocumentStatus, default: FiscalDocumentStatus.PENDING })
  status!: FiscalDocumentStatus;

  @Column({ type: 'varchar', length: 14, nullable: true })
  cae?: string | null;

  @Column({ name: 'cae_expiration', type: 'date', nullable: true })
  caeExpiration?: string | null;

  @Column({ name: 'issue_date', type: 'date' })
  issueDate!: string;

  @Column({ name: 'doc_type', type: 'smallint', unsigned: true })
  docType!: number;

  @Column({ name: 'doc_number', type: 'varchar', length: 20 })
  docNumber!: string;

  @Column({ name: 'receiver_condition_id', type: 'smallint', unsigned: true })
  receiverConditionId!: number;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  total!: string;

  @Column({ name: 'net_taxed', type: 'decimal', precision: 14, scale: 2 })
  netTaxed!: string;

  @Column({ name: 'vat_total', type: 'decimal', precision: 14, scale: 2 })
  vatTotal!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  exempt!: string;

  @Column({ name: 'not_taxed', type: 'decimal', precision: 14, scale: 2 })
  notTaxed!: string;

  /** Alícuotas informadas: [{ arcaId, base, amount }]. */
  @Column({ name: 'vat_rates', type: 'json' })
  vatRates!: Array<{ arcaId: number; base: string; amount: string }>;

  /** Comprobante asociado (notas de crédito). */
  @Column({ name: 'associated_document_id', type: 'varchar', length: 36, nullable: true })
  associatedDocumentId?: string | null;

  @Column({ type: 'json', nullable: true })
  observations?: Array<{ code: string; message: string }> | null;

  @Column({ name: 'error_message', type: 'varchar', length: 1000, nullable: true })
  errorMessage?: string | null;

  @Column({ type: 'smallint', unsigned: true, default: 0 })
  attempts!: number;

  @Column({ name: 'actor_user_id', type: 'varchar', length: 36 })
  actorUserId!: string;

  @Column({ name: 'authorized_at', type: 'timestamp', precision: 6, nullable: true })
  authorizedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', precision: 6 })
  updatedAt!: Date;
}
