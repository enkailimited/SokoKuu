import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface RedisReadinessResult {
  connected: boolean;
  pingResponse: string | null;
  error?: string;
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    this.client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
    });

    this.client.on('error', (err) => {
      this.logger.warn(`Redis client warning: ${err.message}`);
    });
  }

  getClient(): Redis {
    return this.client;
  }

  async ping(): Promise<RedisReadinessResult> {
    try {
      if (this.client.status === 'wait') {
        await this.client.connect();
      }
      const pong = await this.client.ping();
      return {
        connected: pong === 'PONG',
        pingResponse: pong,
      };
    } catch (error) {
      return {
        connected: false,
        pingResponse: null,
        error: error instanceof Error ? error.message : 'Redis readiness check failed',
      };
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (
      this.client.status === 'ready' ||
      this.client.status === 'connecting' ||
      this.client.status === 'connect'
    ) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
    } else {
      this.client.disconnect();
    }
  }
}
