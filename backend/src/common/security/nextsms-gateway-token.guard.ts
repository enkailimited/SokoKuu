import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';

export const NEXTSMS_GATEWAY_HEADER = 'x-nextsms-gateway-token';

@Injectable()
export class NextSmsGatewayTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const headerValue = request.headers[NEXTSMS_GATEWAY_HEADER];
    const providedToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    const expectedToken = this.configService.get<string>('NEXTSMS_WEBHOOK_SHARED_TOKEN');
    if (!expectedToken) {
      throw new UnauthorizedException('NextSMS webhook shared token is not configured.');
    }

    if (!providedToken || typeof providedToken !== 'string') {
      throw new UnauthorizedException('Missing X-NextSMS-Gateway-Token header.');
    }

    const providedDigest = createHash('sha256').update(providedToken, 'utf8').digest();
    const expectedDigest = createHash('sha256').update(expectedToken, 'utf8').digest();

    if (!timingSafeEqual(providedDigest, expectedDigest)) {
      throw new UnauthorizedException('Invalid X-NextSMS-Gateway-Token.');
    }

    return true;
  }
}
