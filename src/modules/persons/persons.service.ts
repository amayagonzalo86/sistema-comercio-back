import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { CreatePersonDto } from './dto/create-person.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { PersonEntity } from './entities/person.entity';
import { Repository } from 'typeorm';

@Injectable()
export class PersonsService {
  private readonly logger = new Logger(PersonsService.name);
  constructor(
    @InjectRepository(PersonEntity)
    private readonly personRepository: Repository<PersonEntity>
  ){}


  async create(tenantId: string, createPersonDto: CreatePersonDto): Promise<PersonEntity> {
    try{
      const personNew: PersonEntity = this.personRepository.create({ ...createPersonDto, tenantId });
      return await this.personRepository.save(personNew);
    } catch (error) {
      if ( error instanceof NotFoundException || error instanceof ConflictException || error instanceof BadRequestException ) {
        throw error;
      }
      this.logger.error(`Error al crear a la persona: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined );
      throw new InternalServerErrorException('No se pudo crear a la persona nueva');
    }
  };

  // findAll() {
  //   return `This action returns all persons`;
  // }

  // findOne(id: number) {
  //   return `This action returns a #${id} person`;
  // }

  // update(id: number, updatePersonDto: UpdatePersonDto) {
  //   return `This action updates a #${id} person`;
  // }

  // remove(id: number) {
  //   return `This action removes a #${id} person`;
  // }
}
