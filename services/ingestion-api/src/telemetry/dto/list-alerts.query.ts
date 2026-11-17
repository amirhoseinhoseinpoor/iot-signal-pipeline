import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type { AnomalyType } from '../domain/anomalies';
import { ListTelemetryQuery } from './list-telemetry.query';

export const ANOMALY_TYPES: AnomalyType[] = ['overspeed', 'gps_jump'];

/** Same filters and paging as telemetry, plus the alert type. */
export class ListAlertsQuery extends ListTelemetryQuery {
  @ApiPropertyOptional({ enum: ANOMALY_TYPES })
  @IsOptional()
  @IsIn(ANOMALY_TYPES)
  type?: AnomalyType;
}
