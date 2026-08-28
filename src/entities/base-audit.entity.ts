import { Column, CreateDateColumn, Index, PrimaryGeneratedColumn, UpdateDateColumn, } from 'typeorm';

export abstract class BaseAuditEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 36, nullable: false, name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 36, nullable: true, name: 'created_by' })
  createdBy?: string;

  @Column({ type: 'varchar', length: 36, nullable: true, name: 'updated_by' })
  updatedBy?: string;

  @CreateDateColumn({ type: 'datetime', precision: 6, name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, name: 'updated_at' })
  updatedAt!: Date;

  constructor(partial?: Partial<BaseAuditEntity>) {
    if (partial && typeof partial === 'object' && !Array.isArray(partial)) {
      Object.assign(this, partial);
    }
  }
}