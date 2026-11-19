import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ListManagedOrdersQueryDto {
  @ApiPropertyOptional({
    enum: ['ROUTED_PLATFORM_MANAGED_HELPDESK', 'ROUTED_DIRECT_MERCHANT_DB'],
  })
  @IsOptional()
  @IsIn(['ROUTED_PLATFORM_MANAGED_HELPDESK', 'ROUTED_DIRECT_MERCHANT_DB'])
  routingOutputCode?: 'ROUTED_PLATFORM_MANAGED_HELPDESK' | 'ROUTED_DIRECT_MERCHANT_DB';

  @ApiPropertyOptional({
    enum: ['OPEN', 'IN_REVIEW', 'IN_TRANSIT', 'RESOLVED', 'ESCALATED', 'DIRECT_MERCHANT'],
  })
  @IsOptional()
  @IsIn(['OPEN', 'IN_REVIEW', 'IN_TRANSIT', 'RESOLVED', 'ESCALATED', 'DIRECT_MERCHANT'])
  helpdeskStatus?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sellerBusinessId?: string;
}

export class UpdateManagedOrderStatusDto {
  @ApiProperty({ enum: ['OPEN', 'IN_REVIEW', 'IN_TRANSIT', 'RESOLVED', 'ESCALATED'] })
  @IsIn(['OPEN', 'IN_REVIEW', 'IN_TRANSIT', 'RESOLVED', 'ESCALATED'])
  helpdeskStatus!: 'OPEN' | 'IN_REVIEW' | 'IN_TRANSIT' | 'RESOLVED' | 'ESCALATED';

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Driver assigned when the managed order starts transit (IN_TRANSIT).',
  })
  @IsOptional()
  @IsUUID()
  driverUserId?: string;
}
