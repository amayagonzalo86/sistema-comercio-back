import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-use.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) { }
