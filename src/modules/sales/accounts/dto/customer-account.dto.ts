import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../../common/dto/page-query.dto';
import { CheckDataDto } from '../../checks/dto/check.dto';
import { ReceiptPaymentMethod } from '../entities/customer-receipt.entity';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/** PATCH /customer-accounts/:personId/credit — habilitar la cuenta corriente, límite y plazo. */
export class UpdateCreditDto {
  @IsBoolean()
  creditEnabled!: boolean;

  /** Deuda máxima; null = sin límite. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999.99)
  creditLimit?: number | null;

  /** Plazo de pago en días (0 = vence en el día). */
  @IsInt()
  @Min(0)
  @Max(365)
  creditTermDays!: number;
}

/** POST /customer-accounts/:personId/authorizations — excepción del encargado para una venta. */
export class CreateCreditAuthorizationDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999999999.99)
  maxAmount!: number;

  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Indicá el motivo de la autorización.' })
  @MaxLength(200)
  reason!: string;
}

export class ReceiptPaymentDto {
  @IsEnum(ReceiptPaymentMethod)
  method!: ReceiptPaymentMethod;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999999999.99)
  amount!: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  externalReference?: string;

  /** Obligatorio si method = CHECK. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CheckDataDto)
  check?: CheckDataDto;
}

export class ReceiptAllocationDto {
  /** Movimiento deudor (venta a cuenta o nota de débito). */
  @IsUUID('4')
  entryId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999999999.99)
  amount!: number;
}

/** POST /customer-accounts/:personId/receipts — recibo de cobranza. */
export class CreateReceiptDto {
  @IsUUID('4')
  branchId!: string;

  /** Caja abierta: obligatoria si hay efectivo; si no, la cobranza igual queda en esa caja para el cierre. */
  @IsOptional()
  @IsUUID('4')
  cashSessionId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ReceiptPaymentDto)
  payments!: ReceiptPaymentDto[];

  /** Qué facturas cancela. Si no se envía, se imputa de la más vieja a la más nueva. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceiptAllocationDto)
  allocations?: ReceiptAllocationDto[];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  notes?: string;
}

export class CustomerAccountQueryDto extends PageQueryDto {
  /** Nombre, CUIT/DNI o número de cuenta. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  search?: string;

  /** WITH_DEBT: con saldo deudor; OVERDUE: con deuda vencida; ALL: todos los clientes con cuenta o saldo. */
  @IsOptional()
  @IsIn(['ALL', 'WITH_DEBT', 'OVERDUE'])
  status?: 'ALL' | 'WITH_DEBT' | 'OVERDUE';
}

export class StatementQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}

/** PUT /customer-accounts/settings — interés mensual por mora (%). */
export class AccountSettingsDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50)
  lateInterestMonthly!: number;
}
