import type { Channel } from 'amqplib';

/**
 * Broker topology shared by every service that talks to RabbitMQ. Declarations
 * are idempotent, so whichever service starts first creates them.
 *
 * Keep the declarations below in sync with `services/device-simulator/src/topology.ts`:
 * RabbitMQ refuses to redeclare a queue with different arguments.
 */
export const TELEMETRY_EXCHANGE = 'telemetry';
export const TELEMETRY_QUEUE = 'telemetry.ingest';
export const DEAD_LETTER_EXCHANGE = 'telemetry.dlx';
export const DEAD_LETTER_QUEUE = 'telemetry.ingest.dlq';

/** Deliveries a message gets before the broker dead-letters it. */
export const DELIVERY_LIMIT = 5;

export const routingKeyFor = (deviceId: string) => `device.${deviceId}`;

/**
 * Devices can also publish over MQTT to `devices/<deviceId>/telemetry`.
 * RabbitMQ's MQTT plugin forwards those messages to `amq.topic`, swapping
 * "/" and "." in the topic, so the routing key becomes
 * `devices.<deviceId with "." as "/">.telemetry`.
 */
export const MQTT_EXCHANGE = 'amq.topic';
export const MQTT_ROUTING_PATTERN = 'devices.*.telemetry';
export const mqttTopicFor = (deviceId: string) => `devices/${deviceId}/telemetry`;

export async function assertTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(TELEMETRY_EXCHANGE, 'topic', { durable: true });
  await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'fanout', { durable: true });

  await channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true });
  await channel.bindQueue(DEAD_LETTER_QUEUE, DEAD_LETTER_EXCHANGE, '');

  // A quorum queue is replicated and counts redeliveries, which lets the broker
  // move a message that keeps failing to the dead-letter queue on its own.
  await channel.assertQueue(TELEMETRY_QUEUE, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-delivery-limit': DELIVERY_LIMIT,
      'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE,
    },
  });
  await channel.bindQueue(TELEMETRY_QUEUE, TELEMETRY_EXCHANGE, 'device.#');
  // amq.topic always exists; the binding is harmless when the MQTT plugin is off.
  await channel.bindQueue(TELEMETRY_QUEUE, MQTT_EXCHANGE, MQTT_ROUTING_PATTERN);
}
