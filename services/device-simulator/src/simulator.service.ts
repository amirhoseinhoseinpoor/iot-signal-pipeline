import { Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { injectAnomaly, maybeAnomaly } from './anomaly-injector';
import { transportFor } from './config';
import type { SimulatorConfig } from './config';
import { AmqpPublisher, MqttPublisher } from './publishers';
import type { TelemetryMessage, TelemetryPublisher } from './publishers';
import { SimulatedVehicle } from './vehicle';
import type { Random } from './vehicle';

export const SIMULATOR_CONFIG = Symbol('SIMULATOR_CONFIG');
export const PUBLISHER_FACTORY = Symbol('PUBLISHER_FACTORY');

export type PublisherFactory = (
  transport: 'amqp' | 'mqtt',
  config: SimulatorConfig,
) => TelemetryPublisher;

export const defaultPublisherFactory: PublisherFactory = (transport, config) =>
  transport === 'amqp'
    ? new AmqpPublisher(config.amqpUrl)
    : new MqttPublisher(config.mqttUrl, `wayline-simulator-${process.pid}`);

/**
 * Drives a small fleet of simulated vehicles and publishes one telemetry batch
 * per vehicle per interval, over AMQP, MQTT or both. A small share of batches
 * carry injected anomalies so the detection pipeline has something to find.
 *
 * Built by a factory provider (see AppModule) so tests can inject the
 * publishers and the random source directly.
 */
export class SimulatorService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SimulatorService.name);
  private readonly vehicles: SimulatedVehicle[];
  private readonly publishers = new Map<'amqp' | 'mqtt', TelemetryPublisher>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: SimulatorConfig,
    private readonly createPublisher: PublisherFactory,
    private readonly random: Random = Math.random,
  ) {
    this.vehicles = Array.from({ length: config.deviceCount }, (_, i) => {
      const deviceId = `vehicle-${String(i + 1).padStart(3, '0')}`;
      return new SimulatedVehicle(deviceId, {
        lat: config.originLat + (this.random() - 0.5) * 0.04,
        lng: config.originLng + (this.random() - 0.5) * 0.06,
        headingDeg: this.random() * 360,
        speedMps: 5 + this.random() * 10,
      });
    });
  }

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.publishAll(), this.config.publishIntervalMs);
    this.logger.log(
      `Simulating ${this.vehicles.length} vehicles over ${this.config.transport}, ` +
        `one batch each every ${this.config.publishIntervalMs} ms`,
    );
  }

  buildMessage(vehicle: SimulatedVehicle, now = new Date()): TelemetryMessage {
    const intervalMs = Math.floor(this.config.publishIntervalMs / this.config.readingsPerBatch);
    let readings = vehicle.sampleBatch(this.config.readingsPerBatch, intervalMs);

    const anomaly = maybeAnomaly(this.config.anomalyRate, this.random);
    if (anomaly) {
      readings = injectAnomaly(readings, anomaly);
      this.logger.log(`Injected ${anomaly} into the next batch from ${vehicle.deviceId}`);
    }

    return {
      messageId: randomUUID(),
      deviceId: vehicle.deviceId,
      recordedAt: now.toISOString(),
      readings,
    };
  }

  async publishAll(): Promise<void> {
    await Promise.all(
      this.vehicles.map(async (vehicle, index) => {
        const publisher = this.publisherFor(index);
        const message = this.buildMessage(vehicle);
        try {
          await publisher.publish(message);
          this.logger.debug(`Published ${message.messageId} for ${vehicle.deviceId}`);
        } catch (error) {
          this.logger.error(
            `${publisher.name} publish failed for ${vehicle.deviceId}: ` +
              (error instanceof Error ? error.message : String(error)),
          );
        }
      }),
    );
  }

  private publisherFor(index: number): TelemetryPublisher {
    const transport = transportFor(this.config, index);
    let publisher = this.publishers.get(transport);
    if (!publisher) {
      publisher = this.createPublisher(transport, this.config);
      this.publishers.set(transport, publisher);
    }
    return publisher;
  }

  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    await Promise.all([...this.publishers.values()].map((p) => p.close()));
  }
}
