import { Column, CreateDateColumn, Index, PrimaryGeneratedColumn, UpdateDateColumn, } from 'typeorm';

export abstract class BaseAuditEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Index()
    @Column({ type: 'varchar', length: 36, nullable: false })
    tenantId: string;

    @Column({ type: 'varchar', length: 36, nullable: true })
    createdBy: string | null;

    @Column({ type: 'varchar', length: 36, nullable: true })
    updatedBy: string | null;

    @CreateDateColumn({ type: 'datetime' })
    createdAt!: Date;

    @UpdateDateColumn({ type: 'datetime' })
    updatedAt!: Date;

    constructor(tenantId: string, createdBy?: string, updatedBy?: string) {
        this.tenantId = tenantId;
        this.createdBy = createdBy || null;
        this.updatedBy = updatedBy || null;
    }
}