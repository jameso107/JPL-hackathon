# TRIAGE Module Contracts (build-day spec)

Authoritative spec for the parallel module builds. Types in `src/types/` are the
law; this file pins down **formulas, edge rules, and golden numbers** the types
can't express. If a contract here conflicts with your judgment, follow the
contract — integration depends on it. Read `ARCHITECTURE` context in the repo
PRD if needed, but this file supersedes it where more specific.

Shared rules for every module:

- Pure TypeScript, strict mode, no new npm dependencies (everything needed is installed).
- **Only write files you own** (ownership list per section). Do not touch `src/types/`,
  `config/`, `src/config/`, `package.json`, or another module's files.
- Numbers are computed, never invented. Every evidence/cost/probability value must trace
  to source data or a cited config assertion.
- Provenance: CSV rows are **1-based including the header** (first data row = row 2 —
  matches what a user sees in an editor). JSON records cite `recordIds`.
- All modules may import from `../types` and `../config` (typed, validated exports:
  `hypothesisLibrary`, `riskDefaults`, `diagnosticsCatalog`, `analyticsConfig`,
  `bayesConfig`, `schemaMappings`).
- Tests: Vitest, in `tests/<module>.test.ts` (you own your test file). Load the MSRH
  dataset via raw imports, e.g. `import telemetryRaw from '../examples/msrh/telemetry_flights.csv?raw'`.
  Golden numbers below were computed independently (Python) — match them to the stated
  tolerance. Run: `npx vitest run tests/<yourfile>.test.ts`, typecheck: `npx tsc -b --force`.

The MSRH demo dataset lives in `examples/msrh/` (7 files). Key storyline facts your
module should reproduce (not hard-code): progressive vibration trend across 46 flights;
F47 exceedance 0.22 g; bearing play 0.002 → 0.003 → 0.0035 mm vs 0.004 limit; upper
bearing (MSRH-RA-002) qty 0 at Mars depot, resupply Sol 320; delay cost $285K/sol;
effective margin 75 sols (window open 380 − 60 sols curing − current sol 245).

---

## §Ingest — owner: ingest agent

**Files owned:** `src/ingest/**` (replace stub `index.ts`, add helpers freely),
`tests/ingest.test.ts`.

**Entry point (exact signature, already stubbed):**
`ingestFiles(files: RawFile[]): IngestResult`

Behavior:

1. **Profile matching** per file, in order: (a) filename regex match against
   `profile.filePatterns` (case-insensitive substring/regex), then (b) content signature —
   all `signatureFields` present in the parsed header (CSV) or first record (JSON array) or
   top-level keys (JSON object). First profile that matches wins. Unmatched files go to
   `unrecognized` (do not fail ingest).
2. **CSV parser:** hand-rolled, no deps. Handle quoted fields with commas, CRLF, trailing
   newline, empty trailing field (`anomaly_flag` is empty for most rows → `undefined`).
   Numeric coercion per target field type; a non-numeric value in a numeric field emits a
   `warning` notice and skips the row (never throws).
3. **Column mapping:** apply `profile.columns` (`from` aliases, first present wins).
   Missing `required` column → `error` notice for that file, file contributes nothing.
   Missing optional column → field defaults: strings `''`, numbers `0`, `anomalyFlag`
   `undefined`, `executionMethod` `'unknown'`.
4. **Timeline** (`columns: []`): structural mapping snake_case → camelCase per the
   `MissionTimeline` type, including nested `earth_return_window` and `scheduled_flights`.
5. **MissionModel assembly:** telemetry sorted by `flightNumber`; `sourceRow` = 1-based CSV
   row (first data row = 2). `meta.vehicle = 'MSRH'` (constant for v1),
   `meta.currentSol = timeline.currentSol` if present, `meta.sources` filled per matched file.
6. **Degradation:** `missingRoles` = the 7 roles minus present ones. Telemetry missing →
   `model: null` + `error` notice ("telemetry is required"). Each other missing role adds an
   `info` notice with its disabled capability (degradation matrix from the PRD):
   anomaly_history → "heritage priors → uniform prior"; inventory → "parts/lead-time joins
   disabled"; timeline → "delay-cost math & window pressure disabled"; team → "personnel
   matching disabled"; budget → "budget checks disabled".

