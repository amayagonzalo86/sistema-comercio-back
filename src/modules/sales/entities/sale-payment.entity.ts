import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum SalePaymentMethod {
  CASH = 'CASH',
  DEBIT_CARD = 'DEBIT_CARD',
  CREDIT_CARD = 'CREDIT_CARD',
  BANK_TRANSFER = 'BANK_TRANSFER',
  QR = 'QR',
  /** Cheque (físico o eCheq): sus datos quedan en received_checks para seguirlo hasta la acreditación. */
  CHECK = 'CHECK',
  /** Cuenta corriente: el cliente lo paga después; genera una deuda con vencimiento (customer_account_entries). */
  ACCOUNT = 'ACCOUNT',
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

  /** Plan de tarjeta con que se cobró (tarjeta, banco, cuotas). */
  @Column({ name: 'card_plan_id', type: 'varchar', length: 36, nullable: true })
  cardPlanId?: string | null;

  @Column({ type: 'smallint', unsigned: true, nullable: true })
  installments?: number | null;

  /** Qué ajuste se aplicó: "Ventas en efectivo (−5 %)", "Visa Banco TDF · 12 cuotas sin interés". */
  @Column({ name: 'adjustment_label', type: 'varchar', length: 150, nullable: true })
  adjustmentLabel?: string | null;

  /** Descuento (negativo) o recargo (positivo) incluido en este pago respecto del precio base. */
  @Column({ name: 'adjustment_amount', type: 'decimal', precision: 14, scale: 2, default: 0 })
  adjustmentAmount!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;
}
