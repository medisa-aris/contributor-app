import { Controller, Get, Inject } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/public.decorator';
import { DATA_SOURCE } from '../../database/database.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  @Public()
  @Get()
  async check(): Promise<{
    status: string;
    database: string;
    memorySemantic: 'on' | 'off' | 'unknown';
    uptimeSeconds: number;
  }> {
    let database = 'down';
    let memorySemantic: 'on' | 'off' | 'unknown' = 'unknown';
    try {
      await this.dataSource.query('SELECT 1');
      database = 'up';
      // Pencarian semantik memori aktif bila pgvector terpasang dan kolom embedding ada;
      // tanpa itu memori tetap jalan dengan teks penuh (bukan kondisi degraded).
      const rows = (await this.dataSource.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'memory_entries' AND column_name = 'embedding'`,
      )) as unknown[];
      memorySemantic = rows.length > 0 ? 'on' : 'off';
    } catch {
      // database tetap 'down' bila SELECT 1 gagal; status memori dibiarkan 'unknown'.
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      memorySemantic,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