**Tests must cover:** all 7 MSRH files ingest cleanly (47 telemetry records, 10 maintenance,
15 anomalies, 13 parts, 6 scheduled flights, 10 engineers, 6 budget lines — note
`quantity_mars_depot` for MSRH-RA-002 is 0); legacy `technician` alias maps to
`commandingEngineer`; quoted-comma CSV field; missing-telemetry degradation; unrecognized
file listing; F47 `anomalyFlag === 'VIBRATION_EXCEEDANCE'` with `sourceRow` 48.

---

## §Analytics — owner: analytics agent

**Files owned:** `src/analytics/**`, `tests/analytics.test.ts`.

**Entry point:** `runAnalytics(model: MissionModel, cfg: AnalyticsConfig): EvidencePackage`

Skip gracefully: every analysis that needs a missing dataset is skipped silently (no
evidence emitted). Telemetry-only input must still produce trend/baseline/confounder items.

**Anomalous flight:** the telemetry record whose `anomalyFlag` contains `EXCEEDANCE`
(if several, highest `flightNumber`; if none, the max-vibration flight and note it in the
anomaly description). "Baseline flights" = all others. `anomaly.flightRef = "F47"`,
`anomaly.category = "vibration"` (v1 constant).

**Thresholds:** extract from maintenance notes when present — regex
`/threshold lowered from ([0-9.]+)\s*g to ([0-9.]+)\s*g/i` → (original, current); fallback
`cfg.defaultOriginalThresholdG` / `cfg.defaultAlertThresholdG`. Bearing spec limit: regex
`/upper spec limit of ([0-9.]+)\s*mm/i`; fallback `cfg.defaultBearingPlayLimitMm`.
Bearing play values: regex over each maintenance note
`/bearing play[^0-9]*([0-9.]+)\s*mm/gi` (matches "measured at X", "estimated at X",
"within spec (Xmm)", "at X").

**Evidence items** (ids `EV-01`, `EV-02`, … in the order listed; omit items whose inputs
are unavailable, ids stay sequential over what IS emitted). All statistics over **baseline
flights only** (excludes F47) unless said otherwise. Weight formulas are exact.

1. `exceedance` / `vibration_exceedance` — robust baseline: median & MAD of `vibrationG`
   over the first `cfg.baselineWindowFlights` (10) flights; σ_rob = 1.4826·MAD;
   z = (v_anom − median)/σ_rob. weight = min(1, |z|/10).
   Golden: median 0.12850, MAD 0.00450, σ_rob 0.006672, z(F47) = 13.71 (±0.05) → w = 1.
   Value keys: `median, mad, robustSigma, z, vibration, thresholdCurrent, thresholdOriginal`.
   Provenance: telemetry rows of the baseline window + F47 (row 48), plus maintenance
   record MA-009 (threshold source).
2. `trend` / `monotonic_trend_vs_rotor_hours` — OLS `vibrationG ~ cumulativeRotorHours`
   over baseline flights (n=46): slope, intercept, R², t = slope/SE(slope). Emit pattern
   only if slope > 0 and t ≥ cfg.trendMinTStat; weight = min(1, R²).
   Golden: slope 0.024504 (±1e-4), intercept 0.120305 (±1e-4), R² 0.7982 (±1e-3),
   t 13.19 (±0.1), trend RMSE (√(SSres/(n−2))) 0.008393 (±1e-4).
3. `prediction` / `trend_projection_reaches_threshold` — hours at which the trend line
   crosses the current threshold: (thr − intercept)/slope. weight = 0.5 (fixed projection
   discount). Golden: 2.681 rotor hours (±0.01) vs F47 at 2.37.
4. `exceedance` / `acute_departure_from_trend` — F47 residual above the trend line:
   r = v_anom − (slope·hours_anom + intercept); weight = min(1, |r|/(3·trendRMSE)).
   Golden: r 0.0416 (±5e-4), r/RMSE 4.96 → w = 1.
5. `confounder` / `confounder_unexplained_residual` **or** `confounder_explains_anomaly` —
   multivariate OLS (normal equations, Gaussian elimination)
   `vibrationG ~ 1 + windSpeedMs + ambientTempC + rotorRpmAvg + durationMin` over baseline;
   predict F47; residual + RMSE (√(SSres/(n−k)), k=5). If |residual| > 2·RMSE emit
   `confounder_unexplained_residual`, else `confounder_explains_anomaly`.
   weight = min(1, |residual|/(3·RMSE)).
   Golden: R² 0.1402 (±5e-3), RMSE 0.017947 (±5e-4), predicted(F47) 0.1331 (±2e-3),
   residual 0.0869 (±2e-3), residual/RMSE 4.84 → w = 1 → `confounder_unexplained_residual`.
   Include wind-twin in the statement & value: baseline flights with
   |wind − wind_anom| ≤ cfg.windTwinToleranceMs → F23 (wind 11.9, vib 0.148); values
   `twinFlight: 23, twinVibration: 0.148`.
