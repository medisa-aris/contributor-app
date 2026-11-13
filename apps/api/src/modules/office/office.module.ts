import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { DocumentsModule } from '../documents/documents.module';
import { OfficeController } from './office.controller';
import { OfficeService } from './office.service';

@Module({
  imports: [DocumentsModule, AiModule],
  controllers: [OfficeController],
  providers: [OfficeService],
})
export class OfficeModule {}
