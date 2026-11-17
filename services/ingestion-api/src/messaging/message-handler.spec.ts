import { decideDisposition, deviceIdFromMqttRoutingKey, Ingest } from './message-handler';

const validMessage = {
  messageId: 'b7e2c1d0-0000-4000-8000-000000000001',
  deviceId: 'vehicle-001',
  recordedAt: '2026-11-17T09:30:00.000Z',
  readings: [
    { offsetMs: 0, lat: 52.52, lng: 13.405, speedMps: 8.1 },
    { offsetMs: 1000, lat: 52.5201, lng: 13.4051, speedMps: 8.4 },
  ],
};

const body = (value: unknown) => Buffer.from(JSON.stringify(value));
const ok: Ingest = () => Promise.resolve({ id: 'abc', status: 'created', alerts: 0 });

describe('decideDisposition', () => {
  it('acks a valid message once it is stored', async () => {
    const ingest = jest.fn(ok);
    const result = await decideDisposition(body(validMessage), ingest);

    expect(result).toEqual({ action: 'ack', result: { id: 'abc', status: 'created', alerts: 0 } });
    const dto = ingest.mock.calls[0][0];
    expect(dto.recordedAt).toBeInstanceOf(Date);
    expect(dto.readings).toHaveLength(2);
  });

  it('acks a replayed message without treating it as an error', async () => {
    const result = await decideDisposition(body(validMessage), () =>
      Promise.resolve({ id: 'abc', status: 'duplicate', alerts: 0 }),
    );
    expect(result).toMatchObject({ action: 'ack', result: { status: 'duplicate' } });
  });

  it('rejects a body that is not JSON', async () => {
    const ingest = jest.fn(ok);
    const result = await decideDisposition(Buffer.from('{not json'), ingest);

    expect(result).toEqual({ action: 'reject', reason: 'body is not valid JSON' });
    expect(ingest).not.toHaveBeenCalled();
  });

  it.each([['a string'], [42], [null], [[validMessage]]])(
    'rejects a non-object body: %j',
    async (value) => {
      const result = await decideDisposition(body(value), ok);
      expect(result.action).toBe('reject');
    },
  );

  it('rejects a message with out-of-range coordinates and names the field', async () => {
    const bad = {
      ...validMessage,
      readings: [{ offsetMs: 0, lat: 123, lng: 13.405, speedMps: 1 }],
    };
    const result = await decideDisposition(body(bad), ok);

    expect(result.action).toBe('reject');
    expect(result.action === 'reject' && result.reason).toContain('readings.0.lat');
  });

  it('rejects a message without readings', async () => {
    const result = await decideDisposition(body({ ...validMessage, readings: [] }), ok);
    expect(result.action).toBe('reject');
  });

  it('rejects unknown fields so schema drift is caught early', async () => {
    const result = await decideDisposition(body({ ...validMessage, extra: true }), ok);
    expect(result.action).toBe('reject');
  });

  it('asks for a retry when storage fails', async () => {
    const result = await decideDisposition(body(validMessage), () =>
      Promise.reject(new Error('connection refused')),
    );
    expect(result).toEqual({ action: 'retry', reason: 'connection refused' });
  });
});

describe('MQTT device binding', () => {
  it('extracts the device id from an MQTT routing key', () => {
    expect(deviceIdFromMqttRoutingKey('devices.vehicle-001.telemetry')).toBe('vehicle-001');
    // The MQTT plugin maps "." in a topic to "/" in the routing key.
    expect(deviceIdFromMqttRoutingKey('devices.truck/7.telemetry')).toBe('truck.7');
    expect(deviceIdFromMqttRoutingKey('device.vehicle-001')).toBeUndefined();
    expect(deviceIdFromMqttRoutingKey('devices.a.b.telemetry')).toBeUndefined();
  });

  it('accepts a message whose payload matches the topic device', async () => {
    const result = await decideDisposition(body(validMessage), ok, {
      topicDeviceId: 'vehicle-001',
    });
    expect(result.action).toBe('ack');
  });

  it('rejects a message published on another device topic', async () => {
    const ingest = jest.fn(ok);
    const result = await decideDisposition(body(validMessage), ingest, {
      topicDeviceId: 'vehicle-999',
    });
    expect(result).toMatchObject({ action: 'reject' });
    expect(ingest).not.toHaveBeenCalled();
  });
});
