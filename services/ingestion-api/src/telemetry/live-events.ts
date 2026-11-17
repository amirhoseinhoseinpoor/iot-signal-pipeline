import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { filter, Observable, Subject } from 'rxjs';
import type { AnomalyType } from './domain/anomalies';

export interface PositionEvent {
  type: 'position';
  deviceId: string;
  /** Time of the latest reading in the batch. */
  at: string;
  lat: number;
  lng: number;
  speedMps: number;
  distanceMeters: number;
}

export interface AlertEvent {
  type: 'alert';
  id: string;
  deviceId: string;
  alertType: AnomalyType;
  at: string;
  lat: number;
  lng: number;
  value: number | null;
  threshold: number;
}

export type LiveEvent = PositionEvent | AlertEvent;

/**
 * In-process publish/subscribe for live updates. Ingestion publishes after a
 * batch is stored; the SSE endpoint subscribes.
 *
 * This fans out within one API instance only. Running several replicas would
 * need a broker-backed fan-out (for example a RabbitMQ fanout exchange); see
 * ADR 0005.
 */
@Injectable()
export class LiveEvents implements OnModuleDestroy {
  private readonly subject = new Subject<LiveEvent>();

  publish(event: LiveEvent): void {
    this.subject.next(event);
  }

  stream(deviceId?: string): Observable<LiveEvent> {
    const events = this.subject.asObservable();
    return deviceId ? events.pipe(filter((e) => e.deviceId === deviceId)) : events;
  }

  onModuleDestroy() {
    this.subject.complete();
  }
}
