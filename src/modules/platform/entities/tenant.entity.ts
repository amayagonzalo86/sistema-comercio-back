import { VatRegime } from '../../fiscal/vat/vat';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FiscalProfileEntity } from './fiscal-profile.entity';
import { TenantMembershipEntity } from './tenant-membership.entity';

export enum TenantStatus {
  TRIAL = 'TRIAL',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  CLOSED = 'CLOSED',
}

@Entity('tenants')
@Index('UQ_tenants_slug', ['slug'], { unique: true })
@Index('UQ_tenants_tax_id', ['taxId'], { unique: true })
export class TenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  slug!: string;

  @Column({ name: 'legal_name', type: 'varchar', length: 200 })
  legalName!: string;

  @Column({ name: 'trade_name', type: 'varchar', length: 200, nullable: true })
  tradeName?: string | null;

  /** Nombre que se muestra en el sistema (encabezado del menú). Lo asigna el operador de la plataforma; no va en los comprobantes. */
  @Column({ name: 'display_name', type: 'varchar', length: 60, nullable: true })
  displayName?: string | null;

  /** Archivo del logo (UPLOADS_DIR/logos); se sirve en /api/v1/tenant-logos/<archivo>. */
  @Column({ name: 'logo_path', type: 'varchar', length: 60, nullable: true })
  logoPath?: string | null;

  /** WhatsApp que se imprime al pie de facturas y presupuestos (texto libre, por ejemplo +54 9 2964 49-4926). */
  @Column({ name: 'print_whatsapp', type: 'varchar', length: 30, nullable: true })
  printWhatsapp?: string | null;

  /** Sitio web que se imprime al pie de los comprobantes. */
  @Column({ name: 'print_website', type: 'varchar', length: 120, nullable: true })
  printWebsite?: string | null;

  /** Leyenda en negrita en el cuerpo de la factura (retiro de mercadería, garantía, etc.). */
  @Column({ name: 'invoice_legend', type: 'varchar', length: 300, nullable: true })
  invoiceLegend?: string | null;

  /** «Condición» del pie del presupuesto (por ejemplo «3 y 6 cuotas sin interés»). */
  @Column({ name: 'quote_condition', type: 'varchar', length: 80, nullable: true })
  quoteCondition?: string | null;

  /** % de descuento pagando en efectivo o débito que informa el presupuesto («A pagar con descuento»). */
  @Column({ name: 'quote_cash_discount', type: 'decimal', precision: 5, scale: 2, default: 0 })
  quoteCashDiscount!: string;

  // CUIT is stored without punctuation. Null is allowed until fiscal onboarding.
  @Column({ name: 'tax_id', type: 'varchar', length: 11, nullable: true })
  taxId?: string | null;

  @Column({
    type: 'enum',
    enum: TenantStatus,
    default: TenantStatus.TRIAL,
  })
  status!: TenantStatus;

  @Column({
    name: 'time_zone',
    type: 'varchar',
    length: 64,
    default: 'America/Argentina/Buenos_Aires',
  })
  timeZone!: string;

  @Column({ name: 'currency_code', type: 'char', length: 3, default: 'ARS' })
  currencyCode!: string;

  /** Interés mensual por mora de cuentas corrientes (%, 0 = sin intereses). Se cobra con nota de débito. */
  @Column({ name: 'late_interest_monthly', type: 'decimal', precision: 5, scale: 2, default: 0 })
  lateInterestMonthly!: string;

  /** Régimen de IVA por defecto de la empresa (Tierra del Fuego: ventas exentas, Ley 19.640). Lo configura la plataforma. */
  @Column({ name: 'default_vat_regime', type: 'enum', enum: VatRegime, default: VatRegime.GENERAL })
  defaultVatRegime!: VatRegime;

  /** Solo se puede entrar desde equipos aprobados por la plataforma (ver trusted_devices). */
  @Column({ name: 'device_approval_required', type: 'boolean', default: false })
  deviceApprovalRequired!: boolean;

  @OneToMany(() => TenantMembershipEntity, (membership) => membership.tenant)
  memberships!: TenantMembershipEntity[];

  @OneToMany(() => FiscalProfileEntity, (profile) => profile.tenant)
  fiscalProfiles!: FiscalProfileEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', precision: 6 })
  updatedAt!: Date;
}
