import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '@common/security/auth.types';
import { CurrentUser, Roles } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import {
  AttachPricingTemplatesDto,
  CreatePricingTemplateDto,
  UpdatePricingTemplateDto,
} from './dto/pricing-template.dto';
import { PricingTemplateService } from './pricing-template.service';

@ApiTags('Pricing Templates')
@ApiBearerAuth('bearer')
@Controller('api/v1')
export class AdminPricingTemplatesController {
  constructor(private readonly service: PricingTemplateService) {}

  @Post('admin/pricing-templates')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Create a standalone reusable Standard Pricing Template (SUPER_ADMIN)',
  })
  createTemplate(
    @Body() dto: CreatePricingTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createTemplate(dto, user);
  }

  @Get('admin/pricing-templates')
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER)
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiOperation({ summary: 'List standalone Pricing Templates with unit details and TZS prices' })
  listTemplates(@Query('includeInactive') includeInactive?: string) {
    return this.service.listTemplates(includeInactive === 'true');
  }

  @Patch('admin/pricing-templates/:templateId')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Version/update a Pricing Template without touching Merchant overrides or orders',
  })
  updateTemplate(
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Body() dto: UpdatePricingTemplateDto,
  ) {
    return this.service.updateTemplate(templateId, dto);
  }

  @Delete('admin/pricing-templates/:templateId')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Soft-delete a Pricing Template (attachments preserved for audit)' })
  deleteTemplate(@Param('templateId', new ParseUUIDPipe()) templateId: string) {
    return this.service.deleteTemplate(templateId);
  }

  @Post('admin/marketplace/catalog/:globalCatalogId/attach-pricing-templates')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Attach a complete set of Pricing Templates to a Global Catalog product' })
  attachTemplates(
    @Param('globalCatalogId', new ParseUUIDPipe()) globalCatalogId: string,
    @Body() dto: AttachPricingTemplatesDto,
  ) {
    return this.service.attachTemplates(globalCatalogId, dto);
  }

  @Get('marketplace/catalog/:globalCatalogId/pricing-templates')
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER)
  @ApiOperation({ summary: 'List Pricing Templates attached to a Global Catalog product' })
  listCatalogTemplates(
    @Param('globalCatalogId', new ParseUUIDPipe()) globalCatalogId: string,
  ) {
    return this.service.listTemplatesForCatalog(globalCatalogId);
  }
}
