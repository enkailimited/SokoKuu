import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class RecordLedgerPaymentDto {
  @ApiProperty({ minimum: 0, example: 10000 })
  @IsInt()
  @Min(0)
  collectedAmountTzs!: number;

  @ApiProperty({ enum: ['CASH', 'M-PESA', 'TIGO-PESA'], example: 'M-PESA' })
  @IsIn(['CASH', 'M-PESA', 'TIGO-PESA'])
  paymentMethod!: 'CASH' | 'M-PESA' | 'TIGO-PESA';

  @ApiPropertyOptional({ maxLength: 64, example: 'MP99281726' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  mobileMoneyRef?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  mobileMoneyVerified?: boolean;
}

export class VerifyMobileMoneyDto {
  @ApiProperty({ maxLength: 64, example: 'MP99281726' })
  @IsString()
  @MaxLength(64)
  mobileMoneyRef!: string;

  @ApiProperty({ default: true })
  @IsBoolean()
  verified!: boolean;
}

export class SettleDriverEodDto {
  @ApiProperty({ minimum: 0, example: 28000 })
  @IsInt()
  @Min(0)
  declaredCashTzs!: number;

  @ApiPropertyOptional({
    default: false,
    description: 'Explicit confirmation required when partial payments leave an outstanding balance > 0',
  })
  @IsOptional()
  @IsBoolean()
  acknowledgeOutstandingBalance?: boolean;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}
