import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AuthenticatedRequest, AuthenticatedUser, TenantContext } from './auth.types';
import { Role } from './roles.enum';

export const IS_PUBLIC_KEY = 'sokokuu:is_public';
export const ROLES_KEY = 'sokokuu:roles';
export const TENANT_SCOPED_KEY = 'sokokuu:tenant_scoped';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const TenantScoped = () => SetMetadata(TENANT_SCOPED_KEY, true);

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);

export const CurrentTenant = createParamDecorator(
  (data: keyof TenantContext | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const tenant = request.tenantContext;
    return data ? tenant?.[data] : tenant;
  },
);
