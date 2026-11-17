import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import {
  CalculateQuoteDto,
  CalculateStandardPricingQuoteDto,
} from './dto/pricing.dto';
import { CalculatedOrderQuote, PricingRoutingEngine } from './pricing-routing.engine';

@ApiTags('Pricing')
@ApiBearerAuth('bearer')
@Controller('api/v1/pricing')
export class PricingController {
  constructor(private readonly pricingEngine: PricingRoutingEngine) {}

  @Post('calculate-quote')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.RETAILER, Role.CONSUMER, Role.WHOLESALER, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Calculate authoritative server-side TZS quote with Channel Harmony & wholesale crossover',
  })
  @ApiResponse({ status: 200, description: 'Authoritative server-calculated order quote' })
  @ApiResponse({ status: 422, description: 'Channel Harmony or single-store isolation violation' })
  calculateQuote(@Body() dto: CalculateQuoteDto): Promise<CalculatedOrderQuote> {
    return this.pricingEngine.calculateOrderQuote(dto);
  }

  @Post('standard-quote')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.RETAILER, Role.CONSUMER, Role.WHOLESALER, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Evaluate bracketed standard pricing or Merchant-isolated override using product-specific units',
  })
  evaluateStandardQuote(@Body() dto: CalculateStandardPricingQuoteDto) {
    return this.pricingEngine.evaluateStandardPricingQuote(dto);
  }
}
