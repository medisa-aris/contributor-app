import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@bara/shared';
import { CurrentAuth } from '../../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import type { AuthContext } from '../../../common/types/auth-context';
import { TasksService } from '../tasks.service';
import { AgentWorkspaceService } from './agent-workspace.service';
import {
  AgentGroupDto,
  AgentTaskDto,
  FromTemplateDto,
  PersonalAgentDto,
  SkillDto,
  TaskApprovalDecisionDto,
  TaskEventsQueryDto,
  TaskReplyDto,
  UpdatePersonalAgentDto,
  UpdateSkillDto,
} from './dto/agents.dto';
import { TaskRunnerService } from './task-runner.service';

const UUID = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

/** Agent pribadi, skill, grup, dan tugas agent di mode Subordinate. */
@ApiTags('ai-workspace')
@Controller('ai')
export class WorkspaceAgentsController {
  constructor(
    private readonly workspace: AgentWorkspaceService,
    private readonly runner: TaskRunnerService,
    private readonly tasks: TasksService,
  ) {}

  // ── Agent ──

  @RequirePermission(PERMISSIONS.agentsManagePersonal)
  @Get('agent-templates')
  templates() {
    return this.workspace.templates();
  }

  @RequirePermission(PERMISSIONS.agentsManagePersonal)
  @Get('agents')
  agents(@CurrentAuth() auth: AuthContext) {
    return this.workspace.listAgents(auth.user.id);
  }

  @RequirePermission(PERMISSIONS.agentsManagePersonal)
  @Post('agents')
  createAgent(@CurrentAuth() auth: AuthContext, @Body() dto: PersonalAgentDto) {
    return this.workspace.createAgent(auth, dto);
  }

  @RequirePermission(PERMISSIONS.agentsManagePersonal)
  @Post('agents/from-template')
  fromTemplate(@CurrentAuth() auth: AuthContext, @Body() dto: FromTemplateDto) {
    return this.workspace.fromTemplate(auth, dto);
  }

  @RequirePermission(PERMISSIONS.agentsManagePersonal)
  @Get('agents/:id')
  agent(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.workspace.agent(auth.user.id, id);
  }

  @RequirePermission(PERMISSIONS.agentsManagePersonal)
  @Patch('agents/:id')
  updateAgent(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UUID) id: string,
    @Body() dto: UpdatePersonalAgentDto,
  ) {
    return this.workspace.updateAgent(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.agentsManagePersonal)
  @Delete('agents/:id')
  @HttpCode(204)
  async removeAgent(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    await this.workspace.removeAgent(auth, id);
  }

  // ── Skill ──

  @RequirePermission(PERMISSIONS.agentsManagePersonal)
  @Get('skills')
  skills(@CurrentAuth() auth: AuthContext) {
    return this.workspace.listSkills(auth.user.id);
  }

  @RequirePermission(PERMISSIONS.agentsManagePersonal)
  @Post('skills')
  createSkill(@CurrentAuth() auth: AuthContext, @Body() dto: SkillDto) {
    return this.workspace.createSkill(auth, dto);
  }

  @RequirePermission(PERMISSIONS.agentsManagePersonal)
  @Patch('skills/:id')
  updateSkill(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UUID) id: string,
    @Body() dto: UpdateSkillDto,
  ) {
    return this.workspace.updateSkill(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.agentsManagePersonal)
  @Delete('skills/:id')
  @HttpCode(204)
  async removeSkill(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    await this.workspace.removeSkill(auth, id);
  }

  // ── Grup ──

  @RequirePermission(PERMISSIONS.agentsManagePersonal)
  @Get('agent-groups')
  groups(@CurrentAuth() auth: AuthContext) {
    return this.workspace.listGroups(auth.user.id);
  }

  @RequirePermission(PERMISSIONS.agentsManagePersonal)
  @Post('agent-groups')
  createGroup(@CurrentAuth() auth: AuthContext, @Body() dto: AgentGroupDto) {
    return this.workspace.createGroup(auth, dto);
  }

  @RequirePermission(PERMISSIONS.agentsManagePersonal)
  @Put('agent-groups/:id')
  updateGroup(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UUID) id: string,
    @Body() dto: AgentGroupDto,
  ) {
    return this.workspace.updateGroup(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.agentsManagePersonal)
  @Delete('agent-groups/:id')
  @HttpCode(204)
  async removeGroup(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    await this.workspace.removeGroup(auth, id);
  }

  // ── Tugas agent ──

  /** Buat tugas untuk agent atau grup; dijalankan asinkron oleh runner. */
  @RequirePermission(PERMISSIONS.subordinateExecute)
  @Post('agent-tasks')
  createTask(@CurrentAuth() auth: AuthContext, @Body() dto: AgentTaskDto) {
    return this.runner.create(auth, dto);
  }

  /** Detail tugas; `afterEventId` untuk polling inkremental. */
  @RequirePermission(PERMISSIONS.subordinateExecute)
  @Get('agent-tasks/:id')
  taskDetail(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UUID) id: string,
    @Query() query: TaskEventsQueryDto,
  ) {
    return this.tasks.detail(auth, id, query.afterEventId ?? 0);
  }

  @RequirePermission(PERMISSIONS.subordinateExecute)
  @HttpCode(200)
  @Post('agent-tasks/:id/reply')
  reply(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UUID) id: string,
    @Body() dto: TaskReplyDto,
  ) {
    return this.runner.reply(auth, id, dto.message);
  }

  @RequirePermission(PERMISSIONS.subordinateExecute)
  @HttpCode(200)
  @Post('agent-tasks/:id/retry')
  retry(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    return this.runner.retry(auth, id);
  }

  @RequirePermission(PERMISSIONS.subordinateExecute)
  @HttpCode(200)
  @Post('agent-tasks/:id/cancel')
  async cancel(@CurrentAuth() auth: AuthContext, @Param('id', UUID) id: string) {
    this.runner.abort(id);
    return this.tasks.cancel(auth, id);
  }

  @RequirePermission(PERMISSIONS.subordinateExecute)
  @HttpCode(200)
  @Post('agent-tasks/:id/tool-approvals/:approvalId/decide')
  decide(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UUID) id: string,
    @Param('approvalId', UUID) approvalId: string,
    @Body() dto: TaskApprovalDecisionDto,
  ) {
    return this.runner.decide(auth, id, approvalId, dto.decision, dto.note);
  }
}
