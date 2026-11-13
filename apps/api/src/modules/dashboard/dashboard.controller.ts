import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import type { AuthContext } from '../../common/types/auth-context';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('dashboard/summary')
  summary(@CurrentAuth() auth: AuthContext) {
    return this.dashboard.summary(auth);
  }

  @Get('guardrails/status')
  guardrailsStatus() {
    return this.dashboard.guardrailsStatus();
  }

  @Get('notifications')
  notifications(@CurrentAuth() auth: AuthContext) {
    return this.dashboard.notifications(auth);
  }
}
