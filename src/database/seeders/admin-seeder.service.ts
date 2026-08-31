import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { UserEntity } from '../../modules/users/entities/user.entity';
import { PersonEntity } from '../../modules/persons/entities/person.entity';
import { UserRoleEnum } from '../../modules/roles/entities/role.entity';

@Injectable()
export class AdminSeederService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminSeederService.name);
  private readonly ADMIN_USERNAME = 'admin';

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(PersonEntity)
    private readonly personRepository: Repository<PersonEntity>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seed();
  }

  async seed(): Promise<void> {
    try {
      const adminUserExists = await this.userRepository.findOne({
        where: { username: this.ADMIN_USERNAME },
      });

      if (adminUserExists) {
        this.logger.log(`El usuario Administrador (${this.ADMIN_USERNAME}) ya existe.`);
        return;
      }

      this.logger.log('Inicializando Seeding: Creando Persona y Usuario Administrador...');

      // 1. Hash seguro de contraseña con Argon2id
      const passwordHash = await argon2.hash('AdminPass123!', {
        type: argon2.argon2id,
        memoryCost: 2 ** 16,
        timeCost: 3,
        parallelism: 1,
      });

      // 2. Crear Persona asociada al Administrador
      const adminPerson = this.personRepository.create({
        id: '11111111-1111-1111-1111-111111111111',
        firstName: 'Administrador',
        lastName: 'Sistema',
        email: 'admin@empresa.local',
        nationalId: '00000000',
      });

      const savedPerson = await this.personRepository.save(adminPerson);

      // 3. Crear Usuario asociado a la Persona
      const adminUser = this.userRepository.create({
        id: '3b33cd9a-55ca-40d8-96ea-4d466f2106ab',
        username: this.ADMIN_USERNAME,
        passwordHash,
        roles: [ UserRoleEnum.SUPER_ADMIN as any],
        isActive: true,
        personId: savedPerson.id,
        person: savedPerson,
      });

      await this.userRepository.save(adminUser);
      this.logger.log(`Usuario Administrador y datos personales creados con éxito (${this.ADMIN_USERNAME})`);
    } catch (error) {
      this.logger.error('Error crítico durante la inicialización del Administrador', error);
      throw error;
    }
  }
}