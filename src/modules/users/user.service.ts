import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UserEntity, UserRole } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) { }

  async create(createUserDto: CreateUserDto, tenantId: string): Promise<Omit<UserEntity, 'passwordHash'>> {
    const existingUser = await this.userRepository.findOne({
      where: {
        tenantId,
        email: createUserDto.email.toLowerCase().trim(),
      },
    });

    if (existingUser) {
      throw new ConflictException(
        `El correo '${createUserDto.email}' ya está registrado en su organización`,
      );
    }

    const passwordHash = await argon2.hash(createUserDto.password);

    const newUser = this.userRepository.create({
      tenantId,
      email: createUserDto.email.toLowerCase().trim(),
      passwordHash,
      firstName: createUserDto.firstName,
      lastName: createUserDto.lastName,
      role: createUserDto.role ?? UserRole.CASHIER,
      status: true,
    });

    const savedUser = await this.userRepository.save(newUser);

    // Excluir passwordHash de la respuesta
    const { passwordHash: _, currentHashedRefreshToken: __, ...userResult } = savedUser;
    return userResult as Omit<UserEntity, 'passwordHash'>;
  }

  async findAllByTenant(tenantId: string): Promise<UserEntity[]> {
    return await this.userRepository.find({
      where: { tenantId },
      select: {
        id: true,
        tenantId: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        createdAt: true,
      },
      order: { createdAt: 'DESC' },
    });
  }
}