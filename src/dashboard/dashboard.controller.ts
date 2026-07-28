import { BadRequestException, Controller, Get, Param, UseGuards } from '@nestjs/common';
import { DashboardService, type DashboardMetric } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const VALID_METRICS: DashboardMetric[] = ['present', 'absent', 'active', 'onLeave'];

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  getSummary() {
    return this.dashboard.getSummary();
  }

  @Get('drilldown/:metric')
  getDrilldown(@Param('metric') metric: string) {
    if (!VALID_METRICS.includes(metric as DashboardMetric)) {
      throw new BadRequestException({ error: 'invalid_metric', message: 'Unknown dashboard metric.' });
    }
    return this.dashboard.getDrilldown(metric as DashboardMetric);
  }
}
