/**
 * Analytics engine — emits the Evidence Package (docs/CONTRACTS.md §Analytics).
 *
 * Pure deterministic TypeScript. Robust baseline (median/MAD z), OLS trend vs
 * rotor hours with threshold-crossing projection, multivariate confounder
 * regression (normal equations + Gaussian elimination) with wind-twin, onset
 * classification, maintenance-note extraction, historical signature matching,
 * and constraint scanning. Numbers are computed, never invented; every item
 * carries full provenance. Analyses whose inputs are missing are skipped
 * silently — evidence ids stay sequential over what IS emitted.
 */
import type {
  AnalyticsConfig,
  AnomalyRecord,
  DatasetRole,
  EvidenceItem,
  EvidenceKind,
  EvidencePackage,
  FlightRecord,
  MissionModel,
  PatternTag,
  Provenance,
} from '../types';
import {
  extractBearingLimit,
  extractBearingPlaySeries,
  extractCuringSols,
  extractThresholds,
  extractUsdK,
} from './extractors';
import { MAD_TO_SIGMA, clamp01, mad, median, olsMulti, olsSimple, percentileOf } from './stats';

/** Item under construction — ids are assigned after the emission set is known. */
type DraftItem = Omit<EvidenceItem, 'id'>;

const DEFAULT_FILE_NAMES: Record<DatasetRole, string> = {
  telemetry: 'telemetry_flights.csv',
  maintenance: 'maintenance_log.json',
  anomaly_history: 'anomaly_history.json',
  inventory: 'parts_inventory.csv',
  timeline: 'mission_timeline.json',
  team: 'engineering_team.json',
  budget: 'budget_contingency.csv',
};

const HISTORICAL_KEYWORDS = ['bearing', 'lubricant', 'wear', 'dust', 'blade', 'sensor'];
const PROGRESSIVE_ONSET_RE = /gradual|progressive|increase/i;
const VEHICLE_CLASS_RE = /MSRH|Ingenuity|heritage/i;

