import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './data-source-options';

export const DATA_SOURCE = 'DATA_SOURCE';

@Global()
@Module({
  providers: [
    {
      provide: DATA_SOURCE,
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<DataSource> => {
        const url = config.get<string>('app.databaseUrl') ?? '';
        const dataSource = new DataSource(buildDataSourceOptions(url));
        return dataSource.initialize();
      },
    },
  ],
  exports: [DATA_SOURCE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }
}
