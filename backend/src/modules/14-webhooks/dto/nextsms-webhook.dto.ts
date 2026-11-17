import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class NextSmsIncomingDto {
  @ApiProperty({ example: '0712345678', description: 'Sender MSISDN (06/07..., 255..., or +255...)' })
  @IsString()
  @MinLength(9)
  @MaxLength(20)
  from!: string;

  @ApiProperty({
    example: 'SK#AB12CD34#KH1#SUG1:K:2#A1B2C3',
    description: 'Compact <= 160 char NextSMS command payload',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(160)
  text!: string;

  @ApiPropertyOptional({ example: 'nextsms-msg-90125' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  messageId?: string;
}
