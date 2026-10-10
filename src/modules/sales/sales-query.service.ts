import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Paginated, paginated } from '../../common/dto/page-query.dto';
import { SaleQueryDto } from './dto/sale-query.dto';
import { SaleEntity } from './entities/sale.entity';

/** Consultas de ventas para el listado y la búsqueda del frontend. */
@Injectable()
export class SalesQueryService {
  constructor(private readonly dataSource: DataSource) {}

  async list(tenantId: string, query: SaleQueryDto, branchScope: string | null): Promise<Paginated<SaleEntity>> {
    if (branchScope && query.branchId && query.branchId !== branchScope) {
      throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    }
    const branchId = branchScope ?? query.branchId;
    const qb = this.dataSource
      .getRepository(SaleEntity)
      .createQueryBuilder('s')
      .where('s.tenantId = :tenantId', { tenantId });
    if (branchId) qb.andWhere('s.branchId = :branchId', { branchId });
    if (query.from) qb.andWhere('s.createdAt >= :from', { from: `${query.from.slice(0, 10)} 00:00:00` });
    if (query.to) qb.andWhere('s.createdAt < DATE_ADD(:to, INTERVAL 1 DAY)', { to: query.to.slice(0, 10) });
    if (query.customerPersonId) qb.andWhere('s.customerPersonId = :customer', { customer: query.customerPersonId });
    if (query.sellerUserId) qb.andWhere('s.actorUserId = :seller', { seller: query.sellerUserId });
    if (query.voucherClass) qb.andWhere('s.voucherClass = :voucherClass', { voucherClass: query.voucherClass });
    if (query.returnStatus) qb.andWhere('s.returnStatus = :returnStatus', { returnStatus: query.returnStatus });
    if (query.paymentMethod) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.tenant_id = s.tenant_id AND sp.sale_id = s.id AND sp.method = :method)',
        { method: query.paymentMethod },
      );
    }
    const [items, total] = await qb
      .orderBy('s.createdAt', 'DESC')
      .addOrderBy('s.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return paginated(items, total, query.page, query.limit);
  }
}
