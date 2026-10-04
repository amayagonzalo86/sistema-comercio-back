import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';

type TenantRequest = {
  user?: {
    };
  tenantId?: string;
};

export const GetTenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp()?.getRequest<TenantRequest>();
    const tenantId = request?.user?.tenantId;

    if (!tenantId) {
      throw new UnauthorizedException('Inconsistencia en el Token JWT: tenantId no encontrado en el contexto de seguridad.');
    }

    return tenantId;
  },
);