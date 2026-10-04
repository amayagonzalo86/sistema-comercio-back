import { ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
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

    try {
      const branch = this.branchRepository.create({
        tenantId,
        code: cleanCode,
        name: createBranchDto.name.trim(),
        address: createBranchDto.address?.trim(),
        phone: createBranchDto.phone?.trim(),
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

  async findAll(tenantId: string): Promise<BranchEntity[]> {
    try{
      return await this.branchRepository.find({ where: { tenantId }, order: { createdAt: 'DESC' } });
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
  
      Object.assign(branch, restUpdateData);
      return await this.branchRepository.save(branch);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
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
}