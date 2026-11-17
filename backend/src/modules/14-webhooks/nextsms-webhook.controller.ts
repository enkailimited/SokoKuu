import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '@common/security/decorators';
import { NextSmsGatewayTokenGuard } from '@common/security/nextsms-gateway-token.guard';
import { NEXTSMS_GATEWAY_SECURITY_NAME } from '@config/swagger.config';
import { NextSmsIncomingDto } from './dto/nextsms-webhook.dto';
import { NextSmsWebhookService } from './nextsms-webhook.service';

@ApiTags('Webhooks')
@ApiSecurity(NEXTSMS_GATEWAY_SECURITY_NAME)
@Controller('api/v1/callback/nextsms')
export class NextSmsWebhookController {
  constructor(private readonly webhookService: NextSmsWebhookService) {}

  @Public()
  @UseGuards(NextSmsGatewayTokenGuard)
  @Post('incoming')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive inbound NextSMS compact order & cancellation webhooks with HMAC-SHA256 verification',
  })
  @ApiResponse({ status: 200, description: 'Webhook processed or duplicate safely ignored' })
  @ApiResponse({ status: 401, description: 'Invalid gateway token or tampered SIG6 HMAC' })
  handleIncoming(@Body() dto: NextSmsIncomingDto, @Req() req: Request) {
    return this.webhookService.handleInboundSms(dto, req.ip);
  }
}
