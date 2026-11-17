import { injectAnomaly, maybeAnomaly } from './anomaly-injector';
import type { Reading } from './vehicle';

const batch: Reading[] = [0, 1, 2, 3, 4].map((i) => ({
  offsetMs: i * 1000,
  lat: 52.5 + i * 0.0001,
  lng: 13.4,
  speedMps: 10,
}));

describe('injectAnomaly', () => {
  it('adds a speeding burst in the middle of the batch', () => {
    const result = injectAnomaly(batch, 'overspeed');
    expect(result.map((r) => r.speedMps)).toEqual([10, 10, 42, 43, 10]);
  });

  it('moves one reading about a kilometre away', () => {
    const result = injectAnomaly(batch, 'gps_jump');
    expect(result[2].lat - batch[2].lat).toBeCloseTo(0.01, 6);
    expect(result.filter((r, i) => r.lat !== batch[i].lat)).toHaveLength(1);
  });

  it('does not mutate the input', () => {
    const before = JSON.stringify(batch);
    injectAnomaly(batch, 'overspeed');
    injectAnomaly(batch, 'gps_jump');
    expect(JSON.stringify(batch)).toBe(before);
  });

  it('handles an empty batch', () => {
    expect(injectAnomaly([], 'gps_jump')).toEqual([]);
  });
});

describe('maybeAnomaly', () => {
  it('never injects when the rate is zero', () => {
    expect(maybeAnomaly(0, () => 0)).toBeUndefined();
  });

  it('injects when the draw is below the rate', () => {
    const draws = [0.01, 0.2];
    expect(maybeAnomaly(0.05, () => draws.shift()!)).toBe('overspeed');
  });

  it('skips when the draw is above the rate', () => {
    expect(maybeAnomaly(0.05, () => 0.5)).toBeUndefined();
  });
});
