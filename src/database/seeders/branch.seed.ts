import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BranchEntity } from '../../modules/branches/entities/branch.entity';

export const runBranchSeed = async (dataSource: DataSource): Promise<void> => {
    const logger = new Logger('BranchSeed');
    const branchRepository = dataSource.getRepository(BranchEntity);

    logger.log(`Iniciando verificación de sucursales`);

    // 1. Contar registros totales independientemente del tenant o status
    const totalBranchesCount = await branchRepository.count({ withDeleted: true });
    logger.log(`Total absoluto de sucursales en BD (incluyendo eliminadas): ${totalBranchesCount}`);

    // // 2. Verificar existencia de sucursal para el tenant específico
    const existingBranch = await branchRepository.findOne({
        where: { name: 'Sucursal Central - Río Grande' },
        withDeleted: true,
    });

    if (!existingBranch) {
        logger.warn(`No se encontraron sucursales central . Creando sucursal semilla...`);

        const seedBranch = branchRepository.create({
            code: 'SUC-001',
            name: 'Sucursal Central - Río Grande',
            address: 'Av. San Martín 450',
            phone: '+542964112233',
            status: true,
        });

        const saved = await branchRepository.save(seedBranch);
        logger.log(`Sucursal semilla creada exitosamente con ID: ${saved.id}`);
    } else {
        logger.log(`Sucursal detectada: ${existingBranch.name} (Status: ${existingBranch.status})`);
    }
};