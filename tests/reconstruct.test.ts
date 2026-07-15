/** Flight-reconstruction math: deterministic, physically coherent, anomaly-shaped. */
import { describe, expect, it } from 'vitest';
import {
  EXCEEDANCE_RAMP_S,
  SAMPLES_N,
  reconstructFlight,
  vibrationRgb,
} from '../src/scenes/reconstruct';
import { heightAt } from '../src/scenes/terrain';
import { ingestFiles } from '../src/ingest';
import { msrhDemoFiles } from '../src/demo/msrhDemo';

const THRESH = 0.186;

const model = ingestFiles(msrhDemoFiles).model!;
const f47 = model.telemetry.find((f) => f.flightNumber === 47)!;
const f23 = model.telemetry.find((f) => f.flightNumber === 23)!;
const f38 = model.telemetry.find((f) => f.flightNumber === 38)!;

describe('flight reconstruction', () => {
  it('is deterministic: same flight → identical reconstruction', () => {
    const a = reconstructFlight(f23, THRESH);
    const b = reconstructFlight(f23, THRESH);
    expect(a.path).toEqual(b.path);
    expect(a.channels).toEqual(b.channels);
  });

  it('respects the flight summary: duration, altitude ceiling, battery endpoints', () => {
    const r = reconstructFlight(f23, THRESH);
    expect(r.durationS).toBeCloseTo(f23.durationMin * 60, 6);
    expect(r.channels).toHaveLength(SAMPLES_N);
    const maxAgl = Math.max(...r.channels.map((c) => c.agl));
    expect(maxAgl).toBeLessThanOrEqual(f23.maxAltitudeM * 1.001);
    expect(maxAgl).toBeGreaterThan(f23.maxAltitudeM * 0.9);
    expect(r.channels[0].agl).toBe(0);
    expect(r.channels[SAMPLES_N - 1].agl).toBeCloseTo(0, 6);
    expect(r.channels[0].battery).toBeCloseTo(f23.batteryVStart, 6);
    expect(r.channels[SAMPLES_N - 1].battery).toBeCloseTo(f23.batteryVEnd, 6);
  });

  it('keeps the path on or above the terrain', () => {
    for (const rec of [f23, f47]) {
      const r = reconstructFlight(rec, THRESH);
      for (const p of r.path) {
        expect(p.y).toBeGreaterThanOrEqual(heightAt(p.x, p.z) - 1e-6);
      }
    }
  });

  it('F47 (EXCEEDANCE) ramps vibration to the recorded 0.22 g in the final 30 s', () => {
    const r = reconstructFlight(f47, THRESH);
    const peak = Math.max(...r.channels.map((c) => c.vibration));
    expect(peak).toBeGreaterThanOrEqual(f47.vibrationG * 0.98);
    expect(peak).toBeLessThanOrEqual(f47.vibrationG * 1.05);
    // the threshold crossing happens inside the terminal ramp window
    expect(r.alertCrossS).toBeDefined();
    expect(r.alertCrossS!).toBeGreaterThan(r.durationS - EXCEEDANCE_RAMP_S - 1);
    // before the ramp the level sits near the wear-trend base, below threshold
    const preRamp = r.channels.filter((c) => c.t < r.durationS - EXCEEDANCE_RAMP_S);
    expect(Math.max(...preRamp.map((c) => c.vibration))).toBeLessThan(THRESH);
  });

  it('F38 (minor note) peaks mid-flight, not at the end; F23 never crosses the threshold', () => {
    const r38 = reconstructFlight(f38, THRESH);
    const peakIdx = r38.channels.reduce(
      (best, c, i) => (c.vibration > r38.channels[best].vibration ? i : best),
      0,
    );
    const peakT = r38.channels[peakIdx].t;
    expect(peakT).toBeGreaterThan(r38.durationS * 0.3);
    expect(peakT).toBeLessThan(r38.durationS * 0.8);

    const r23 = reconstructFlight(f23, THRESH);
    expect(r23.alertCrossS).toBeUndefined();
  });

  it('cache-transport flights are one-way (land away from base); others return', () => {
    const transport = model.telemetry.find((f) => f.objective === 'cache_transport')!;
    const rt = reconstructFlight(transport, THRESH);
    const endDist = Math.hypot(rt.end.x - rt.start.x, rt.end.z - rt.start.z);
    expect(endDist).toBeGreaterThan(100);

    const r = reconstructFlight(f23, THRESH); // site_survey → out-and-back
    const backDist = Math.hypot(r.end.x - r.start.x, r.end.z - r.start.z);
    expect(backDist).toBeLessThan(10);
  });

  it('severity colors: nominal green, near-threshold amber, exceedance red', () => {
    const [gr, gg] = vibrationRgb(0.12, THRESH);
    expect(gg).toBeGreaterThan(gr); // green dominant
    const [ar, ag, ab] = vibrationRgb(0.175, THRESH);
    expect(ar).toBeGreaterThan(ab); // warm
    expect(ag).toBeGreaterThan(0.3);
    const [rr, rg] = vibrationRgb(0.22, THRESH);
    expect(rr).toBeGreaterThan(rg * 1.8); // red dominant
  });
});
