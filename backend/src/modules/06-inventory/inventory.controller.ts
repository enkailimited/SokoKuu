import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TenantContext } from '@common/security/auth.types';
import { CurrentTenant, Roles, TenantScoped } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import { PosSalesRequestDto } from './dto/pos-sales.dto';
import { InventoryService, PosSalesReceiptResponse } from './inventory.service';

@ApiTags('Inventory')
@ApiBearerAuth('bearer')
@Controller('api/v1/retailer/pos')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post('sales-receipt')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.RETAILER, Role.SUPER_ADMIN)
  @TenantScoped()
  @ApiOperation({
    summary: 'Record Retailer POS walk-in sale with atomic Quarter-Quanta deduction and bulk-breaking',
  })
  @ApiResponse({ status: 200, description: 'POS sale deducted and receipt generated' })
  @ApiResponse({ status: 409, description: 'Insufficient shelf and sealed bulk inventory' })
  recordPosSale(
    @Body() dto: PosSalesRequestDto,
    @CurrentTenant() tenantContext?: TenantContext,
  ): Promise<PosSalesReceiptResponse> {
    return this.inventoryService.recordPosSale(dto, tenantContext);
  }
}
