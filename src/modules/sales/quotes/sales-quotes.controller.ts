import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { GetTenantId } from '../../../common/decorators/get-tenant.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Paginated } from '../../../common/dto/page-query.dto';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { TenantContextGuard } from '../../../common/guards/tenant-context.guard';
import { buildAuditContext } from '../../../common/http/request-context';
import { requireAssignedBranch, requireBranchAccess } from '../../../common/security/tenant-branch-access';
import { UserRoleEnum } from '../../roles/entities/role.entity';
import { SalesOrderView } from '../orders/sales-orders.service';
import { CreateSalesQuoteDto, SalesQuoteQueryDto } from './dto/sales-quote.dto';
import { QuoteActor, SalesQuoteDetailView, SalesQuotesService, SalesQuoteView } from './sales-quotes.service';
import { RequiresModule, TenantModule } from '../../../common/modules/tenant-modules';

type RequestActor = { id: string; branchId?: string | null; tenantRole?: string; tenantRoles?: string[] };
const OPERATORS = [UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.SELLER] as const;

/** Presupuestos "X" de 24 horas (no válidos como factura). */
@Controller('sales-quotes')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
@Roles(...OPERATORS)
export class SalesQuotesController {
  constructor(private readonly quotes: SalesQuotesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateSalesQuoteDto,
  ): Promise<SalesQuoteView> {
    if (!idempotencyKey) throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    const actor = request.user as RequestActor;
    requireBranchAccess(actor, dto.branchId);
    return this.quotes.create(tenantId, toActor(actor), idempotencyKey, dto, buildAuditContext(request));
  }

  @Get()
  list(@GetTenantId() tenantId: string, @Req() request: Request, @Query() query: SalesQuoteQueryDto): Promise<Paginated<SalesQuoteView>> {
    return this.quotes.list(tenantId, toActor(request.user as RequestActor), query);
  }

  @Get('by-number/:number')
  findByNumber(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('number', new ParseIntPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST })) number: number,
  ): Promise<SalesQuoteView> {
    if (number < 1 || number > 4_294_967_295) throw new BadRequestException('Número de presupuesto inválido.');
    return this.quotes.findByNumber(tenantId, toActor(request.user as RequestActor), number);
  }

  @Get(':id')
  findOne(@GetTenantId() tenantId: string, @Req() request: Request, @Param('id', ParseUUIDPipe) id: string): Promise<SalesQuoteDetailView> {
    return this.quotes.findOne(tenantId, toActor(request.user as RequestActor), id);
  }

  /** Pasa el presupuesto a pedido de venta (solo quien lo emitió, dentro de las 24 h). */
  @RequiresModule(TenantModule.PRESALE)
  @Post(':id/convert')
  @HttpCode(HttpStatus.CREATED)
  convert(@GetTenantId() tenantId: string, @Req() request: Request, @Param('id', ParseUUIDPipe) id: string): Promise<SalesOrderView> {
    return this.quotes.convert(tenantId, toActor(request.user as RequestActor), id, buildAuditContext(request));
  }

  @Delete(':id')
  remove(@GetTenantId() tenantId: string, @Req() request: Request, @Param('id', ParseUUIDPipe) id: string): Promise<{ message: string }> {
    return this.quotes.remove(tenantId, toActor(request.user as RequestActor), id, buildAuditContext(request));
  }
}

function toActor(actor: RequestActor): QuoteActor {
  return { id: actor.id, branchId: requireAssignedBranch(actor), tenantRole: actor.tenantRole, tenantRoles: actor.tenantRoles };
}
