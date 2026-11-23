import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '@common/security/auth.types';
import { CurrentUser, Public, Roles } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import {
  ConvertLeadDto,
  CreateLeadDto,
  PublicLeadDto,
} from './dto/platform-admin.dto';
import { SalesLeadsService } from './sales-leads.service';

@ApiTags('Platform Administration')
@ApiBearerAuth('bearer')
@Controller('api/v1/sales/leads')
export class SalesLeadsController {
  constructor(private readonly salesLeadsService: SalesLeadsService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER, Role.SALES_STAFF)
  @ApiQuery({ name: 'status', required: false })
  @ApiOperation({ summary: 'List field-captured Merchant prospect and converted leads' })
  listLeads(@Query('status') status?: string) {
    return this.salesLeadsService.listLeads(status);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER, Role.SALES_STAFF)
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

  /**
   * Public quote / registration entry point used by the public "register"
   * screen. Creates a PROSPECT lead in the same table; the SokoKuu team
   * contacts the applicant and later converts/verifies the merchant.
   */
  @Public()
  @Post('public')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Submit a public merchant quote / registration request as a sales lead',
  })
  @ApiResponse({ status: 201, description: 'Prospect lead captured for team follow-up' })
  @ApiResponse({ status: 409, description: 'A lead already exists for this phone number' })
  capturePublicLead(@Body() dto: PublicLeadDto) {
    return this.salesLeadsService.capturePublicProspectLead(dto);
  }

  @Post(':leadId/convert')
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER, Role.SALES_STAFF)
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
