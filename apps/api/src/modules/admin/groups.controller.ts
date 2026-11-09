import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@bara/shared';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { AuthContext } from '../../common/types/auth-context';
import { CreateGroupDto, GroupMembersDto, UpdateGroupDto } from './dto/rbac.dto';
import { RoleAssignmentDto } from './dto/users.dto';
import { GroupsService } from './groups.service';

const uuidPipe = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('admin-groups')
@Controller('admin/groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @RequirePermission(PERMISSIONS.groupsRead)
  @Get()
  list() {
    return this.groups.list();
  }

  @RequirePermission(PERMISSIONS.groupsRead)
  @Get(':id')
  detail(@Param('id', uuidPipe) id: string) {
    return this.groups.detail(id);
  }

  @RequirePermission(PERMISSIONS.groupsManage)
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateGroupDto) {
    return this.groups.create(auth, dto);
  }

  @RequirePermission(PERMISSIONS.groupsManage)
  @Patch(':id')
  update(@CurrentAuth() auth: AuthContext, @Param('id', uuidPipe) id: string, @Body() dto: UpdateGroupDto) {
    return this.groups.update(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.groupsManage)
  @Delete(':id')
  remove(@CurrentAuth() auth: AuthContext, @Param('id', uuidPipe) id: string) {
    return this.groups.remove(auth, id);
  }

  @RequirePermission(PERMISSIONS.groupsManage)
  @Post(':id/members')
  addMembers(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: GroupMembersDto,
  ) {
    return this.groups.addMembers(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.groupsManage)
  @Delete(':id/members/:userId')
  removeMember(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuidPipe) id: string,
    @Param('userId', uuidPipe) userId: string,
  ) {
    return this.groups.removeMember(auth, id, userId);
  }

  @RequirePermission(PERMISSIONS.permissionsAssign)
  @Post(':id/roles')
  assignRole(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuidPipe) id: string,
    @Body() dto: RoleAssignmentDto,
  ) {
    return this.groups.assignRole(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.permissionsAssign)
  @Delete(':id/roles/:assignmentId')
  revokeRole(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuidPipe) id: string,
    @Param('assignmentId', uuidPipe) assignmentId: string,
  ) {
    return this.groups.revokeRole(auth, id, assignmentId);
  }
}
