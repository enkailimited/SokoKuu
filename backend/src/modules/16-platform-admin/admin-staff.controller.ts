import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '@common/security/auth.types';
import { CurrentUser, Roles } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import {
  CreateSalesStaffDto,
  SetSalesStaffActiveDto,
} from './dto/platform-admin.dto';
import { AdminStaffService } from './admin-staff.service';

@ApiTags('Platform Administration')
@ApiBearerAuth('bearer')
@Roles(Role.SUPER_ADMIN)
@Controller('api/v1/admin/staff')
export class AdminStaffController {
  constructor(private readonly adminStaffService: AdminStaffService) {}

  @Get()
  @ApiOperation({ summary: 'List admin-created sales team accounts' })
  listStaff() {
    return this.adminStaffService.listStaff();
  }

  @Post()
  @ApiOperation({ summary: 'Create a SALES_STAFF account for the sales dashboard' })
  @ApiResponse({ status: 201, description: 'Sales staff account created' })
  @ApiResponse({ status: 409, description: 'Phone number already registered' })
  createStaff(@Body() dto: CreateSalesStaffDto) {
    return this.adminStaffService.createSalesStaff(dto);
  }

  @Patch(':userId/status')
  @ApiOperation({ summary: 'Activate or deactivate a sales staff account' })
  setStaffActive(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: SetSalesStaffActiveDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.adminStaffService.setSalesStaffActive(userId, dto, admin.sub);
  }
}
