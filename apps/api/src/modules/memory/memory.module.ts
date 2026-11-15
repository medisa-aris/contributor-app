import { forwardRef, Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { MemoryEmbeddingService } from './memory-embedding.service';
import { MemoryExtractionService } from './memory-extraction.service';
import { MemoryInsightsService } from './memory-insights.service';
import { MemoryScopeService } from './memory-scope.service';
import { MemorySettingsService } from './memory-settings.service';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';

/** Memori terpusat (lihat docs/LLM-requirement.md). Saling impor dengan AiModule. */
@Module({
  imports: [forwardRef(() => AiModule)],
  controllers: [MemoryController],
  providers: [
    MemorySettingsService,
    MemoryScopeService,
    MemoryEmbeddingService,
    MemoryService,
    MemoryExtractionService,
    MemoryInsightsService,
  ],
  exports: [MemoryService, MemoryExtractionService, MemoryScopeService, MemoryInsightsService],
})
export class MemoryModule {}
