import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuditController } from './audit.controller';
import { ConfigController } from './config.controller';
import { DepartmentsController, DepartmentsService } from './departments';
import { DiagnosticsAdminController } from './diagnostics-admin.controller';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { NavAdminController } from './nav-admin.controller';
import { NavigationController } from './navigation.controller';
import { PermissionsController } from './permissions.controller';
import { PoliciesController, PoliciesService } from './policies';
import { ProvidersController } from './providers.controller';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { SessionsAdminController } from './sessions-admin.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, RbacModule],
  controllers: [
    UsersController,
    RolesController,
    GroupsController,
    DepartmentsController,
    PoliciesController,
    PermissionsController,
    AuditController,
    SessionsAdminController,
    DiagnosticsAdminController,
    ConfigController,
    ProvidersController,
    NavigationController,
    NavAdminController,
  ],
  providers: [UsersService, RolesService, GroupsService, DepartmentsService, PoliciesService],
})
export class AdminModule {}
