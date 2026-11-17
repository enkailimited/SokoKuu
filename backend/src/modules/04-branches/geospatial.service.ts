import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AuthenticatedUser, TenantContext } from '@common/security/auth.types';
import { Role } from '@common/security/roles.enum';
import { PrismaService } from '@database/prisma.service';

export interface MerchantMapNode {
  merchantId: string;
  smsShortCode: string;
  merchantName: string;
  tier: string;
  ward: string;
  district: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  logoUrl: string;
  isPlatformManaged: boolean;
}

export interface StoresMapMatrixResponse {
  databaseCluster: string;
  isolationLevel: 'REPEATABLE_READ';
  authorityScope: 'SUPER_ADMIN_MASTER' | 'TENANT_AUTHORIZED';
  nodeCount: number;
  nodes: MerchantMapNode[];
  evaluatedAtEat: string;
}

@Injectable()
export class GeospatialService {
  private readonly logger = new Logger(GeospatialService.name);

  constructor(private readonly prismaService: PrismaService) {}

  async loadStoresMapMatrix(
    user: AuthenticatedUser,
    tenantContext: TenantContext | undefined,
    originLat: number,
    originLng: number,
    maxDistanceMeters: number,
  ): Promise<StoresMapMatrixResponse> {
    const isSuperAdmin = user.role === Role.SUPER_ADMIN;

    return this.prismaService.runInTransaction('RepeatableRead', async (tx) => {
      if (!isSuperAdmin) {
        const merchantId = tenantContext?.businessId ?? user.businessId ?? user.merchantId;
        if (!merchantId) {
          throw new ForbiddenException(
            'HTTP 403 FORBIDDEN: Missing authenticated Merchant profile identifier.',
          );
        }

        const profile = await tx.businessProfile.findUnique({
          where: { id: merchantId },
          select: { geospatialMapEnabled: true },
        });

        const mapEnabled = Boolean(profile?.geospatialMapEnabled);
        if (!mapEnabled) {
          this.logger.warn(
            `[SOKOKUU-GEO-GUARD] engine=SOKOKUU_CLOUD_SQL_CLUSTER merchant=${merchantId} status=HTTP_403_MAP_DISABLED`,
          );
          throw new ForbiddenException(
            'HTTP 403 FORBIDDEN: Geospatial map access is disabled for this Merchant profile (geospatial_map_enabled = FALSE).',
          );
        }
      }

      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          sms_short_code: string;
          business_name: string;
          tier: string;
          ward: string;
          district: string;
          latitude: number;
          longitude: number;
          distance_meters: number;
          logo_url: string;
          is_platform_managed: boolean;
        }>
      >`
        WITH origin AS (
          SELECT ST_SetSRID(ST_MakePoint(${originLng}::DOUBLE PRECISION, ${originLat}::DOUBLE PRECISION), 4326)::GEOGRAPHY AS geog
        )
        SELECT bp.id::text AS id,
               bp.sms_short_code,
               bp.business_name,
               bp.tier::text AS tier,
               bp.ward,
               bp.district,
               bp.latitude::DOUBLE PRECISION AS latitude,
               bp.longitude::DOUBLE PRECISION AS longitude,
               ROUND(ST_Distance(bp.location, o.geog, false)::NUMERIC, 1)::DOUBLE PRECISION AS distance_meters,
               COALESCE(bp.logo_cdn_url, 'https://ik.imagekit.io/sokokuutz/catalog/default-merchant.webp') AS logo_url,
               bp.is_platform_managed
          FROM business_profiles bp
          CROSS JOIN origin o
         WHERE bp.is_open = TRUE
           AND bp.location IS NOT NULL
           AND ST_DWithin(bp.location, o.geog, ${maxDistanceMeters}::DOUBLE PRECISION, false)
         ORDER BY bp.location <-> o.geog ASC
         LIMIT 100
      `;

      const nodes: MerchantMapNode[] = rows.map((row) => ({
        merchantId: row.id,
        smsShortCode: row.sms_short_code,
        merchantName: row.business_name,
        tier: row.tier,
        ward: row.ward,
        district: row.district,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        distanceMeters: Number(row.distance_meters),
        logoUrl: row.logo_url,
        isPlatformManaged: row.is_platform_managed,
      }));

      return {
        databaseCluster: 'SokoKuu Cloud SQL Database Cluster',
        isolationLevel: 'REPEATABLE_READ',
        authorityScope: isSuperAdmin ? 'SUPER_ADMIN_MASTER' : 'TENANT_AUTHORIZED',
        nodeCount: nodes.length,
        nodes,
        evaluatedAtEat: new Date().toISOString(),
      };
    });
  }
}
