import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthenticatedRequest, AuthenticatedUser, MerchantTier } from './auth.types';
import { IS_PUBLIC_KEY } from './decorators';
import { Role } from './roles.enum';

interface RawJwtPayload {
  sub?: string;
  role?: Role;
  businessId?: string | null;
  merchantId?: string | null;
  tier?: MerchantTier | null;
  phoneE164?: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing Bearer authorization token.');
    }

    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
    if (!secret) {
      throw new UnauthorizedException('JWT access secret is not configured.');
    }

    try {
      const payload = await this.jwtService.verifyAsync<RawJwtPayload>(token, { secret });
      if (!payload.sub || !payload.role || !Object.values(Role).includes(payload.role)) {
        throw new UnauthorizedException('Invalid JWT subject or role claim.');
      }

      const resolvedBusinessId = payload.businessId ?? payload.merchantId ?? null;
      const user: AuthenticatedUser = {
        sub: payload.sub,
        role: payload.role,
        businessId: resolvedBusinessId,
        merchantId: resolvedBusinessId,
        tier: payload.tier ?? null,
        phoneE164: payload.phoneE164,
      };
      request.user = user;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired Bearer access token.');
    }
  }

  private extractBearerToken(request: AuthenticatedRequest): string | null {
    const header = request.headers.authorization;
    if (!header || typeof header !== 'string') {
      return null;
    }
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return null;
    }
    return token.trim();
  }
}