6. `exceedance` / `high_wind_during_anomaly` — wind percentile of the anomalous flight
   among baseline winds (fraction ≤, ties count). Emit only if percentile ≥ 0.9;
   weight = percentile. Golden: 1.000 (11.9 ties fleet max).
7. Onset classification — exactly one of:
   `exceedance` / `gradual_onset_multi_flight` (emitted when trend item #2 fired AND a
   precursor exists: an earlier flight with non-empty `anomalyFlag` or vibration ≥ 90% of
   the original threshold — F38 satisfies both), weight = 0.5 + 0.15·(trend fired) +
   0.15·(precursor exists) → 0.8 here; otherwise `sudden_onset_single_flight`,
   weight 0.7. Provenance: F38 row 39 + F47 row 48.
8. `maintenance_correlation` / `bearing_play_near_limit` — latest play / limit ≥
   cfg.bearingPlayNearLimitRatio. weight = latest/limit. Golden: 0.0035/0.004 = 0.875.
   Provenance recordIds: [MA-010, MA-008] + limit source MA-008.
9. `maintenance_correlation` / `maintenance_wear_progression` — play series strictly
   increasing across ≥ 3 records. weight = min(1, (count−1)/3) → 0.667 (3 records).
   Provenance: [MA-002, MA-008, MA-010]. Values: the series + sols.
10. `maintenance_correlation` / `recent_software_change` — most recent
    `subsystem == 'flight_computer'` record with sol ≤ anomaly sol within
    cfg.recentSoftwareChangeSols before the **anomaly event sol**. Anomaly event sol =
    timeline.currentSol if present (245), else anomalous flight's sol. Δ = 245 − 232 = 13.
    weight = max(0, 1 − Δ/30) = 0.567 (±0.01). Provenance: MA-009.
11. `exceedance` / `exceeds_original_threshold` — v_anom vs ORIGINAL threshold.
    Emit if v_anom > original. weight = min(1, (v_anom/original − 1)/0.2) = 0.5.
    (Meaning: the alert is real even under the pre-patch limit.)
