import { Module } from '@nestjs/common';
import { ConnectorsModule } from '../connectors/connectors.module';
import { DocumentsModule } from '../documents/documents.module';
import { ChatToolsService } from './chat-tools.service';
import { ToolApprovalsService } from './tool-approvals.service';
import { AiController } from './ai.controller';
import { AgentWorkspaceService } from './agents/agent-workspace.service';
import { TaskRunnerService } from './agents/task-runner.service';
import { WorkspaceAgentsController } from './agents/workspace-agents.controller';
import { AttachmentsService } from './attachments.service';
import { ConversationsService } from './conversations.service';
import { AiGatewayService } from './gateway.service';
import { GuardrailsAdminController } from './guardrails/guardrails-admin.controller';
import { GuardrailsService } from './guardrails/guardrails.service';
import { TasksService } from './tasks.service';
import { WebSourceService } from './web-source.service';
import { WebSearchAdminController } from './web-search/web-search-admin.controller';
import { WebSearchService } from './web-search/web-search.service';

@Module({
  imports: [DocumentsModule, ConnectorsModule],
  controllers: [AiController, WorkspaceAgentsController, WebSearchAdminController, GuardrailsAdminController],
  providers: [
    AiGatewayService,
    GuardrailsService,
    AttachmentsService,
    ConversationsService,
    TasksService,
    WebSourceService,
    WebSearchService,
    ChatToolsService,
    ToolApprovalsService,
    AgentWorkspaceService,
    TaskRunnerService,
  ],
  exports: [
    AiGatewayService,
    AttachmentsService,
    ConversationsService,
    TasksService,
    ChatToolsService,
    ToolApprovalsService,
  ],
})
export class AiModule {}
