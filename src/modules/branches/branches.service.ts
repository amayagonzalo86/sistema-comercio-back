  import {
    ConflictException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
  } from '@nestjs/common';
  import { InjectRepository } from '@nestjs/typeorm';
  import { FindOptionsWhere, Repository } from 'typeorm';
  import { UserRole } from '../users/entities/user.entity';
  import { CreateBranchDto } from './dto/create-branch.dto';
  import { UpdateBranchDto } from './dto/update-branch.dto';
  import { BranchEntity } from './entities/branch.entity';

  @Injectable()
  export class BranchesService {
    private readonly logger = new Logger(BranchesService.name);

    constructor(
      @InjectRepository(BranchEntity)
      private readonly branchRepository: Repository<BranchEntity>,
    ) { }

    async create(createBranchDto: CreateBranchDto, tenantId: string): Promise<BranchEntity> {
      const cleanCode = createBranchDto.code.trim().toUpperCase();

      const existingBranch = await this.branchRepository.findOne({
        where: {
          tenantId,
          code: cleanCode,
        },
      });

      if (existingBranch) {
        throw new ConflictException(
          `Ya existe una sucursal con el código '${cleanCode}' en su organización`,
        );
      }

      try {
        const branch = this.branchRepository.create({
          code: cleanCode,
          name: createBranchDto.name.trim(),
          address: createBranchDto.address?.trim(),
          phone: createBranchDto.phone?.trim(),
          status: createBranchDto.status ?? true,
          tenantId,
        });

        const savedBranch = await this.branchRepository.save(branch);
        this.logger.log(`Sucursal registrada correctamente: ${savedBranch.name} (${savedBranch.code})`);
        return savedBranch;
      } catch (error) {
        this.logger.error('Error al registrar la sucursal en MySQL', error);
        throw new InternalServerErrorException('Error interno al crear la sucursal');
      }
    }

    async findAllByTenant(tenantId: string, role: UserRole): Promise<BranchEntity[]> {
      const isAdminRole = role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN;

      this.logger.debug(`[findAllByTenant] Solicitud recibida -> TenantID: "${tenantId}" | Role: "${role}" | isAdmin: ${isAdminRole}`);

      const whereCondition: FindOptionsWhere<BranchEntity> = isAdminRole
        ? { tenantId }
        : { tenantId, status: true };

      const branches = await this.branchRepository.find({
        where: whereCondition,
        order: { createdAt: 'DESC' },
      });

      this.logger.debug(`[findAllByTenant] Registros encontrados en MySQL: ${branches.length}`);

      // Si el array retorna vacío, realizamos una búsqueda global sin restricción de tenantId para diagnóstico en consola
      if (branches.length === 0) {
        const globalCount = await this.branchRepository.count();
        this.logger.warn(`[DIAGNÓSTICO] La consulta retornó 0 registros. Total global de sucursales en BD: ${globalCount}`);
      }

      return branches;
    }

    async findOneByTenant(id: string, tenantId: string, role: UserRole): Promise<BranchEntity> {
      const isAdminRole = role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN;

      const whereCondition: FindOptionsWhere<BranchEntity> = isAdminRole
        ? { id, tenantId }
        : { id, tenantId, status: true };

      const branch = await this.branchRepository.findOne({
        where: whereCondition,
      });

      if (!branch) {
        throw new NotFoundException(
          `Sucursal con ID '${id}' no fue encontrada o no está disponible`,
        );
      }

      return branch;
    }

    async update(
      id: string,
      updateBranchDto: UpdateBranchDto,
      tenantId: string,
    ): Promise<BranchEntity> {
      const branch = await this.branchRepository.findOne({ where: { id, tenantId } });

      if (!branch) {
        throw new NotFoundException(
          `Sucursal con ID '${id}' no existe en su organización`,
        );
      }

      const { code, ...restUpdateData } = updateBranchDto;

      if (code) {
        const cleanCode = code.trim().toUpperCase();
        if (cleanCode !== branch.code) {
          const existingBranch = await this.branchRepository.findOne({
            where: { tenantId, code: cleanCode },
          });

          if (existingBranch) {
            throw new ConflictException(
              `El código de sucursal '${cleanCode}' ya está en uso`,
            );
          }
          branch.code = cleanCode;
        }
      }

      Object.assign(branch, restUpdateData);
      return await this.branchRepository.save(branch);
    }

    async remove(id: string, tenantId: string): Promise<{ message: string }> {
      const branch = await this.branchRepository.findOne({ where: { id, tenantId } });

      if (!branch) {
        throw new NotFoundException(
          `Sucursal con ID '${id}' no existe en su organización`,
        );
      }

      branch.status = false;
      await this.branchRepository.save(branch);

      return { message: `Sucursal '${branch.name}' deshabilitada correctamente` };
    }
  }