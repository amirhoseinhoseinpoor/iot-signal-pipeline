import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_RULES, DetectionRules } from './domain/anomalies';

export const DETECTION_RULES = Symbol('DETECTION_RULES');
export const DEVICE_STALE_AFTER_MS = Symbol('DEVICE_STALE_AFTER_MS');

const numberOr = (config: ConfigService, key: string, fallback: number): number => {
  const raw = config.get<unknown>(key);
  const value = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

export const detectionProviders: Provider[] = [
  {
    provide: DETECTION_RULES,
    inject: [ConfigService],
    useFactory: (config: ConfigService): DetectionRules => ({
      overspeedMps: numberOr(config, 'OVERSPEED_LIMIT_MPS', DEFAULT_RULES.overspeedMps),
      maxImpliedSpeedMps: numberOr(
        config,
        'MAX_IMPLIED_SPEED_MPS',
        DEFAULT_RULES.maxImpliedSpeedMps,
      ),
    }),
  },
  {
    provide: DEVICE_STALE_AFTER_MS,
    inject: [ConfigService],
    useFactory: (config: ConfigService): number =>
      numberOr(config, 'DEVICE_STALE_AFTER_SECONDS', 60) * 1000,
  },
];
