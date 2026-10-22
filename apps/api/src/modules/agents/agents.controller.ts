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
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@bara/shared';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import type { AuthContext } from '../../common/types/auth-context';
import { paginated } from '../admin/common/pagination';
import {
  AgentTasksQueryDto,
  ApprovalsQueryDto,
  CreateAgentDto,
  DecideApprovalDto,
  ExecuteAgentDto,
  UpdateAgentDto,
} from './dto/agents.dto';
import { AgentsService } from './agents.service';

@ApiTags('agent-center')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @RequirePermission(PERMISSIONS.agentsView)
  @Get()
  async list(@Query() query: PaginationQueryDto) {
    const { items, total } = await this.agents.list({ skip: query.skip, take: query.pageSize });
    return paginated(items, { page: query.page, limit: query.pageSize, offset: query.skip }, total);
  }

  @RequirePermission(PERMISSIONS.agentsView)
  @Get('tasks')
  async listTasks(@Query() query: AgentTasksQueryDto) {
    const { items, total } = await this.agents.listTasks({
      status: query.status,
      agentId: query.agentId,
      skip: query.skip,
      take: query.pageSize,
    });
    return paginated(items, { page: query.page, limit: query.pageSize, offset: query.skip }, total);
  }

  @RequirePermission(PERMISSIONS.agentsApprove)
  @Get('approvals')
  async approvals(@Query() query: ApprovalsQueryDto) {
    const { items, total } = await this.agents.approvalsInbox({
      status: query.status,
      skip: query.skip,
      take: query.pageSize,
    });
    return paginated(items, { page: query.page, limit: query.pageSize, offset: query.skip }, total);
  }

  @RequirePermission(PERMISSIONS.agentsApprove)
  @HttpCode(200)
  @Post('approvals/:id/decide')
  decide(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: DecideApprovalDto,
  ) {
    return this.agents.decide(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.agentsView)
  @Get('tasks/:id')
  taskDetail(@Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string) {
    return this.agents.taskDetail(id);
  }

  @RequirePermission(PERMISSIONS.agentsCreate)
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateAgentDto) {
    return this.agents.create(auth, dto);
  }

  @RequirePermission(PERMISSIONS.agentsView)
  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string) {
    return this.agents.detail(id);
  }

  @RequirePermission(PERMISSIONS.agentsUpdate)
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: UpdateAgentDto,
  ) {
    return this.agents.update(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.agentsDelete)
  @Delete(':id')
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    await this.agents.remove(auth, id);
    return { deleted: true };
  }

  @RequirePermission(PERMISSIONS.agentsExecute)
  @HttpCode(200)
  @Post(':id/execute')
  execute(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: ExecuteAgentDto,
  ) {
    return this.agents.execute(auth, id, dto);
  }
}
