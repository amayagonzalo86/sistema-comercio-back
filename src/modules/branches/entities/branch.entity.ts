import { Column, Entity, OneToMany } from 'typeorm';
import { BaseAuditEntity } from '../../../entities/base-audit.entity';
import { UserEntity } from '../../users/entities/user.entity';

@Entity('branches')
export class BranchEntity extends BaseAuditEntity {
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