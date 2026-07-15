/**
 * Flight reconstruction — parameterized profiles from summary telemetry.
 *
 * The telemetry gives per-flight summaries only (duration, max altitude,
 * average RPM, one vibration amplitude, battery endpoints). Every path and
 * channel curve here is RECONSTRUCTED from those summaries plus the flight
 * objective — deterministic (seeded by flight number), physically plausible,
 * and always labeled as reconstruction in the UI, never presented as recorded
 * data. Anomaly annotations shape the curves: an EXCEEDANCE flight ramps
 * vibration to its recorded amplitude across the final 30 s; a minor-note
 * flight gets a mid-flight transient.
 *
 * Pure TypeScript (three.js-free) so the math is unit-testable.
 */
import type { FlightRecord } from '../types';
import { heightAt } from './terrain';
import { lerp, mulberry32, smoothstep } from './rng';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ChannelSample {
  /** seconds from takeoff */
  t: number;
  /** altitude above ground level, m */
  agl: number;
  /** vibration amplitude, g */
  vibration: number;
  /** battery voltage, V */
  battery: number;
  /** rotor speed, RPM */
  rpm: number;
}

export interface ReconstructedFlight {
  flight: FlightRecord;
  durationS: number;
  /** end of climb / start of descent, seconds */
  climbEndS: number;
  descentStartS: number;
  /** world-frame path points at SAMPLES_N uniform time steps */
  path: Vec3[];
  /** channel curves at the same time steps */
  channels: ChannelSample[];
  /** ground-track length, m */
  trackLengthM: number;
  /** takeoff / landing / turnaround points (world frame) */
  start: Vec3;
  apex: Vec3;
  end: Vec3;
  /** first time vibration crosses the alert threshold, seconds (if it does) */
  alertCrossS?: number;
}

export const SAMPLES_N = 240;
/** duration of the terminal vibration ramp on EXCEEDANCE flights, seconds */
export const EXCEEDANCE_RAMP_S = 30;

// ---------------------------------------------------------------------------
// Site layout — objective-clustered sectors around the base station
// ---------------------------------------------------------------------------

/** Sector heading (radians from +x east, ccw) and range band per objective. */
const SECTORS: Record<string, { heading: number; spread: number }> = {
  sample_retrieval: { heading: -0.55, spread: 0.5 }, // NE toward the delta
  cache_transport: { heading: Math.PI * 0.92, spread: 0.25 }, // W to Cache Depot Alpha
  reconnaissance: { heading: -1.35, spread: 0.6 }, // N, farther out
  site_survey: { heading: 1.15, spread: 0.7 }, // S basin floor
};

/** Mean ground speed by objective, m/s (Ingenuity-class cruise). */
function cruiseSpeed(objective: string, rand: () => number): number {
  const base = objective === 'reconnaissance' ? 6.5 : objective === 'site_survey' ? 5.5 : 4.5;
  return base * (0.9 + 0.2 * rand());
}

/**
 * Out-and-back ground track: base → target (bowed), hover, return along an
 * offset bow. Transport flights are one-way A→B (they land at the depot).
 */
