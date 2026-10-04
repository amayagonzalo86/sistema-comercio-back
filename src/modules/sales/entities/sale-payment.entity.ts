import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum SalePaymentMethod {
  CASH = 'CASH',
  DEBIT_CARD = 'DEBIT_CARD',
  CREDIT_CARD = 'CREDIT_CARD',
  BANK_TRANSFER = 'BANK_TRANSFER',
  QR = 'QR',
  OTHER = 'OTHER',
}

@Entity('sale_payments')
@Index('IDX_sale_payments_tenant_sale', ['tenantId', 'saleId'])
export class SalePaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @Column({ name: 'sale_id', type: 'varchar', length: 36 })
  saleId!: string;

  @Column({ type: 'enum', enum: SalePaymentMethod })
  method!: SalePaymentMethod;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount!: string;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  // Never store PAN, CVV, track data, or full bank credentials here.
  @Column({ name: 'external_reference', type: 'varchar', length: 100, nullable: true })
  externalReference?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;
}
