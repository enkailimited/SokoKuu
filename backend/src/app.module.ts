import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';
import { createPinoLoggerConfig } from '@common/logging/pino-logger.config';
import { JwtAuthGuard } from '@common/security/jwt-auth.guard';
import { RolesGuard } from '@common/security/roles.guard';
import { TenantContextGuard } from '@common/security/tenant-context.guard';
import { validateEnv } from '@config/env.validation';
import { PrismaModule } from '@database/prisma.module';
import { RedisModule } from '@redis/redis.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from '@modules/01-identity/identity.module';
import { AuthorizationModule } from '@modules/02-authorization/authorization.module';
import { MerchantTenancyModule } from '@modules/03-tenancy/merchant-tenancy.module';
import { MerchantBranchesModule } from '@modules/04-branches/merchant-branches.module';
import { CatalogModule } from '@modules/05-catalog/catalog.module';
import { InventoryModule } from '@modules/06-inventory/inventory.module';
import { PricingModule } from '@modules/07-pricing/pricing.module';
import { ProcurementModule } from '@modules/08-procurement/procurement.module';
import { OrdersModule } from '@modules/09-orders/orders.module';
import { FinancialsModule } from '@modules/10-financials/financials.module';
import { CodVerificationModule } from '@modules/11-cod-verification/cod-verification.module';
import { DispatchModule } from '@modules/12-dispatch/dispatch.module';
import { NotificationsModule } from '@modules/13-notifications/notifications.module';
import { WebhooksModule } from '@modules/14-webhooks/webhooks.module';
import { AuditModule } from '@modules/15-audit/audit.module';
import { PlatformAdminModule } from '@modules/16-platform-admin/platform-admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createPinoLoggerConfig(
          config.get<string>('LOG_LEVEL') ?? 'info',
          config.get<string>('NODE_ENV') ?? 'development',
        ),
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 120,
      },
    ]),
    PrismaModule,
    RedisModule,
    HealthModule,
    IdentityModule,
    AuthorizationModule,
    MerchantTenancyModule,
    MerchantBranchesModule,
    CatalogModule,
    InventoryModule,
    PricingModule,
    ProcurementModule,
    OrdersModule,
    FinancialsModule,
    CodVerificationModule,
    DispatchModule,
    NotificationsModule,
    WebhooksModule,
    AuditModule,
    PlatformAdminModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useFactory: (config: ConfigService) =>
        new AllExceptionsFilter(config.get<string>('NODE_ENV') === 'production'),
      inject: [ConfigService],
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TenantContextGuard,
    },
  ],
})
export class AppModule {}
