import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface UserTokenPayload {
    userId: string;
    email: string;
    role: string;
    tenantId: string;
}

export const GetUser = createParamDecorator(
    (data: keyof UserTokenPayload | undefined, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        const user = request.user as UserTokenPayload;

        return data ? user?.[data] : user;
    },
);