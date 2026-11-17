import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import type { App } from 'supertest/types';
import { configureApp } from '../src/app.setup';
import { TelemetryModule } from '../src/telemetry/telemetry.module';

/**
 * Exercises the HTTP API against a real (in-memory) MongoDB. The AMQP consumer
 * is left out; its decision logic has its own unit tests.
 */
describe('Telemetry API (e2e)', () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication<App>;

  const http = () => request(app.getHttpServer());

  const batch = (overrides: Record<string, unknown> = {}) => ({
    messageId: `msg-${Math.random().toString(36).slice(2)}`,
    deviceId: 'vehicle-001',
    recordedAt: '2026-11-17T09:30:00.000Z',
    readings: [
      // ~10 m in one second: realistic, so the fixture raises no alerts.
      { offsetMs: 1000, lat: 52.52009, lng: 13.405, speedMps: 10 },
      { offsetMs: 0, lat: 52.52, lng: 13.405, speedMps: 6 },
    ],
    ...overrides,
  });

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(mongo.getUri('wayline-test')),
        TelemetryModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, { swagger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  it('stores a batch with computed route stats and sorted readings', async () => {
    const created = await http().post('/api/v1/telemetry').send(batch()).expect(201);
    expect(created.body).toEqual({ id: expect.any(String), status: 'created', alerts: 0 });

    const fetched = await http().get(`/api/v1/telemetry/${created.body.id}`).expect(200);
    expect(fetched.body.readings.map((r: { offsetMs: number }) => r.offsetMs)).toEqual([0, 1000]);
    expect(fetched.body.stats).toMatchObject({
      readingCount: 2,
      durationMs: 1000,
      maxSpeedMps: 10,
      avgSpeedMps: 8,
    });
    expect(fetched.body.stats.distanceMeters).toBeCloseTo(10.01, 1);
  });

  it('is idempotent on messageId', async () => {
    const payload = batch({ messageId: 'replayed-1' });
    const first = await http().post('/api/v1/telemetry').send(payload).expect(201);
    const second = await http().post('/api/v1/telemetry').send(payload).expect(200);

    expect(second.body).toEqual({ id: first.body.id, status: 'duplicate', alerts: 0 });
  });

  it.each([
    ['missing readings', { readings: undefined }],
    ['empty readings', { readings: [] }],
    ['bad latitude', { readings: [{ offsetMs: 0, lat: 91, lng: 0, speedMps: 0 }] }],
    ['bad device id', { deviceId: 'has spaces' }],
    ['bad timestamp', { recordedAt: 'yesterday' }],
    ['unknown field', { firmware: '1.2.3' }],
  ])('rejects invalid payloads: %s', async (_name, overrides) => {
    await http().post('/api/v1/telemetry').send(batch(overrides)).expect(400);
  });

  it('lists batches newest first, filtered and paginated, without raw readings', async () => {
    const seed: Array<[string, number]> = [
      ['truck-a', 1],
      ['truck-a', 2],
      ['truck-a', 3],
      ['truck-b', 4],
    ];
    for (const [deviceId, minute] of seed) {
      await http()
        .post('/api/v1/telemetry')
        .send(batch({ deviceId, recordedAt: `2026-11-18T10:0${minute}:00.000Z` }))
        .expect(201);
    }

    const page = await http()
      .get('/api/v1/telemetry')
      .query({ deviceId: 'truck-a', limit: 2, page: 1 })
      .expect(200);
    expect(page.body.total).toBe(3);
    expect(page.body.items).toHaveLength(2);
    expect(page.body.items[0].recordedAt).toBe('2026-11-18T10:03:00.000Z');
    expect(page.body.items[0].readings).toBeUndefined();

    const ranged = await http()
      .get('/api/v1/telemetry')
      .query({ deviceId: 'truck-a', from: '2026-11-18T10:02:00Z', to: '2026-11-18T10:02:59Z' })
      .expect(200);
    expect(ranged.body.total).toBe(1);
  });

  it('rejects an oversized page', async () => {
    await http().get('/api/v1/telemetry').query({ limit: 1000 }).expect(400);
  });

  it('summarises devices with their last position', async () => {
    const devices = await http().get('/api/v1/devices').expect(200);
    const truckA = devices.body.find((d: { deviceId: string }) => d.deviceId === 'truck-a');

    expect(truckA).toMatchObject({
      batchCount: 3,
      lastSeenAt: '2026-11-18T10:03:00.000Z',
      maxSpeedMps: 10,
      lastPosition: { lat: 52.52009, lng: 13.405 },
      lastSpeedMps: 10,
      // Seeded with 2026 timestamps far from "now" in the test run.
      status: expect.stringMatching(/^(online|stale)$/),
    });
  });

  it('returns 404 for unknown or malformed ids, and deletes existing ones', async () => {
    await http().get('/api/v1/telemetry/not-an-id').expect(404);
    await http().get('/api/v1/telemetry/64b7f0000000000000000000').expect(404);

    const created = await http().post('/api/v1/telemetry').send(batch()).expect(201);
    await http().delete(`/api/v1/telemetry/${created.body.id}`).expect(204);
    await http().get(`/api/v1/telemetry/${created.body.id}`).expect(404);
  });

  describe('alerts', () => {
    const speeding = (messageId: string) =>
      batch({
        messageId,
        deviceId: 'speedy-1',
        recordedAt: '2026-11-18T12:00:00.000Z',
        readings: [
          { offsetMs: 0, lat: 52.52, lng: 13.405, speedMps: 20 },
          { offsetMs: 1000, lat: 52.5203, lng: 13.405, speedMps: 38 },
          { offsetMs: 2000, lat: 52.5206, lng: 13.405, speedMps: 41 },
          { offsetMs: 3000, lat: 52.5209, lng: 13.405, speedMps: 25 },
          // ~1.1 km in one second: a GPS jump.
          { offsetMs: 4000, lat: 52.5309, lng: 13.405, speedMps: 25 },
        ],
      });

    it('raises one alert per anomaly when a batch is ingested', async () => {
      const res = await http().post('/api/v1/telemetry').send(speeding('alerts-1')).expect(201);
      expect(res.body.alerts).toBe(2);

      const alerts = await http().get('/api/v1/alerts').query({ deviceId: 'speedy-1' }).expect(200);
      expect(alerts.body.total).toBe(2);

      const byType = Object.fromEntries(
        alerts.body.items.map((a: { type: string }) => [a.type, a]),
      );
      expect(byType.overspeed).toMatchObject({
        value: 41,
        threshold: 33.3,
        detectedAt: '2026-11-18T12:00:02.000Z',
        position: { lat: 52.5206, lng: 13.405 },
      });
      expect(byType.gps_jump).toMatchObject({ detectedAt: '2026-11-18T12:00:04.000Z' });
      expect(byType.gps_jump.value).toBeGreaterThan(1000);
    });

    it('does not duplicate alerts when the batch is replayed', async () => {
      await http().post('/api/v1/telemetry').send(speeding('alerts-1')).expect(200);
      const alerts = await http().get('/api/v1/alerts').query({ deviceId: 'speedy-1' }).expect(200);
      expect(alerts.body.total).toBe(2);
    });

    it('filters alerts by type and validates the filter', async () => {
      const jumps = await http()
        .get('/api/v1/alerts')
        .query({ deviceId: 'speedy-1', type: 'gps_jump' })
        .expect(200);
      expect(jumps.body.total).toBe(1);

      await http().get('/api/v1/alerts').query({ type: 'meteor' }).expect(400);
    });
  });
});
