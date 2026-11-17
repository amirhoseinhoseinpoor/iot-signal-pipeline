import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AlertsService } from './alerts.service';
import { ListAlertsQuery } from './dto/list-alerts.query';

@ApiTags('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  @ApiOperation({
    summary: 'List alerts (overspeed, GPS jumps), newest first',
    description: 'Filters: `deviceId`, `type`, `from`, `to` (on detection time), `page`, `limit`.',
  })
  list(@Query() query: ListAlertsQuery) {
    return this.alerts.list(query);
  }
}
