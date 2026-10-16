import { Controller, Get, Inject } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/public.decorator';
import { DATA_SOURCE } from '../../database/database.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  @Public()
  @Get()
  async check(): Promise<{ status: string; database: string; uptimeSeconds: number }> {
    let database = 'down';
    try {
      await this.dataSource.query('SELECT 1');
      database = 'up';
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
