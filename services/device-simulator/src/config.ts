export type Transport = 'amqp' | 'mqtt' | 'mixed';

export interface SimulatorConfig {
  amqpUrl: string;
  mqttUrl: string;
  /** `mixed` sends even-numbered vehicles over AMQP and odd-numbered ones over MQTT. */
  transport: Transport;
  /** Number of simulated vehicles. */
  deviceCount: number;
  /** How often each vehicle publishes a batch. */
  publishIntervalMs: number;
  /** Readings per batch; they are spaced evenly across the publish interval. */
  readingsPerBatch: number;
  /** Probability (0 to 1) that a batch carries an injected anomaly. */
  anomalyRate: number;
  /** Where vehicles start, roughly: a point plus a random offset of up to ~2 km. */
  originLat: number;
  originLng: number;
}

const TRANSPORTS: readonly Transport[] = ['amqp', 'mqtt', 'mixed'];

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min = 1): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}, got "${raw}"`);
  }
  return value;
}

function decimal(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  [min, max] = [-Infinity, Infinity],
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

function transport(env: NodeJS.ProcessEnv): Transport {
  const raw = (env.TRANSPORT || 'amqp').toLowerCase();
  if (!TRANSPORTS.includes(raw as Transport)) {
    throw new Error(`TRANSPORT must be one of ${TRANSPORTS.join(', ')}, got "${raw}"`);
  }
  return raw as Transport;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SimulatorConfig {
  return {
    amqpUrl: env.AMQP_URL || 'amqp://localhost:5672',
    mqttUrl: env.MQTT_URL || 'mqtt://localhost:1883',
    transport: transport(env),
    deviceCount: integer(env, 'DEVICE_COUNT', 5),
    publishIntervalMs: integer(env, 'PUBLISH_INTERVAL_MS', 5000, 100),
    readingsPerBatch: integer(env, 'READINGS_PER_BATCH', 5),
    anomalyRate: decimal(env, 'ANOMALY_RATE', 0.05, [0, 1]),
    originLat: decimal(env, 'ORIGIN_LAT', 52.520008, [-90, 90]),
    originLng: decimal(env, 'ORIGIN_LNG', 13.404954, [-180, 180]),
  };
}

/** Which transport the vehicle at `index` (0-based) uses. */
export function transportFor(config: Pick<SimulatorConfig, 'transport'>, index: number) {
  if (config.transport !== 'mixed') return config.transport;
  return index % 2 === 0 ? 'amqp' : 'mqtt';
}
