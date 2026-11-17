import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '@common/security/decorators';
import { HealthService, LivenessResponse, ReadinessResponse } from './health.service';

@ApiTags('Health')
@Controller('api/v1/health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe for SokoKuu TZ backend process' })
  @ApiResponse({ status: 200, description: 'Backend process is alive' })
  getLiveness(): LivenessResponse {
    return this.healthService.getLiveness();
  }

  @Public()
  @Get('readiness')
  @ApiOperation({
    summary: 'Readiness probe verifying PostgreSQL SELECT 1, PostGIS_Version(), and Redis PING',
  })
  @ApiResponse({ status: 200, description: 'All infrastructure dependencies are ready' })
  @ApiResponse({ status: 503, description: 'One or more dependencies are degraded' })
  async getReadiness(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponse> {
    const result = await this.healthService.getReadiness();
    res.status(
      result.status === 'ready' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return result;
  }
}
