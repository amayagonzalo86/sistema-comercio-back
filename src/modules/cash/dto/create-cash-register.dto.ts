import { IsString, IsUUID, Length, Matches } from 'class-validator';

export class CreateCashRegisterDto {
  @IsUUID('4')
  branchId!: string;

  @IsString()
  @Length(1, 32)
  @Matches(/\S/, { message: 'El código de caja no puede estar vacío.' })
  code!: string;

  @IsString()
  @Length(1, 120)
  @Matches(/\S/, { message: 'El nombre de caja no puede estar vacío.' })
  name!: string;
}
