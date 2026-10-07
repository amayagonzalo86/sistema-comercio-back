import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { recordAudit } from '../../common/audit/audit';
import { Paginated, paginated } from '../../common/dto/page-query.dto';
import { RequestAuditContext } from '../../common/http/request-context';
import { TenantEntity } from '../platform/entities/tenant.entity';
import { buildPeriod, localToday } from '../reports/domain/period';
import { PromotionType } from './domain/promotions';
import {
  CreatePromotionDto,
  CustomerInsightQueryDto,
  InactiveCustomersQueryDto,
  PromotionQueryDto,
  UpdatePromotionDto,
} from './dto/promotion.dto';
import { PromotionEntity } from './entities/promotion.entity';

type Row = Record<string, string | number | Date | null>;
const num = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0);
const money = (value: unknown): number => Math.round(num(value) * 100) / 100;

/** Escapa un valor para CSV (y neutraliza fórmulas al abrirlo en Excel). */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Promociones y análisis de clientes. */
@Injectable()
export class MarketingService {
  constructor(private readonly dataSource: DataSource) {}

  async createPromotion(tenantId: string, actorUserId: string, dto: CreatePromotionDto, context: RequestAuditContext): Promise<PromotionEntity> {
    const fields = this.validatePromotion(dto);
    return this.dataSource.transaction(async (manager) => {
      const promotion = await manager.save(
        PromotionEntity,
        manager.create(PromotionEntity, {
          tenantId,
          name: dto.name,
          description: dto.description?.trim() || null,
          type: dto.type,
          ...fields,
          productIds: dto.productIds?.length ? dto.productIds : null,
          categories: dto.categories?.length ? dto.categories : null,
          brands: dto.brands?.length ? dto.brands : null,
          branchIds: dto.branchIds?.length ? dto.branchIds : null,
          weekdays: dto.weekdays?.length ? [...new Set(dto.weekdays)].sort() : null,
          minQuantity: dto.minQuantity !== undefined ? Number(dto.minQuantity).toFixed(3) : null,
          startsAt: dto.startsAt?.slice(0, 10) ?? null,
          endsAt: dto.endsAt?.slice(0, 10) ?? null,
          isActive: dto.isActive ?? true,
          createdByUserId: actorUserId,
        }),
      );
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'PROMOTION_CREATED',
        aggregateType: 'PROMOTION',
        aggregateId: promotion.id,
        metadata: { name: promotion.name, type: promotion.type },
        context,
      });
      return promotion;
    });
  }

  async updatePromotion(
    tenantId: string,
    actorUserId: string,
    promotionId: string,
    dto: UpdatePromotionDto,
    context: RequestAuditContext,
  ): Promise<PromotionEntity> {
    return this.dataSource.transaction(async (manager) => {
      const promotion = await manager.findOne(PromotionEntity, { where: { id: promotionId, tenantId } });
      if (!promotion) throw new NotFoundException('Promoción no encontrada.');
      if (dto.name !== undefined) promotion.name = dto.name;
      if (dto.description !== undefined) promotion.description = dto.description?.trim() || null;
      if (dto.isActive !== undefined) promotion.isActive = dto.isActive;
      if (dto.startsAt !== undefined) promotion.startsAt = dto.startsAt?.slice(0, 10) ?? null;
      if (dto.endsAt !== undefined) promotion.endsAt = dto.endsAt?.slice(0, 10) ?? null;
      if (promotion.startsAt && promotion.endsAt && promotion.startsAt > promotion.endsAt) {
        throw new BadRequestException('La fecha de inicio no puede ser posterior a la de fin.');
      }
      const saved = await manager.save(PromotionEntity, promotion);
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'PROMOTION_UPDATED',
        aggregateType: 'PROMOTION',
        aggregateId: promotion.id,
        metadata: { changes: dto },
        context,
      });
      return saved;
    });
  }

  async listPromotions(tenantId: string, query: PromotionQueryDto): Promise<Paginated<PromotionEntity>> {
    const qb = this.dataSource
      .getRepository(PromotionEntity)
      .createQueryBuilder('promo')
      .where('promo.tenantId = :tenantId', { tenantId });
    if (query.current) {
      const today = localToday(await this.timeZone(tenantId));
      qb.andWhere('promo.isActive = true')
        .andWhere('(promo.startsAt IS NULL OR promo.startsAt <= :today)', { today })
        .andWhere('(promo.endsAt IS NULL OR promo.endsAt >= :today)', { today });
    }
    const [items, total] = await qb
      .orderBy('promo.isActive', 'DESC')
      .addOrderBy('promo.createdAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return paginated(items, total, query.page, query.limit);
  }

  async getPromotion(tenantId: string, promotionId: string): Promise<PromotionEntity> {
    const promotion = await this.dataSource.getRepository(PromotionEntity).findOne({ where: { id: promotionId, tenantId } });
    if (!promotion) throw new NotFoundException('Promoción no encontrada.');
    return promotion;
  }

  /** Mejores clientes del período: facturación neta de devoluciones, compras y última visita. */
  async topCustomers(tenantId: string, query: CustomerInsightQueryDto, branchScope: string | null) {
    const branchId = this.scope(query.branchId, branchScope);
    const period = await this.period(tenantId, query.from, query.to);
    const rows = (await this.dataSource.query(
      `SELECT s.customer_person_id AS personId, MAX(p.first_name) AS firstName, MAX(p.last_name) AS lastName,
              MAX(p.email) AS email, MAX(p.phone) AS phone, MAX(p.marketing_consent) AS consent,
              COUNT(*) AS purchases, SUM(s.total - s.refunded_total) AS spent, MAX(s.created_at) AS lastPurchase
         FROM sales s
         JOIN persons p ON p.id = s.customer_person_id AND p.tenant_id = s.tenant_id
        WHERE s.tenant_id = ? AND s.customer_person_id IS NOT NULL AND s.created_at >= ? AND s.created_at < ?${branchId ? ' AND s.branch_id = ?' : ''}
        GROUP BY s.customer_person_id
        ORDER BY spent DESC
        LIMIT ?`,
      [tenantId, period.startUtc, period.endUtc, ...(branchId ? [branchId] : []), query.limit],
    )) as Row[];
    return {
      period: { from: period.from, to: period.to },
      items: rows.map((row) => {
        const purchases = num(row.purchases);
        const spent = money(row.spent);
        return {
          personId: String(row.personId),
          name: `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim(),
          email: row.email ? String(row.email) : null,
          phone: row.phone ? String(row.phone) : null,
          marketingConsent: num(row.consent) === 1,
          purchases,
          spent,
          averageTicket: purchases > 0 ? money(spent / purchases) : 0,
          lastPurchase: row.lastPurchase,
        };
      }),
    };
  }

  /** Clientes que compraron antes pero no en los últimos N días (para campañas de recuperación). */
  async inactiveCustomers(tenantId: string, query: InactiveCustomersQueryDto) {
    const since = new Date(Date.now() - query.days * 86_400_000);
    const consentSql = query.onlyWithConsent ? ' AND p.marketing_consent = 1' : '';
    const base = `FROM sales s
         JOIN persons p ON p.id = s.customer_person_id AND p.tenant_id = s.tenant_id AND p.isActive = 1
        WHERE s.tenant_id = ? AND s.customer_person_id IS NOT NULL${consentSql}
        GROUP BY s.customer_person_id
       HAVING MAX(s.created_at) < ?`;
    const [rows, count] = await Promise.all([
      this.dataSource.query(
        `SELECT s.customer_person_id AS personId, MAX(p.first_name) AS firstName, MAX(p.last_name) AS lastName,
                MAX(p.email) AS email, MAX(p.phone) AS phone, MAX(p.marketing_consent) AS consent,
                COUNT(*) AS purchases, SUM(s.total - s.refunded_total) AS spent, MAX(s.created_at) AS lastPurchase
           ${base}
          ORDER BY spent DESC
          LIMIT ? OFFSET ?`,
        [tenantId, since, query.limit, (query.page - 1) * query.limit],
      ) as Promise<Row[]>,
      this.dataSource.query(`SELECT COUNT(*) AS total FROM (SELECT s.customer_person_id ${base}) AS inactive`, [tenantId, since]) as Promise<Row[]>,
    ]);
    const total = num(count[0]?.total);
    return {
      days: query.days,
      items: rows.map((row) => ({
        personId: String(row.personId),
        name: `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim(),
        email: row.email ? String(row.email) : null,
        phone: row.phone ? String(row.phone) : null,
        marketingConsent: num(row.consent) === 1,
        purchases: num(row.purchases),
        spent: money(row.spent),
        lastPurchase: row.lastPurchase,
      })),
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  /** Resumen del período: clientes nuevos vs. recurrentes y peso de las ventas identificadas. */
  async customerSummary(tenantId: string, query: CustomerInsightQueryDto, branchScope: string | null) {
    const branchId = this.scope(query.branchId, branchScope);
    const period = await this.period(tenantId, query.from, query.to);
    const branchSql = branchId ? ' AND s.branch_id = ?' : '';
    const params = [tenantId, period.startUtc, period.endUtc, ...(branchId ? [branchId] : [])];
    const [totals, customers] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*) AS tickets, SUM(s.customer_person_id IS NOT NULL) AS identified,
                COALESCE(SUM(s.total), 0) AS gross, COALESCE(SUM(CASE WHEN s.customer_person_id IS NOT NULL THEN s.total ELSE 0 END), 0) AS identifiedGross
           FROM sales s WHERE s.tenant_id = ? AND s.created_at >= ? AND s.created_at < ?${branchSql}`,
        params,
      ) as Promise<Row[]>,
      this.dataSource.query(
        `SELECT COUNT(*) AS customers,
                SUM(CASE WHEN first_purchase >= ? THEN 1 ELSE 0 END) AS newCustomers
           FROM (
             SELECT s.customer_person_id,
                    (SELECT MIN(x.created_at) FROM sales x WHERE x.tenant_id = s.tenant_id AND x.customer_person_id = s.customer_person_id) AS first_purchase
               FROM sales s
              WHERE s.tenant_id = ? AND s.customer_person_id IS NOT NULL AND s.created_at >= ? AND s.created_at < ?${branchSql}
              GROUP BY s.customer_person_id, s.tenant_id
           ) AS buyers`,
        [period.startUtc, ...params],
      ) as Promise<Row[]>,
    ]);
    const tickets = num(totals[0]?.tickets);
    const customersCount = num(customers[0]?.customers);
    const newCustomers = num(customers[0]?.newCustomers);
    return {
      period: { from: period.from, to: period.to },
      tickets,
      identifiedTickets: num(totals[0]?.identified),
      identifiedShare: tickets > 0 ? Math.round((num(totals[0]?.identified) / tickets) * 1000) / 10 : 0,
      customers: customersCount,
      newCustomers,
      returningCustomers: customersCount - newCustomers,
      grossSales: money(totals[0]?.gross),
      identifiedGrossSales: money(totals[0]?.identifiedGross),
    };
  }

  /**
   * Exporta en CSV los contactos que dieron consentimiento de marketing (Ley 25.326).
   * La exportación queda auditada porque contiene datos personales.
   */
  async exportContacts(tenantId: string, actorUserId: string, context: RequestAuditContext): Promise<string> {
    const rows = (await this.dataSource.query(
      `SELECT first_name AS firstName, last_name AS lastName, email, phone, marketing_consent_at AS consentAt
         FROM persons
        WHERE tenant_id = ? AND isActive = 1 AND marketing_consent = 1 AND (email IS NOT NULL OR phone IS NOT NULL)
          AND person_type IN ('CUSTOMER', 'BOTH')
        ORDER BY last_name, first_name
        LIMIT 50000`,
      [tenantId],
    )) as Row[];
    await this.dataSource.transaction((manager) =>
      recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'MARKETING_CONTACTS_EXPORTED',
        aggregateType: 'PERSON',
        aggregateId: tenantId,
        metadata: { rows: rows.length },
        context,
      }),
    );
    const header = 'nombre,apellido,email,telefono,consentimiento';
    const lines = rows.map((row) =>
      [row.firstName, row.lastName, row.email, row.phone, row.consentAt instanceof Date ? row.consentAt.toISOString() : row.consentAt]
        .map(csvCell)
        .join(','),
    );
    return [header, ...lines].join('\r\n') + '\r\n';
  }

  private validatePromotion(dto: CreatePromotionDto): Pick<PromotionEntity, 'percentBasisPoints' | 'buyQuantity' | 'payQuantity'> {
    if (dto.startsAt && dto.endsAt && dto.startsAt.slice(0, 10) > dto.endsAt.slice(0, 10)) {
      throw new BadRequestException('La fecha de inicio no puede ser posterior a la de fin.');
    }
    if (dto.type === PromotionType.PERCENTAGE) {
      if (dto.percentage === undefined) throw new BadRequestException('Indicá el porcentaje de descuento.');
      return { percentBasisPoints: Math.round(dto.percentage * 100), buyQuantity: null, payQuantity: null };
    }
    if (!dto.buyQuantity || dto.payQuantity === undefined || dto.payQuantity >= dto.buyQuantity) {
      throw new BadRequestException('Para "llevá X pagá Y" indicá buyQuantity y payQuantity, con Y menor que X.');
    }
    return { percentBasisPoints: null, buyQuantity: dto.buyQuantity, payQuantity: dto.payQuantity };
  }

  private scope(requested: string | undefined, branchScope: string | null): string | null {
    if (branchScope && requested && requested !== branchScope) {
      throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    }
    return branchScope ?? requested ?? null;
  }

  private async timeZone(tenantId: string): Promise<string> {
    const tenant = await this.dataSource.getRepository(TenantEntity).findOne({ where: { id: tenantId }, select: { id: true, timeZone: true } });
    return tenant?.timeZone || 'America/Argentina/Buenos_Aires';
  }

  private async period(tenantId: string, from?: string, to?: string) {
    try {
      return buildPeriod(await this.timeZone(tenantId), from, to);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Período inválido.');
    }
  }
}
