import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { CreatePersonDto } from './dto/create-person.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { PersonEntity } from './entities/person.entity';
import { Brackets, In, Repository } from 'typeorm';
import { UpdatePersonDto } from './dto/update-person.dto';
import { PersonListQueryDto, PersonRoleFilter, PersonStatusFilter } from './dto/person-query.dto';
import { likePattern, Paginated, paginated } from '../../common/dto/page-query.dto';
import { PersonType } from './entities/person.entity';
import {
  CUIT_REQUIRED_CONDITIONS,
  IdentificationTypeEnum,
  TaxConditionEnum,
} from '../../common/enums/afip.enum';
import { isValidCuit, isValidDni, normalizeTaxId } from '../../common/validators/argentina-id';

export interface NormalizedFiscalIdentity {
  documentType: IdentificationTypeEnum | null;
  nationalId: string | null;
  vatCondition: TaxConditionEnum;
}

/**
 * Valida y normaliza la identificación fiscal de un cliente/proveedor según las reglas de ARCA:
 * - CUIT/CUIL con dígito verificador válido.
 * - DNI de 7 u 8 dígitos.
 * - Responsable Inscripto, Monotributo y Exento deben identificarse con CUIT.
 * Exportada para reutilizarla en otros flujos (alta rápida desde POS, importaciones).
 */
export function normalizeFiscalIdentity(
  documentType: IdentificationTypeEnum | null | undefined,
  nationalId: string | null | undefined,
  vatCondition: TaxConditionEnum | null | undefined,
): NormalizedFiscalIdentity {
  const condition = vatCondition ?? TaxConditionEnum.CONSUMIDOR_FINAL;
  const rawId = nationalId?.trim() ? nationalId.trim() : null;
  let type = documentType ?? null;

  // Si no se informa el tipo, se infiere: 11 dígitos => CUIT, 7-8 dígitos => DNI.
  if (rawId && type === null) {
    const digits = normalizeTaxId(rawId);
    if (/^\d{11}$/.test(digits)) type = IdentificationTypeEnum.CUIT;
    else if (/^\d{7,8}$/.test(digits)) type = IdentificationTypeEnum.DNI;
  }

  let normalizedId: string | null = rawId;
  switch (type) {
    case IdentificationTypeEnum.CUIT:
    case IdentificationTypeEnum.CUIL:
      if (!rawId || !isValidCuit(rawId)) {
        throw new BadRequestException('La CUIT/CUIL no es válida (verificá los 11 dígitos y el dígito verificador).');
      }
      normalizedId = normalizeTaxId(rawId);
      break;
    case IdentificationTypeEnum.DNI:
      if (!rawId || !isValidDni(rawId)) {
        throw new BadRequestException('El DNI debe tener 7 u 8 dígitos.');
      }
      normalizedId = normalizeTaxId(rawId);
      break;
    case IdentificationTypeEnum.PASAPORTE:
      if (!rawId) {
        throw new BadRequestException('Indicá el número de pasaporte.');
      }
      normalizedId = rawId.toUpperCase();
      break;
    case IdentificationTypeEnum.CONSUMIDOR_FINAL:
      normalizedId = null;
      break;
    default:
      break;
  }

  if (CUIT_REQUIRED_CONDITIONS.has(condition) && type !== IdentificationTypeEnum.CUIT) {
    throw new BadRequestException(
      'Los Responsables Inscriptos, Monotributistas y Exentos deben identificarse con CUIT válida.',
    );
  }

  return { documentType: type, nationalId: normalizedId, vatCondition: condition };
}

@Injectable()
export class PersonsService {
  private readonly logger = new Logger(PersonsService.name);
  constructor(
    @InjectRepository(PersonEntity)
    private readonly personRepository: Repository<PersonEntity>
  ){}


