import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { GetTenantId } from '../../common/decorators/get-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { UserRoleEnum } from '../roles/entities/role.entity';
import { AuditEventQueryDto } from './dto/audit-event-query.dto';
import { AuditEventsService } from './audit-events.service';

@Controller('audit-events')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class AuditEventsController {
  constructor(private readonly auditEventsService: AuditEventsService) {}

  @Get()
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN)
  findTenantEvents(
    @GetTenantId() tenantId: string,
    @Query() filters: AuditEventQueryDto,
    @Req() request: Request,
  ) {
    const actor = request.user as { branchId?: string | null };
    if (actor.branchId) {
      throw new ForbiddenException(
        'La consulta de auditoría completa requiere acceso administrativo a toda la empresa.',
      );
    }

    return this.auditEventsService.findTenantEvents(tenantId, filters);
  }
}
