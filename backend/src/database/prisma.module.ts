import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, OutboxService],
  exports: [PrismaService, OutboxService],
})
export class PrismaModule {}
