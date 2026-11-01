import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum TrustedDeviceStatus {
  /** Se registró al iniciar sesión; espera la aprobación de la plataforma. */
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  /** Dado de baja: no puede entrar aunque tenga usuario y contraseña. */
  REVOKED = 'REVOKED',
}

/**
 * Equipo (navegador) de una empresa. Se identifica por una llave criptográfica que el navegador genera y guarda
 * sin poder exportarla: no depende de la IP, así que funciona con IP dinámica, desde el local o desde casa.
 */
@Entity('trusted_devices')
@Index('UQ_trusted_devices_tenant_key', ['tenantId', 'keyThumbprint'], { unique: true })
@Index('IDX_trusted_devices_tenant_status', ['tenantId', 'status', 'lastSeenAt'])
export class TrustedDeviceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  /** Huella SHA-256 de la llave pública (RFC 7638). */
  @Column({ name: 'key_thumbprint', type: 'char', length: 64 })
  keyThumbprint!: string;

  /** Llave pública ECDSA P-256 en formato JWK (JSON). */
  @Column({ name: 'public_key', type: 'varchar', length: 400 })
  publicKey!: string;

  /** Nombre que le da el local (p. ej. «Caja 1 – Centro»). */
  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'enum', enum: TrustedDeviceStatus, default: TrustedDeviceStatus.PENDING })
  status!: TrustedDeviceStatus;

  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  userAgent?: string | null;

  @Column({ name: 'requested_by_user_id', type: 'varchar', length: 36, nullable: true })
  requestedByUserId?: string | null;

  @Column({ name: 'approved_by_user_id', type: 'varchar', length: 36, nullable: true })
  approvedByUserId?: string | null;

  @Column({ name: 'approved_at', type: 'timestamp', precision: 6, nullable: true })
  approvedAt?: Date | null;

  @Column({ name: 'revoked_by_user_id', type: 'varchar', length: 36, nullable: true })
  revokedByUserId?: string | null;

  @Column({ name: 'revoked_at', type: 'timestamp', precision: 6, nullable: true })
  revokedAt?: Date | null;

  @Column({ name: 'last_seen_at', type: 'timestamp', precision: 6, nullable: true })
  lastSeenAt?: Date | null;

  @Column({ name: 'last_ip', type: 'varchar', length: 45, nullable: true })
  lastIp?: string | null;

  @Column({ name: 'last_user_id', type: 'varchar', length: 36, nullable: true })
  lastUserId?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', precision: 6 })
  updatedAt!: Date;
}
