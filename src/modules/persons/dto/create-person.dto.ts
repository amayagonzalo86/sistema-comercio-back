import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { PersonType } from "../entities/person.entity";

export class CreatePersonDto {

    @IsOptional()
    @IsEnum(PersonType)
    personType?: PersonType;

    @IsString( { message: 'el Primer nombre debe ser String'})
    @MinLength(3, { message: 'El Primer Nombre debe contener mínimo 3 (tres) letras'})
    @MaxLength(250, { message: 'El Primer Nombre debe contener como máximo 250 caracteres'})
    @IsNotEmpty({ message: ' El Primer Nombre no puede estar vacio' })
    firstName!: string;

    @IsString( { message: 'el Apellido debe ser String'})
    @MinLength(3, { message: 'El Apellido debe contener mínimo 3 (tres) letras'})
    @MaxLength(250, { message: 'El Apellido debe contener como máximo 250 caracteres'})
    @IsNotEmpty({ message: 'El Apellido no puede ser vacio' })
    lastName!: string;

    @IsOptional({ message: 'La nacionalidad puede ser opcional'})
    nationalId?: string | null;
    
    @IsOptional({ message: 'el email puede ser opcional'})
    email?: string | null;

    @IsOptional({ message: 'El teléfono puede ser opcional'})
    phone?: string | null;

    @IsOptional({ message: 'La dirección puede ser opcional'})
    address?: string | null;   
}