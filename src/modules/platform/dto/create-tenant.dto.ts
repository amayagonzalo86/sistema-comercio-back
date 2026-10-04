import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @Length(3, 80)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @IsString()
  @Length(2, 200)
  legalName!: string;

  @IsOptional()
  @IsString()
  @Length(2, 200)
  tradeName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$/)
  taxId?: string;

  @IsUUID('4')
  ownerUserId!: string;
}
