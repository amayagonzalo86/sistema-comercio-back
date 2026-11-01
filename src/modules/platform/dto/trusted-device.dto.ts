import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value);

/** PATCH /platform/tenants/:tenantId/device-approval — exigir equipos autorizados en la empresa. */
export class UpdateDeviceApprovalDto {
  @IsBoolean({ message: 'Indicá si la empresa exige equipos autorizados (true) o no (false).' })
  readonly required!: boolean;
}

/** GET /platform/tenants/:tenantId/devices */
export class TrustedDeviceQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REVOKED'])
  readonly status?: 'PENDING' | 'APPROVED' | 'REVOKED';
}

/** POST .../devices/:deviceId/approve — aprobar (opcionalmente con otro nombre). */
export class ApproveDeviceDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  readonly name?: string;
}

/** PATCH .../devices/:deviceId — renombrar. */
export class RenameDeviceDto {
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'El nombre del equipo debe tener al menos 2 caracteres.' })
  @MaxLength(80)
  readonly name!: string;
}
