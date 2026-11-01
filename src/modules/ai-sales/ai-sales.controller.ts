import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { GetTenantId } from '../../common/decorators/get-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Paginated } from '../../common/dto/page-query.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { buildAuditContext } from '../../common/http/request-context';
import { RequiresModule, TenantModule } from '../../common/modules/tenant-modules';
import { UserRoleEnum } from '../roles/entities/role.entity';
import { AgentReply } from './agent/ai-sales.agent';
import {
  AiSalesService,
  AiConversationDetail,
  AiConversationSummary,
  AiSalesSettingsView,
  AiUsageView,
} from './ai-sales.service';
import {
  AiConversationQueryDto,
  AiUsageQueryDto,
  ConversationStatusDto,
  HumanReplyDto,
  SimulatorMessageDto,
  UpdateAiSalesSettingsDto,
} from './dto/ai-sales.dto';

const ADMINS = [UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN];
const MANAGE = [...ADMINS, UserRoleEnum.MANAGER];
/** Quienes atienden las conversaciones derivadas (vendedores y cajeros incluidos). */
const ATTEND = [...MANAGE, UserRoleEnum.SELLER, UserRoleEnum.CASHIER];

const actorId = (request: Request): string => (request.user as { id: string }).id;

/** Panel del vendedor IA por WhatsApp (módulo premium). */
@RequiresModule(TenantModule.AI_SALES)
@Controller('ai-sales')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class AiSalesController {
  constructor(private readonly service: AiSalesService) {}

  @Get('settings')
  @Roles(...MANAGE)
  getSettings(@GetTenantId() tenantId: string): Promise<AiSalesSettingsView> {
    return this.service.getSettings(tenantId);
  }

  /** Solo administradores: incluye el token de WhatsApp. */
  @Put('settings')
  @Roles(...ADMINS)
  updateSettings(@GetTenantId() tenantId: string, @Req() request: Request, @Body() dto: UpdateAiSalesSettingsDto): Promise<AiSalesSettingsView> {
    return this.service.updateSettings(tenantId, actorId(request), dto, buildAuditContext(request));
  }

  @Get('conversations')
  @Roles(...ATTEND)
  list(@GetTenantId() tenantId: string, @Query() query: AiConversationQueryDto): Promise<Paginated<AiConversationSummary>> {
    return this.service.listConversations(tenantId, query);
  }

  @Get('conversations/:id')
  @Roles(...ATTEND)
  detail(@GetTenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<AiConversationDetail> {
    return this.service.getConversation(tenantId, id);
  }

  @Post('conversations/:id/reply')
  @Roles(...ATTEND)
  @HttpCode(HttpStatus.OK)
  reply(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HumanReplyDto,
  ): Promise<AiConversationDetail> {
    return this.service.humanReply(tenantId, actorId(request), id, dto, buildAuditContext(request));
  }

  @Post('conversations/:id/status')
  @Roles(...ATTEND)
  @HttpCode(HttpStatus.OK)
  setStatus(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConversationStatusDto,
  ): Promise<AiConversationDetail> {
    return this.service.setStatus(tenantId, actorId(request), id, dto, buildAuditContext(request));
  }

  @Post('simulator')
  @Roles(...MANAGE)
  @HttpCode(HttpStatus.OK)
  simulate(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Body() dto: SimulatorMessageDto,
  ): Promise<AgentReply & { conversation: AiConversationDetail }> {
    return this.service.simulate(tenantId, actorId(request), dto);
  }

  @Get('usage')
  @Roles(...MANAGE)
  usage(@GetTenantId() tenantId: string, @Query() query: AiUsageQueryDto): Promise<AiUsageView> {
    return this.service.usage(tenantId, query.days ?? 30);
  }
}