function groundTrack(rec: FlightRecord, rand: () => number) {
  const sector = SECTORS[rec.objective] ?? { heading: rand() * Math.PI * 2, spread: 0.8 };
  const heading = sector.heading + (rand() - 0.5) * sector.spread;
  const cruise = cruiseSpeed(rec.objective, rand);
  const oneWay = rec.objective === 'cache_transport';
  const cruiseTimeS = rec.durationMin * 60 * 0.7; // cruise fraction of the flight
  const rangeM = Math.max(120, (cruise * cruiseTimeS) / (oneWay ? 1 : 2));

  const sx = (rand() - 0.5) * 60;
  const sz = (rand() - 0.5) * 60;
  const tx = sx + Math.cos(heading) * rangeM;
  const tz = sz + Math.sin(heading) * rangeM;
  const bow = (rand() - 0.5) * rangeM * 0.5;
  const bowHeading = heading + Math.PI / 2;
  const cx = (sx + tx) / 2 + Math.cos(bowHeading) * bow;
  const cz = (sz + tz) / 2 + Math.sin(bowHeading) * bow;

  /** quadratic bezier position on the outbound leg, u ∈ [0,1] */
  const outbound = (u: number): [number, number] => {
    const a = 1 - u;
    return [a * a * sx + 2 * a * u * cx + u * u * tx, a * a * sz + 2 * a * u * cz + u * u * tz];
  };
  // return leg bows the other way (slightly offset path home)
  const rx = (sx + tx) / 2 - Math.cos(bowHeading) * bow * 0.7;
  const rz = (sz + tz) / 2 - Math.sin(bowHeading) * bow * 0.7;
  const inbound = (u: number): [number, number] => {
    const a = 1 - u;
    return [a * a * tx + 2 * a * u * rx + u * u * sx, a * a * tz + 2 * a * u * rz + u * u * sz];
  };

  return {
    oneWay,
    /** ground position for mission progress p ∈ [0,1] over the whole flight */
    at(p: number): [number, number] {
      if (oneWay) return outbound(p);
      if (p < 0.48) return outbound(p / 0.48);
      if (p < 0.52) return outbound(1); // station-keep over the target
      return inbound((p - 0.52) / 0.48);
    },
    start: [sx, sz] as [number, number],
    target: [tx, tz] as [number, number],
  };
}

// ---------------------------------------------------------------------------
// Channel curves
// ---------------------------------------------------------------------------

interface ChannelParams {
  rec: FlightRecord;
  durationS: number;
  climbEndS: number;
  descentStartS: number;
  alertThresholdG: number;
  rand: () => number;
}

function vibrationAt(t: number, p: ChannelParams, ripplePhase: number): number {
  const { rec, durationS } = p;
  const flag = rec.anomalyFlag ?? '';
  const ripple = 0.004 * Math.sin(t / 7 + ripplePhase) + 0.002 * Math.sin(t / 2.3 + ripplePhase * 2);
  if (/EXCEEDANCE/i.test(flag)) {
    // steady near the wear-trend level, ramping to the recorded peak in the final 30 s
    const base = rec.vibrationG * 0.8;
    const rampStart = Math.max(0, durationS - EXCEEDANCE_RAMP_S);
    if (t <= rampStart) return base + ripple;
    const u = smoothstep((t - rampStart) / (durationS - rampStart));
    return lerp(base, rec.vibrationG, u) + ripple * (1 - u);
  }
  if (/VIBRATION/i.test(flag)) {
    // minor note: mid-flight transient peaking at the recorded amplitude
    const base = rec.vibrationG * 0.85;
    const peakT = durationS * 0.55;
    const w = durationS * 0.12;
    const bump = Math.exp(-((t - peakT) ** 2) / (2 * w * w));
    return base + (rec.vibrationG - base) * bump + ripple;
  }
  return rec.vibrationG + ripple;
}

function aglAt(t: number, p: ChannelParams): number {
  const { rec, durationS, climbEndS, descentStartS } = p;
  const cruiseAlt = rec.maxAltitudeM;
  if (t <= 0) return 0;
  if (t < climbEndS) return cruiseAlt * smoothstep(t / climbEndS);
  if (t <= descentStartS) {
    const u = (t - climbEndS) / Math.max(1, descentStartS - climbEndS);
    // gentle cruise undulation that only dips BELOW the recorded max altitude
    return cruiseAlt * (1 - 0.06 * (0.5 + 0.5 * Math.sin(u * Math.PI * 2)));
  }
  if (t >= durationS) return 0;
  return cruiseAlt * (1 - smoothstep((t - descentStartS) / (durationS - descentStartS)));
}

