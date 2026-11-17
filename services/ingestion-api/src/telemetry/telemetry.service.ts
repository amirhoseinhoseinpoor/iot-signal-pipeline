import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, isValidObjectId, Model } from 'mongoose';
import { AlertsService } from './alerts.service';
import { DETECTION_RULES, DEVICE_STALE_AFTER_MS } from './detection-rules.provider';
import { detectAnomalies } from './domain/anomalies';
import type { DetectionRules } from './domain/anomalies';
import { computeRouteStats, Reading, sortReadings } from './domain/route-stats';
import { IngestTelemetryDto } from './dto/ingest-telemetry.dto';
import { ListTelemetryQuery } from './dto/list-telemetry.query';
import { LiveEvents } from './live-events';
import { TelemetryBatch } from './telemetry-batch.schema';

export type IngestStatus = 'created' | 'duplicate';

export interface IngestResult {
  id: string;
  status: IngestStatus;
  /** Number of anomalies found in the batch. */
  alerts: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export interface DeviceSummary {
  deviceId: string;
  batchCount: number;
  lastSeenAt: Date;
  totalDistanceMeters: number;
  maxSpeedMps: number;
  lastPosition: { lat: number; lng: number } | null;
  lastSpeedMps: number | null;
  /** `stale` when nothing arrived within DEVICE_STALE_AFTER_SECONDS. */
  status: 'online' | 'stale';
}

const DUPLICATE_KEY_ERROR = 11000;

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  constructor(
    @InjectModel(TelemetryBatch.name)
    private readonly batches: Model<TelemetryBatch>,
    private readonly alerts: AlertsService,
    private readonly events: LiveEvents,
    @Inject(DETECTION_RULES) private readonly rules: DetectionRules,
    @Inject(DEVICE_STALE_AFTER_MS) private readonly staleAfterMs: number,
  ) {}

  /**
   * Stores one batch. Replaying a batch with a known `messageId` returns the
   * existing record instead of creating a second one, so callers can retry safely.
   */
  async ingest(dto: IngestTelemetryDto): Promise<IngestResult> {
    const readings = sortReadings(dto.readings).map(({ offsetMs, lat, lng, speedMps }) => ({
      offsetMs,
      lat,
      lng,
      speedMps,
    }));
    const stats = computeRouteStats(readings);
    const anomalies = detectAnomalies(readings, this.rules);

    let result: IngestResult;
    try {
      const created = await this.batches.create({
        messageId: dto.messageId,
        deviceId: dto.deviceId,
        recordedAt: dto.recordedAt,
        readings,
        stats,
        payloadBytes: Buffer.byteLength(JSON.stringify(readings)),
      });
      this.logger.debug(`Stored batch ${dto.messageId} from ${dto.deviceId}`);
      result = { id: created.id as string, status: 'created', alerts: anomalies.length };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;

      const existing = await this.batches
        .findOne({ messageId: dto.messageId }, { _id: 1 })
        .lean()
        .exec();
      if (!existing) throw error;
      this.logger.log(`Ignored replayed batch ${dto.messageId}`);
      result = { id: String(existing._id), status: 'duplicate', alerts: anomalies.length };
    }

    // Runs for replays too: if a previous attempt crashed after storing the batch
    // but before storing its alerts, the replay completes the job. Only alerts
    // that are actually new are returned, so nothing is announced twice.
    const newAlerts = await this.alerts.recordForBatch(dto, anomalies);

    if (result.status === 'created') this.publishPosition(dto, readings, stats.distanceMeters);
    for (const alert of newAlerts) {
      this.events.publish({
        type: 'alert',
        id: String(alert._id),
        deviceId: alert.deviceId,
        alertType: alert.type,
        at: alert.detectedAt.toISOString(),
        lat: alert.position.lat,
        lng: alert.position.lng,
        value: alert.value,
        threshold: alert.threshold,
      });
    }

    return result;
  }

  private publishPosition(
    dto: IngestTelemetryDto,
    readings: Reading[],
    distanceMeters: number,
  ): void {
    const last = readings[readings.length - 1];
    this.events.publish({
      type: 'position',
      deviceId: dto.deviceId,
      at: new Date(dto.recordedAt.getTime() + last.offsetMs).toISOString(),
      lat: last.lat,
      lng: last.lng,
      speedMps: last.speedMps,
      distanceMeters,
    });
  }

  async list(query: ListTelemetryQuery): Promise<Page<Omit<TelemetryBatch, 'readings'>>> {
    const filter: FilterQuery<TelemetryBatch> = {};
    if (query.deviceId) filter.deviceId = query.deviceId;
    if (query.from || query.to) {
      filter.recordedAt = {
        ...(query.from && { $gte: query.from }),
        ...(query.to && { $lte: query.to }),
      };
    }

    const [items, total] = await Promise.all([
      this.batches
        .find(filter, { readings: 0 })
        .sort({ recordedAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean()
        .exec(),
      this.batches.countDocuments(filter).exec(),
    ]);

    return { items, page: query.page, limit: query.limit, total };
  }

  async findById(id: string): Promise<TelemetryBatch> {
    const batch = isValidObjectId(id) ? await this.batches.findById(id).lean().exec() : null;
    if (!batch) throw new NotFoundException(`Telemetry batch ${id} not found`);
    return batch;
  }

  async remove(id: string): Promise<void> {
    const deleted = isValidObjectId(id)
      ? await this.batches.findByIdAndDelete(id).lean().exec()
      : null;
    if (!deleted) throw new NotFoundException(`Telemetry batch ${id} not found`);
  }

  /** One row per device: activity totals and the most recent known position. */
  async listDevices(now = new Date()): Promise<DeviceSummary[]> {
    const rows = await this.batches
      .aggregate<Omit<DeviceSummary, 'status'>>([
        { $sort: { recordedAt: -1 } },
        {
          $group: {
            _id: '$deviceId',
            batchCount: { $sum: 1 },
            lastSeenAt: { $first: '$recordedAt' },
            totalDistanceMeters: { $sum: '$stats.distanceMeters' },
            maxSpeedMps: { $max: '$stats.maxSpeedMps' },
            lastReading: { $first: { $arrayElemAt: ['$readings', -1] } },
          },
        },
        {
          $project: {
            _id: 0,
            deviceId: '$_id',
            batchCount: 1,
            lastSeenAt: 1,
            totalDistanceMeters: { $round: ['$totalDistanceMeters', 2] },
            maxSpeedMps: 1,
            lastPosition: {
              $cond: [
                { $ifNull: ['$lastReading', false] },
                { lat: '$lastReading.lat', lng: '$lastReading.lng' },
                null,
              ],
            },
            lastSpeedMps: { $ifNull: ['$lastReading.speedMps', null] },
          },
        },
        { $sort: { deviceId: 1 } },
      ])
      .exec();

    return rows.map((row) => ({
      ...row,
      status: now.getTime() - row.lastSeenAt.getTime() > this.staleAfterMs ? 'stale' : 'online',
    }));
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY_ERROR
  );
}
