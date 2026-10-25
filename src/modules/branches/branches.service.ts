import { ConflictException, ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { BASE_BRANCH_LIMIT, hasTenantModule, TenantModule } from '../../common/modules/tenant-modules';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { BranchEntity } from './entities/branch.entity';

@Injectable()
export class BranchesService {
  private readonly logger = new Logger(BranchesService.name);

  constructor(
    @InjectRepository(BranchEntity)
    private readonly branchRepository: Repository<BranchEntity>,
  ) {}

  async create(tenantId: string, createBranchDto: CreateBranchDto): Promise<BranchEntity> {
    const cleanCode = createBranchDto.code.trim().toUpperCase();

    const existingBranch = await this.branchRepository.findOne({ where: { code: cleanCode, tenantId } });

    if (existingBranch) { throw new ConflictException( `Ya existe una sucursal con el código '${cleanCode}'` ) }
    await this.assertBranchSlot(tenantId);

    try {
      const branch = this.branchRepository.create({
        tenantId,
        code: cleanCode,
        name: createBranchDto.name.trim(),
        address: createBranchDto.address?.trim(),
        phone: createBranchDto.phone?.trim(),
        city: createBranchDto.city?.trim() || null,
        province: createBranchDto.province?.trim() || null,
        allowedIpRanges: normalizeRanges(createBranchDto.allowedIpRanges),
        status: true,
      });

      const savedBranch = await this.branchRepository.save(branch);
      this.logger.log(`Sucursal registrada correctamente: ${savedBranch.name} (${savedBranch.code})`);
      return savedBranch;
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
        throw new ConflictException(`Ya existe una sucursal con el código '${cleanCode}' en esta empresa`);
      }
      this.logger.error('Error al registrar la sucursal en MySQL', error);
      throw new InternalServerErrorException('Error interno al crear la sucursal');
    }
  }

  async findAll(tenantId: string, scopedBranchId: string | null = null): Promise<BranchEntity[]> {
    try{
      return await this.branchRepository.find({
        where: { tenantId, ...(scopedBranchId ? { id: scopedBranchId } : {}) },
        order: { createdAt: 'DESC' },
      });
    } catch (error) {
      this.logger.error('Error al buscar sucursales', error);
      throw new InternalServerErrorException('Error interno al consultar sucursales');
    }
  };

  async findOne(id: string, tenantId: string): Promise<BranchEntity> {
    try{
      const branch = await this.branchRepository.findOne({ where: { id, tenantId } });
      if (!branch) { throw new NotFoundException( `Sucursal con ID '${id}' no encontrada` ) }
      return branch;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error al buscar la sucursal ID '${id}'`, error);
      throw new InternalServerErrorException('Error interno al consultar la sucursal');
    }
  };

  async update(id: string, tenantId: string, updateBranchDto: UpdateBranchDto): Promise<BranchEntity> {
    try {
      const branch = await this.findOne(id, tenantId);
      const { code, ...restUpdateData } = updateBranchDto;
 
      if (code) {
        const cleanCode = code.trim().toUpperCase();
        if (cleanCode !== branch.code) {
          const existingBranch = await this.branchRepository.findOne({
            where: { code: cleanCode, tenantId },
          });
  
          if (existingBranch) {
            throw new ConflictException(
              `El código de sucursal '${cleanCode}' ya está en uso`,
            );
          }
          branch.code = cleanCode;
        }
      }
  
      // Reactivar una sucursal ocupa un lugar del plan.
      if (restUpdateData.status === true && !branch.status) await this.assertBranchSlot(tenantId);
      const { allowedIpRanges, ...otherUpdates } = restUpdateData;
      Object.assign(branch, otherUpdates);
      if (allowedIpRanges !== undefined) {
        branch.allowedIpRanges = normalizeRanges(allowedIpRanges);
      }
      return await this.branchRepository.save(branch);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Error al actualizar la sucursal ID '${id}'`, error);
      throw new InternalServerErrorException('Error interno al actualizar la sucursal');
    }
  };

  async remove(id: string, tenantId: string): Promise<{ message: string }> {
    try{
      const branch = await this.findOne(id, tenantId);

      branch.status = false;
      await this.branchRepository.save(branch);

      return { message: `Sucursal '${branch.name}' deshabilitada correctamente` };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error al deshabilitar la sucursal ID '${id}'`, error);
      throw new InternalServerErrorException('Error interno al deshabilitar la sucursal');
    }
  };

  /**
   * Plan base: una sucursal activa (incluye depósitos). Con «Multisucursal y depósitos» no hay límite.
   */
  private async assertBranchSlot(tenantId: string): Promise<void> {
    const manager = this.branchRepository.manager;
    if (await hasTenantModule(manager, tenantId, TenantModule.MULTI_BRANCH)) return;
    const active = await this.branchRepository.count({ where: { tenantId, status: true } });
    if (active >= BASE_BRANCH_LIMIT) {
      throw new ForbiddenException(
        `El plan base incluye ${BASE_BRANCH_LIMIT} sucursal. Para sumar sucursales o depósitos pedí el módulo «Multisucursal y depósitos».`,
        { description: `MODULE_NOT_ENABLED:${TenantModule.MULTI_BRANCH}` },
      );
    }
  }
}

function normalizeRanges(ranges: string[] | null | undefined): string[] | null {
  if (!ranges || ranges.length === 0) {
    return null;
  }
  return [...new Set(ranges.map((range) => range.trim()))];

}
