import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@bara/shared';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { AuthContext } from '../../common/types/auth-context';
import { MindMapQueryDto, TopicsQueryDto } from './dto/mind-map.dto';
import { MindMapService } from './mind-map.service';

@ApiTags('ai-workspace')
@Controller('mind-map')
export class MindMapController {
  constructor(private readonly mindMap: MindMapService) {}

  @RequirePermission(PERMISSIONS.mindMapTeamRead)
  @Get('org')
  org(@CurrentAuth() auth: AuthContext, @Query() query: MindMapQueryDto) {
    return this.mindMap.org(auth, query);
  }

  @RequirePermission(PERMISSIONS.mindMapTeamRead)
  @Get('people/:userId/thoughts')
  personThoughts(
    @CurrentAuth() auth: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: MindMapQueryDto,
  ) {
    return this.mindMap.personThoughts(auth, userId, query);
  }

  @RequirePermission(PERMISSIONS.mindMapTeamRead)
  @Get('topics')
  topics(@CurrentAuth() auth: AuthContext, @Query() query: TopicsQueryDto) {
    return this.mindMap.topics(auth, query);
  }
}
