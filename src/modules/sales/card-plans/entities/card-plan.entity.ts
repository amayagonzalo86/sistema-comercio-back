import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Medio de pago al que corresponde el plan. */
export enum CardPlanPaymentMethod {
  CREDIT_CARD = 'CREDIT_CARD',
  DEBIT_CARD = 'DEBIT_CARD',
}

export enum CardBrand {
  VISA = 'VISA',
  MASTERCARD = 'MASTERCARD',
  AMEX = 'AMEX',
  CABAL = 'CABAL',
  NARANJA = 'NARANJA',
  MAESTRO = 'MAESTRO',
  OTHER = 'OTHER',
}

/**
 * Plan de tarjeta que se ofrece al cobrar: tarjeta + banco (o cualquier banco) + cuotas + recargo.
 * Ej.: "Visa Banco de Tierra del Fuego · 10 cuotas sin interés", "Mastercard · 3 cuotas sin interés",
 * "Visa Banco de Tierra del Fuego · 12 cuotas sin interés" solo los jueves (weekdays = "4").
 * El recargo (o descuento, si es negativo) se aplica sobre la parte de la venta que se paga con ese plan.
 * Se da de baja de forma lógica: las ventas guardan el nombre y las cuotas con que se cobraron.
 */
@Entity('card_plans')
@Index('IDX_card_plans_tenant_active', ['tenantId', 'isActive'])
export class CardPlanEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  /** Nombre que ve el cajero: "Visa Banco de Tierra del Fuego", "Tarjeta TDF". */
  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ name: 'card_brand', type: 'enum', enum: CardBrand, default: CardBrand.OTHER })
  cardBrand!: CardBrand;

  /** Banco emisor; null = cualquier banco. */
  @Column({ name: 'bank_name', type: 'varchar', length: 80, nullable: true })
  bankName?: string | null;

  @Column({ name: 'payment_method', type: 'enum', enum: CardPlanPaymentMethod, default: CardPlanPaymentMethod.CREDIT_CARD })
  paymentMethod!: CardPlanPaymentMethod;

  @Column({ type: 'smallint', unsigned: true, default: 1 })
  installments!: number;

  /** Recargo sobre el precio: 0 = sin interés, 15 = 15 % de recargo, −10 = 10 % de descuento. */
  @Column({ name: 'surcharge_percentage', type: 'decimal', precision: 7, scale: 2, default: 0 })
  surchargePercentage!: string;

  /** Días en que vale el plan (0 = domingo … 6 = sábado, separados por coma). null = todos los días. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  weekdays?: string | null;

  /** Vigencia opcional (fechas locales de la empresa, inclusive). */
  @Column({ name: 'valid_from', type: 'date', nullable: true })
  validFrom?: string | null;

  @Column({ name: 'valid_to', type: 'date', nullable: true })
  validTo?: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date | null;
}
