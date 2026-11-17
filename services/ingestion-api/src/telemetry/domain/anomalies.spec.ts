import { DetectionRules, detectAnomalies } from './anomalies';
import { Reading } from './route-stats';

const rules: DetectionRules = { overspeedMps: 30, maxImpliedSpeedMps: 70 };

/** Readings one second apart moving north by `stepDeg` latitude each time. */
function drive(speeds: number[], stepDeg = 0.0001): Reading[] {
  return speeds.map((speedMps, i) => ({
    offsetMs: i * 1000,
    lat: 52.5 + i * stepDeg,
    lng: 13.4,
    speedMps,
  }));
}

describe('detectAnomalies', () => {
  it('returns nothing for normal driving', () => {
    expect(detectAnomalies(drive([10, 12, 14, 13]), rules)).toEqual([]);
  });

  it('reports one overspeed anomaly per episode, at its peak', () => {
    const anomalies = detectAnomalies(drive([20, 31, 35, 32, 20, 20, 40, 20]), rules);

    expect(anomalies).toHaveLength(2);
    expect(anomalies[0]).toMatchObject({ type: 'overspeed', offsetMs: 2000, value: 35 });
    expect(anomalies[1]).toMatchObject({ type: 'overspeed', offsetMs: 6000, value: 40 });
  });

  it('closes an overspeed episode that lasts until the end of the batch', () => {
    const anomalies = detectAnomalies(drive([10, 31, 33]), rules);
    expect(anomalies).toEqual([expect.objectContaining({ type: 'overspeed', value: 33 })]);
  });

  it('does not flag a speed exactly at the limit', () => {
    expect(detectAnomalies(drive([30, 30]), rules)).toEqual([]);
  });

  it('flags a position jump that implies an impossible speed', () => {
    const readings = drive([10, 10, 10]);
    readings[2] = { ...readings[2], lat: readings[1].lat + 0.01 }; // ~1.1 km in one second

    const anomalies = detectAnomalies(readings, rules);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({ type: 'gps_jump', offsetMs: 2000, threshold: 70 });
    expect(anomalies[0].value).toBeGreaterThan(1000);
  });

  it('flags a jump between two readings with the same timestamp', () => {
    const readings: Reading[] = [
      { offsetMs: 0, lat: 52.5, lng: 13.4, speedMps: 5 },
      { offsetMs: 0, lat: 52.6, lng: 13.4, speedMps: 5 },
    ];
    const [jump] = detectAnomalies(readings, rules);
    expect(jump.type).toBe('gps_jump');
    expect(jump.value).toBeNull();
  });

  it('ignores small jitter even when timestamps are identical', () => {
    const readings: Reading[] = [
      { offsetMs: 0, lat: 52.5, lng: 13.4, speedMps: 0 },
      { offsetMs: 0, lat: 52.50005, lng: 13.4, speedMps: 0 }, // ~5.5 m
    ];
    expect(detectAnomalies(readings, rules)).toEqual([]);
  });

  it('returns anomalies ordered by offset', () => {
    const readings = drive([40, 10, 10, 10]);
    readings[3] = { ...readings[3], lat: readings[2].lat + 0.01 };
    const types = detectAnomalies(readings, rules).map((a) => a.type);
    expect(types).toEqual(['overspeed', 'gps_jump']);
  });
});
