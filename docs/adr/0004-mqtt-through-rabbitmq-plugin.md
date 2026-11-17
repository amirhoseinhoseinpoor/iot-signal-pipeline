# 4. MQTT ingestion through RabbitMQ's MQTT plugin

- Status: accepted
- Date: 2026-11-18

## Context

Many tracking devices are constrained. They run on cellular links with
unreliable coverage, cannot hold an AMQP connection, and speak MQTT. The
platform should accept MQTT without adding a second ingestion path that would
need its own validation, idempotency and retry logic.

## Options

1. Run a separate MQTT broker (for example Mosquitto) and a bridge service that
   republishes to RabbitMQ.
2. Enable RabbitMQ's built-in MQTT plugin and bind the existing queue to the
   exchange it publishes to.

## Decision

Use option 2.

- `rabbitmq_mqtt` is enabled in `deploy/rabbitmq/enabled_plugins`, and port 1883 is exposed.
- Devices publish JSON batches with QoS 1 to `devices/<deviceId>/telemetry`.
- The plugin publishes these to `amq.topic` with routing key
  `devices.<deviceId>.telemetry`. In that conversion, "/" and "." swap places.
- `telemetry.ingest` is also bound to `amq.topic` with the pattern `devices.*.telemetry`.
- The consumer checks that the device in the topic matches the payload's
  `deviceId`, and dead-letters the message otherwise. Combined with per-device
  credentials and topic permissions, this stops one device from writing data for
  another.

## Consequences

- There is one queue, one consumer, and one set of guarantees for every transport.
  Dead-lettering, idempotency and validation apply to MQTT unchanged.
- There is no extra service to deploy, monitor or scale.
- The simulator can run in `amqp`, `mqtt` or `mixed` mode. The CI smoke test runs
  in mixed mode, so both paths are exercised on every change.
- MQTT traffic shares the broker's capacity with AMQP. At large device counts, a
  dedicated MQTT tier (such as EMQX) bridged to RabbitMQ would scale better. Because
  the queue contract stays the same, this can be swapped in later without touching
  the consumer.
