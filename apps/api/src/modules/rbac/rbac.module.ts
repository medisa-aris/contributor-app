import { Global, Module } from '@nestjs/common';
import { AuthzCacheService } from './authz-cache.service';
import { EffectivePermissionsService } from './effective-permissions.service';
import { EscalationService } from './escalation.service';
import { RbacDiagnosticsController } from './rbac-diagnostics.controller';

@Global()
@Module({
  controllers: [RbacDiagnosticsController],
  providers: [AuthzCacheService, EffectivePermissionsService, EscalationService],
  exports: [AuthzCacheService, EffectivePermissionsService, EscalationService],
})
export class RbacModule {}
