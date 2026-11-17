import { Logger } from '@nestjs/common';
import {
  AmqpConnectionManager,
  ChannelWrapper,
  connect as amqpConnect,
} from 'amqp-connection-manager';
import type { Channel } from 'amqplib';
import { connect as mqttConnect, MqttClient } from 'mqtt';
import { assertTopology, mqttTopicFor, routingKeyFor, TELEMETRY_EXCHANGE } from './topology';

export interface TelemetryMessage {
  messageId: string;
  deviceId: string;
  recordedAt: string;
  readings: Array<{ offsetMs: number; lat: number; lng: number; speedMps: number }>;
}

/** A way for a simulated device to get a batch to the platform. */
export interface TelemetryPublisher {
  readonly name: 'amqp' | 'mqtt';
  publish(message: TelemetryMessage): Promise<void>;
  close(): Promise<void>;
}

/**
 * Publishes straight to the telemetry exchange over AMQP, as a gateway or a
 * backend integration would. Uses a confirm channel, so `publish` resolves
 * only after the broker has taken responsibility for the message.
 */
export class AmqpPublisher implements TelemetryPublisher {
  readonly name = 'amqp' as const;
  private readonly logger = new Logger(AmqpPublisher.name);
  private readonly connection: AmqpConnectionManager;
  private readonly channel: ChannelWrapper;

  constructor(url: string) {
    this.connection = amqpConnect([url], { reconnectTimeInSeconds: 5 });
    this.connection.on('connect', () => this.logger.log('Connected to RabbitMQ (AMQP)'));
    this.connection.on('disconnect', ({ err }) =>
      this.logger.warn(`AMQP disconnected: ${err?.message ?? 'unknown reason'}`),
    );
    this.channel = this.connection.createChannel({
      json: false,
      setup: (channel: Channel) => assertTopology(channel),
    });
  }

  async publish(message: TelemetryMessage): Promise<void> {
    await this.channel.publish(
      TELEMETRY_EXCHANGE,
      routingKeyFor(message.deviceId),
      Buffer.from(JSON.stringify(message)),
      {
        persistent: true,
        contentType: 'application/json',
        messageId: message.messageId,
        timestamp: Math.floor(Date.now() / 1000),
      },
    );
  }

  async close(): Promise<void> {
    await this.channel.close();
    await this.connection.close();
  }
}

/**
 * Publishes like a constrained device would: MQTT, QoS 1, one topic per
 * device. RabbitMQ's MQTT plugin bridges these into the same queue.
 */
export class MqttPublisher implements TelemetryPublisher {
  readonly name = 'mqtt' as const;
  private readonly logger = new Logger(MqttPublisher.name);
  private readonly client: MqttClient;

  constructor(url: string, clientId: string) {
    this.client = mqttConnect(url, {
      clientId,
      clean: false, // keep QoS 1 messages queued across reconnects
      reconnectPeriod: 5000,
      connectTimeout: 10_000,
    });
    this.client.on('connect', () => this.logger.log(`Connected to MQTT broker as ${clientId}`));
    this.client.on('error', (err) => this.logger.warn(`MQTT error: ${err.message}`));
  }

  async publish(message: TelemetryMessage): Promise<void> {
    await this.client.publishAsync(mqttTopicFor(message.deviceId), JSON.stringify(message), {
      qos: 1,
    });
  }

  async close(): Promise<void> {
    await this.client.endAsync();
  }
}
