import { plainToInstance, Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

export class Environment {
  @IsString()
  MONGO_URI: string;

  @IsString()
  AMQP_URL: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  /** Unacknowledged messages a single consumer may hold at once. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  AMQP_PREFETCH: number = 20;

  /** Reported speed that raises an `overspeed` alert (default 33.3 m/s, 120 km/h). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  OVERSPEED_LIMIT_MPS: number = 33.3;

  /** Implied speed between two positions that raises a `gps_jump` alert. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  MAX_IMPLIED_SPEED_MPS: number = 70;

  /** A device with no data for this long is reported as `stale`. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  DEVICE_STALE_AFTER_SECONDS: number = 60;
}

/** Fails fast at startup with every missing or malformed variable listed. */
export function validateEnvironment(config: Record<string, unknown>): Environment {
  const env = plainToInstance(Environment, config, { enableImplicitConversion: false });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return env;
}
