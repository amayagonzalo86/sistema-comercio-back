import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { BranchEntity } from './entities/branch.entity';
import { UserRole } from '../users/entities/user.entity';

@Injectable()
export class BranchesService {
  constructor(
    @InjectRepository(BranchEntity)
    private readonly branchRepository: Repository<BranchEntity>,
  ) { }

  async create(createBranchDto: CreateBranchDto, tenantId: string): Promise<BranchEntity> {
    const existingBranch = await this.branchRepository.findOne({
      where: {
        tenantId,
        code: createBranchDto.code,
      },
    });

    if (existingBranch) {
      throw new ConflictException(
        `Ya existe una sucursal con el código '${createBranchDto.code}' en su organización`,
      );
    }

    const branch = this.branchRepository.create({
      code: createBranchDto.code,
      name: createBranchDto.name,
      address: createBranchDto.address,
      phone: createBranchDto.phone,
      status: createBranchDto.status ?? true,
      tenantId,
    });

    return await this.branchRepository.save(branch);
  }

  async findAllByTenant(tenantId: string, role: UserRole): Promise<BranchEntity[]> {
    // Determinar si el usuario posee rol administrativo
    const isAdminRole = role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN;

    // Si es ADMIN / SUPER_ADMIN ve todas (true y false). Si no, solo activas (true).
    const whereCondition = isAdminRole
      ? { tenantId }
      : { tenantId, status: true };

    return await this.branchRepository.find({
      where: whereCondition,
      order: { createdAt: 'DESC' },
    });
  }

  async findOneByTenant(id: string, tenantId: string, role: UserRole): Promise<BranchEntity> {
    const isAdminRole = role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN;

    const whereCondition = isAdminRole
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
    // Para actualizar se permite buscar sin restringir por estado activo
    const branch = await this.branchRepository.findOne({ where: { id, tenantId } });

    if (!branch) {
      throw new NotFoundException(
        `Sucursal con ID '${id}' no existe en su organización`,
      );
    }

    if (updateBranchDto.code && updateBranchDto.code !== branch.code) {
      const existingBranch = await this.branchRepository.findOne({
        where: { tenantId, code: updateBranchDto.code },
      });

      if (existingBranch) {
        throw new ConflictException(
          `El código de sucursal '${updateBranchDto.code}' ya está en uso`,
        );
      }
    }

    Object.assign(branch, updateBranchDto);
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

    return { message: `Sucursal '${branch.name}' desactivada correctamente` };
  }
}