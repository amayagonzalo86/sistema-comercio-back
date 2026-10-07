import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
} from 'typeorm';
import { BaseAuditEntity } from '../../../entities/base-audit.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { TenantEntity } from '../../platform/entities/tenant.entity';
import { IdentificationTypeEnum, TaxConditionEnum } from '../../../common/enums/afip.enum';

export enum PersonType {
  CUSTOMER = 'CUSTOMER',
  SUPPLIER = 'SUPPLIER',
  BOTH = 'BOTH',
}

@Entity('persons')
@Index('UQ_persons_tenant_id', ['tenantId', 'id'], { unique: true })
@Index('UQ_persons_tenant_national_id', ['tenantId', 'nationalId'], { unique: true })
@Index('UQ_persons_tenant_email', ['tenantId', 'email'], { unique: true })
export class PersonEntity extends BaseAuditEntity {
  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: TenantEntity;
  @Column({ type: 'varchar', length: 100, nullable: false, name: 'first_name' })
  firstName!: string;

  @Column({ type: 'varchar', length: 100, nullable: false, name: 'last_name' })
  lastName!: string;

  // Número de documento sin puntos ni guiones (DNI, CUIT o CUIL según documentType).
  @Column({ type: 'varchar', length: 20, nullable: true, name: 'national_id' })
  nationalId?: string | null;

  // Código ARCA del tipo de documento: 80 CUIT, 86 CUIL, 96 DNI, 94 Pasaporte, 99 Sin identificar.
  @Column({ name: 'document_type', type: 'smallint', unsigned: true, nullable: true })
  documentType?: IdentificationTypeEnum | null;

  // Condición frente al IVA: define la clase de comprobante (A/B/C) y si se discrimina el IVA.
  @Column({
    name: 'vat_condition',
    type: 'varchar',
    length: 40,
    default: TaxConditionEnum.CONSUMIDOR_FINAL,
  })
  vatCondition!: TaxConditionEnum;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email?: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address?: string | null;

  @OneToOne(() => UserEntity, (user) => user.person)
  user?: UserEntity | null;

  @Column({ name: 'person_type', type: 'enum', enum: PersonType, default: PersonType.BOTH })
  personType!: PersonType;

  @Column({ type: 'boolean', nullable: false, default: true})
  isActive!: boolean;

  constructor(partial?: Partial<PersonEntity>) {
    super(partial);
    if (partial) {
      Object.assign(this, partial);
    }
  }

  // Getter de dominio para nombre completo
  get fullName(): string {
    return `${this.firstName} ${this.lastName}`.trim();
  }
}