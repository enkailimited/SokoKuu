import { Module } from '@nestjs/common';
import { ImageKitUploadController } from './imagekit-upload.controller';
import { ImageKitUploadService } from './imagekit-upload.service';

@Module({
  controllers: [ImageKitUploadController],
  providers: [ImageKitUploadService],
  exports: [ImageKitUploadService],
})
export class ImageKitUploadModule {}
