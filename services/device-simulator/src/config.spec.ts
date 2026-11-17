import { loadConfig, transportFor } from './config';

describe('loadConfig', () => {
  it('uses sensible defaults', () => {
    expect(loadConfig({})).toMatchObject({
      transport: 'amqp',
      deviceCount: 5,
      publishIntervalMs: 5000,
      readingsPerBatch: 5,
      anomalyRate: 0.05,
    });
  });

  it('reads overrides from the environment', () => {
    const config = loadConfig({
      TRANSPORT: 'MQTT',
      DEVICE_COUNT: '12',
      ANOMALY_RATE: '0.5',
      MQTT_URL: 'mqtt://broker:1883',
    });
    expect(config).toMatchObject({
      transport: 'mqtt',
      deviceCount: 12,
      anomalyRate: 0.5,
      mqttUrl: 'mqtt://broker:1883',
    });
  });

  it.each([
    [{ TRANSPORT: 'carrier-pigeon' }, /TRANSPORT/],
    [{ DEVICE_COUNT: '0' }, /DEVICE_COUNT/],
    [{ DEVICE_COUNT: '2.5' }, /DEVICE_COUNT/],
    [{ PUBLISH_INTERVAL_MS: '10' }, /PUBLISH_INTERVAL_MS/],
    [{ ANOMALY_RATE: '1.5' }, /ANOMALY_RATE/],
    [{ ORIGIN_LAT: '100' }, /ORIGIN_LAT/],
  ])('rejects invalid values: %j', (env, message) => {
    expect(() => loadConfig(env)).toThrow(message);
  });
});

describe('transportFor', () => {
  it('uses the configured transport for every vehicle', () => {
    expect(transportFor({ transport: 'mqtt' }, 0)).toBe('mqtt');
    expect(transportFor({ transport: 'amqp' }, 3)).toBe('amqp');
  });

  it('alternates in mixed mode', () => {
    const mixed = { transport: 'mixed' as const };
    expect([0, 1, 2, 3].map((i) => transportFor(mixed, i))).toEqual([
      'amqp',
      'mqtt',
      'amqp',
      'mqtt',
    ]);
  });
});