  async create(tenantId: string, createPersonDto: CreatePersonDto): Promise<PersonEntity> {
    const fiscal = normalizeFiscalIdentity(
      createPersonDto.documentType,
      createPersonDto.nationalId,
      createPersonDto.vatCondition,
    );
    try{
      const personNew: PersonEntity = this.personRepository.create({
        ...createPersonDto,
        ...fiscal,
        email: createPersonDto.email || null,
        marketingConsent: createPersonDto.marketingConsent ?? false,
        marketingConsentAt: createPersonDto.marketingConsent ? new Date() : null,
        tenantId,
      });
      return await this.personRepository.save(personNew);
    } catch (error) {
      if ( error instanceof NotFoundException || error instanceof ConflictException || error instanceof BadRequestException ) {
        throw error;
      }
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
        throw new ConflictException('Ya existe una persona con ese documento o email en esta empresa.');
      }
      this.logger.error(`Error al crear a la persona: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined );
      throw new InternalServerErrorException('No se pudo crear a la persona nueva');
    }
  };

  async findAll(tenantId: string, query: PersonListQueryDto): Promise<Paginated<PersonEntity>> {
    const qb = this.personRepository
      .createQueryBuilder('person')
      .where('person.tenantId = :tenantId', { tenantId });
    if (query.status === PersonStatusFilter.ACTIVE) qb.andWhere('person.isActive = true');
    if (query.status === PersonStatusFilter.INACTIVE) qb.andWhere('person.isActive = false');
    if (query.role === PersonRoleFilter.CUSTOMERS) {
      qb.andWhere('person.personType IN (:...types)', { types: [PersonType.CUSTOMER, PersonType.BOTH] });
    }
    if (query.role === PersonRoleFilter.SUPPLIERS) {
      qb.andWhere('person.personType IN (:...types)', { types: [PersonType.SUPPLIER, PersonType.BOTH] });
    }
    if (query.search) {
      const pattern = likePattern(query.search);
      const digits = query.search.replace(/[\s.-]/g, '');
      qb.andWhere(
        new Brackets((where) => {
          where
            .where('person.firstName LIKE :pattern', { pattern })
            .orWhere('person.lastName LIKE :pattern', { pattern })
            .orWhere('person.email LIKE :pattern', { pattern })
            .orWhere('person.phone LIKE :pattern', { pattern })
            .orWhere('person.nationalId = :digits', { digits });
        }),
      );
    }
    const [items, total] = await qb
      .orderBy('person.lastName', 'ASC')
      .addOrderBy('person.firstName', 'ASC')
      .addOrderBy('person.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return paginated(items, total, query.page, query.limit);
  }

  async findOne(tenantId: string, id: string): Promise<PersonEntity> {
    const person = await this.personRepository.findOne({ where: { id, tenantId } });
    if (!person) {
      throw new NotFoundException('La persona no existe en esta empresa.');
    }
    return person;
  }

  async update(tenantId: string, id: string, dto: UpdatePersonDto): Promise<PersonEntity> {
    const person = await this.findOne(tenantId, id);
    const touchesFiscal = dto.documentType !== undefined || dto.nationalId !== undefined || dto.vatCondition !== undefined;
    const fiscal = touchesFiscal
      ? normalizeFiscalIdentity(
          dto.documentType !== undefined ? dto.documentType : person.documentType,
          dto.nationalId !== undefined ? dto.nationalId : person.nationalId,
          dto.vatCondition ?? person.vatCondition,
        )
      : {};
    const consentBefore = person.marketingConsent;
    Object.assign(person, dto, fiscal);
    if (dto.email !== undefined) person.email = dto.email || null;
    if (dto.marketingConsent !== undefined && dto.marketingConsent !== consentBefore) {
      person.marketingConsentAt = dto.marketingConsent ? new Date() : null;
    }
    try {
      return await this.personRepository.save(person);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
        throw new ConflictException('Ya existe una persona con ese documento o email en esta empresa.');
      }
      this.logger.error(`Error al actualizar la persona: ${error instanceof Error ? error.message : String(error)}`);
      throw new InternalServerErrorException('No se pudo actualizar la persona');
    }
  }

  /** Baja lógica: se conserva por su historial de ventas, compras y cuenta corriente. */
  async setActive(tenantId: string, id: string, isActive: boolean): Promise<PersonEntity> {
    const person = await this.findOne(tenantId, id);
    person.isActive = isActive;
    return this.personRepository.save(person);
  }

  async findManyByIds(tenantId: string, ids: string[]): Promise<PersonEntity[]> {
    return ids.length ? this.personRepository.find({ where: { tenantId, id: In(ids) } }) : [];
  }
}
