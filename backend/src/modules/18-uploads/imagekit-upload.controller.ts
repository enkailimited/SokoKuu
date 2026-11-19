import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '@common/security/decorators';
import { AuthenticatedUser } from '@common/security/auth.types';
import { Role } from '@common/security/roles.enum';
import { ImageKitSignatureDto } from './dto/imagekit-upload.dto';
import { ImageKitUploadService } from './imagekit-upload.service';

@ApiTags('Uploads')
@ApiBearerAuth('bearer')
@Controller('api/v1/uploads')
export class ImageKitUploadController {
  constructor(private readonly uploadService: ImageKitUploadService) {}

  @Post('imagekit/signature')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.SUPER_ADMIN,
    Role.WHOLESALER,
    Role.RETAILER,
    Role.CONSUMER,
    Role.DRIVER,
    Role.SUPPLIER,
  )
  @ApiOperation({
    summary: 'Issue a short-lived signed ImageKit direct-upload policy (private key never exposed)',
  })
  @ApiResponse({ status: 200, description: 'Signed upload credentials issued' })
  createSignature(@Body() dto: ImageKitSignatureDto, @CurrentUser() user: AuthenticatedUser) {
    return this.uploadService.createSignature(dto, user.role);
  }
}
