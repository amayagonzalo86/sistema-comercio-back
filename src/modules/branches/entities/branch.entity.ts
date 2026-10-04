import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseAuditEntity } from '../../../entities/base-audit.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { TenantEntity } from '../../platform/entities/tenant.entity';

@Entity('branches')
@Index('UQ_branches_tenant_code', ['tenantId', 'code'], { unique: true })
@Index('IDX_branches_tenant_status', ['tenantId', 'status'])
export class BranchEntity extends BaseAuditEntity {
    @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
    tenantId!: string;

    @ManyToOne(() => TenantEntity, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'tenant_id' })
    tenant!: TenantEntity;

    @Column({ type: 'varchar', length: 20, nullable: false, name: 'code' })
    code!: string;

    @Column({ type: 'varchar', length: 150, nullable: false, name: 'name' })
    name!: string;

    @Column({ type: 'varchar', length: 255, nullable: true, name: 'address' })
    address?: string;

    @Column({ type: 'varchar', length: 50, nullable: true, name: 'phone' })
    phone?: string;

    @Column({ type: 'boolean', default: true, name: 'status' })
    status!: boolean;

    @OneToMany(() => UserEntity, (user) => user.branch)
    users!: UserEntity[];

    constructor(partial?: Partial<BranchEntity>) {
        super(partial);
        if (partial) {
            Object.assign(this, partial);
        }
    }
}