function rpmAt(t: number, p: ChannelParams): number {
  const { rec, durationS } = p;
  const SPIN_S = 8;
  if (t < SPIN_S) return rec.rotorRpmAvg * smoothstep(t / SPIN_S);
  if (t > durationS - SPIN_S) return rec.rotorRpmAvg * smoothstep((durationS - t) / SPIN_S);
  return rec.rotorRpmAvg;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function reconstructFlight(
  rec: FlightRecord,
  alertThresholdG: number,
): ReconstructedFlight {
  const rand = mulberry32(0x9e3779b9 ^ (rec.flightNumber * 2654435761));
  const durationS = rec.durationMin * 60;
  const climbEndS = Math.min(30, durationS * 0.15);
  const descentStartS = durationS - Math.min(30, durationS * 0.15);
  const track = groundTrack(rec, rand);
  const ripplePhase = rand() * Math.PI * 2;
  const params: ChannelParams = {
    rec,
    durationS,
    climbEndS,
    descentStartS,
    alertThresholdG,
    rand,
  };

  const path: Vec3[] = [];
  const channels: ChannelSample[] = [];
  let trackLengthM = 0;
  let alertCrossS: number | undefined;
  let prev: [number, number] | null = null;

  for (let i = 0; i < SAMPLES_N; i++) {
    const t = (durationS * i) / (SAMPLES_N - 1);
    const progress = i / (SAMPLES_N - 1);
    const [gx, gz] = track.at(progress);
    const agl = aglAt(t, params);
    const vibration = vibrationAt(t, params, ripplePhase);
    const battery = lerp(rec.batteryVStart, rec.batteryVEnd, progress);
    path.push({ x: gx, y: heightAt(gx, gz) + agl, z: gz });
    channels.push({ t, agl, vibration, battery, rpm: rpmAt(t, params) });
    if (alertCrossS === undefined && vibration >= alertThresholdG) alertCrossS = t;
    if (prev) trackLengthM += Math.hypot(gx - prev[0], gz - prev[1]);
    prev = [gx, gz];
  }

  const [ax, az] = track.at(track.oneWay ? 1 : 0.5);
  return {
    flight: rec,
    durationS,
    climbEndS,
    descentStartS,
    path,
    channels,
    trackLengthM,
    start: path[0],
    apex: { x: ax, y: heightAt(ax, az) + rec.maxAltitudeM, z: az },
    end: path[path.length - 1],
    alertCrossS,
  };
}

// ---------------------------------------------------------------------------
// Severity color scale — vibration → green/amber/red (status colors: this IS state)
// ---------------------------------------------------------------------------

const GREEN: [number, number, number] = [0x0c / 255, 0xa3 / 255, 0x0c / 255];
const AMBER: [number, number, number] = [0xfa / 255, 0xb2 / 255, 0x19 / 255];
const RED: [number, number, number] = [0xd0 / 255, 0x3b / 255, 0x3b / 255];

function mix(a: [number, number, number], b: [number, number, number], t: number) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)] as [
    number,
    number,
    number,
  ];
}

/**
 * Vibration severity → RGB in [0,1]. Green through the nominal band, amber as
 * it approaches the alert threshold, red at/above the threshold.
 */
export function vibrationRgb(
  v: number,
  alertThresholdG: number,
  nominalG = 0.12,
): [number, number, number] {
  const amberStart = nominalG + (alertThresholdG - nominalG) * 0.45;
  if (v <= amberStart) {
    return mix(GREEN, AMBER, Math.max(0, (v - nominalG) / (amberStart - nominalG)) * 0.55);
  }
  if (v < alertThresholdG) {
    return mix(mix(GREEN, AMBER, 0.55), AMBER, (v - amberStart) / (alertThresholdG - amberStart));
  }
  const over = Math.min(1, (v - alertThresholdG) / (alertThresholdG * 0.25));
  return mix(AMBER, RED, 0.35 + 0.65 * over);
}

export function vibrationCss(v: number, alertThresholdG: number): string {
  const [r, g, b] = vibrationRgb(v, alertThresholdG);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}
