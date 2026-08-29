import { IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class AssignBranchDto {
    @IsUUID('4', { message: 'El ID de la sucursal debe ser un UUID v4 válido' })
    @IsNotEmpty({ message: 'El ID de la sucursal es obligatorio' })
    readonly branchId!: string;
}

export class UpdateUserBranchDto {
    @IsUUID('4', { message: 'El ID de la sucursal debe ser un UUID v4 válido' })
    @IsOptional()
    readonly branchId?: string | null;
}