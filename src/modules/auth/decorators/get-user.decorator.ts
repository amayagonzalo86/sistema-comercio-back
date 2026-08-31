import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface UserTokenPayload {
    id: string;
    sub?: string;
    username: string;
    role: string;
}

export const GetUser = createParamDecorator(
    (data: keyof UserTokenPayload | undefined, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest<{ user?: UserTokenPayload }>();
        const user = request.user;

        if (!user) {
            return null;
        }

        return data ? user[data] : user;
    },
);