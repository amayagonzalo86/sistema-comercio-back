import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { recordAudit } from '../../common/audit/audit';
import { parseTaxCondition, TaxConditionEnum } from '../../common/enums/afip.enum';
import { Paginated, paginated } from '../../common/dto/page-query.dto';
import { RequestAuditContext } from '../../common/http/request-context';
import { cents, formatMoney } from '../../common/utils/money';
import { BranchEntity } from '../branches/entities/branch.entity';
import { PersonEntity } from '../persons/entities/person.entity';
import { ArcaEnvironment, FiscalProfileEntity } from '../platform/entities/fiscal-profile.entity';
import { TenantEntity } from '../platform/entities/tenant.entity';
import { SaleItemEntity } from '../sales/entities/sale-item.entity';
import { SaleEntity, SaleFiscalStatus } from '../sales/entities/sale.entity';
import { SaleReturnItemEntity } from '../sales/returns/entities/sale-return-item.entity';
import { SaleReturnEntity } from '../sales/returns/entities/sale-return.entity';
import { ARCA_CLIENT, ArcaClient, ArcaTransportError } from './arca/arca-client';
import { SecretBox } from './arca/secrets';
import { ArcaAuthError } from './arca/wsaa';
import {
  arcaDate,
  CaeRequest,
  FiscalDocumentKind,
  qrUrl,
  receiverConditionId,
  receiverDocument,
  VatRateAmount,
  voucherTypeCode,
  WsfeAuth,
} from './arca/wsfe';
import { CreatePointOfSaleDto, FiscalDocumentQueryDto, UpsertFiscalProfileDto } from './dto/fiscal.dto';
import { ArcaTicketEntity } from './entities/arca-ticket.entity';
import { FiscalDocumentEntity, FiscalDocumentStatus, FiscalSourceType } from './entities/fiscal-document.entity';
import { FiscalPointOfSaleEntity } from './entities/fiscal-point-of-sale.entity';

interface IssueInput {
  tenantId: string;
  actorUserId: string;
  branchId: string;
  sourceType: FiscalSourceType;
  sourceId: string;
  voucherClass: string;
  kind: FiscalDocumentKind;
  customerPersonId: string | null;
  customerVatCondition: string | null;
  amounts: { total: string; netTaxed: string; vat: string; exempt: string; notTaxed: string; vatRates: VatRateAmount[] };
  associated: FiscalDocumentEntity | null;
  context: RequestAuditContext;
}

const LOCK_TIMEOUT_SECONDS = 30;

/**
 * Facturación electrónica con ARCA (WSFEv1): facturas y notas de crédito A, B y C.
 * Numeración serializada por punto de venta y tipo, ticket WSAA cifrado y conciliación ante cortes.
 */
