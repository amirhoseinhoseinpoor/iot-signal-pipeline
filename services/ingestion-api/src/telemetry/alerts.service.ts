import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { Alert } from './alert.schema';
import type { Anomaly } from './domain/anomalies';
import { ListAlertsQuery } from './dto/list-alerts.query';
import type { Page } from './telemetry.service';

export interface StoredAlert extends Alert {
  _id: unknown;
}

const DUPLICATE_KEY_ERROR = 11000;

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(@InjectModel(Alert.name) private readonly alerts: Model<Alert>) {}

  /**
   * Persists the anomalies found in one batch and returns the alerts that are
   * new. Safe to call repeatedly for the same batch: the unique index drops
   * alerts that already exist, so a replayed batch never raises them twice.
   */
  async recordForBatch(
    batch: { messageId: string; deviceId: string; recordedAt: Date },
    anomalies: readonly Anomaly[],
  ): Promise<StoredAlert[]> {
    if (anomalies.length === 0) return [];

    const docs = anomalies.map((a) => ({
      deviceId: batch.deviceId,
      messageId: batch.messageId,
      type: a.type,
      detectedAt: new Date(batch.recordedAt.getTime() + a.offsetMs),
      position: { lat: a.lat, lng: a.lng },
      value: a.value,
      threshold: a.threshold,
    }));

    try {
      const inserted = await this.alerts.insertMany(docs, { ordered: false, lean: true });
      return inserted as unknown as StoredAlert[];
    } catch (error) {
      // With ordered: false Mongo inserts what it can and reports duplicates together.
      const result = error as {
        code?: number;
        writeErrors?: Array<{ code?: number; err?: { code?: number } }>;
        insertedDocs?: StoredAlert[];
      };
      const writeErrors = result.writeErrors ?? [];
      const onlyDuplicates =
        writeErrors.length > 0
          ? writeErrors.every((e) => (e.code ?? e.err?.code) === DUPLICATE_KEY_ERROR)
          : result.code === DUPLICATE_KEY_ERROR;
      if (!onlyDuplicates) throw error;

      this.logger.debug(
        `Skipped ${writeErrors.length || 1} existing alert(s) for ${batch.messageId}`,
      );
      return result.insertedDocs ?? [];
    }
  }

  async list(query: ListAlertsQuery): Promise<Page<Alert>> {
    const filter: FilterQuery<Alert> = {};
    if (query.deviceId) filter.deviceId = query.deviceId;
    if (query.type) filter.type = query.type;
    if (query.from || query.to) {
      filter.detectedAt = {
        ...(query.from && { $gte: query.from }),
        ...(query.to && { $lte: query.to }),
      };
    }

    const [items, total] = await Promise.all([
      this.alerts
        .find(filter)
        .sort({ detectedAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean()
        .exec(),
      this.alerts.countDocuments(filter).exec(),
    ]);
    return { items, page: query.page, limit: query.limit, total };
  }
}
