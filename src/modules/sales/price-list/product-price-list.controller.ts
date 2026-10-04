import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { requireBranchAccess } from '../../../common/security/tenant-branch-access';
import { CreatePriceListDto } from './dto/price-list.dto';
import { PriceListService } from './price-list.service';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { TenantContextGuard } from '../../../common/guards/tenant-context.guard';
import { GetTenantId } from '../../../common/decorators/get-tenant.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { UserRoleEnum } from '../../roles/entities/role.entity';

@Controller('price-lists')
@UseGuards(JwtAuthGuard, TenantContextGuard, RolesGuard)
export class ProductPriceListController {
  constructor(private readonly priceListService: PriceListService) {}

  @Post()
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() createPriceListDto: CreatePriceListDto,
    @GetTenantId() tenantId: string,
  ) {
    return this.priceListService.create(tenantId, createPriceListDto);
  }

  @Get(':priceListId/products/:productId/branches/:branchId/calculated-price')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.SUPER_ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.SELLER)
  getCalculatedPrice(
    @Param('priceListId', ParseUUIDPipe) priceListId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @GetTenantId() tenantId: string,
    @Req() request: Request,
  ) {
    const actor = request.user as { branchId?: string | null; tenantRole?: string };
    requireBranchAccess(actor, branchId);
    return this.priceListService.getCalculatedProductPrice(
      tenantId,
      productId,
      branchId,
      priceListId
    );
  }
}