import { Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import { OutboundSmsService } from './outbound-sms.service';

@ApiTags('Notifications')
@ApiBearerAuth('bearer')
@Roles(Role.SUPER_ADMIN)
@Controller('api/v1/notifications/sms')
export class NotificationsController {
  constructor(private readonly outboundSmsService: OutboundSmsService) {}

  @Get('logs')
  @ApiOperation({ summary: 'Inspect outbound NextSMS delivery tracking and dead-letter logs' })
  @ApiQuery({ name: 'status', required: false, enum: ['QUEUED', 'SENT', 'FAILED', 'DEAD_LETTER'] })
  listSmsLogs(@Query('status') status?: string) {
    return this.outboundSmsService.listSmsDeliveryLogs(status);
  }

  @Post('retry-due')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Process due outbound NextSMS retries with exponential backoff' })
  processDueRetries() {
    return this.outboundSmsService.processDueRetries();
  }
}
