import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type SupportedIsolationLevel = 'Serializable' | 'RepeatableRead' | 'ReadCommitted';

export interface DatabaseReadinessResult {
  connected: boolean;
  postgisVersion: string | null;
  error?: string;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test' || process.env.SKIP_DB_CONNECT_ON_BOOT === 'true') {
      return;
    }
    try {
      await this.$connect();
      this.logger.log('Connected to SokoKuu Cloud SQL Database Cluster (PostgreSQL + PostGIS).');
    } catch (error) {
      this.logger.warn(
        `Initial PostgreSQL connection deferred: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async runInTransaction<T>(
    isolationLevel: SupportedIsolationLevel,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    timeoutMs = 5000,
  ): Promise<T> {
    return this.$transaction(fn, {
      isolationLevel: Prisma.TransactionIsolationLevel[isolationLevel],
      timeout: timeoutMs,
    });
  }

  async checkDatabaseReadiness(): Promise<DatabaseReadinessResult> {
    try {
      await this.$queryRaw`SELECT 1`;
      const rows = await this.$queryRaw<Array<{ postgis_version: string }>>`
        SELECT PostGIS_Version() AS postgis_version
      `;
      const postgisVersion = rows[0]?.postgis_version ?? null;
      return {
        connected: true,
        postgisVersion,
      };
    } catch (error) {
      return {
        connected: false,
        postgisVersion: null,
        error: error instanceof Error ? error.message : 'Database readiness check failed',
      };
    }
  }
}
