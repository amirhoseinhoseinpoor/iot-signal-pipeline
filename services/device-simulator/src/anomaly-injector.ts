import type { Random, Reading } from './vehicle';

export type InjectedAnomaly = 'overspeed' | 'gps_jump';

/**
 * Corrupts a batch the way real devices misbehave, so the ingestion side's
 * detectors and the dashboard have something to show. Returns a new array;
 * the vehicle's own state is never affected.
 */
export function injectAnomaly(readings: readonly Reading[], kind: InjectedAnomaly): Reading[] {
  const copy = readings.map((r) => ({ ...r }));
  if (copy.length === 0) return copy;

  const middle = Math.floor(copy.length / 2);
  if (kind === 'overspeed') {
    // A short burst well above motorway speed.
    for (let i = middle; i < Math.min(copy.length, middle + 2); i++) {
      copy[i].speedMps = 40 + i;
    }
  } else {
    // One fix lands ~1.1 km away (multipath reflection or a cold-start fix).
    copy[middle].lat = Math.round((copy[middle].lat + 0.01) * 1e6) / 1e6;
  }
  return copy;
}

/** Picks an anomaly for a batch with probability `rate`, or none. */
export function maybeAnomaly(rate: number, random: Random): InjectedAnomaly | undefined {
  if (rate <= 0 || random() >= rate) return undefined;
  return random() < 0.5 ? 'overspeed' : 'gps_jump';
}
