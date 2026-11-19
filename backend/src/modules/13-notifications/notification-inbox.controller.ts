import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '@common/security/auth.types';
import { CurrentUser, Roles, TenantScoped } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import { UserNotificationService } from './user-notification.service';

@ApiTags('Notifications')
@ApiBearerAuth('bearer')
@Controller('api/v1/notifications')
export class NotificationInboxController {
  constructor(private readonly userNotificationService: UserNotificationService) {}

  @Get('inbox')
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER, Role.CONSUMER, Role.DRIVER, Role.SUPPLIER)
  @TenantScoped()
  @ApiOperation({ summary: 'Read the authenticated user role-isolated durable notification inbox' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean })
  getInbox(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.userNotificationService.getInbox(
      user.sub,
      limit ? Number(limit) : 50,
      unreadOnly === 'true',
    );
  }

  @Patch('inbox/:notificationId/read')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER, Role.CONSUMER, Role.DRIVER, Role.SUPPLIER)
  @TenantScoped()
  @ApiOperation({ summary: 'Mark one durable notification as read' })
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId', new ParseUUIDPipe()) notificationId: string,
  ) {
    return this.userNotificationService.markRead(user.sub, notificationId);
  }

  @Patch('inbox/read-all')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER, Role.CONSUMER, Role.DRIVER, Role.SUPPLIER)
  @TenantScoped()
  @ApiOperation({ summary: 'Mark all durable notifications as read for the authenticated user' })
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.userNotificationService.markAllRead(user.sub);
  }
}
