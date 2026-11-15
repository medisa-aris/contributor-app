import { forwardRef, Module } from '@nestjs/common';
import { ConnectorsModule } from '../connectors/connectors.module';
import { DocumentsModule } from '../documents/documents.module';
import { MemoryModule } from '../memory/memory.module';
import { ChatToolsService } from './chat-tools.service';
import { ChatTurnService } from './chat-turn.service';
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
import { GrantService } from './models/grant.service';
import { ModelAccessService } from './models/model-access.service';
import { ModelCatalogService } from './models/model-catalog.service';
import { ModelsController } from './models/models.controller';
import { PROVIDER_ADAPTER_FACTORY, ProviderRegistryService } from './models/provider-registry.service';
import { UsageLedgerService } from './models/usage-ledger.service';
import { RunWorkerService } from './runs/run-worker.service';
import { RunsController } from './runs/runs.controller';
import { RunsService } from './runs/runs.service';
import { TasksService } from './tasks.service';
import { WebSourceService } from './web-source.service';
import { WebSearchAdminController } from './web-search/web-search-admin.controller';
import { WebSearchService } from './web-search/web-search.service';

@Module({
  imports: [DocumentsModule, ConnectorsModule, forwardRef(() => MemoryModule)],
  controllers: [
    AiController,
    WorkspaceAgentsController,
    WebSearchAdminController,
    GuardrailsAdminController,
    ModelsController,
    RunsController,
  ],
  providers: [
    // null = adapter asli; tes integrasi mengganti dengan pabrik adapter palsu.
    { provide: PROVIDER_ADAPTER_FACTORY, useValue: null },
    ProviderRegistryService,
    ModelCatalogService,
    UsageLedgerService,
    ModelAccessService,
    GrantService,
    AiGatewayService,
    GuardrailsService,
    AttachmentsService,
    ConversationsService,
    TasksService,
    WebSourceService,
    WebSearchService,
    ChatToolsService,
    ChatTurnService,
    RunsService,
    RunWorkerService,
    ToolApprovalsService,
    AgentWorkspaceService,
    TaskRunnerService,
  ],
  exports: [
    ModelCatalogService,
    ModelAccessService,
    AiGatewayService,
    GuardrailsService,
    AttachmentsService,
    ConversationsService,
    TasksService,
    ChatToolsService,
    ToolApprovalsService,
  ],
})
export class AiModule {}
