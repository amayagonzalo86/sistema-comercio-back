import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { IsCuit } from '../../../../common/validators/decorators';
import { CheckStatus } from '../entities/received-check.entity';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/** Datos del cheque cuando un pago es con cheque (method = CHECK). */
export class CheckDataDto {
  @Transform(trim)
  @IsString({ message: 'Indicá el banco del cheque.' })
  @MinLength(2, { message: 'Indicá el banco del cheque.' })
  @MaxLength(80)
  bank!: string;

  @Transform(trim)
  @Matches(/^[0-9A-Za-z-]{1,30}$/, { message: 'El número de cheque admite hasta 30 dígitos o letras.' })
  number!: string;

  /** Fecha de cobro AAAA-MM-DD (puede ser futura: cheque diferido). */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha de cobro debe tener el formato AAAA-MM-DD.' })
  payDate!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(150)
  drawerName?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @Matches(/^\d{11}$/, { message: 'La CUIT del librador debe tener 11 dígitos, sin guiones.' })
  @IsCuit()
  drawerTaxId?: string;
}

/** PATCH /checks/:id/status — seguimiento del cheque (depositado, acreditado o rechazado). */
export class UpdateCheckStatusDto {
  @IsEnum(CheckStatus, { message: 'Estado inválido.' })
  status!: CheckStatus;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class CheckQueryDto {
  @IsOptional()
  @IsEnum(CheckStatus)
  status?: CheckStatus;

  /** Fecha de cobro desde/hasta (AAAA-MM-DD). */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  /** Número de cheque, banco o librador. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  search?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}
