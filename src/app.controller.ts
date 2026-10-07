import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService, HealthStatus } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** GET /api/v1/health — usar como health check en Render, Railway, Docker o Uptime Kuma. */
  @Get('health')
  @SkipThrottle()
  health(): Promise<HealthStatus> {
    return this.appService.health();
  }
}
