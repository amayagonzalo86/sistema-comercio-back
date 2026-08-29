import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseAuditEntity } from '../../../entities/base-audit.entity';
import { UserEntity } from '../../users/entities/user.entity';

@Entity('branches')
@Index(['tenantId', 'code'], { unique: true })
export class BranchEntity extends BaseAuditEntity {
    @Column({ type: 'varchar', length: 20, nullable: false })
    code!: string;

    @Column({ type: 'varchar', length: 150, nullable: false })
    name!: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    address!: string;

    @Column({ type: 'varchar', length: 50, nullable: true })
    phone!: string;

    @Column({ type: 'boolean', default: true })
    status!: boolean;

    @Column({ type: 'boolean', default: true })
  isActive!: boolean;

    @OneToMany(() => UserEntity, (user) => user.branch)
    users!: UserEntity[];

    constructor(partial?: Partial<BranchEntity>) {
        super(partial);
        if (partial) {
            Object.assign(this, partial);
        }
    }
}