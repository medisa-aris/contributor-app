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
import type { AuthContext } from '../../common/types/auth-context';
import {
  CreateUserDto,
  ResetPasswordDto,
  RoleAssignmentDto,
  UpdateUserDto,
} from './dto/users.dto';
import { UsersService } from './users.service';

@ApiTags('admin-users')
@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @RequirePermission(PERMISSIONS.usersRead)
  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() query: Record<string, unknown>) {
    return this.users.list(auth.user.id, query);
  }

  @RequirePermission(PERMISSIONS.usersRead)
  @Get(':id')
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    return this.users.detail(auth.user.id, id);
  }

  @RequirePermission(PERMISSIONS.usersManage)
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateUserDto) {
    return this.users.create(auth, dto);
  }

  @RequirePermission(PERMISSIONS.usersManage)
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.usersManage)
  @HttpCode(200)
  @Post(':id/password')
  async resetPassword(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    await this.users.resetPassword(auth, id, dto);
    return { reset: true };
  }

  @RequirePermission(PERMISSIONS.permissionsAssign)
  @Post(':id/roles')
  assignRole(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: RoleAssignmentDto,
  ) {
    return this.users.assignRole(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.permissionsAssign)
  @Delete(':id/roles/:assignmentId')
  revokeRole(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Param('assignmentId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) assignmentId: string,
  ) {
    return this.users.revokeRole(auth, id, assignmentId);
  }
}
