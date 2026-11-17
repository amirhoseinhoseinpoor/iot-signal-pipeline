import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { AnomalyType } from './domain/anomalies';

@Schema({ _id: false, versionKey: false })
export class GeoPoint {
  @Prop({ required: true }) lat: number;
  @Prop({ required: true }) lng: number;
}
const GeoPointSchema = SchemaFactory.createForClass(GeoPoint);

@Schema({
  collection: 'alerts',
  versionKey: false,
  timestamps: { createdAt: 'createdAt', updatedAt: false },
})
export class Alert {
  @Prop({ required: true }) deviceId: string;
  /** The batch the alert was raised from. */
  @Prop({ required: true }) messageId: string;
  @Prop({ type: String, required: true, enum: ['overspeed', 'gps_jump'] }) type: AnomalyType;
  /** Time of the reading that triggered the alert: `recordedAt + offsetMs`. */
  @Prop({ required: true }) detectedAt: Date;
  @Prop({ type: GeoPointSchema, required: true }) position: GeoPoint;
  /** Metres per second; null for a jump between readings that share a timestamp. */
  @Prop({ type: Number, default: null }) value: number | null;
  @Prop({ required: true }) threshold: number;
  createdAt: Date;
}

export type AlertDocument = HydratedDocument<Alert>;

export const AlertSchema = SchemaFactory.createForClass(Alert);

// Re-processing a batch (redelivery, crash between writes) must not duplicate alerts.
AlertSchema.index({ messageId: 1, type: 1, detectedAt: 1 }, { unique: true });
AlertSchema.index({ deviceId: 1, detectedAt: -1 });
AlertSchema.index({ detectedAt: -1 });
