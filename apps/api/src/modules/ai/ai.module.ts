import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AttachmentsService } from './attachments.service';
import { ConversationsService } from './conversations.service';
import { AiGatewayService } from './gateway.service';
import { TasksService } from './tasks.service';
import { WebSourceService } from './web-source.service';

@Module({
  controllers: [AiController],
  providers: [AiGatewayService, AttachmentsService, ConversationsService, TasksService, WebSourceService],
  exports: [AiGatewayService, AttachmentsService, ConversationsService, TasksService],
})
export class AiModule {}
