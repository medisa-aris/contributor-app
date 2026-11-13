import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { DocumentsModule } from '../documents/documents.module';
import { OfficeStylesController } from './office-styles.controller';
import { OfficeStylesService } from './office-styles.service';

@Module({
  imports: [DocumentsModule, AiModule],
  controllers: [OfficeStylesController],
  providers: [OfficeStylesService],
})
export class OfficeStylesModule {}
