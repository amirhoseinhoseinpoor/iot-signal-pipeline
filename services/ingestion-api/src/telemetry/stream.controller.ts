import { Controller, MessageEvent, Query, Sse } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { interval, map, merge, Observable } from 'rxjs';
import { LiveEvents } from './live-events';

/** Keeps idle connections open through proxies that drop silent streams. */
export const HEARTBEAT_MS = 25_000;

@ApiTags('stream')
@Controller('stream')
export class StreamController {
  constructor(private readonly events: LiveEvents) {}

  @Sse()
  @ApiOperation({
    summary: 'Live updates as Server-Sent Events',
    description:
      'Emits `position` events when a batch is stored and `alert` events when an anomaly ' +
      'is detected, plus a `ping` every 25 seconds. Use `EventSource` in the browser.',
  })
  @ApiQuery({ name: 'deviceId', required: false })
  stream(@Query('deviceId') deviceId?: string): Observable<MessageEvent> {
    const updates = this.events
      .stream(deviceId || undefined)
      .pipe(map((event): MessageEvent => ({ type: event.type, data: event })));
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'ping', data: { at: new Date().toISOString() } })),
    );
    return merge(updates, heartbeat);
  }
}
