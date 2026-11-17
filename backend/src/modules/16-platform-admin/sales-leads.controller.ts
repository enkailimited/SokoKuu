import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '@common/security/auth.types';
import { CurrentUser, Roles } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import { ConvertLeadDto, CreateLeadDto } from './dto/platform-admin.dto';
import { SalesLeadsService } from './sales-leads.service';

@ApiTags('Platform Administration')
@ApiBearerAuth('bearer')
@Controller('api/v1/sales/leads')
export class SalesLeadsController {
  constructor(private readonly salesLeadsService: SalesLeadsService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER)
  @ApiOperation({
    summary: 'Capture prospective Merchant lead with mandatory WGS84 GPS coordinates',
  })
  @ApiResponse({ status: 201, description: 'Merchant prospect lead captured with PostGIS geography' })
  captureLead(
    @Body() dto: CreateLeadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.salesLeadsService.captureProspectLead(dto, user.sub);
  }

  @Post(':leadId/convert')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Convert prospective Merchant lead atomically with optimistic version locking',
  })
  @ApiResponse({ status: 200, description: 'Lead converted to verified Merchant and NextSMS queued' })
  @ApiResponse({ status: 409, description: 'Optimistic lock version conflict' })
  convertLead(
    @Param('leadId', new ParseUUIDPipe()) leadId: string,
    @Body() dto: ConvertLeadDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.salesLeadsService.convertLeadToMerchant(leadId, dto, admin.sub);
  }
}
