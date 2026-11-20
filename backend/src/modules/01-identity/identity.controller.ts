import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthenticatedUser, TenantContext } from '@common/security/auth.types';
import { CurrentTenant, CurrentUser, Public } from '@common/security/decorators';
import {
  ChangePasswordDto,
  LoginDto,
  LogoutDto,
  PasswordResetChallengeDto,
  PasswordResetConfirmDto,
  RefreshTokenDto,
  RegisterDto,
  RegistrationChallengeDto,
  UpdateMerchantShopImageDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import { AuthTokenResponse, IdentityService } from './identity.service';

const REFRESH_COOKIE_NAME = 'sokokuu_refresh';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}

@ApiTags('Identity')
@Controller('api/v1/auth')
export class IdentityController {
  constructor(
    private readonly identityService: IdentityService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('register/challenge')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a short-lived SMS code to verify phone ownership' })
  @ApiResponse({ status: 200, description: 'Verification code dispatched' })
  @ApiResponse({ status: 429, description: 'Too many verification requests' })
  requestRegistrationChallenge(
    @Body() dto: RegistrationChallengeDto,
    @Req() req: Request,
  ) {
    return this.identityService.requestRegistrationChallenge(dto, req.ip);
  }

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Register a SokoKuu TZ user with verified phone, Argon2id & offline SMS HMAC secret',
  })
  @ApiResponse({ status: 201, description: 'User registered and initial session issued' })
  @ApiResponse({ status: 400, description: 'Invalid or expired verification code' })
  @ApiResponse({ status: 409, description: 'Phone number already registered' })
  register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResponse> {
    return this.issueSession(this.identityService.register(dto, req.ip), res);
  }

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with Tanzanian MSISDN + Argon2id password' })
  @ApiResponse({ status: 200, description: 'Authenticated with JWT & opaque refresh token' })
  @ApiResponse({ status: 429, description: 'Throttled after repeated failed attempts' })
  login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResponse> {
    return this.issueSession(this.identityService.login(dto, req.ip), res);
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token with strict family reuse revocation' })
  @ApiResponse({ status: 200, description: 'Fresh access and rotated refresh token issued' })
  @ApiResponse({ status: 401, description: 'Invalid, expired, or replayed refresh token' })
  refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResponse> {
    const refreshToken = dto.refreshToken ?? readCookie(req.headers.cookie, REFRESH_COOKIE_NAME);
    return this.issueSession(
      this.identityService.refresh({ ...dto, refreshToken }, req.ip),
      res,
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Revoke active refresh session family and current access token' })
  logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ revoked: boolean }> {
    const refreshToken = dto.refreshToken ?? readCookie(req.headers.cookie, REFRESH_COOKIE_NAME);
    this.identityService.revokeAccessToken(user.jti, user.sub);
    this.clearRefreshCookie(res);
    return this.identityService.logout(user.sub, { ...dto, refreshToken });
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

  @Patch('me')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Update authenticated profile and merchant business details' })
  @ApiResponse({ status: 200, description: 'Profile updated' })
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext: TenantContext | undefined,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.identityService.updateProfile(user.sub, dto, tenantContext);
  }

  @Patch('me/merchant-image')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Persist the merchant shop image ImageKit CDN URL' })
  @ApiResponse({ status: 200, description: 'Merchant shop image updated' })
  @ApiResponse({ status: 403, description: 'Account has no owned merchant profile' })
  updateMerchantShopImage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMerchantShopImageDto,
  ) {
    return this.identityService.updateMerchantShopImage(user.sub, dto.logoCdnUrl.trim());
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Change password for authenticated user (revokes active sessions)' })
  @ApiResponse({ status: 200, description: 'Password changed' })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.identityService.changePassword(user.sub, dto.currentPassword, dto.newPassword);
  }

  @Public()
  @Post('password-reset/challenge')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request SMS OTP to reset password' })
  @ApiResponse({ status: 200, description: 'Password reset challenge issued when eligible' })
  passwordResetChallenge(@Body() dto: PasswordResetChallengeDto) {
    return this.identityService.requestPasswordResetChallenge(dto);
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Confirm SMS OTP and set a new password' })
  @ApiResponse({ status: 200, description: 'Password reset completed' })
  passwordResetConfirm(@Body() dto: PasswordResetConfirmDto) {
    return this.identityService.confirmPasswordReset(dto);
  }

  private async issueSession(
    pending: Promise<AuthTokenResponse>,
    res: Response,
  ): Promise<AuthTokenResponse> {
    const session = await pending;
    this.setRefreshCookie(res, session.refreshToken);
    return session;
  }

  private setRefreshCookie(res: Response, refreshToken?: string): void {
    if (!refreshToken) return;
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
  }

  private clearRefreshCookie(res: Response): void {
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/api/v1/auth',
    });
  }
}
