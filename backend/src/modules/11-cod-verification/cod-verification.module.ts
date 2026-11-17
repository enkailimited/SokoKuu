import { Module } from '@nestjs/common';
import { CodVerificationController } from './cod-verification.controller';
import { CodVerificationService } from './cod-verification.service';

@Module({
  controllers: [CodVerificationController],
  providers: [CodVerificationService],
  exports: [CodVerificationService],
})
export class CodVerificationModule {}
