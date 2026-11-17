import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '@common/security/jwt-auth.guard';
import { NextSmsGatewayTokenGuard } from '@common/security/nextsms-gateway-token.guard';
import { RolesGuard } from '@common/security/roles.guard';
import { TenantContextGuard } from '@common/security/tenant-context.guard';

/**
 * Implemented in Phase 1 — Module 02: Authorization & RBAC.
 * Provides stateless JWT verification, 5-role RBAC enforcement, server-derived
 * Merchant tenant isolation, and constant-time NextSMS gateway token verification.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [
    JwtAuthGuard,
    RolesGuard,
    TenantContextGuard,
    NextSmsGatewayTokenGuard,
  ],
  exports: [
    JwtModule,
    JwtAuthGuard,
    RolesGuard,
    TenantContextGuard,
    NextSmsGatewayTokenGuard,
  ],
})
export class AuthorizationModule {
  static readonly phaseStatus = 'IMPLEMENTED_PHASE_1_SECURITY_PRIMITIVES';
}
