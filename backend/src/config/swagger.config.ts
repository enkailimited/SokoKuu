import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export const NEXTSMS_GATEWAY_SECURITY_NAME = 'nextsms-gateway-token';

export function buildSwaggerConfig(): Omit<OpenAPIObject, 'paths'> {
  return new DocumentBuilder()
    .setTitle('SokoKuu TZ — B2B2C Enterprise Marketplace API')
    .setDescription(
      'Production NestJS backend for SokoKuu TZ (Wafanyabiashara / Merchants, PostGIS Ward Routing, Integer Quarter-Quanta Inventory, Dual-PIN Cash-on-Delivery, and NextSMS Gateway).',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Stateless JWT Access Token issued by IdentityModule',
      },
      'bearer',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-NextSMS-Gateway-Token',
        description: 'Shared gateway token authenticating inbound NextSMS webhooks',
      },
      NEXTSMS_GATEWAY_SECURITY_NAME,
    )
    .addTag('Health', 'Liveness & readiness probes (PostgreSQL, PostGIS, Redis)')
    .addTag('Identity', 'Authentication, JWT rotation, and user sessions')
    .addTag('Authorization', 'RBAC policies and tenant permission introspection')
    .addTag('Merchants (Tenancy)', 'Multi-tenant Merchant (Wafanyabiashara) profiles & tiers')
    .addTag('Merchant Branches', 'PostGIS ward markers and Merchant branch locations')
    .addTag('Catalog', 'Merchant active SKUs, Base-Zero global catalog cloning, ImageKit CDN')
    .addTag('Inventory', 'Integer Quarter-Quanta stock and bulk sack deconstruction')
    .addTag('Pricing', 'Dynamic volume-based pricing and Channel Harmony tiers')
    .addTag('Procurement', 'Smart reorder feeds and store-isolated B2B replenishment')
    .addTag('Orders', 'Store-locked B2B/B2C order intake, POS receipts, and interceptor routing')
    .addTag('Financials', 'Cash-on-Delivery expectations, EOD settlement, and Swahili CSV export')
    .addTag('CoD Verification', 'Single-use SKQR tokens and isolated Dual-PIN doorstep closure')
    .addTag('Dispatch', 'Driver fleet queue, PIN allocation, and delivery tracking')
    .addTag('Notifications', 'STOMP/Socket.IO real-time alerts, VAPID Web Push, outbound NextSMS')
    .addTag('Webhooks', 'Inbound NextSMS compact SMS webhook receiver')
    .addTag('Audit & Compliance', 'Dispatch audit traces, deconstruction logs, 3-strike fraud')
    .addTag('Platform Administration', 'Super Admin Merchant Directory (Wafanyabiashara & Mipangilio), Leads CRM, and Architecture Vault')
    .build();
}

export function setupSwagger(app: INestApplication): OpenAPIObject {
  const config = buildSwaggerConfig();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });
  return document;
}