export function runAnalytics(model: MissionModel, cfg: AnalyticsConfig): EvidencePackage {
  const computedAt = new Date().toISOString();
  const fileFor = (role: DatasetRole): string =>
    model.meta.sources.find((s) => s.role === role)?.fileName ?? DEFAULT_FILE_NAMES[role];
  const joinFiles = (...files: (string | undefined)[]): string =>
    [...new Set(files.filter((f): f is string => !!f))].join(' + ');

  const telemetry = [...(model.telemetry ?? [])].sort((a, b) => a.flightNumber - b.flightNumber);
  if (telemetry.length === 0) {
    return {
      anomaly: {
        description: 'No telemetry records available — analytics skipped.',
        category: 'vibration',
      },
      items: [],
      computedAt,
    };
  }

  // -------------------------------------------------------------------------
  // Anomalous flight: EXCEEDANCE flag (highest flight number wins);
  // fallback: maximum-vibration flight, noted in the description.
  // -------------------------------------------------------------------------
  const flagged = telemetry.filter((f) =>
    (f.anomalyFlag ?? '').toUpperCase().includes('EXCEEDANCE'),
  );
  let anomFlight: FlightRecord;
  let flagNote: string;
  if (flagged.length > 0) {
    anomFlight = flagged[flagged.length - 1];
    flagNote = `flagged ${anomFlight.anomalyFlag}`;
  } else {
    anomFlight = telemetry.reduce((a, b) => (b.vibrationG > a.vibrationG ? b : a));
    flagNote = 'no EXCEEDANCE flag present — selected the maximum-vibration flight';
  }
  const baseline = telemetry.filter((f) => f !== anomFlight);
  const vAnom = anomFlight.vibrationG;

  const thresholds = extractThresholds(model.maintenance, cfg);
  const bearingLimit = extractBearingLimit(model.maintenance, cfg);
  const playSeries = extractBearingPlaySeries(model.maintenance);

  const telemetryFile = fileFor('telemetry');
  const maintenanceFile = model.maintenance?.length ? fileFor('maintenance') : undefined;
  const thresholdIds = thresholds.sourceId ? [thresholds.sourceId] : [];
  const thresholdFile = thresholds.sourceId ? maintenanceFile : undefined;

  const anomaly: EvidencePackage['anomaly'] = {
    description:
      `Flight ${anomFlight.flightNumber} (Sol ${anomFlight.sol}) vibration amplitude ` +
      `${fmt(vAnom, 3)} g vs current alert threshold ${fmt(thresholds.currentG, 3)} g — ${flagNote}.`,
    category: 'vibration',
    flightRef: `F${anomFlight.flightNumber}`,
  };

  const items: DraftItem[] = [];
  const push = (
    kind: EvidenceKind,
    pattern: PatternTag | undefined,
    statement: string,
    value: Record<string, number>,
    provenance: Provenance,
    weight: number,
  ): void => {
    items.push({ kind, pattern, statement, value, provenance, weight: clamp01(weight) });
  };

  // -------------------------------------------------------------------------
  // 1. Robust baseline exceedance (median/MAD z over the early-mission window)
  // -------------------------------------------------------------------------
  const window = baseline.slice(0, cfg.baselineWindowFlights);
  if (window.length > 0) {
    const vibs = window.map((f) => f.vibrationG);
    const med = median(vibs);
    const madV = mad(vibs, med);
    const robustSigma = MAD_TO_SIGMA * madV;
    const z = robustSigma > 0 ? (vAnom - med) / robustSigma : 0;
    push(
      'exceedance',
      'vibration_exceedance',
      `F${anomFlight.flightNumber} vibration ${fmt(vAnom, 3)} g is ${fmt(z, 1)} robust sigma above the ` +
        `early-mission baseline (median ${fmt(med, 4)} g, MAD ${fmt(madV, 4)} g over the first ` +
        `${window.length} flights) and exceeds the current ${fmt(thresholds.currentG, 3)} g alert threshold.`,
      {
        median: med,
        mad: madV,
        robustSigma,
        z,
        vibration: vAnom,
        thresholdCurrent: thresholds.currentG,
        thresholdOriginal: thresholds.originalG,
      },
      {
        file: joinFiles(telemetryFile, thresholdFile),
        rows: [...window.map((f) => f.sourceRow), anomFlight.sourceRow],
        recordIds: thresholdIds.length ? thresholdIds : undefined,
      },
      Math.abs(z) / 10,
    );
  }

  // -------------------------------------------------------------------------
  // 2. OLS trend vs cumulative rotor hours (baseline flights only)
  // -------------------------------------------------------------------------
  const trend = olsSimple(
    baseline.map((f) => f.cumulativeRotorHours),
    baseline.map((f) => f.vibrationG),
  );
  const trendFired = !!trend && trend.slope > 0 && trend.tStat >= cfg.trendMinTStat;
  const baselineRows = baseline.map((f) => f.sourceRow);
  if (trend && trendFired) {
    push(
      'trend',
      'monotonic_trend_vs_rotor_hours',
      `Baseline vibration rises steadily with rotor hours: slope ${fmt(trend.slope, 4)} g/hr, ` +
        `R² ${fmt(trend.r2, 3)}, t = ${fmt(trend.tStat, 1)} over ${trend.n} baseline flights ` +
        `(excludes F${anomFlight.flightNumber}).`,
      {
        slope: trend.slope,
        intercept: trend.intercept,
        r2: trend.r2,
        t: trend.tStat,
        rmse: trend.rmse,
        n: trend.n,
      },
      { file: telemetryFile, rows: baselineRows },
      trend.r2,
    );
  }

  // -------------------------------------------------------------------------
  // 3. Trend projection reaching the current threshold
  // -------------------------------------------------------------------------
  if (trend && trendFired) {
    const crossingHours = (thresholds.currentG - trend.intercept) / trend.slope;
    push(
      'prediction',
      'trend_projection_reaches_threshold',
      `Extrapolating the rotor-hours trend, vibration reaches the ${fmt(thresholds.currentG, 3)} g ` +
        `threshold at ${fmt(crossingHours, 2)} cumulative rotor hours — F${anomFlight.flightNumber} ` +
        `occurred at ${fmt(anomFlight.cumulativeRotorHours, 2)} h, so the exceedance arrived ahead of ` +
        `the gradual-wear projection.`,
      {
        crossingHours,
        thresholdCurrent: thresholds.currentG,
        anomalyHours: anomFlight.cumulativeRotorHours,
        slope: trend.slope,
        intercept: trend.intercept,
      },
      {
        file: joinFiles(telemetryFile, thresholdFile),
        rows: baselineRows,
        recordIds: thresholdIds.length ? thresholdIds : undefined,
      },
      0.5, // fixed projection discount
    );
  }

  // -------------------------------------------------------------------------
  // 4. Acute departure from the trend line (F_anom residual)
  // -------------------------------------------------------------------------
  if (trend) {
    const predicted = trend.predict(anomFlight.cumulativeRotorHours);
    const residual = vAnom - predicted;
    const ratio = trend.rmse > 0 ? residual / trend.rmse : 0;
    push(
      'exceedance',
      'acute_departure_from_trend',
      `F${anomFlight.flightNumber} sits ${fmt(residual, 4)} g above the rotor-hours trend line ` +
        `(${fmt(ratio, 1)}x the trend RMSE of ${fmt(trend.rmse, 4)} g) — an acute step beyond the ` +
        `gradual trend.`,
      { residual, trendRmse: trend.rmse, ratio, predicted, vibration: vAnom },
      { file: telemetryFile, rows: [...baselineRows, anomFlight.sourceRow] },
      Math.abs(residual) / (3 * trend.rmse),
    );
  }

  // -------------------------------------------------------------------------
  // 5. Confounder regression (wind/ambient/RPM/duration) + wind-twin
  // -------------------------------------------------------------------------
  const conf = olsMulti(
    baseline.map((f) => [1, f.windSpeedMs, f.ambientTempC, f.rotorRpmAvg, f.durationMin]),
    baseline.map((f) => f.vibrationG),
  );
  if (conf) {
    const predicted = conf.predict([
      1,
      anomFlight.windSpeedMs,
      anomFlight.ambientTempC,
      anomFlight.rotorRpmAvg,
      anomFlight.durationMin,
    ]);
    const residual = vAnom - predicted;
    const ratio = conf.rmse > 0 ? residual / conf.rmse : 0;
    const unexplained = Math.abs(residual) > 2 * conf.rmse;
    const twins = baseline.filter(
      (f) => Math.abs(f.windSpeedMs - anomFlight.windSpeedMs) <= cfg.windTwinToleranceMs,
    );
    const twin = twins.length
      ? twins.reduce((best, f) => {
          const dBest = Math.abs(best.windSpeedMs - anomFlight.windSpeedMs);
          const dF = Math.abs(f.windSpeedMs - anomFlight.windSpeedMs);
          return dF < dBest || (dF === dBest && f.flightNumber > best.flightNumber) ? f : best;
        })
      : undefined;
    const twinText = twin
      ? ` Wind-twin F${twin.flightNumber} (wind ${fmt(twin.windSpeedMs, 1)} m/s vs ` +
        `${fmt(anomFlight.windSpeedMs, 1)} m/s) flew at only ${fmt(twin.vibrationG, 3)} g.`
      : '';
    push(
      'confounder',
      unexplained ? 'confounder_unexplained_residual' : 'confounder_explains_anomaly',
      unexplained
        ? `Environmental confounders (wind, ambient temp, RPM, duration) predict ${fmt(predicted, 3)} g ` +
          `for F${anomFlight.flightNumber} conditions vs observed ${fmt(vAnom, 3)} g — the ` +
          `${fmt(residual, 4)} g residual (${fmt(ratio, 1)}x model RMSE, baseline R² ${fmt(conf.r2, 3)}) ` +
          `is NOT explained by environment.${twinText}`
        : `Environmental confounders (wind, ambient temp, RPM, duration) predict ${fmt(predicted, 3)} g ` +
          `for F${anomFlight.flightNumber} vs observed ${fmt(vAnom, 3)} g — the residual ` +
          `${fmt(residual, 4)} g is within 2x model RMSE; environment largely explains the reading.${twinText}`,
      {
        r2: conf.r2,
        rmse: conf.rmse,
        predicted,
        residual,
        ratio,
        n: conf.n,
        k: conf.k,
        ...(twin ? { twinFlight: twin.flightNumber, twinVibration: twin.vibrationG } : {}),
      },
      { file: telemetryFile, rows: [...baselineRows, anomFlight.sourceRow] },
      Math.abs(residual) / (3 * conf.rmse),
    );
  }

  // -------------------------------------------------------------------------
  // 6. High wind during the anomaly (percentile of baseline winds, ties count)
  // -------------------------------------------------------------------------
  if (baseline.length > 0) {
    const winds = baseline.map((f) => f.windSpeedMs);
    const pct = percentileOf(winds, anomFlight.windSpeedMs);
    if (pct >= 0.9) {
      push(
        'exceedance',
        'high_wind_during_anomaly',
        `F${anomFlight.flightNumber} wind ${fmt(anomFlight.windSpeedMs, 1)} m/s is at the ` +
          `${fmt(pct * 100, 0)}th percentile of baseline winds (fleet max ${fmt(Math.max(...winds), 1)} m/s) — ` +
          `high wind was present during the anomaly.`,
        { percentile: pct, windAnomaly: anomFlight.windSpeedMs, baselineMaxWind: Math.max(...winds) },
        { file: telemetryFile, rows: [...baselineRows, anomFlight.sourceRow] },
        pct,
      );
    }
  }

  // -------------------------------------------------------------------------
  // 7. Onset classification: gradual (trend + precursor) vs sudden
  // -------------------------------------------------------------------------
  {
    const precursors = baseline.filter(
      (f) =>
        f.flightNumber < anomFlight.flightNumber &&
        ((f.anomalyFlag ?? '').length > 0 || f.vibrationG >= 0.9 * thresholds.originalG),
    );
    const precursor = precursors.length ? precursors[precursors.length - 1] : undefined;
    if (trendFired && precursor) {
      push(
        'exceedance',
        'gradual_onset_multi_flight',
        `Onset is gradual across multiple flights: precursor F${precursor.flightNumber} ` +
          `(${fmt(precursor.vibrationG, 3)} g${precursor.anomalyFlag ? `, ${precursor.anomalyFlag}` : ''}) ` +
          `preceded F${anomFlight.flightNumber}, and the rotor-hours trend is statistically significant.`,
        {
          precursorFlight: precursor.flightNumber,
          precursorVibration: precursor.vibrationG,
          anomalyFlight: anomFlight.flightNumber,
          anomalyVibration: vAnom,
        },
        { file: telemetryFile, rows: [precursor.sourceRow, anomFlight.sourceRow] },
        0.5 + 0.15 * 1 + 0.15 * 1,
      );
    } else {
      push(
        'exceedance',
        'sudden_onset_single_flight',
        `Onset appears sudden: no ${trendFired ? 'precursor flight' : 'significant trend or precursor'} ` +
          `precedes the F${anomFlight.flightNumber} exceedance.`,
        { anomalyFlight: anomFlight.flightNumber, anomalyVibration: vAnom },
        { file: telemetryFile, rows: [anomFlight.sourceRow] },
        0.7,
      );
    }
  }

  // -------------------------------------------------------------------------
  // 8. Bearing play near spec limit (latest measurement / limit)
  // -------------------------------------------------------------------------
  if (playSeries.length > 0) {
    const latest = playSeries[playSeries.length - 1];
    const ratio = latest.valueMm / bearingLimit.limitMm;
    if (ratio >= cfg.bearingPlayNearLimitRatio && maintenanceFile) {
      const prior = playSeries.length > 1 ? playSeries[playSeries.length - 2] : undefined;
      const recordIds = [
        latest.actionId,
        ...(prior ? [prior.actionId] : []),
        ...(bearingLimit.sourceId ? [bearingLimit.sourceId] : []),
      ];
      push(
        'maintenance_correlation',
        'bearing_play_near_limit',
        `Latest bearing play ${fmt(latest.valueMm, 4)} mm (${latest.actionId}, Sol ${latest.sol}) is ` +
          `${fmt(ratio * 100, 1)}% of the ${fmt(bearingLimit.limitMm, 3)} mm upper spec limit` +
          `${bearingLimit.sourceId ? ` (${bearingLimit.sourceId})` : ''}.`,
        { latestPlayMm: latest.valueMm, limitMm: bearingLimit.limitMm, ratio, latestSol: latest.sol },
        { file: maintenanceFile, recordIds: [...new Set(recordIds)] },
        ratio,
      );
    }
  }

  // -------------------------------------------------------------------------
  // 9. Maintenance wear progression (strictly increasing play series)
  // -------------------------------------------------------------------------
  if (playSeries.length >= 3 && maintenanceFile) {
    const strictlyIncreasing = playSeries.every(
      (p, i) => i === 0 || p.valueMm > playSeries[i - 1].valueMm,
    );
    if (strictlyIncreasing) {
      const value: Record<string, number> = { count: playSeries.length };
      playSeries.forEach((p, i) => {
        value[`play${i + 1}`] = p.valueMm;
        value[`sol${i + 1}`] = p.sol;
      });
      push(
        'maintenance_correlation',
        'maintenance_wear_progression',
        `Bearing play increased strictly across ${playSeries.length} services: ` +
          `${playSeries.map((p) => fmt(p.valueMm, 4)).join(' -> ')} mm ` +
          `(Sols ${playSeries.map((p) => p.sol).join(' -> ')}).`,
        value,
        { file: maintenanceFile, recordIds: playSeries.map((p) => p.actionId) },
        (playSeries.length - 1) / 3,
      );
    }
  }

  // -------------------------------------------------------------------------
  // 10. Recent software change before the anomaly event sol
  // -------------------------------------------------------------------------
  if (model.maintenance?.length && maintenanceFile) {
    const eventSol = model.timeline?.currentSol ?? anomFlight.sol;
    const candidates = model.maintenance
      .filter(
        (m) =>
          m.subsystem === 'flight_computer' &&
          m.sol <= eventSol &&
          eventSol - m.sol <= cfg.recentSoftwareChangeSols,
      )
      .sort((a, b) => a.sol - b.sol);
    const change = candidates[candidates.length - 1];
    if (change) {
      const delta = eventSol - change.sol;
      push(
        'maintenance_correlation',
        'recent_software_change',
        `Flight-computer change ${change.actionId} ("${change.action}") on Sol ${change.sol} was only ` +
          `${delta} sols before the anomaly event (Sol ${eventSol}) — a recent software change is in the ` +
          `causal window.`,
        { changeSol: change.sol, anomalyEventSol: eventSol, deltaSols: delta },
        { file: maintenanceFile, recordIds: [change.actionId] },
        Math.max(0, 1 - delta / cfg.recentSoftwareChangeSols),
      );
    }
  }

  // -------------------------------------------------------------------------
  // 11. Exceeds the ORIGINAL (pre-patch) threshold. Only meaningful when a
  // threshold-lowering patch is documented in the maintenance log — with no
  // maintenance data there is no "pre-patch" limit to compare against.
  // -------------------------------------------------------------------------
  if (thresholds.sourceId && vAnom > thresholds.originalG) {
    const excessFraction = vAnom / thresholds.originalG - 1;
    push(
      'exceedance',
      'exceeds_original_threshold',
      `F${anomFlight.flightNumber} vibration ${fmt(vAnom, 3)} g exceeds even the original (pre-patch) ` +
        `${fmt(thresholds.originalG, 2)} g threshold by ${fmt(excessFraction * 100, 0)}% — the alert is ` +
        `real under the pre-patch limit, not an artifact of the lowered threshold.`,
      { vibration: vAnom, thresholdOriginal: thresholds.originalG, excessFraction },
      {
        file: joinFiles(telemetryFile, thresholdFile),
        rows: [anomFlight.sourceRow],
        recordIds: thresholdIds.length ? thresholdIds : undefined,
      },
      excessFraction / 0.2,
    );
  }

  // -------------------------------------------------------------------------
  // 12. Historical signature matching (top-K resolved anomaly-history records)
  // -------------------------------------------------------------------------
  if (model.anomalyHistory?.length) {
    const historyFile = fileFor('anomaly_history');
    const scored = model.anomalyHistory
      .filter((rec) => !/pending/i.test(rec.resolution))
      .map((rec) => ({ rec, ...scoreHistoricalRecord(rec, anomaly.category) }));
    scored.sort((a, b) => b.score - a.score); // Array.prototype.sort is stable: ties keep file order
    for (const { rec, score, categoryScore, keywordScore, onsetScore, vehicleScore, matched } of scored.slice(
      0,
      cfg.historicalMatchTopK,
    )) {
      push(
        'historical_match',
        undefined,
        `Historical match ${rec.anomalyId} (${rec.vehicle}, ${rec.category}, ${rec.severity}) scores ` +
          `${fmt(score, 2)}${matched.length ? `: ${matched.join('; ')}` : ''}. ` +
          `Root cause: ${truncate(rec.rootCause, 140)}`,
        { score, categoryScore, keywordScore, onsetScore, vehicleScore },
        { file: historyFile, recordIds: [rec.anomalyId] },
        score,
      );
    }
  }

  // -------------------------------------------------------------------------
  // 13. Constraint scanning (weight 0, no pattern; consumed by decision/UI)
  // -------------------------------------------------------------------------
  if (model.inventory?.length) {
    const inventoryFile = fileFor('inventory');
    for (const part of model.inventory) {
      if (/bearing/i.test(part.description) && part.quantityMarsDepot === 0) {
        push(
          'constraint',
          undefined,
          `${part.description} (${part.partNumber}) has 0 units at the Mars depot ` +
            `(${part.quantityEarthStaging} at Earth staging); next resupply Sol ${part.nextResupplySol}, ` +
            `unit cost ${usd(part.unitCostUsd)}, lead time ${part.leadTimeWeeksFromEarth} weeks from Earth.` +
            `${part.notes ? ` Notes: ${part.notes}` : ''}`,
          {
            qtyMars: part.quantityMarsDepot,
            qtyEarth: part.quantityEarthStaging,
            resupplySol: part.nextResupplySol,
            unitCost: part.unitCostUsd,
            leadTimeWeeks: part.leadTimeWeeksFromEarth,
          },
          { file: inventoryFile, recordIds: [part.partNumber] },
          0,
        );
      }
    }
    const lubricant = model.inventory.find((p) => /lubricant/i.test(p.description));
    if (lubricant) {
      push(
        'constraint',
        undefined,
        `${lubricant.description} (${lubricant.partNumber}): ${lubricant.quantityMarsDepot} on hand at ` +
          `the Mars depot (${lubricant.quantityEarthStaging} at Earth staging), unit cost ` +
          `${usd(lubricant.unitCostUsd)}.${lubricant.notes ? ` Notes: ${lubricant.notes}` : ''}`,
        {
          qtyMars: lubricant.quantityMarsDepot,
          qtyEarth: lubricant.quantityEarthStaging,
          resupplySol: lubricant.nextResupplySol,
          unitCost: lubricant.unitCostUsd,
          leadTimeWeeks: lubricant.leadTimeWeeksFromEarth,
        },
        { file: inventoryFile, recordIds: [lubricant.partNumber] },
        0,
      );
    }
  }

  if (model.timeline) {
    const tl = model.timeline;
    const timelineFile = fileFor('timeline');
    const curingSols = extractCuringSols(tl.notes);
    const effectiveDeadlineSol = tl.earthReturnWindow.windowOpenSol - curingSols;
    const marginSols = effectiveDeadlineSol - tl.currentSol;
    push(
      'constraint',
      undefined,
      `Earth-return window opens Sol ${tl.earthReturnWindow.windowOpenSol}, but sample curing at the ` +
        `depot requires a minimum of ${curingSols} sols (per timeline notes) — effective deadline ` +
        `Sol ${effectiveDeadlineSol}, leaving ${marginSols} sols of margin from current Sol ` +
        `${tl.currentSol}. Each sol of delay costs ${usd(tl.delayCostPerSolUsd)}.`,
      {
        windowOpenSol: tl.earthReturnWindow.windowOpenSol,
        curingSols,
        effectiveDeadlineSol,
        currentSol: tl.currentSol,
        marginSols,
        delayCostPerSolUsd: tl.delayCostPerSolUsd,
      },
      { file: timelineFile, recordIds: ['earth_return_window', 'notes'] },
      0,
    );
  }

  if (model.budget?.length) {
    const budgetFile = fileFor('budget');
    const budgetRow = (category: string): number | undefined => {
      const idx = model.budget!.findIndex((b) => b.category === category);
      return idx >= 0 ? idx + 2 : undefined; // 1-based CSV rows including header
    };
    const spareParts = model.budget.find((b) => b.category === 'spare_parts');
    if (spareParts) {
      const upper = model.inventory?.find((p) => /upper rotor bearing/i.test(p.description));
      const lower = model.inventory?.find((p) => /lower rotor bearing/i.test(p.description));
      const bearingSet =
        upper && lower ? upper.unitCostUsd + lower.unitCostUsd : undefined;
      push(
        'constraint',
        undefined,
        `Budget line spare_parts has ${usd(spareParts.remainingUsd)} remaining of ` +
          `${usd(spareParts.allocatedUsd)}` +
          (bearingSet !== undefined
            ? ` — covers the upper+lower bearing set (${usd(bearingSet)} per inventory unit costs).`
            : '.') +
          ` Notes: ${spareParts.notes}`,
        {
          remainingUsd: spareParts.remainingUsd,
          allocatedUsd: spareParts.allocatedUsd,
          spentUsd: spareParts.spentUsd,
          ...(bearingSet !== undefined ? { bearingSetCostUsd: bearingSet } : {}),
        },
        { file: budgetFile, rows: budgetRow('spare_parts') ? [budgetRow('spare_parts')!] : undefined, recordIds: ['spare_parts'] },
        0,
      );
    }
    const reserve = model.budget.find((b) => b.category === 'schedule_reserve');
    if (reserve) {
      push(
        'constraint',
        undefined,
        `Budget line schedule_reserve holds ${usd(reserve.remainingUsd)} of management reserve for ` +
          `schedule delays. Notes: ${reserve.notes}`,
        {
          remainingUsd: reserve.remainingUsd,
          allocatedUsd: reserve.allocatedUsd,
          spentUsd: reserve.spentUsd,
        },
        { file: budgetFile, rows: budgetRow('schedule_reserve') ? [budgetRow('schedule_reserve')!] : undefined, recordIds: ['schedule_reserve'] },
        0,
      );
    }
    const testing = model.budget.find((b) => b.category === 'testing_verification');
    if (testing) {
      const campaign = extractUsdK(testing.notes);
      push(
        'constraint',
        undefined,
        `Budget line testing_verification has ${usd(testing.remainingUsd)} remaining` +
          (campaign !== undefined
            ? ` vs an estimated ${usd(campaign)} post-repair verification campaign.`
            : '.') +
          ` Notes: ${testing.notes}`,
        {
          remainingUsd: testing.remainingUsd,
          allocatedUsd: testing.allocatedUsd,
          spentUsd: testing.spentUsd,
          ...(campaign !== undefined ? { campaignCostUsd: campaign } : {}),
        },
        { file: budgetFile, rows: budgetRow('testing_verification') ? [budgetRow('testing_verification')!] : undefined, recordIds: ['testing_verification'] },
        0,
      );
    }
  }

  return {
    anomaly,
    items: items.map((item, i) => ({ id: evidenceId(i), ...item })),
    computedAt,
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function evidenceId(index: number): string {
  return `EV-${String(index + 1).padStart(2, '0')}`;
}

interface HistoricalScore {
  score: number;
  categoryScore: number;
  keywordScore: number;
  onsetScore: number;
  vehicleScore: number;
  matched: string[];
}

/** Signature-match score for one resolved anomaly-history record. */
function scoreHistoricalRecord(rec: AnomalyRecord, category: string): HistoricalScore {
  const matched: string[] = [];
  const categoryScore = rec.category === category ? 0.4 : 0;
  if (categoryScore > 0) matched.push(`category match (${rec.category})`);

  const rootCause = rec.rootCause.toLowerCase();
  const keywords = HISTORICAL_KEYWORDS.filter((k) => rootCause.includes(k));
  const keywordScore = Math.min(0.3, keywords.length * 0.1);
  if (keywords.length) matched.push(`root-cause keywords: ${keywords.join(', ')}`);

  const onsetScore = PROGRESSIVE_ONSET_RE.test(rec.description) ? 0.2 : 0;
  if (onsetScore > 0) matched.push('progressive-onset language');

  const vehicleScore = VEHICLE_CLASS_RE.test(rec.vehicle) ? 0.1 : 0;
  if (vehicleScore > 0) matched.push(`vehicle class (${rec.vehicle})`);

  const score = Math.min(1, categoryScore + keywordScore + onsetScore + vehicleScore);
  return { score, categoryScore, keywordScore, onsetScore, vehicleScore, matched };
}

function fmt(v: number, digits: number): string {
  return v.toFixed(digits);
}

function usd(v: number): string {
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
