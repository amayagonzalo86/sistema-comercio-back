import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { CreatePersonDto } from './dto/create-person.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { PersonEntity } from './entities/person.entity';
import { Repository } from 'typeorm';
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
}
