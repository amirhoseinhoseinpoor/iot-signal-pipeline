import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import type { Channel, ConsumeMessage } from 'amqplib';
import { TelemetryService } from '../telemetry/telemetry.service';
import { AMQP_CONNECTION } from './amqp-connection.provider';
import { decideDisposition, deviceIdFromMqttRoutingKey } from './message-handler';
import { assertTopology, MQTT_EXCHANGE, TELEMETRY_QUEUE } from './topology';

/**
 * Consumes telemetry batches from RabbitMQ.
 *
 * Messages are acknowledged only after the batch is stored, so a crash never
 * loses data; the broker redelivers instead. Redelivery is harmless because
 * ingestion is idempotent on `messageId`.
 */
@Injectable()
export class TelemetryConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TelemetryConsumer.name);
  private channel?: ChannelWrapper;

  constructor(
    @Inject(AMQP_CONNECTION) private readonly connection: AmqpConnectionManager,
    private readonly telemetry: TelemetryService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    const prefetch = this.config.get<number>('AMQP_PREFETCH', 20);

    // The setup function re-runs after every reconnect.
    this.channel = this.connection.createChannel({
      json: false,
      setup: async (channel: Channel) => {
        await assertTopology(channel);
        await channel.prefetch(prefetch);
        await channel.consume(TELEMETRY_QUEUE, (msg) => {
          if (msg) void this.handle(channel, msg);
        });
        this.logger.log(`Consuming ${TELEMETRY_QUEUE} (prefetch ${prefetch})`);
      },
    });
  }

  async handle(channel: Pick<Channel, 'ack' | 'nack'>, msg: ConsumeMessage): Promise<void> {
    const fromMqtt = msg.fields.exchange === MQTT_EXCHANGE;
    const disposition = await decideDisposition(
      msg.content,
      (dto) => this.telemetry.ingest(dto),
      fromMqtt ? { topicDeviceId: deviceIdFromMqttRoutingKey(msg.fields.routingKey) ?? '' } : {},
    );
    const id = (msg.properties.messageId as string | undefined) ?? 'unknown';

    switch (disposition.action) {
      case 'ack':
        channel.ack(msg);
        break;
      case 'reject':
        this.logger.warn(`Dead-lettering message ${id}: ${disposition.reason}`);
        channel.nack(msg, false, false);
        break;
      case 'retry':
        this.logger.error(`Requeueing message ${id}: ${disposition.reason}`);
        channel.nack(msg, false, true);
        break;
    }
  }

  async onApplicationShutdown() {
    await this.channel?.close();
    await this.connection.close();
  }
}
