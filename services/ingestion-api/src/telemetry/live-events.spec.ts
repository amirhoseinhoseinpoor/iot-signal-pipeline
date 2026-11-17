import { firstValueFrom, take, toArray } from 'rxjs';
import { LiveEvent, LiveEvents } from './live-events';

const position = (deviceId: string): LiveEvent => ({
  type: 'position',
  deviceId,
  at: '2026-11-18T10:00:00.000Z',
  lat: 52.5,
  lng: 13.4,
  speedMps: 10,
  distanceMeters: 50,
});

describe('LiveEvents', () => {
  it('delivers published events to every subscriber', async () => {
    const bus = new LiveEvents();
    const a = firstValueFrom(bus.stream());
    const b = firstValueFrom(bus.stream());

    bus.publish(position('vehicle-001'));

    await expect(a).resolves.toMatchObject({ deviceId: 'vehicle-001' });
    await expect(b).resolves.toMatchObject({ deviceId: 'vehicle-001' });
  });

  it('filters by device when asked', async () => {
    const bus = new LiveEvents();
    const received = firstValueFrom(bus.stream('vehicle-002').pipe(take(2), toArray()));

    bus.publish(position('vehicle-001'));
    bus.publish(position('vehicle-002'));
    bus.publish(position('vehicle-003'));
    bus.publish(position('vehicle-002'));

    const events = await received;
    expect(events.map((e) => e.deviceId)).toEqual(['vehicle-002', 'vehicle-002']);
  });

  it('completes streams on shutdown', async () => {
    const bus = new LiveEvents();
    const all = firstValueFrom(bus.stream().pipe(toArray()));
    bus.publish(position('vehicle-001'));
    bus.onModuleDestroy();
    await expect(all).resolves.toHaveLength(1);
  });
});