12. `historical_match` (no pattern — display + narrative only, weight informational).
    Score every anomaly-history record EXCEPT unresolved ones (resolution contains
    "PENDING", case-insensitive): +0.4 category match; +0.3 keyword overlap between record
    root_cause and {bearing, lubricant, wear, dust, blade, sensor} (0.1 each, cap 0.3);
    +0.2 progressive-onset language in description (/gradual|progressive|increase/i);
    +0.1 same vehicle class (vehicle contains "MSRH" or "Ingenuity" or "heritage").
    Emit top `cfg.historicalMatchTopK` (3) as separate items, weight = score (cap 1).
    Golden ordering: ANM-013 and ANM-003 in the top 2 (both 1.0); third ANM-007 (0.8) —
    (ANM-007: category vibration ✓, "bearing" + "wear"→? root_cause has "bearing" only
    → +0.4 +0.1 +0.2 ("near alert threshold… transient" — description says "reached
    0.19g, near alert threshold" which does NOT match /gradual|progressive|increase/ —
    re-check at build time; assert only that ANM-013 & ANM-003 are top-2 and scores are
    in [0,1] and descending).
13. Constraint items (kind `constraint`, **no pattern**, weight 0) — emit one each when
    source data present:
    - Inventory: for each part whose description matches /bearing/i with Mars-depot qty 0:
      statement + values {qtyMars, qtyEarth, resupplySol, unitCost, leadTimeWeeks}.
      (MSRH-RA-002: 0, 2, 320, 142000, 52.) Also lubricant cartridges on hand
      (MSRH-GN-001: qtyMars 3).
    - Timeline: effective deadline = windowOpenSol − 60 (curing, per timeline notes) = 320;
      margin = 320 − currentSol = 75 sols; delay cost/sol 285000. Cite file + notes.
      (Parse the "minimum 60 sols" curing figure from timeline.notes via /(\d+)\s*sols?/
      after "minimum"; fallback 60.)
    - Budget: spare_parts remaining 566000 vs upper+lower bearing 280000; schedule_reserve
      500000; testing_verification remaining 205000 vs 85000 campaign. One item per
      relevant line, values from the file.

`computedAt` = ISO timestamp. **Every item** gets full provenance (file name as ingested +
rows/recordIds).

**Tests:** golden numbers above (tolerances stated); pattern set emitted for the MSRH
dataset is exactly: {vibration_exceedance, monotonic_trend_vs_rotor_hours,
trend_projection_reaches_threshold, acute_departure_from_trend,
confounder_unexplained_residual, high_wind_during_anomaly, gradual_onset_multi_flight,
bearing_play_near_limit, maintenance_wear_progression, recent_software_change,
exceeds_original_threshold}; telemetry-only model (strip other datasets) still returns
items 1–7 and no maintenance/constraint items; weights all in [0,1].

---

## §Bayes — owner: bayes agent

**Files owned:** `src/reasoning/bayes/**`, `src/reasoning/library/**` (optional helpers),
`tests/bayes.test.ts`.

**Entry point:** `runBayes(pkg, library, model, cfg): BayesResult`

**Priors** (over the K = 8 non-catch-all hypotheses + catch-all):

1. Usable records: `model.anomalyHistory` where `category === pkg.anomaly.category` AND
   resolution does NOT contain "PENDING" (case-insensitive). Golden: {ANM-001, ANM-003,
   ANM-007, ANM-010, ANM-013}, N = 5; excluded: ANM-015.
2. count(h) = number of usable records whose `rootCause` (lowercased) contains ANY of
   h.priorKeywords (case-insensitive substring). A record may count for multiple
   hypotheses. Golden: bearing_degradation 4 (ANM-003/007/010/013), dust_contamination 1
   (ANM-001), all others 0.
3. Laplace: p(h) = (count + α)/(N + α·K), α = cfg.laplaceAlpha (1.0), K = 8.
4. Reserve: prior(h) = p(h)·(1 − R); prior(unknown_other) = R = cfg.reservedUnknownMass
   (0.05). Golden priors (±1e-4): bearing 0.36538, dust 0.14615, each other 0.07308,
   unknown 0.05. Σ = 1.
5. `priorContributions` per hypothesis: (anomalyId, vehicle, matchedKeyword — the first
   keyword that matched).
6. No anomaly history → uniform: prior(h) = (1−R)/K, catch-all R;
   `priorsMeta.uniformFallback = true`.

**Update (log-linear pooling):**

- score(h) = ln(prior(h)) + Σ over evidence items with a pattern:
  w_i · τ · ln(LR(h, pattern_i)), where LR comes from h.evidenceResponse (absent → 1.0 →
  zero contribution; skip the waterfall bar), τ = cfg.tempering (0.7), w_i = item weight.
- Catch-all: score = ln(prior) exactly (no LRs by construction).
- posterior(h) = softmax over all hypotheses: exp(score)/Σexp(score). Use the max-score
  subtraction trick for numerical stability.
- **Waterfall** per hypothesis (`WaterfallStep[]`): first step kind `prior`
  (delta = ln(prior), cumulative = same); one `evidence` step per NON-ZERO contribution
  (delta = w·τ·ln(LR), evidenceId, label = short pattern name); one `normalization` step
  (delta = −ln(Z') where Z' = Σexp(score − maxScore)·exp(maxScore) — equivalently
  ln(posterior) − score; label "normalization"); final step kind `posterior`
  (delta 0, cumulative = ln(posterior)). Invariant: cumulative of the last step
  = ln(posterior(h)) within 1e-9.
- `logOddsShift` = ln(posterior) − ln(prior). `matchedEvidence` = evidence ids that
  produced a bar. Sort `posteriors` descending.

**Tests:** exact-arithmetic unit test with a synthetic 3-hypothesis library + 2 evidence
items (hand-computed softmax, assert 1e-9); MSRH E2E (run real analytics? NO — construct
the EvidencePackage inline from the golden pattern/weight table in §Analytics to stay
decoupled): assert priors match goldens (1e-4), bearing_degradation ranks #1 with
posterior in [0.55, 0.97], environmental_transient < 0.05, software_threshold_artifact
< 0.10, unknown_other ∈ (0, 0.2), Σ posteriors = 1 (1e-9), waterfall invariant holds for
every hypothesis; uniform fallback when history stripped.

---

## §Decision — owner: decision agent

**Files owned:** `src/decision/**`, `src/triage/**`, `tests/decision.test.ts`,
`tests/triage.test.ts`.

**Entry point:** `runDecision(bayes, model, risk): DecisionAnalysis`

Schedule facts (all `CitedValue`, `asserted: false`, citation = file+field):
- currentSol = timeline.currentSol (245).
- curingSols: parse from timeline.notes (/minimum (\d+) sols/) → 60.
- effectiveDeadlineSol = earthReturnWindow.windowOpenSol − curingSols = 320.
- marginSols = effectiveDeadlineSol − currentSol = 75.
- delayCostPerSolUsd = 285000.

Flight sets from the timeline: criticalFlights = scheduled flights with
priority === 'critical' ordered by sol (F48, F49, F51, F52); fullManifest = all six.
Sample banking: ST-17 banks when F48 AND F49 complete; ST-19 banks when F51 AND F52
complete (dependencies are in the file; hard-code the pairing rule
"retrieval flight + its dependent transport" — a transport's `dependency` field names its
retrieval flight).

Per action a (metadata from risk.actions):

- flightsFlown: ground_until_resupply → []; fly_critical_only_mitigated &
  mitigation_service_then_reassess → criticalFlights; resume_full_manifest → fullManifest.
- delaySols: prepDelaySols for flying actions. For ground_until_resupply:
  (inventory resupply sol for the bearing part 320 − currentSol) + repairAndVerifySols
  (fixed 10, cite "engineering estimate: robotic replacement + 3-flight verification")
  = 85.
- Per hypothesis h: p = risk.lovPerFlight[h][profile].perFlight.
  - LOV(a,h) = 1 − (1−p)^nFlights (grounded: nFlights = 0 → LOV = dormancy: use
    1 − (1−p_grounded)^delaySols? NO — keep simple & documented: grounded LOV =
    p_grounded (single dormancy term)).
  - Samples: sequential survival. Flights in sol order; each flight survives w.p. (1−p);
    vehicle loss aborts the rest. ST-17 counts if flights F48,F49 both flown & survived;
    ST-19 if F51,F52 flown & survived. E[samples] = P(first pair completes)·1 +
    P(all four complete)·1 (compute exactly: for iid p, P(pair1) = (1−p)^2,
    P(both pairs) = (1−p)^4, E = (1−p)^2 + (1−p)^4). resume_full_manifest flies F50
    between the pairs (order by sol: F48,F49,F50,F51,F52,F53) — F50/F53 affect survival
    ordering: E = (1−p)^2 + (1−p)^5 (ST-19 needs F48,F49,F50,F51,F52 to survive… compute
    by walking the actual sol-ordered list and multiplying survival up to each banking
    flight — implement generically, don't hard-code exponents).
  - ground_until_resupply: samples banked AFTER repair (sol 330+) — past effective
    deadline 320 → expectedSamples = 0 for batch 3 (flag in summary: "samples retrieved
    post-window-open deadline; batch-3 shortfall 2").
  - directCost(a) = delaySols·delayCostPerSol + partsCost(a) + serviceCost(a)
    + verificationCost(a) + logisticsCost(a):
    - ground_until_resupply: parts = upper bearing 142000 + dust seal kit 3400;
      logistics 35000 (parse "$35K reservation fee" from budget notes? NO — budget notes
      free text; use inventory? Not there either. Hard-code 35000 with citation
      "budget_contingency.csv transportation_logistics notes: $35K reservation fee");
      verification 85000 (citation "budget testing_verification notes").
    - fly_critical_only_mitigated: service = 1200 (one MSRH-GN-001 cartridge).
    - resume_full_manifest: 0 extra.
    - mitigation_service_then_reassess: service 1200 + diagnostics cost 15000+9000
      (ground spin + lube response test from diagnostics catalog) ≈ 25200... use
      catalog estimated_cost_usd for [ground_spin_spectrum, lubrication_response_test]
      + cartridge 1200.
  - riskAdjusted(a,h) = directCost(a) + LOV(a,h)·vehicleLossPenalty +
    shortfall(a,h)·sampleShortfallPenalty, where shortfall = samplesPendingRetrieval −
    E[samples(a,h)].
- Aggregates: lovProbability = Σ posterior·LOV(a,h); expectedSamples = Σ posterior·E[samples];
  expectedRiskAdjustedCostUsd = Σ posterior·riskAdjusted(a,h).
- marginConsumedSols = delaySols (flying actions) or 85 (grounding: exceeds margin 75 —
  clamp not needed, report raw).
- budgetViolations: check directCost components against remaining budget lines:
  parts vs spare_parts.remaining; delay·costPerSol vs mission_operations.remaining +
  schedule_reserve.remaining (combined, cite both); verification vs testing_verification.
  Violation = component > remaining. (Grounding delay 85·285000 = 24.2M ≫ 810K → violation;
  this is the "grounding blows the budget" storyline beat.)
- recommendedActionId = argmin expectedRiskAdjustedCostUsd.
- assertedInputs: LOV table rows actually used + both penalties + nominal LOV, with their
  citation strings (for the UI "cited risk defaults" panel).
- sensitivityNotes (computed, ≥ 2): (a) bearing-posterior flip point between the top two
  actions — solve linearly: find posterior scale where EC ranks cross by re-evaluating at
  bearing posterior ∈ {0.1,…,0.9} grid (report nearest 0.05 where order flips, or "no flip
  in [0.1,0.9]"); (b) grounded action becomes competitive only if vehicleLossPenalty >
  X — compute X where EC(ground) = EC(best flying action) holding others fixed (linear in
  penalty; report X or "never within 10× asserted value").

**Tests (decision):** with MSRH data + a fixed synthetic posterior vector
(bearing 0.65, blade 0.10, others uniform remainder incl. unknown): assert schedule
goldens (deadline 320, margin 75); ground_until_resupply expectedSamples = 0 &
delay 85 & directCost = 85·285000 + 142000 + 3400 + 35000 + 85000 = 24,490,400;
resume_full_manifest LOV > fly_critical LOV > ground LOV; recommended action ∈
{fly_critical_only_mitigated, mitigation_service_then_reassess}; every asserted input has
a nonempty citation; survival math property: E[samples] decreases as p increases.

## §Triage — owner: decision agent (same agent, second module)

**Entry point:** `runTriage(bayes, model, catalog, library): TriagePlan`

- Discrimination score per diagnostic d: Σ over unordered hypothesis pairs (i,j) with
  different `expectedOutcomes` labels (missing hypothesis in the map → label
  "inconclusive"): posterior_i · posterior_j. (Catch-all participates.)
- Order steps by score descending; ties by durationSols ascending. Take diagnostics whose
  score > 0.005 (drop noise), cap at 6 steps. Golden expectation: `ground_spin_spectrum`
  is step 1 for the MSRH posteriors (it separates the most posterior-weighted pairs).
- Steps are sequential: startSol(1) = timeline.currentSol + 1; startSol(k+1) = startSol(k)
  + duration(k). completionSol = last end. Note when completionSol > effective deadline
  (320) — shouldn't trigger here (plan ≈ 8 sols).
- `separates`: top 5 pairs by posterior product, formatted "hypA vs hypB".
- Gates: for each distinct outcome label of the step's diagnostic:
  supports = hypotheses mapped to that label (excluding "inconclusive");
  refutes = hypotheses mapped to other labels **whose posterior ≥ 0.05**;
  nextAction = catalog gateActions[label].
- `rationale`: template "Separates N hypothesis pairs (top: A vs B); expected outcome under
  leading hypothesis: <label for argmax-posterior hypothesis>".
- **Personnel candidates** per step, from `model.team` (skip if absent): score =
  2·|expertise ∩ requiredExpertise| + certBonus + availabilityWeight, where certBonus = 1
  if any certification contains "Level A" (case-insensitive), 0.5 for "Level B";
  availabilityWeight: availability === 'available' → 1; contains 'partial' → 0.5;
  contains 'limited' → 0.25; contains '24hr' → 0.75; contains 'after Sol (\d+)' → 0.5 if
  that sol ≤ startSol+3? — simpler & documented: 'after Sol N' → 0.5. Expertise matching is
  case-insensitive on tag equality (team tags like `rotor_dynamics` match catalog tags
  exactly; also match `vibration_analysis` vs `vibration_testing` prefix rule: strip after
  last `_`? NO — exact tag equality only; the catalog lists both variants where needed).
  Keep candidates with expertise overlap ≥ 1, top 3 by score, matchRationale =
  "tag1 + tag2; Level A; available".
  Golden: ground_spin_spectrum candidates include Chen, Wei and Rodriguez, Maria (both
  Level A rotor_dynamics + vibration tags, available) ranked above Johansson, Erik
  (vibration_testing + data_acquisition, Level B, partial).
- estimatedCostUsd from catalog. notes: include margin note ("plan consumes X of 75-sol
  margin") and the sensor-inference caveat: "MA-008/MA-010 bearing-play values are
  inferred from vibration data — sensor_artifact would contaminate them; sensor_cross_check
  de-risks this."

**Tests (triage):** with MSRH data + synthetic posteriors as above: step 1 is
ground_spin_spectrum; steps sequential & within margin; gates of step 1 include a
bearing_sideband_signature gate supporting bearing_degradation; Chen & Rodriguez top-2
candidates for step 1; every step has ≥ 1 gate and rationale nonempty; discrimination
scores descending.

---

## §LLM — owner: llm agent

**Files owned:** `src/reasoning/llm/**`, `server/index.ts`, `api/disposition.ts`,
`tests/llm.test.ts`.

**Client (`src/reasoning/llm/index.ts`):**
- `requestNarrative(req: NarrativeRequest): Promise<NarrativeResult>`:
  1. Build a COMPACT payload (never raw files): anomaly summary; evidence items (id, kind,
     pattern, statement, weight — omit provenance rows); posteriors (id, name, prior,
     posterior, top-3 waterfall contributors as text); decision table (per action: name,
     expected cost, LOV, samples, margin); triage steps (id, name, rationale); library
     names+descriptions. Target < 8K tokens.
  2. POST `/api/disposition` `{ payload }` (the browser never sees the key or upstream URL).
  3. Response: `{ content: string }` (raw model text). Extract JSON robustly: strip
     `<think>…</think>` blocks and markdown fences, take substring from first `{` to last
     `}`, JSON.parse, zod-validate against `DispositionNarrative` (schema mirrors
     src/types/narrative.ts; `citedEvidence` ids must exist in req.evidence — filter
     invalid ids, don't fail; hypothesisIds must exist in req.bayes — drop unknown).
  4. On parse/validation failure: ONE retry — re-POST with `{ payload, retry: { previousResponse,
     zodError } }` (server appends a corrective user message echoing the error).
     Status 'llm_retry' on success.
  5. On second failure, network error, non-200, or 15s timeout (AbortController):
     `{ status: 'fallback', narrative: buildFallbackNarrative(req), error }`.
  6. AI-proposed hypotheses missing a non-empty `distinguishingTest` are dropped;
     `droppedProposals` counts them.
- `buildFallbackNarrative(req)`: deterministic templates. executiveSummary composed from:
  anomaly description, top hypothesis name+posterior (percent, 0 decimals), margin +
  recommended action name. hypothesisRationales: per hypothesis ≥ 3% posterior — template
  sentence citing its matchedEvidence ids (real EV ids!). triageStepRationales: copy the
  plan's computed rationale. caveats: fixed list — reconstructed-summary telemetry;
  play-values-inferred-from-vibration coupling; asserted LOV values are engineering
  judgment; add "AI narrative unavailable — deterministic disposition shown" when used as
  fallback.

**Prompt (server-side, `server/prompt.ts` shared by both entrypoints via relative import
— api/ may import from server/ helpers ONLY as plain relative TS imports, keep them
dependency-free):** system prompt: role (flight-anomaly disposition assistant), hard rules
(no arithmetic — use provided numbers verbatim; cite only provided EV ids; propose extra
hypotheses ONLY with a falsifiable distinguishing test; STRICT JSON, schema inlined;
no prose outside JSON). Temperature 0.2, max_tokens 2000.

**Server (`server/index.ts`, Express, ~60 lines):** POST /api/disposition → read env
(CHATHPC_BASE_URL, CHATHPC_API_KEY, CHATHPC_MODEL via dotenv), POST
`${base}/chat/completions` (OpenAI chat format; if base already ends with a version
segment, don't double it — just string-concat `/chat/completions`), messages = [system,
user(payload JSON)] (+ corrective turn when `retry` present), return
`{ content: choices[0].message.content }`. Missing env → 503 `{ error: 'llm_unconfigured' }`
(client treats as fallback). Upstream error → 502 with body text (truncated 500 chars).
CORS: allow all origins (dev tool). 30s upstream timeout.

**Vercel function (`api/disposition.ts`):** same logic, plain Node handler (NO express
import), share prompt/upstream helpers from server/ via relative import.

**Tests:** zod schema accepts a valid narrative & rejects missing fields; JSON extraction
handles think-tags + fences + preamble text; invalid EV ids are filtered; proposals
without distinguishingTest dropped & counted; fallback narrative is schema-valid, cites
only real EV ids, and mentions the top hypothesis; mock fetch (vi.stubGlobal) for the
retry-then-fallback path (no real network).

---

## §Store/UI — owner: ui agent

**Files owned:** `src/state/**`, `src/components/**`, `src/App.tsx` (may adjust), and may
READ everything. Do not modify other modules even if broken — report instead.

**Store:** implement `useAppStore` per the `AppState` interface in `src/state/store.ts`
(you own the file; keep the exported interface & `TabId` names stable — App/main are wired).
Derivation (synchronous, in one action): ingest → if model?.telemetry: analytics → bayes →
decision (needs timeline/inventory/budget — pass model regardless; module handles absence…
decision REQUIRES timeline: if timeline missing set decision = null) → triage (team
optional). Wrap each stage in try/catch; a stage failure sets that artifact + downstream
to null and pushes an error notice (graceful degradation, never a white screen).
`loadDemo()` uses `msrhDemoFiles` from `src/demo/msrhDemo.ts`. `generateNarrative()`
guards on evidence+bayes+decision+triage present.

**Layout:** dark ops-console aesthetic (slate-950 bg, mono accents). Header: TRIAGE
wordmark + subtitle + vehicle/sol strip + narrative status badge. Tab bar (4 tabs).

1. **Mission Home** — drag-drop/browse upload zone (multi-file), "Load MSRH Flight 47
   demo case" primary button, source-file status list (role, profile, record count),
   ingest notices, degradation notices (missing roles), fleet status strip (currentSol,
   helicopter status from timeline, flights flown, last anomaly).
2. **Anomaly Workbench** (centerpiece) — three panes:
   evidence stream (left): filter chips by kind; cards show id, kind badge, pattern tag,
   statement, weight bar, provenance line; click → select.
   hypothesis rail (center): sorted posterior cards — name, prior→posterior, posterior bar,
   expandable waterfall (Recharts horizontal bar waterfall: prior/evidence/normalization
   bars with cumulative line; clicking an evidence bar selects that evidence), matched
   evidence chips, prior contributions ("heritage: ANM-003, ANM-013…"), repair options.
   detail pane (right): selected evidence detail — full statement, value table, provenance
   (file + rows/ids), plus context chart: for trend/exceedance/confounder items render the
   vibration-vs-rotor-hours scatter with trend line, baseline band, F47 highlighted, F38
   annotated; for maintenance items, the bearing-play progression vs sols with the 0.004
   limit line; for constraints, a fact table. Also an "AI narrative" panel: generate
   button, status (llm / retry / fallback badge + error), executive summary, per-hypothesis
   rationales with clickable EV citations (click selects evidence), AI-proposed hypotheses
   with a distinct "AI-PROPOSED — no computed posterior" badge, caveats list.
3. **Decision Analysis** — action comparison table (name, delay sols, direct cost,
   LOV %, expected samples /2, margin consumed, risk-adjusted expected cost; recommended
   row highlighted + badge); per-action expandable: per-hypothesis outcome mini-table +
   mitigations + budget violations (red chips); "cited assumptions" collapsible panel
   listing assertedInputs with citations; schedule facts strip; sensitivity notes;
   stacked-bar or grouped-bar chart of expected cost components per action (Recharts).
4. **Triage Plan** — sol-scaled horizontal timeline of steps (start/duration), step cards:
   name, description, rationale, discrimination score, separates list, gates (outcome →
   supports/refutes chips → next action), candidate picker (radio list of top-3 with match
   rationale; selection is local UI state only), cost; plan notes; margin context bar
   (75-sol margin, plan consumption shaded).

Charts: **invoke the `dataviz` skill before writing chart code** and follow it (palette,
axes, tooltips, dark-mode legibility). Recharts only. Traceability is the soul of the app:
every evidence citation anywhere (waterfall bar, narrative chip, hypothesis card) must
select+scroll the evidence stream to that item.

Empty states: every tab renders a helpful empty state before data load (pointer to Mission
Home / demo button inline). Never crash on partial models (missing timeline → Decision tab
shows "timeline required" empty state; missing team → triage cards show "no personnel data").

No new deps; icons from lucide-react; clsx available. Keep components in
`src/components/` (Dashboard.tsx + one file per tab + shared bits).

---

## Integration facts (all agents)

- Dev: `npm run dev` (vite, port 5173) proxies `/api` → `http://localhost:8787`
  (`npm run dev:server`).
- Node ≥ 20. ESM everywhere. Vitest picks up `tests/**/*.test.ts`.
- The seven canonical files also sit at repo root (challenge source of truth) —
  `examples/msrh/` are the copies the app bundles.
- ChatHPC config comes from env only: `CHATHPC_BASE_URL`, `CHATHPC_API_KEY`,
  `CHATHPC_MODEL`. Never hard-code, never import into browser code, never commit `.env`.
