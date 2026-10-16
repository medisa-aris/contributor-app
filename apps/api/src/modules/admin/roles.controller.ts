import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@contributor/shared';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { AuthContext } from '../../common/types/auth-context';
import { CreateRoleDto, ReplaceRolePermissionsDto, UpdateRoleDto } from './dto/rbac.dto';
import { RolesService } from './roles.service';

@ApiTags('admin-roles')
@Controller('admin/roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @RequirePermission(PERMISSIONS.rolesRead)
  @Get()
  list() {
    return this.roles.list();
  }

  @RequirePermission(PERMISSIONS.rolesRead)
  @Get(':id/permissions')
  permissions(@Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string) {
    return this.roles.permissions(id);
  }

  @RequirePermission(PERMISSIONS.rolesManage)
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateRoleDto) {
    return this.roles.create(auth, dto);
  }

  @RequirePermission(PERMISSIONS.rolesManage)
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.roles.update(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.rolesManage)
  @Delete(':id')
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    return this.roles.remove(auth, id);
  }

  @RequirePermission(PERMISSIONS.permissionsAssign)
  @Put(':id/permissions')
  replacePermissions(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: ReplaceRolePermissionsDto,
  ) {
    return this.roles.replacePermissions(auth, id, dto);
  }
}
