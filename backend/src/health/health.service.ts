import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@redis/redis.service';

export interface LivenessResponse {
  status: 'ok';
  service: string;
  timezone: string;
  timestamp: string;
}

export interface ReadinessResponse {
  status: 'ready' | 'degraded';
  databaseCluster: string;
  checks: {
    postgres: { status: 'up' | 'down'; error?: string };
    postgis: { status: 'up' | 'down'; version: string | null };
    redis: { status: 'up' | 'down'; ping: string | null; error?: string };
  };
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  getLiveness(): LivenessResponse {
    return {
      status: 'ok',
      service: 'sokokuu-tz-backend',
      timezone: process.env.TZ ?? 'Africa/Dar_es_Salaam',
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    const [dbResult, redisResult] = await Promise.all([
      this.prismaService.checkDatabaseReadiness(),
      this.redisService.ping(),
    ]);

    const postgresUp = dbResult.connected;
    const postgisUp = dbResult.connected && Boolean(dbResult.postgisVersion);
    const redisUp = redisResult.connected;

    const ready = postgresUp && postgisUp && redisUp;

    return {
      status: ready ? 'ready' : 'degraded',
      databaseCluster: 'SokoKuu Cloud SQL Database Cluster',
      checks: {
        postgres: {
          status: postgresUp ? 'up' : 'down',
          ...(dbResult.error ? { error: dbResult.error } : {}),
        },
        postgis: {
          status: postgisUp ? 'up' : 'down',
          version: dbResult.postgisVersion,
        },
        redis: {
          status: redisUp ? 'up' : 'down',
          ping: redisResult.pingResponse,
          ...(redisResult.error ? { error: redisResult.error } : {}),
        },
      },
      timestamp: new Date().toISOString(),
    };
  }
}
