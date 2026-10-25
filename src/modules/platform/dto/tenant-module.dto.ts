import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

/** PUT /platform/tenants/:tenantId/modules/:module — activa o desactiva un módulo (solo SUPER_ADMIN). */
export class UpdateTenantModuleDto {
  @IsBoolean({ message: 'Indicá si el módulo queda activo (true) o no (false).' })
  readonly enabled!: boolean;

  /** Último día de uso (AAAA-MM-DD), por ejemplo, fin de una prueba o del abono. null = sin vencimiento. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'El vencimiento debe tener el formato AAAA-MM-DD.' })
  readonly validUntil?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(300)
  readonly notes?: string | null;
}
