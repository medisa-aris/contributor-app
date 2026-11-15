import { Global, Module } from '@nestjs/common';
import { AuthzCacheService } from './authz-cache.service';
import { EffectivePermissionsService } from './effective-permissions.service';
import { EscalationService } from './escalation.service';
import { OrgReachService } from './org-reach.service';
import { RbacDiagnosticsController } from './rbac-diagnostics.controller';

@Global()
@Module({
  controllers: [RbacDiagnosticsController],
  providers: [AuthzCacheService, EffectivePermissionsService, EscalationService, OrgReachService],
  exports: [AuthzCacheService, EffectivePermissionsService, EscalationService, OrgReachService],
})
export class RbacModule {}
