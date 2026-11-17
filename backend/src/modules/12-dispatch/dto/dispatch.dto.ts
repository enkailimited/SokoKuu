import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class DispatchOrderDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Assigned DRIVER user UUID' })
  @IsOptional()
  @IsUUID()
  driverUserId?: string;
}
