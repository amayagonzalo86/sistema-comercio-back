import { Injectable } from '@nestjs/common';
import { UpdateUserDto } from './dto/update-use.dto';
import { CreateUserDto } from './dto/create-use.dto';

@Injectable()
export class UserService {
  create(createUserDto: CreateUserDto) {
    return 'This action adds a new user';
  }

  findAll() {
    return `This action returns all users`;
  }

  findOne(id: number) {
    return `This action returns a #${id} use`;
  }

  update(id: number, updateUseDto: UpdateUserDto) {
    return `This action updates a #${id} use`;
  }

  remove(id: number) {
    return `This action removes a #${id} use`;
  }
}
