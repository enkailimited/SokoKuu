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
  @ApiProperty({ description: 'Opaque refresh token previously issued by /auth/login or /auth/refresh' })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class LogoutDto {
  @ApiPropertyOptional({ description: 'Specific opaque refresh token to revoke' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refreshToken?: string;
}
