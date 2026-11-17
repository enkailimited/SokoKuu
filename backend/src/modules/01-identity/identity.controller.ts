import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthenticatedUser, TenantContext } from '@common/security/auth.types';
import { CurrentTenant, CurrentUser, Public } from '@common/security/decorators';
import { LoginDto, LogoutDto, RefreshTokenDto, RegisterDto } from './dto/auth.dto';
import { AuthTokenResponse, IdentityService } from './identity.service';

@ApiTags('Identity')
@Controller('api/v1/auth')
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a SokoKuu TZ user with Argon2id & offline SMS HMAC secret' })
  @ApiResponse({ status: 201, description: 'User registered and initial session issued' })
  @ApiResponse({ status: 409, description: 'Phone number already registered' })
  register(@Body() dto: RegisterDto, @Req() req: Request): Promise<AuthTokenResponse> {
    return this.identityService.register(dto, req.ip);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with Tanzanian MSISDN + Argon2id password' })
  @ApiResponse({ status: 200, description: 'Authenticated with JWT & opaque refresh token' })
  @ApiResponse({ status: 429, description: 'Locked out due to repeated failed attempts' })
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<AuthTokenResponse> {
    return this.identityService.login(dto, req.ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token with strict family reuse revocation' })
  @ApiResponse({ status: 200, description: 'Fresh access and rotated refresh token issued' })
  @ApiResponse({ status: 401, description: 'Invalid, expired, or replayed refresh token' })
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request): Promise<AuthTokenResponse> {
    return this.identityService.refresh(dto, req.ip);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Revoke active refresh token session family' })
  logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LogoutDto,
  ): Promise<{ revoked: boolean }> {
    return this.identityService.logout(user.sub, dto);
  }

  @Get('me')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Return authenticated profile and server-derived Merchant TenantContext' })
  getMe(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.identityService.getMe(user.sub, tenantContext);
  }
}
