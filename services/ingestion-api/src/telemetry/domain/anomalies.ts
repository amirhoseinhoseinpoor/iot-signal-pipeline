import { haversineMeters, Reading } from './route-stats';

export type AnomalyType = 'overspeed' | 'gps_jump';

export interface Anomaly {
  type: AnomalyType;
  /** Offset of the reading where the anomaly was observed (the peak, for overspeed). */
  offsetMs: number;
  lat: number;
  lng: number;
  /**
   * Observed value in metres per second: reported speed, or the implied speed
   * of a jump. `null` when two positions share a timestamp (unbounded speed).
   */
  value: number | null;
  threshold: number;
}

export interface DetectionRules {
  /** Reported speed above which a vehicle is speeding. */
  overspeedMps: number;
  /**
   * Speed implied by two consecutive positions above which the jump cannot be
   * physical (multipath, cold start, spoofing) and the position is suspect.
   */
  maxImpliedSpeedMps: number;
}

export const DEFAULT_RULES: DetectionRules = {
  overspeedMps: 33.3, // 120 km/h
  maxImpliedSpeedMps: 70, // ~250 km/h
};

/** Positions closer than this are treated as GPS noise, never as a jump. */
const JUMP_NOISE_FLOOR_METERS = 25;

/**
 * Finds anomalies in one batch. Expects readings sorted by `offsetMs`.
 *
 * Consecutive overspeed readings form one episode and produce a single
 * anomaly at the episode's peak, so a vehicle doing 130 km/h for a minute
 * raises one alert, not sixty.
 */
export function detectAnomalies(
  readings: readonly Reading[],
  rules: DetectionRules = DEFAULT_RULES,
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  let episodePeak: Reading | undefined;

  const closeEpisode = () => {
    if (!episodePeak) return;
    anomalies.push(anomaly('overspeed', episodePeak, episodePeak.speedMps, rules.overspeedMps));
    episodePeak = undefined;
  };

  readings.forEach((reading, index) => {
    if (reading.speedMps > rules.overspeedMps) {
      if (!episodePeak || reading.speedMps > episodePeak.speedMps) episodePeak = reading;
    } else {
      closeEpisode();
    }

    if (index === 0) return;
    const previous = readings[index - 1];
    const meters = haversineMeters(previous, reading);
    if (meters < JUMP_NOISE_FLOOR_METERS) return;

    const seconds = (reading.offsetMs - previous.offsetMs) / 1000;
    const implied = seconds > 0 ? meters / seconds : Number.POSITIVE_INFINITY;
    if (implied > rules.maxImpliedSpeedMps) {
      anomalies.push(anomaly('gps_jump', reading, implied, rules.maxImpliedSpeedMps));
    }
  });
  closeEpisode();

  return anomalies.sort((a, b) => a.offsetMs - b.offsetMs);
}

function anomaly(type: AnomalyType, at: Reading, value: number, threshold: number): Anomaly {
  return {
    type,
    offsetMs: at.offsetMs,
    lat: at.lat,
    lng: at.lng,
    value: Number.isFinite(value) ? Math.round(value * 100) / 100 : null,
    threshold,
  };
}
