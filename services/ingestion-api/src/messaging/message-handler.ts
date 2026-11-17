import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { IngestTelemetryDto } from '../telemetry/dto/ingest-telemetry.dto';
import type { IngestResult } from '../telemetry/telemetry.service';

/**
 * What the consumer should tell the broker about a delivery:
 * - `ack`:    processed (or a known replay); remove it from the queue.
 * - `reject`: the message itself is bad and will never succeed; dead-letter it now.
 * - `retry`:  processing failed for a reason that may go away (e.g. database down);
 *             requeue it. The broker dead-letters it after `DELIVERY_LIMIT` attempts.
 */
export type Disposition =
  | { action: 'ack'; result: IngestResult }
  | { action: 'reject'; reason: string }
  | { action: 'retry'; reason: string };

export type Ingest = (dto: IngestTelemetryDto) => Promise<IngestResult>;

export interface DeliveryContext {
  /**
   * Device the transport says sent the message (from the MQTT topic). When set,
   * the payload must claim the same device, so one device cannot write
   * telemetry for another by changing the body.
   */
  topicDeviceId?: string;
}

/**
 * Extracts the device id from an MQTT-originated routing key
 * (`devices.<id>.telemetry`). The MQTT plugin turns "." in a topic into "/",
 * so it is turned back here. Returns undefined for any other routing key.
 */
export function deviceIdFromMqttRoutingKey(routingKey: string): string | undefined {
  const match = /^devices\.([^.]+)\.telemetry$/.exec(routingKey);
  return match ? match[1].replace(/\//g, '.') : undefined;
}

export async function decideDisposition(
  content: Buffer,
  ingest: Ingest,
  context: DeliveryContext = {},
): Promise<Disposition> {
  let payload: unknown;
  try {
    payload = JSON.parse(content.toString('utf8'));
  } catch {
    return { action: 'reject', reason: 'body is not valid JSON' };
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { action: 'reject', reason: 'body must be a JSON object' };
  }

  const dto = plainToInstance(IngestTelemetryDto, payload);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length > 0) {
    return { action: 'reject', reason: `validation failed: ${describe(errors)}` };
  }

  if (context.topicDeviceId !== undefined && context.topicDeviceId !== dto.deviceId) {
    return {
      action: 'reject',
      reason: `deviceId "${dto.deviceId}" does not match topic device "${context.topicDeviceId}"`,
    };
  }

  try {
    return { action: 'ack', result: await ingest(dto) };
  } catch (error) {
    return { action: 'retry', reason: error instanceof Error ? error.message : String(error) };
  }
}

function describe(errors: ValidationError[], parent = ''): string {
  return errors
    .flatMap((error) => {
      const path = parent ? `${parent}.${error.property}` : error.property;
      const own = Object.values(error.constraints ?? {}).map((message) => `${path}: ${message}`);
      const nested = error.children?.length ? [describe(error.children, path)] : [];
      return [...own, ...nested];
    })
    .join('; ');
}
