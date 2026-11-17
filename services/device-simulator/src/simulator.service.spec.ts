import { loadConfig, SimulatorConfig } from './config';
import type { TelemetryMessage, TelemetryPublisher } from './publishers';
import { PublisherFactory, SimulatorService } from './simulator.service';

class RecordingPublisher implements TelemetryPublisher {
  readonly sent: TelemetryMessage[] = [];
  closed = false;
  constructor(readonly name: 'amqp' | 'mqtt') {}
  publish(message: TelemetryMessage) {
    this.sent.push(message);
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

function setup(overrides: Partial<SimulatorConfig> = {}) {
  const config = { ...loadConfig({}), anomalyRate: 0, ...overrides };
  const publishers: Record<string, RecordingPublisher> = {};
  const factory: PublisherFactory = (transport) =>
    (publishers[transport] ??= new RecordingPublisher(transport));
  const service = new SimulatorService(config, factory, () => 0.5);
  return { service, publishers };
}

describe('SimulatorService', () => {
  it('publishes one valid batch per vehicle', async () => {
    const { service, publishers } = setup({ deviceCount: 3, readingsPerBatch: 4 });
    await service.publishAll();

    const sent = publishers.amqp.sent;
    expect(sent.map((m) => m.deviceId)).toEqual(['vehicle-001', 'vehicle-002', 'vehicle-003']);
    for (const message of sent) {
      expect(message.messageId).toMatch(/^[0-9a-f-]{36}$/);
      expect(Number.isNaN(Date.parse(message.recordedAt))).toBe(false);
      expect(message.readings).toHaveLength(4);
    }
  });

  it('gives every batch a fresh messageId', async () => {
    const { service, publishers } = setup({ deviceCount: 1 });
    await service.publishAll();
    await service.publishAll();
    const [a, b] = publishers.amqp.sent;
    expect(a.messageId).not.toBe(b.messageId);
  });

  it('splits vehicles across transports in mixed mode', async () => {
    const { service, publishers } = setup({ deviceCount: 4, transport: 'mixed' });
    await service.publishAll();

    expect(publishers.amqp.sent.map((m) => m.deviceId)).toEqual(['vehicle-001', 'vehicle-003']);
    expect(publishers.mqtt.sent.map((m) => m.deviceId)).toEqual(['vehicle-002', 'vehicle-004']);
  });

  it('keeps publishing other vehicles when one publish fails', async () => {
    const config = { ...loadConfig({}), deviceCount: 2, anomalyRate: 0 };
    let calls = 0;
    const sent: string[] = [];
    const factory: PublisherFactory = () => ({
      name: 'amqp',
      publish: (m) => {
        calls++;
        if (calls === 1) return Promise.reject(new Error('broker unavailable'));
        sent.push(m.deviceId);
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
    });
    const service = new SimulatorService(config, factory, () => 0.5);

    await expect(service.publishAll()).resolves.toBeUndefined();
    expect(sent).toEqual(['vehicle-002']);
  });

  it('closes its publishers on shutdown', async () => {
    const { service, publishers } = setup({ deviceCount: 2, transport: 'mixed' });
    await service.publishAll();
    await service.onApplicationShutdown();
    expect(publishers.amqp.closed).toBe(true);
    expect(publishers.mqtt.closed).toBe(true);
  });
});
