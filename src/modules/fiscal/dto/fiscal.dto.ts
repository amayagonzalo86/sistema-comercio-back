import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';
import { TaxConditionEnum } from '../../../common/enums/afip.enum';
import { IsCuit } from '../../../common/validators/decorators';
import { ArcaEnvironment } from '../../platform/entities/fiscal-profile.entity';
import { FiscalDocumentStatus, FiscalSourceType } from '../entities/fiscal-document.entity';

const SECRET_REF = /^(env:[A-Z][A-Z0-9_]{2,100}|file:[\w./-]{1,200})$/;

/**
 * PUT /fiscal/profile — datos fiscales del emisor.
 * El certificado y la clave NO se envían: se indican referencias ("env:ARCA_CERT" o "file:empresa.crt").
 */
export class UpsertFiscalProfileDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/[\s.-]/g, '') : value))
  @IsCuit()
  taxId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalName!: string;

  @IsIn([TaxConditionEnum.RESPONSABLE_INSCRIPTO, TaxConditionEnum.MONOTRIBUTO, TaxConditionEnum.EXENTO], {
    message: 'La condición del emisor debe ser RESPONSABLE_INSCRIPTO, MONOTRIBUTO o EXENTO.',
  })
  vatConditionCode!: TaxConditionEnum;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  grossIncomeRegistration?: string;

  @IsEnum(ArcaEnvironment)
  environment!: ArcaEnvironment;

  @IsOptional()
  @Matches(SECRET_REF, { message: 'Usá "env:NOMBRE_VARIABLE" o "file:archivo.crt".' })
  @MaxLength(255)
  certificateSecretRef?: string;

  @IsOptional()
  @Matches(SECRET_REF, { message: 'Usá "env:NOMBRE_VARIABLE" o "file:archivo.key".' })
  @MaxLength(255)
  privateKeySecretRef?: string;

  @IsOptional()
  @IsDateString()
  activityStartDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  commercialAddress?: string;
}

export class CreatePointOfSaleDto {
  @IsUUID('4')
  branchId!: string;

  @IsInt()
  @Min(1)
  @Max(99998)
  number!: number;
}

export class FiscalDocumentQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(FiscalDocumentStatus)
  status?: FiscalDocumentStatus;

  @IsOptional()
  @IsEnum(FiscalSourceType)
  sourceType?: FiscalSourceType;

  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
