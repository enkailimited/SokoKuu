import { Body, Controller, Delete, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '@common/security/auth.types';
import { CurrentUser, Roles, TenantScoped } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import { WebPushDispatchService } from './web-push.service';

class WebPushSubscriptionDto {
  endpoint!: string;
  keys!: {
    p256dh: string;
    auth: string;
  };
  deviceType?: string;
}

class UnsubscribeDto {
  endpoint!: string;
}

@ApiTags('Notifications')
@ApiBearerAuth('bearer')
@Controller('api/v1/notifications/push')
export class WebPushController {
  constructor(private readonly webPushService: WebPushDispatchService) {}

  @Post('subscribe')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER, Role.DRIVER, Role.CONSUMER)
  @TenantScoped()
  @ApiOperation({ summary: 'Register or update Web Push browser subscription bound strictly to JWT userId' })
  subscribe(
    @Body() dto: WebPushSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.webPushService.upsertSubscription(user.sub, dto);
  }

  @Delete('unsubscribe')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER, Role.DRIVER, Role.CONSUMER)
  @TenantScoped()
  @ApiOperation({ summary: 'Remove browser Web Push subscription endpoint' })
  unsubscribe(@Body() dto: UnsubscribeDto) {
    return this.webPushService.removeSubscription(dto.endpoint);
  }
}
