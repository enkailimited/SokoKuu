import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '@common/security/roles.enum';

export const TZ_E164_REGEX = /^\+255[67][0-9]{8}$/;

export enum SelfRegistrableRole {
  WHOLESALER = Role.WHOLESALER,
  RETAILER = Role.RETAILER,
  CONSUMER = Role.CONSUMER,
  DRIVER = Role.DRIVER,
  SUPPLIER = Role.SUPPLIER,
}

export class RegistrationChallengeDto {
  @ApiProperty({ example: '+255712345678', description: 'Tanzanian E.164 MSISDN to verify' })
  @IsString()
  @Matches(TZ_E164_REGEX, {
    message: 'phoneE164 must be a valid Tanzanian mobile number (+2556XXXXXXXX or +2557XXXXXXXX)',
  })
  phoneE164!: string;
}

export class RegisterDto {
  @ApiProperty({ example: '+255712345678', description: 'Tanzanian E.164 MSISDN' })
  @IsString()
  @Matches(TZ_E164_REGEX, {
    message: 'phoneE164 must be a valid Tanzanian mobile number (+2556XXXXXXXX or +2557XXXXXXXX)',
  })
  phoneE164!: string;

  @ApiProperty({ example: 'Amina Hassan Mwinyi' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName!: string;

  @ApiProperty({ example: 'SokoKuu#2026!', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiProperty({
    example: '482913',
    description: 'Six-digit one-time code delivered to phoneE164 by /auth/register/challenge',
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'verificationCode must be a 6-digit SMS code' })
  verificationCode!: string;

  @ApiProperty({ enum: SelfRegistrableRole, example: SelfRegistrableRole.RETAILER })
  @IsEnum(SelfRegistrableRole)
  role!: SelfRegistrableRole;

  @ApiPropertyOptional({ enum: ['sw', 'en'], default: 'sw' })
  @IsOptional()
  @IsIn(['sw', 'en'])
  preferredLocale?: 'sw' | 'en';
}

export class LoginDto {
  @ApiProperty({ example: '+255712345678' })
  @IsString()
  @Matches(TZ_E164_REGEX, {
    message: 'phoneE164 must be a valid Tanzanian mobile number (+2556XXXXXXXX or +2557XXXXXXXX)',
  })
  phoneE164!: string;

  @ApiProperty({ example: 'SokoKuu#2026!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}

export class RefreshTokenDto {
  @ApiPropertyOptional({
    description:
      'Opaque refresh token. When omitted, the HttpOnly sokokuu_refresh cookie is used instead.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refreshToken?: string;
}

export class LogoutDto {
  @ApiPropertyOptional({ description: 'Specific opaque refresh token to revoke' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refreshToken?: string;
}

export const IMAGEKIT_SHOP_IMAGE_REGEX = /^https:\/\/ik\.imagekit\.io\/[a-zA-Z0-9_-]+\/.+$/;

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Amina Hassan Mwinyi' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName?: string;

  @ApiPropertyOptional({ enum: ['sw', 'en'], example: 'sw' })
  @IsOptional()
  @IsIn(['sw', 'en'])
  preferredLocale?: 'sw' | 'en';

  @ApiPropertyOptional({ example: 'Kuluthum Beverages Wholesale' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  businessName?: string;

  @ApiPropertyOptional({ example: 'Kariakoo' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ward?: string;

  @ApiPropertyOptional({ example: 'Ilala' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string;

  @ApiPropertyOptional({ example: 'Barabara ya Msimbazi 14' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  streetAddress?: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'Masanja123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ example: 'NywilaMpya#2026', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

export class PasswordResetChallengeDto {
  @ApiProperty({ example: '+255712345678' })
  @IsString()
  @Matches(TZ_E164_REGEX, {
    message: 'phoneE164 must be a valid Tanzanian mobile number (+2556XXXXXXXX or +2557XXXXXXXX)',
  })
  phoneE164!: string;
}

export class PasswordResetConfirmDto {
  @ApiProperty({ example: '+255712345678' })
  @IsString()
  @Matches(TZ_E164_REGEX, {
    message: 'phoneE164 must be a valid Tanzanian mobile number (+2556XXXXXXXX or +2557XXXXXXXX)',
  })
  phoneE164!: string;

  @ApiProperty({ example: '482913' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'verificationCode must be a 6-digit SMS code' })
  verificationCode!: string;

  @ApiProperty({ example: 'NywilaMpya#2026', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

export class UpdateMerchantShopImageDto {
  @ApiProperty({
    example: 'https://ik.imagekit.io/ochspoiwa/sokokuutz/merchants/duka-logo.webp',
    description: 'Absolute ImageKit CDN URL returned by the signed browser upload',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(IMAGEKIT_SHOP_IMAGE_REGEX, {
    message:
      'logoCdnUrl must be an absolute ImageKit.io CDN URL (https://ik.imagekit.io/<account>/<path>)',
  })
  @MaxLength(2048)
  logoCdnUrl!: string;
}
