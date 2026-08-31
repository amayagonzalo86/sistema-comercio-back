import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignBranchDto } from './dto/assign-branch.dto';
import { UserEntity } from './entities/user.entity';
import { PersonEntity } from '../persons/entities/person.entity';
import { BranchEntity } from '../branches/entities/branch.entity';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(PersonEntity)
    private readonly personRepository: Repository<PersonEntity>,
    @InjectRepository(BranchEntity)
    private readonly branchRepository: Repository<BranchEntity>,
  ) {}

  async create( createUserDto: CreateUserDto ): Promise<Omit<UserEntity, 'passwordHash' | 'currentHashedRefreshToken'>> {
    try {
      const { username, password, role, personId, branchId } = createUserDto;
        
      // 1. Verificar si el username ya está registrado
      const existingUserByUsername = await this.userRepository.findOne({ where: { username } });
      if (existingUserByUsername) { throw new ConflictException(`El nombre de usuario '${username}' ya está registrado en el sistema`) }
        
      // 2. Validar existencia previa e independiente de la persona
      const person = await this.personRepository.findOne({ where: { id: personId } });
      if (!person) { throw new NotFoundException(`No existe una persona registrada con el ID ${personId}. Debe crear la persona previamente.`) }
        
      // 3. Verificar que la persona no posea ya un usuario asociado
      const existingUserByPerson = await this.userRepository.findOne({ where: { person: { id: personId } } });
      if (existingUserByPerson) { throw new ConflictException(`La persona especificada ya tiene un usuario asignado ('${existingUserByPerson.username}')`) }
        
      // 4. Validar sucursal opcional
      let branch: BranchEntity | null = null;
      if (branchId) {
        branch = await this.branchRepository.findOne({ where: { id: branchId } });
        if (!branch) { throw new NotFoundException(`Sucursal con ID ${branchId} no encontrada`) }
      }
        
      // 5. Cifrar la contraseña con Argon2
      const passwordHash = await argon2.hash(password);
      
      // 6. Instanciar y guardar la entidad
      const newUser = this.userRepository.create({
        username,
        passwordHash,
        role,
        person,
        branch: branch || undefined,
        isActive: true,
      });
        
      const savedUser = await this.userRepository.save(newUser);
        
      // 7. Omitir credenciales en la respuesta
      delete (savedUser as Partial<UserEntity>).passwordHash;
      delete (savedUser as Partial<UserEntity>).currentHashedRefreshToken;
      return savedUser;
    } catch (error) {
      if ( error instanceof NotFoundException || error instanceof ConflictException || error instanceof BadRequestException ) {
        throw error;
      }
      this.logger.error(`Error al crear el usuario: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined );
      throw new InternalServerErrorException('No se pudo crear el usuario');
    }
  }
  
  async findAll(): Promise<UserEntity[]> {
    try{
      return await this.userRepository.find({ relations: { person: true, branch: true },
        select: {
          id: true,
          username: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (error){
      this.logger.error(`Error al obtener usuarios: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw new InternalServerErrorException('No se pudieron obtener los usuarios');
    }
  };

  async findOne(id: string): Promise<UserEntity> {
    try {
      const user = await this.userRepository.findOne({ where: { id },  relations: { person: true, branch: true } });
      if (!user) { throw new NotFoundException(`Usuario con ID ${id} no encontrado`) }
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) { throw error }
      this.logger.error(`Error al obtener el usuario con ID ${id}: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw new InternalServerErrorException('No se pudo obtener el usuario');
    }
  };

  async findByUsername(username: string): Promise<UserEntity> {
    try {
      const user = await this.userRepository.findOne({ where: { username }, relations: { person: true, branch: true } });
      if (!user) { throw new NotFoundException(`Usuario con el nombre '${username}' no encontrado`) }
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) { throw error }
      this.logger.error(`Error al obtener el usuario con nombre '${username}': ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw new InternalServerErrorException('No se pudo obtener el usuario');
    }
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<UserEntity> {
    const user = await this.findOne(id);

    if (updateUserDto.username && updateUserDto.username !== user.username) {
      const existingUsername = await this.userRepository.findOne({ where: { username: updateUserDto.username } });
      if (existingUsername) { throw new ConflictException(`El nombre de usuario '${updateUserDto.username}' ya está en uso`) }
      user.username = updateUserDto.username;
    }

    if (updateUserDto.password) {
      user.passwordHash = await argon2.hash(updateUserDto.password);
    }

    if (updateUserDto.role) {
      user.role = updateUserDto.role;
    }

    if (updateUserDto.branchId !== undefined) {
      if (updateUserDto.branchId === null) {
        user.branch = null;
        user.branchId = null;
      } else {
        const branch = await this.branchRepository.findOne({
          where: { id: updateUserDto.branchId },
        });
        if (!branch) {
          throw new NotFoundException(
            `Sucursal con ID ${updateUserDto.branchId} no encontrada`,
          );
        }
        user.branch = branch;
        user.branchId = branch.id;
      }
    }

    if (updateUserDto.isActive !== undefined) {
      user.isActive = updateUserDto.isActive;
    }

    return await this.userRepository.save(user);
  }

  async assignBranch( assignBranchDto: AssignBranchDto): Promise<UserEntity> {
    const { branchId , userId } = assignBranchDto;
    const user = await this.findOne(userId);
    const branchFind = await this.branchRepository.findOne({ where: { id: branchId } });
    if (!branchFind) { throw new NotFoundException(`Sucursal con ID ${assignBranchDto.branchId} no encontrada`) }
    user.branch = branchFind;
    user.branchId = branchFind.id;
    return await this.userRepository.save(user);
  };

  async unassignBranch(userId: string): Promise<{ message: string }> {
    try {
      const user = await this.findOne(userId);
      if (!user.branch) { throw new BadRequestException('El usuario no tiene una sucursal asignada') }
      user.branch = null;
      user.branchId = null;
      await this.userRepository.save(user);

      return { message: 'Sucursal desasignada correctamente del usuario' };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) { throw error }
      this.logger.error(`Error al desasignar la sucursal del usuario con ID ${userId}: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw new InternalServerErrorException('No se pudo desasignar la sucursal del usuario');
    }
  };

  async findUsersByBranch(branchId: string): Promise<UserEntity[]> {
    try {
      const branch = await this.branchRepository.findOne({ where: { id: branchId } });
      if (!branch) { throw new NotFoundException(`Sucursal con ID ${branchId} no encontrada`) }

      return await this.userRepository.find({ where: { branch: { id: branchId } }, relations: { person: true },
        select: {
          id: true,
          username: true,
          role: true,
          isActive: true,
        },
      });
    } catch (error) {
      if (error instanceof NotFoundException) { throw error; }
      this.logger.error( `Error al obtener usuarios de la sucursal con ID ${branchId}: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw new InternalServerErrorException('No se pudieron obtener los usuarios de la sucursal');
    }
  };

  async disable(id: string): Promise<{ message: string }> {
    try {
      const user = await this.findOne(id);
      user.isActive = false;
      await this.userRepository.save(user);
      return { message: `El usuario '${user.username}' ha sido desactivado` };
    } catch (error) {
      if (error instanceof NotFoundException) { throw error }
      this.logger.error( `Error al desactivar el usuario con ID ${id}: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw new InternalServerErrorException('No se pudo desactivar el usuario');
    }
  };

  async enable(id: string): Promise<{ message: string }> {
    const user = await this.findOne(id);
    user.isActive = true;
    await this.userRepository.save(user);
    return { message: `El usuario '${user.username}' ha sido activado` };
  }
}