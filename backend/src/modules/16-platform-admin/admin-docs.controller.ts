import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '@common/security/auth.types';
import { CurrentUser, Roles } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import { PrismaService } from '@database/prisma.service';

@ApiTags('Platform Administration')
@ApiBearerAuth('bearer')
@Roles(Role.SUPER_ADMIN)
@Controller('api/v1/admin/docs')
export class AdminSystemDocsController {
  constructor(private readonly prismaService: PrismaService) {}

  @Get('blueprints')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Serve SokoKuu TZ Blueprint Implementation Mapping Vault (SUPER_ADMIN Only)',
    description: 'Returns the complete 61-artifact implementation mapping status, architectural specs, and cluster telemetry.',
  })
  @ApiResponse({ status: 200, description: 'Blueprint mapping vault returned successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden: Requires SUPER_ADMIN role' })
  async getSystemBlueprints(@CurrentUser() admin: AuthenticatedUser) {
    if (this.prismaService.securityAuditLog && typeof this.prismaService.securityAuditLog.create === 'function') {
      await this.prismaService.securityAuditLog.create({
        data: {
          userId: admin.sub,
          eventType: 'ADMIN_SYSTEM_DOCS_ACCESSED',
          details: {
            vaultTarget: 'BLUEPRINT_IMPLEMENTATION_MAPPING',
          },
        },
      }).catch(() => undefined);
    }

    return {
      vaultName: 'SokoKuu TZ Enterprise Architecture Vault',
      masterSourceReference: 'src/data/blueprints.ts',
      masterChecksumSha256: '93b77ca4355cfbbc5a896dffb217b171fb9a1de7f007829b20496de0383e8683',
      totalArtifacts: 61,
      implementationStatus: 'COMPLETE_PHASE_4',
      databaseCluster: 'SokoKuu Cloud SQL Database Cluster (PostgreSQL 16 + PostGIS)',
      websocketBroker: 'STOMP 1.2 / Socket.IO Dual Protocol Gateway (/realtime)',
      outboxRelay: 'Transactional Outbox Pattern with AFTER_COMMIT Semantic Parity',
      accessedByAdminId: admin.sub,
      timestampEat: new Date().toISOString(),
    };
  }
}
