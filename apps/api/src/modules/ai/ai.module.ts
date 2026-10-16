import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { ConversationsService } from './conversations.service';
import { AiGatewayService } from './gateway.service';
import { TasksService } from './tasks.service';

@Module({
  controllers: [AiController],
  providers: [AiGatewayService, ConversationsService, TasksService],
  exports: [AiGatewayService, ConversationsService, TasksService],
})
export class AiModule {}
