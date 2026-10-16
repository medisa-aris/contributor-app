import { AppConfig } from './app-config.entity';
import { Application } from './application.entity';
import { AuditEvent } from './audit-event.entity';
import { Department } from './department.entity';
import { Feature } from './feature.entity';
import { Group } from './group.entity';
import { GroupRole } from './group-role.entity';
import { LoginAttempt } from './login-attempt.entity';
import { MenuItem } from './menu-item.entity';
import { NavModule } from './module.entity';
import { Permission } from './permission.entity';
import { RbacMeta } from './rbac-meta.entity';
import { ResourcePolicy } from './resource-policy.entity';
import { Role } from './role.entity';
import { RolePermission } from './role-permission.entity';
import { User } from './user.entity';
import { UserGroup } from './user-group.entity';
import { UserRole } from './user-role.entity';
import { UserSession } from './session.entity';

export {
  AppConfig,
  Application,
  AuditEvent,
  Department,
  Feature,
  Group,
  GroupRole,
  LoginAttempt,
  MenuItem,
  NavModule,
  Permission,
  RbacMeta,
  ResourcePolicy,
  Role,
  RolePermission,
  User,
  UserGroup,
  UserRole,
  UserSession,
};

export const entities = [
  AppConfig,
  Application,
  AuditEvent,
  Department,
  Feature,
  Group,
  GroupRole,
  LoginAttempt,
  MenuItem,
  NavModule,
  Permission,
  RbacMeta,
  ResourcePolicy,
  Role,
  RolePermission,
  User,
  UserGroup,
  UserRole,
  UserSession,
];