@Injectable()
export class FiscalService {
  private readonly logger = new Logger(FiscalService.name);
  private readonly box: SecretBox;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(ARCA_CLIENT) private readonly arca: ArcaClient,
  ) {
    this.box = new SecretBox(process.env.FISCAL_ENCRYPTION_KEY || process.env.JWT_ACCESS_SECRET || '');
  }

  // ── Configuración ────────────────────────────────────────────────

  async getProfile(tenantId: string): Promise<FiscalProfileEntity | null> {
    return this.dataSource.getRepository(FiscalProfileEntity).findOne({ where: { tenantId, isActive: true } });
  }

  /** Crea o actualiza el perfil fiscal activo de la empresa (uno por empresa). */
  async upsertProfile(tenantId: string, actorUserId: string, dto: UpsertFiscalProfileDto, context: RequestAuditContext): Promise<FiscalProfileEntity> {
    return this.dataSource.transaction(async (manager) => {
      const tenant = await manager.findOne(TenantEntity, { where: { id: tenantId } });
      if (!tenant) throw new NotFoundException('Empresa no encontrada.');
      if (tenant.taxId && tenant.taxId !== dto.taxId) {
        throw new BadRequestException('La CUIT no coincide con la registrada para la empresa.');
      }
      await manager.update(FiscalProfileEntity, { tenantId }, { isActive: false });
      let profile = await manager.findOne(FiscalProfileEntity, { where: { tenantId, taxId: dto.taxId, environment: dto.environment } });
      profile ??= manager.create(FiscalProfileEntity, { tenantId, taxId: dto.taxId, environment: dto.environment });
      Object.assign(profile, {
        legalName: dto.legalName.trim(),
        vatConditionCode: dto.vatConditionCode,
        grossIncomeRegistration: dto.grossIncomeRegistration?.trim() || null,
        certificateSecretRef: dto.certificateSecretRef ?? profile.certificateSecretRef ?? null,
        privateKeySecretRef: dto.privateKeySecretRef ?? profile.privateKeySecretRef ?? null,
        activityStartDate: dto.activityStartDate?.slice(0, 10) ?? profile.activityStartDate ?? null,
        commercialAddress: dto.commercialAddress?.trim() || profile.commercialAddress || null,
        isActive: true,
      });
      const saved = await manager.save(FiscalProfileEntity, profile);
      if (!tenant.taxId) await manager.update(TenantEntity, { id: tenantId }, { taxId: dto.taxId });
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'FISCAL_PROFILE_UPDATED',
        aggregateType: 'FISCAL_PROFILE',
        aggregateId: saved.id,
        metadata: { taxId: saved.taxId, vatCondition: saved.vatConditionCode, environment: saved.environment },
        context,
      });
      return saved;
    });
  }

  async listPointsOfSale(tenantId: string): Promise<FiscalPointOfSaleEntity[]> {
    return this.dataSource.getRepository(FiscalPointOfSaleEntity).find({ where: { tenantId }, order: { environment: 'ASC', number: 'ASC' } });
  }

  async createPointOfSale(tenantId: string, actorUserId: string, dto: CreatePointOfSaleDto, context: RequestAuditContext): Promise<FiscalPointOfSaleEntity> {
    const profile = await this.requireProfile(tenantId);
    const branch = await this.dataSource.getRepository(BranchEntity).findOne({ where: { id: dto.branchId, tenantId }, select: { id: true } });
    if (!branch) throw new NotFoundException('La sucursal no pertenece a esta empresa.');
    try {
      return await this.dataSource.transaction(async (manager) => {
        const saved = await manager.save(
          FiscalPointOfSaleEntity,
          manager.create(FiscalPointOfSaleEntity, {
            tenantId,
            branchId: dto.branchId,
            number: dto.number,
            environment: profile.environment,
            isActive: true,
          }),
        );
        await recordAudit(manager, {
          tenantId,
          actorUserId,
          eventType: 'FISCAL_POINT_OF_SALE_CREATED',
          aggregateType: 'FISCAL_POINT_OF_SALE',
          aggregateId: saved.id,
          metadata: { branchId: dto.branchId, number: dto.number, environment: profile.environment },
          context,
        });
        return saved;
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
        throw new ConflictException('Ese número de punto de venta o esa sucursal ya tienen uno asignado en este ambiente.');
      }
      throw error;
    }
  }

  /** Estado de los servidores de ARCA y validez de las credenciales de la empresa. */
  async status(tenantId: string) {
    const profile = await this.requireProfile(tenantId);
    let servers: { app: string | null; db: string | null; auth: string | null } | null = null;
    let credentials = 'NOT_CHECKED';
    try {
      servers = await this.arca.health(profile.environment);
    } catch {
      servers = null;
    }
    try {
      const auth = await this.auth(tenantId, profile);
      credentials = auth ? 'OK' : 'ERROR';
    } catch (error) {
      credentials = error instanceof Error ? error.message : 'ERROR';
    }
    return { environment: profile.environment, cuit: profile.taxId, servers, credentials };
  }

  async receiverConditions(tenantId: string) {
    const profile = await this.requireProfile(tenantId);
    return this.arca.receiverConditions(profile.environment, await this.auth(tenantId, profile));
  }

  // ── Emisión ──────────────────────────────────────────────────────

  /** Emite la factura electrónica de una venta (idempotente: si ya está autorizada, la devuelve). */
  async invoiceSale(tenantId: string, actorUserId: string, saleId: string, branchScope: string | null, context: RequestAuditContext) {
    const sale = await this.dataSource.getRepository(SaleEntity).findOne({ where: { id: saleId, tenantId } });
    if (!sale || (branchScope && sale.branchId !== branchScope)) throw new NotFoundException('Venta no encontrada.');
    if (!sale.voucherClass) {
      throw new BadRequestException('La venta es anterior a la configuración fiscal y no tiene clase de comprobante.');
    }
    const rates = (await this.dataSource.query(
      `SELECT arca_vat_rate_id AS arcaId, SUM(net_amount) AS base, SUM(tax_amount) AS amount
         FROM sale_items WHERE tenant_id = ? AND sale_id = ? AND arca_vat_rate_id IS NOT NULL
        GROUP BY arca_vat_rate_id ORDER BY arca_vat_rate_id`,
      [tenantId, saleId],
    )) as Array<{ arcaId: number; base: string; amount: string }>;
    return this.issue({
      tenantId,
      actorUserId,
      branchId: sale.branchId,
      sourceType: FiscalSourceType.SALE,
      sourceId: sale.id,
      voucherClass: sale.voucherClass,
      kind: FiscalDocumentKind.INVOICE,
      customerPersonId: sale.customerPersonId ?? null,
      customerVatCondition: sale.customerVatCondition ?? null,
      amounts: {
        total: sale.total,
        netTaxed: sale.netTaxedTotal,
        vat: sale.taxTotal,
        exempt: sale.exemptTotal,
        notTaxed: sale.notTaxedTotal,
        vatRates: rates.map((rate) => ({ arcaId: Number(rate.arcaId), base: money(rate.base), amount: money(rate.amount) })),
      },
      associated: null,
      context,
    });
  }

  /** Emite la nota de crédito de una devolución, asociada a la factura de la venta. */
  async creditNoteForReturn(tenantId: string, actorUserId: string, returnId: string, branchScope: string | null, context: RequestAuditContext) {
    const saleReturn = await this.dataSource.getRepository(SaleReturnEntity).findOne({ where: { id: returnId, tenantId } });
    if (!saleReturn || (branchScope && saleReturn.branchId !== branchScope)) throw new NotFoundException('Devolución no encontrada.');
    const sale = await this.dataSource.getRepository(SaleEntity).findOneOrFail({ where: { id: saleReturn.saleId, tenantId } });
    const invoice = await this.dataSource.getRepository(FiscalDocumentEntity).findOne({
      where: { tenantId, sourceType: FiscalSourceType.SALE, sourceId: sale.id, status: FiscalDocumentStatus.AUTHORIZED },
    });
    if (!invoice) throw new BadRequestException('La venta no tiene una factura autorizada: no corresponde nota de crédito.');
    const [totals] = (await this.dataSource.query(
      `SELECT COALESCE(SUM(ri.net_amount), 0) AS net, COALESCE(SUM(ri.exempt_amount), 0) AS exempt, COALESCE(SUM(ri.not_taxed_amount), 0) AS notTaxed
         FROM sale_return_items ri WHERE ri.tenant_id = ? AND ri.sale_return_id = ?`,
      [tenantId, returnId],
    )) as Array<{ net: string; exempt: string; notTaxed: string }>;
    const rates = (await this.dataSource.query(
      `SELECT si.arca_vat_rate_id AS arcaId, SUM(ri.net_amount) AS base, SUM(ri.tax_amount) AS amount
         FROM sale_return_items ri JOIN sale_items si ON si.id = ri.sale_item_id
        WHERE ri.tenant_id = ? AND ri.sale_return_id = ? AND si.arca_vat_rate_id IS NOT NULL
        GROUP BY si.arca_vat_rate_id ORDER BY si.arca_vat_rate_id`,
      [tenantId, returnId],
    )) as Array<{ arcaId: number; base: string; amount: string }>;
    return this.issue({
      tenantId,
      actorUserId,
      branchId: saleReturn.branchId,
      sourceType: FiscalSourceType.SALE_RETURN,
      sourceId: saleReturn.id,
      voucherClass: invoice.voucherClass,
      kind: FiscalDocumentKind.CREDIT_NOTE,
      customerPersonId: sale.customerPersonId ?? null,
      customerVatCondition: sale.customerVatCondition ?? null,
      amounts: {
        total: saleReturn.total,
        netTaxed: money(totals.net),
        vat: saleReturn.taxTotal,
        exempt: money(totals.exempt),
        notTaxed: money(totals.notTaxed),
        vatRates: rates.map((rate) => ({ arcaId: Number(rate.arcaId), base: money(rate.base), amount: money(rate.amount) })),
      },
      associated: invoice,
      context,
    });
  }

  async listDocuments(tenantId: string, query: FiscalDocumentQueryDto, branchScope: string | null): Promise<Paginated<FiscalDocumentEntity>> {
    if (branchScope && query.branchId && query.branchId !== branchScope) {
      throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    }
    const branchId = branchScope ?? query.branchId;
    const qb = this.dataSource.getRepository(FiscalDocumentEntity).createQueryBuilder('d').where('d.tenantId = :tenantId', { tenantId });
    if (branchId) qb.andWhere('d.branchId = :branchId', { branchId });
    if (query.status) qb.andWhere('d.status = :status', { status: query.status });
    if (query.sourceType) qb.andWhere('d.sourceType = :sourceType', { sourceType: query.sourceType });
    if (query.from) qb.andWhere('d.issueDate >= :from', { from: query.from.slice(0, 10) });
    if (query.to) qb.andWhere('d.issueDate <= :to', { to: query.to.slice(0, 10) });
    const [items, total] = await qb
      .orderBy('d.createdAt', 'DESC')
      .addOrderBy('d.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return paginated(items, total, query.page, query.limit);
  }

  /** Comprobante con todos los datos para imprimirlo (emisor, receptor, ítems, totales y QR). */
  async getDocument(tenantId: string, documentId: string, branchScope: string | null) {
    const document = await this.dataSource.getRepository(FiscalDocumentEntity).findOne({ where: { id: documentId, tenantId } });
    if (!document || (branchScope && document.branchId !== branchScope)) throw new NotFoundException('Comprobante no encontrado.');
    const profile = await this.dataSource.getRepository(FiscalProfileEntity).findOne({
      where: { tenantId, environment: document.environment },
      order: { isActive: 'DESC', updatedAt: 'DESC' },
    });
    const items =
      document.sourceType === FiscalSourceType.SALE
        ? await this.dataSource.getRepository(SaleItemEntity).find({ where: { tenantId, saleId: document.sourceId }, order: { id: 'ASC' } })
        : await this.dataSource.getRepository(SaleReturnItemEntity).find({ where: { tenantId, saleReturnId: document.sourceId }, order: { id: 'ASC' } });
    // Receptor (RG 1415: apellido y nombre o razón social y domicilio en comprobantes identificados).
    const sourceSale =
      document.sourceType === FiscalSourceType.SALE
        ? await this.dataSource.getRepository(SaleEntity).findOne({ where: { id: document.sourceId, tenantId } })
        : await this.dataSource
            .getRepository(SaleReturnEntity)
            .findOne({ where: { id: document.sourceId, tenantId } })
            .then((saleReturn) => (saleReturn ? this.dataSource.getRepository(SaleEntity).findOne({ where: { id: saleReturn.saleId, tenantId } }) : null));
    const customer = sourceSale?.customerPersonId
      ? await this.dataSource.getRepository(PersonEntity).findOne({ where: { id: sourceSale.customerPersonId, tenantId } })
      : null;
    const associated = document.associatedDocumentId
      ? await this.dataSource.getRepository(FiscalDocumentEntity).findOne({ where: { id: document.associatedDocumentId, tenantId } })
      : null;
    return {
      document,
      issuer: profile
        ? {
            legalName: profile.legalName,
            cuit: profile.taxId,
            vatCondition: profile.vatConditionCode,
            grossIncomeRegistration: profile.grossIncomeRegistration ?? null,
            activityStartDate: profile.activityStartDate ?? null,
            commercialAddress: profile.commercialAddress ?? null,
          }
        : null,
      receiver: customer
        ? { name: `${customer.firstName} ${customer.lastName}`.replace(/\s+-$/, '').trim(), address: customer.address ?? null }
        : null,
      associated: associated
        ? { voucherType: associated.voucherType, pointOfSale: associated.pointOfSale, number: associated.number, issueDate: associated.issueDate }
        : null,
      items,
      formattedNumber:
        document.number !== null && document.number !== undefined
          ? `${String(document.pointOfSale).padStart(5, '0')}-${String(document.number).padStart(8, '0')}`
          : null,
      qrUrl:
        document.status === FiscalDocumentStatus.AUTHORIZED && document.cae && profile && document.number
          ? qrUrl({
              date: document.issueDate,
              cuit: profile.taxId,
              pointOfSale: document.pointOfSale,
              voucherType: document.voucherType,
              number: document.number,
              total: document.total,
              docType: document.docType,
              docNumber: document.docNumber,
              cae: document.cae,
            })
          : null,
    };
  }

  // ── Núcleo de emisión ────────────────────────────────────────────

  private async issue(input: IssueInput): Promise<FiscalDocumentEntity> {
    const profile = await this.requireProfile(input.tenantId);
    const issuerCondition = parseTaxCondition(profile.vatConditionCode);
    if (issuerCondition !== TaxConditionEnum.RESPONSABLE_INSCRIPTO && input.voucherClass !== 'C') {
      throw new BadRequestException('El perfil fiscal no es Responsable Inscripto: solo puede emitir comprobantes C.');
    }
    let voucherType: number;
    try {
      voucherType = voucherTypeCode(input.voucherClass, input.kind);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Clase de comprobante no soportada.');
    }
    const pos = await this.dataSource.getRepository(FiscalPointOfSaleEntity).findOne({
      where: { tenantId: input.tenantId, branchId: input.branchId, environment: profile.environment, isActive: true },
    });
    if (!pos) throw new BadRequestException('La sucursal no tiene un punto de venta de ARCA configurado para este ambiente.');

    const customer = input.customerPersonId
      ? await this.dataSource.getRepository(PersonEntity).findOne({
          where: { id: input.customerPersonId, tenantId: input.tenantId },
          select: { id: true, nationalId: true, documentType: true },
        })
      : null;
    const receiver = receiverDocument(customer?.nationalId ?? null, customer?.documentType ?? null);
    if (input.voucherClass === 'A' && receiver.docType !== 80) {
      throw new BadRequestException('Un comprobante A requiere que el cliente tenga CUIT.');
    }

    // Clase C: el emisor no discrimina IVA; todo el importe va como neto.
    const amounts =
      input.voucherClass === 'C'
        ? { total: input.amounts.total, netTaxed: input.amounts.total, vat: '0.00', exempt: '0.00', notTaxed: '0.00', vatRates: [] as VatRateAmount[] }
        : input.amounts;
    const timeZone = (await this.dataSource.getRepository(TenantEntity).findOne({ where: { id: input.tenantId }, select: { id: true, timeZone: true } }))?.timeZone || 'America/Argentina/Buenos_Aires';
    const date = arcaDate(timeZone);
    const issueDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;

    const documents = this.dataSource.getRepository(FiscalDocumentEntity);
    let document = await documents.findOne({ where: { tenantId: input.tenantId, sourceType: input.sourceType, sourceId: input.sourceId } });
    if (document?.status === FiscalDocumentStatus.AUTHORIZED) return document;
    if (!document) {
      try {
        document = await documents.save(
          documents.create({
            tenantId: input.tenantId,
            branchId: input.branchId,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            environment: profile.environment,
            voucherClass: input.voucherClass,
            voucherType,
            pointOfSale: pos.number,
            number: null,
            status: FiscalDocumentStatus.PENDING,
            issueDate,
            docType: receiver.docType,
            docNumber: receiver.docNumber,
            receiverConditionId: receiverConditionId(input.customerVatCondition),
            total: money(amounts.total),
            netTaxed: money(amounts.netTaxed),
            vatTotal: money(amounts.vat),
            exempt: money(amounts.exempt),
            notTaxed: money(amounts.notTaxed),
            vatRates: amounts.vatRates,
            associatedDocumentId: input.associated?.id ?? null,
            attempts: 0,
            actorUserId: input.actorUserId,
          }),
        );
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
          document = await documents.findOneOrFail({ where: { tenantId: input.tenantId, sourceType: input.sourceType, sourceId: input.sourceId } });
          if (document.status === FiscalDocumentStatus.AUTHORIZED) return document;
        } else {
          throw error;
        }
      }
    }
    const documentId = (document as FiscalDocumentEntity).id;

    // Serializa la numeración por (empresa, ambiente, punto de venta, tipo) en todas las instancias de la API.
    const lockName = 'arca:' + createHash('sha1').update(`${input.tenantId}:${profile.environment}:${pos.number}:${voucherType}`).digest('hex');
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const [lock] = (await runner.query('SELECT GET_LOCK(?, ?) AS acquired', [lockName, LOCK_TIMEOUT_SECONDS])) as Array<{ acquired: number | string | null }>;
      if (Number(lock?.acquired) !== 1) {
        throw new ConflictException('Hay otro comprobante emitiéndose en este punto de venta. Reintentá en unos segundos.');
      }
      try {
        return await this.issueLocked(documentId, input, profile, voucherType, pos.number, date);
      } finally {
        await runner.query('SELECT RELEASE_LOCK(?)', [lockName]);
      }
    } finally {
      await runner.release();
    }
  }

  private async issueLocked(
    documentId: string,
    input: IssueInput,
    profile: FiscalProfileEntity,
    voucherType: number,
    pointOfSale: number,
    date: string,
  ): Promise<FiscalDocumentEntity> {
    const documents = this.dataSource.getRepository(FiscalDocumentEntity);
    const document = await documents.findOneOrFail({ where: { id: documentId } });
    if (document.status === FiscalDocumentStatus.AUTHORIZED) return document;

    const auth = await this.auth(input.tenantId, profile);
    document.attempts += 1;

    try {
      // Un intento anterior pudo autorizarse en ARCA sin que llegara la respuesta: se consulta antes de renumerar.
      if (document.status === FiscalDocumentStatus.ERROR && document.number) {
        const previous = await this.arca.consult(profile.environment, auth, pointOfSale, voucherType, document.number);
        if (previous.found && previous.cae && Number(previous.total) === Number(document.total)) {
          return this.markAuthorized(document, input, previous.cae, previous.caeExpiration, []);
        }
      }

      const last = await this.arca.lastAuthorized(profile.environment, auth, pointOfSale, voucherType);
      document.number = last + 1;
      document.status = FiscalDocumentStatus.PENDING;
      document.errorMessage = null;
      await documents.save(document);

      const request: CaeRequest = {
        pointOfSale,
        voucherType,
        number: document.number,
        date,
        docType: document.docType,
        docNumber: document.docNumber,
        receiverConditionId: document.receiverConditionId,
        total: document.total,
        netTaxed: document.netTaxed,
        notTaxed: document.notTaxed,
        exempt: document.exempt,
        vat: document.vatTotal,
        currency: 'PES',
        vatRates: document.vatRates,
        associated: input.associated?.number
          ? {
              voucherType: input.associated.voucherType,
              pointOfSale: input.associated.pointOfSale,
              number: input.associated.number,
              cuit: profile.taxId,
              date: input.associated.issueDate.replace(/-/g, ''),
            }
          : null,
      };
      const result = await this.arca.requestCae(profile.environment, auth, request);
      if ((result.result === 'A' || result.result === 'P') && result.cae) {
        return this.markAuthorized(document, input, result.cae, result.caeExpiration, result.observations);
      }

      document.status = FiscalDocumentStatus.REJECTED;
      document.number = null;
      document.observations = [...result.errors, ...result.observations];
      document.errorMessage = describe(document.observations) || 'ARCA rechazó el comprobante.';
      await documents.save(document);
      await this.updateSourceStatus(input, SaleFiscalStatus.REJECTED);
      await this.audit(input, document, 'FISCAL_DOCUMENT_REJECTED');
      return document;
    } catch (error) {
      if (error instanceof ArcaTransportError || error instanceof ArcaAuthError) {
        document.status = FiscalDocumentStatus.ERROR;
        document.errorMessage = error.message.slice(0, 1000);
        await documents.save(document);
        await this.updateSourceStatus(input, SaleFiscalStatus.FAILED);
        throw new ServiceUnavailableException(`${error.message} El comprobante quedó pendiente: reintentá la emisión.`);
      }
      if (error instanceof Error && error.message.startsWith('ARCA:')) {
        document.status = FiscalDocumentStatus.REJECTED;
        document.number = null;
        document.errorMessage = error.message.slice(0, 1000);
        await documents.save(document);
        await this.updateSourceStatus(input, SaleFiscalStatus.REJECTED);
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private async markAuthorized(
    document: FiscalDocumentEntity,
    input: IssueInput,
    cae: string,
    expiration: string | null,
    observations: Array<{ code: string; message: string }>,
  ): Promise<FiscalDocumentEntity> {
    document.status = FiscalDocumentStatus.AUTHORIZED;
    document.cae = cae;
    document.caeExpiration = expiration && /^\d{8}$/.test(expiration) ? `${expiration.slice(0, 4)}-${expiration.slice(4, 6)}-${expiration.slice(6, 8)}` : null;
    document.observations = observations.length ? observations : null;
    document.errorMessage = null;
    document.authorizedAt = new Date();
    const saved = await this.dataSource.getRepository(FiscalDocumentEntity).save(document);
    await this.updateSourceStatus(input, SaleFiscalStatus.AUTHORIZED);
    await this.audit(input, saved, 'FISCAL_DOCUMENT_AUTHORIZED');
    return saved;
  }

  private async updateSourceStatus(input: IssueInput, status: SaleFiscalStatus): Promise<void> {
    if (input.sourceType === FiscalSourceType.SALE) {
      await this.dataSource.getRepository(SaleEntity).update({ id: input.sourceId, tenantId: input.tenantId }, { fiscalStatus: status });
    } else {
      await this.dataSource.getRepository(SaleReturnEntity).update({ id: input.sourceId, tenantId: input.tenantId }, { fiscalStatus: status });
    }
  }

  private async audit(input: IssueInput, document: FiscalDocumentEntity, eventType: string): Promise<void> {
    await this.dataSource.transaction((manager) =>
      recordAudit(manager, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        eventType,
        aggregateType: 'FISCAL_DOCUMENT',
        aggregateId: document.id,
        metadata: {
          sourceType: document.sourceType,
          sourceId: document.sourceId,
          voucherType: document.voucherType,
          pointOfSale: document.pointOfSale,
          number: document.number ?? null,
          cae: document.cae ?? null,
          total: document.total,
          error: document.errorMessage ?? null,
        },
        context: input.context,
      }),
    );
  }

  /** Ticket de WSAA: se reutiliza mientras esté vigente (cifrado en la base). */
  private async auth(tenantId: string, profile: FiscalProfileEntity): Promise<WsfeAuth> {
    const tickets = this.dataSource.getRepository(ArcaTicketEntity);
    const stored = await tickets.findOne({ where: { tenantId, service: 'wsfe', environment: profile.environment } });
    const valid = stored && stored.expiresAt.getTime() > Date.now() + 5 * 60_000;
    if (stored && valid) {
      return { token: this.box.open(stored.sealedToken), sign: this.box.open(stored.sealedSign), cuit: profile.taxId };
    }
    try {
      const ticket = await this.arca.authenticate(
        { environment: profile.environment, cuit: profile.taxId, certificateRef: profile.certificateSecretRef, privateKeyRef: profile.privateKeySecretRef },
        'wsfe',
      );
      const row = stored ?? tickets.create({ tenantId, service: 'wsfe', environment: profile.environment });
      row.sealedToken = this.box.seal(ticket.token);
      row.sealedSign = this.box.seal(ticket.sign);
      row.expiresAt = ticket.expiresAt;
      await tickets.save(row);
      return { token: ticket.token, sign: ticket.sign, cuit: profile.taxId };
    } catch (error) {
      if (error instanceof ArcaAuthError && error.code.includes('alreadyAuthenticated') && stored && stored.expiresAt.getTime() > Date.now()) {
        return { token: this.box.open(stored.sealedToken), sign: this.box.open(stored.sealedSign), cuit: profile.taxId };
      }
      if (error instanceof ArcaAuthError || error instanceof ArcaTransportError) throw error;
      this.logger.warn(`No se pudo autenticar ante ARCA: ${error instanceof Error ? error.message : String(error)}`);
      throw new BadRequestException(error instanceof Error ? error.message : 'No se pudo autenticar ante ARCA.');
    }
  }

  private async requireProfile(tenantId: string): Promise<FiscalProfileEntity> {
    const profile = await this.getProfile(tenantId);
    if (!profile) throw new BadRequestException('Configurá primero el perfil fiscal de la empresa (PUT /fiscal/profile).');
    return profile;
  }
}

function money(value: unknown): string {
  return formatMoney(cents(String(value ?? '0')));
}

function describe(messages: Array<{ code: string; message: string }> | null | undefined): string {
  return (messages ?? []).map((item) => `${item.code} ${item.message}`.trim()).join('; ').slice(0, 1000);
}

