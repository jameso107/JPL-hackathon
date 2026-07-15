# TRIAGE — Methods Whitepaper

**Telemetry Root-cause Inference And Guided Evaluation**
A step-by-step account of every analytical method behind the Mars Sample Return
Helicopter (MSRH) Flight 47 anomaly disposition.

---

## 0. The governing philosophy

Before any method, one rule shaped all of them:

> **Numbers are computed, never generated. The AI writes prose, never arithmetic.**

Every probability, cost, slope, and threshold in TRIAGE is produced by deterministic
code that a reviewer can re-run and get the identical answer. The large language model
(ChatHPC) is allowed to *narrate* that analysis and to *propose* extra hypotheses — but
it never touches a number, and anything it proposes is visibly flagged and must carry a
falsifiable test or it is discarded.

Three principles follow from that rule and recur in every section below:

1. **Traceability.** Every derived value carries *provenance* — the exact file, row
   numbers, or record IDs it came from. A reviewer can always answer "says who?"
2. **Graceful degradation.** Missing an input file disables the features that need it and
   nothing else. Telemetry alone still yields a trend and a disposition; the full seven
   files yield the complete picture.
3. **Separation of computed vs. asserted.** Some inputs are *measured from the files*
   (delay cost, bearing play, part availability). Others are *engineering-judgment
   assertions* (the probability of losing the vehicle under a given action). The two are
   never blended — asserted values live in a config file, each with a citation, and are
   labeled as assumptions everywhere they appear.

The pipeline is a straight line, each stage consuming the last:

```
files → ingest → analytics → Bayesian inference → decision analysis → triage plan
                     │                                                      │
                     └──────────── evidence package ───────────────────────┘
                                          │
                                          └→ LLM narrative (prose only) → export packet
```

---

## 1. Ingestion — turning seven files into one model

**The problem.** The seven challenge files arrive in mixed formats (CSV, JSON arrays,
one nested JSON object) with column names that are convenient for whoever exported them,
not for our code. We need one clean, typed data model regardless.

**The method — schema-mapping profiles.** Rather than hard-code "column 7 is vibration,"
each file is matched against a *mapping profile* that declares:

- how to recognize the file (filename pattern, then a content signature — the set of
  columns that must be present), and
- how each source column maps to a canonical field (`vibration_amplitude_g → vibrationG`),
  including acceptable aliases (the current `commanding_engineer` field *or* the legacy
  `technician` field both map to the same canonical name).

A hand-rolled CSV parser handles quoted fields, embedded commas, CRLF line endings, and
empty trailing fields (most flights have a blank `anomaly_flag`). Every telemetry row
records its 1-based source row number so that downstream evidence can point back to it.

**Why it matters.** This is what makes TRIAGE *general by configuration*. A brand-new
vehicle with different column names needs a new profile, not new code — and if a file is
completely unrecognized, the UI offers a "map columns" dialog that builds a profile at
runtime and re-ingests. The Phase-3 acceptance test proves this: a telemetry CSV with
foreign headers (`flt_no`, `vib_amp`, `mars_day`…) is dispositioned end-to-end.

**Degradation.** Telemetry is the only required file. Each missing optional file removes
exactly one capability (no maintenance log → no bearing-wear correlation; no timeline →
no delay-cost math), announced as a notice, never a crash.

---

## 2. Analytics — building the Evidence Package

The analytics engine is pure, deterministic TypeScript. It emits an **Evidence Package**:
a list of `EvidenceItem`s, each with a human-readable statement, the raw numbers behind
it, a provenance pointer, a computed *weight* (0–1 significance), and a canonical
*pattern tag* that the Bayesian layer will consume.

The single most important design choice here: **the analytics layer and the hypothesis
layer are decoupled through pattern tags.** Analytics says "I observe a
`monotonic_trend_vs_rotor_hours`"; the hypothesis config says "bearing degradation finds
that pattern 6× more likely than chance." Neither knows the other's internals. New
analyses and new hypotheses compose without editing either side.

The worked MSRH numbers below were each verified independently (a separate Python
re-implementation) before being locked into the test suite as "golden numbers."

### 2.1 Robust baseline exceedance — *how far outside normal is this?*

**Method.** Take the first 10 flights as an early-mission baseline. Compute the **median**
and the **median absolute deviation (MAD)** of vibration — robust statistics that a few
outliers cannot distort, unlike mean and standard deviation. Convert MAD to a
normal-consistent sigma (× 1.4826), then express the anomalous flight as a robust
z-score:

```
robust_sigma = 1.4826 × MAD
z = (v_anomaly − median) / robust_sigma
```

**MSRH result.** median = 0.1285 g, MAD = 0.0045 g, robust_sigma = 0.00667 g,
**z(F47) = 13.7**. Flight 47 sits nearly *fourteen* robust standard deviations above the
early-mission norm. Weight = min(1, |z|/10) = 1.0 (saturated).

**Why robust statistics.** The mission includes a known minor precursor (Flight 38). A
mean/σ baseline would be inflated by such points and *understate* how anomalous F47 is;
median/MAD ignores them.

### 2.2 Degradation trend — *is this getting worse over time?*

**Method.** Ordinary least-squares regression of vibration against **cumulative rotor
hours** across the 46 baseline flights (F47 excluded so the anomaly can't drag its own
trend line). We report slope, intercept, R², the residual standard error (RMSE), and the
**t-statistic of the slope** (slope ÷ its standard error) as a significance gate.

```
slope = 0.0245 g per rotor-hour      R² = 0.80      t = 13.2      RMSE = 0.0084 g
```

The pattern fires only if the slope is positive *and* t ≥ 3. Weight = R² = 0.80.

**Interpretation.** Vibration climbs monotonically and tightly (R² = 0.80) with usage —
the fingerprint of wear, not a one-off event.

### 2.3 Threshold-crossing projection — *when would it have alarmed anyway?*

**Method.** Solve the trend line for the sol/hours at which it reaches the current alert
threshold: `hours = (threshold − intercept) / slope`.

**MSRH result.** The trend reaches 0.186 g at **2.68 cumulative rotor hours**; F47
occurred at 2.37 hours. The exceedance arrived *ahead of* the gradual-wear projection —
consistent with wear that is accelerating near end of life. Weight = 0.5 (a fixed
discount, because a projection is an extrapolation, not a measurement).

### 2.4 Acute departure from trend — *is it worse than even the trend predicts?*

**Method.** The residual of F47 against the baseline trend line, normalized by the
trend's RMSE:

```
residual = v_F47 − (slope × hours_F47 + intercept) = 0.042 g
residual / RMSE = 4.96
```

**Interpretation.** F47 is ~5 RMSE *above its own wear trend* — the vibration isn't just
high, it's a step change beyond where steady wear would put it. This is the evidence that
keeps the disposition honest: it slightly supports an acute event (impact) layered on top
of the wear story, which is why "foreign-object debris" never quite falls to zero.

### 2.5 Confounder regression — *could the environment explain it instead?*

This is the analytical centerpiece — the method that rules out the easy excuse ("it was
just a windy day").

**Method.** A **multivariate OLS** regresses vibration against four environmental /
operational covariates — wind speed, ambient temperature, rotor RPM, and flight duration
— over the baseline flights. The regression is solved the textbook way: form the normal
equations (XᵀX)β = Xᵀy and solve by Gaussian elimination with partial pivoting. We then
predict what vibration F47 *should* have shown given its conditions, and measure the
leftover:

```
model R² = 0.14          (environment explains only 14% of vibration variance)
predicted vibration(F47) = 0.133 g
actual vibration(F47)    = 0.220 g
unexplained residual     = 0.087 g   ( = 4.8 × the model's RMSE )
```

Because the residual exceeds 2× RMSE, the engine emits `confounder_unexplained_residual`
(if it had been *within* the noise, it would instead emit `confounder_explains_anomaly`
and the environmental-transient hypothesis would surge). Weight saturates at 1.0.

**The clinching detail — the "wind twin."** The engine searches for a baseline flight
that flew in nearly identical wind to F47 and reports it inside the same evidence item.
It finds **Flight 23: 11.9 m/s wind (identical to F47) — yet only 0.148 g vibration.** A
single, concrete, traceable counterexample that a reviewer can verify by eye: same wind,
two-thirds the vibration. The weather did not do this.

### 2.6 Wind percentile & 2.7 onset classification

Two supporting characterizations:

- **Wind percentile.** F47's wind sits at the **100th percentile** of the fleet (tied for
  the windiest flight ever flown). Emitted as mild support for any wind-related
  hypothesis — deliberately kept as weak evidence so it informs without dominating.
- **Onset classification.** Exactly one of two mutually exclusive tags fires. Because a
  real precursor exists (Flight 38 carried a minor-vibration note) and the trend is
  significant, the engine emits `gradual_onset_multi_flight` (weight 0.8) rather than
  `sudden_onset_single_flight`. Gradual onset is a bearing signature; sudden onset would
  favor impact.

### 2.8–2.11 Maintenance correlation — *does the hardware history line up?*

**Method.** Regexes extract structured facts from free-text maintenance notes: the
alert-threshold change (0.20 → 0.186 g in patch MA-009), the bearing-play spec limit
(0.004 mm), and the **series of bearing-play measurements** over time. From these:

- **Bearing play near limit** — latest reading ÷ spec limit = **0.0035 / 0.004 = 0.875**
  (87.5% of the way to the limit). Weight = the ratio itself.
- **Wear progression** — the play series is strictly increasing across three services:
  **0.002 → 0.003 → 0.0035 mm** (MA-002 → MA-008 → MA-010). Monotone growth is the
  physical trend the vibration trend mirrors.
- **Recent software change** — MA-009 lowered the alert threshold just 13 sols before the
  anomaly. Weight decays with recency. This *slightly* raises "software artifact" — the
  engine actively looks for reasons it might be wrong.
- **Exceeds original threshold** — F47's 0.22 g exceeds even the *pre-patch* 0.20 g limit.
  This is the counter to the software-artifact hypothesis: the alarm is real under the old
  threshold too, so the lowered threshold didn't manufacture it.

**Why this matters.** Physical bearing-play measurements from the maintenance robot are an
*independent* data stream from the vibration sensor. When two independent streams tell the
same monotonic story, the wear hypothesis gets much stronger — and the engine records the
caveat that the later play readings are themselves *inferred from* vibration, so a sensor
fault would contaminate both (which is why a sensor cross-check appears in the triage
plan).

### 2.12 Historical signature matching — *have we seen this before?*

**Method.** Every resolved record in the anomaly history (including heritage vehicles —
Ingenuity, ground-test units) is scored against the current event on four axes: category
match (+0.4), keyword overlap in the root cause (+0.1 each, capped 0.3), progressive-onset
language (+0.2), and same vehicle class (+0.1). The top matches become evidence.

**MSRH result.** The top matches are the heritage bearing-degradation records
(ANM-013's predictive wear model, ANM-003's progressive Ingenuity bearing failure) — the
same physics, on sister aircraft. This is how institutional memory enters the analysis
quantitatively rather than anecdotally.

### 2.13 Constraint scanning — *what does the world let us do?*

Not every "evidence" item is about the cause; some are about the **consequences**. The
engine scans inventory, timeline, and budget for hard constraints and emits them as
zero-weight items (they inform the decision module, not the diagnosis):

- **Inventory:** the upper rotor bearing (MSRH-RA-002) has **0 units at the Mars depot**;
  next resupply is Sol 320.
- **Timeline:** the effective deadline is Sol 320 (launch window opens Sol 380, minus 60
  sols of mandatory sample curing), leaving a **75-sol margin** from the current Sol 245.
- **Budget:** remaining funds by category, against the cost of each candidate repair.

The tension the whole mission turns on falls straight out of these: *the part you need to
fix it for good arrives exactly when your schedule margin runs out.*

---

## 3. Bayesian inference — from evidence to ranked causes

Now we convert a pile of evidence into a probability for each candidate cause. The method
is a transparent, auditable Bayesian update — chosen specifically because a review board
must be able to see *why* a number is what it is.

### 3.1 The hypothesis library

Nine candidate causes live in a config file (bearing degradation, blade erosion, FOD
impact, dust contamination, sensor artifact, structural loosening, environmental
transient, software-threshold artifact, and a catch-all "unknown/other"). Each declares:

- **prior keywords** — matched against heritage root causes to seed the prior, and
- **evidence responses** — for each pattern tag, a **likelihood ratio (LR)** with a
  citation. LR > 1 means "this pattern is more expected if this hypothesis is true"; LR < 1
  means the pattern argues *against* it.

Example: bearing degradation declares LR = 8.0 for `bearing_play_near_limit` (cited to the
MA-008/MA-010 measurements) and LR = 0.3 for `sudden_onset_single_flight` (wear rarely
steps in one flight). Environmental transient declares LR = 0.15 for
`confounder_unexplained_residual` — the confounder evidence actively *destroys* it.

### 3.2 Priors from heritage data

**Method.** Among resolved, same-category anomaly records, count how many match each
hypothesis's keywords, then apply **Laplace (add-one) smoothing** so no cause starts at
exactly zero:

```
prior(h) = (count(h) + α) / (N + α·K) × (1 − R)
```

with α = 1 (smoothing), K = 8 (non-catch-all hypotheses), N = usable records, and R = 0.05
reserved permanently for "unknown/other" so the model can never be 100% certain it has
enumerated every cause.

**MSRH result.** Of the vibration records, four match bearing/lubricant keywords
(ANM-003, 007, 010, 013) and one matches dust (ANM-001); the current event (ANM-015) is
excluded because it's still "PENDING." So:

```
prior(bearing)  = (4+1)/(5+8) × 0.95 = 0.365   (36.5%)
prior(dust)     = (1+1)/(5+8) × 0.95 = 0.146   (14.6%)
prior(each other) = (0+1)/(5+8) × 0.95 = 0.073  (7.3%)
prior(unknown)  = 0.05
```

Bearing degradation leads *before any of this flight's evidence is considered*, purely on
fleet history. If no anomaly history is loaded at all, the priors fall back to uniform and
the UI says so.

### 3.3 The update — log-linear pooling with tempering

**Method.** Work in log-odds so evidence contributions add instead of multiply. Each
hypothesis's score is its log-prior plus the sum, over every matched evidence pattern, of
(evidence weight × tempering × ln LR):

```
score(h) = ln prior(h) + Σᵢ  wᵢ · τ · ln LR(h, patternᵢ)
```

- **wᵢ** is the analytics-computed weight (strong evidence counts more).
- **τ = 0.7** is a global **tempering factor** — a deliberate brake. Multiple evidence
  items are not fully independent (the trend, the acute departure, and the exceedance all
  read the same vibration channel), so naïvely multiplying their likelihood ratios would
  overstate confidence. Tempering discounts every contribution to hedge against that
  double-counting. It is the humility knob.

The catch-all hypothesis receives its prior and no evidence updates by construction.

### 3.4 Normalization and the result

Scores are converted to probabilities with a numerically stable **softmax** (subtract the
max score before exponentiating). For MSRH:

| Cause | Prior | Posterior |
|---|---|---|
| **Progressive rotor bearing degradation** | 36.5% | **94.7%** |
| Dust ingestion / hub contamination | 14.6% | 1.6% |
| Rotor blade leading-edge erosion | 7.3% | 1.5% |
| Structural fastener loosening | 7.3% | 1.0% |
| Foreign-object debris impact | 7.3% | 0.4% |
| Vibration-sensor artifact | 7.3% | 0.3% |
| Unknown / other | 5.0% | 0.3% |
| Software / threshold artifact | 7.3% | 0.2% |
| Environmental transient | 7.3% | 0.1% |

Environmental transient is crushed from 7.3% to 0.1% almost entirely by the confounder
evidence — exactly as intended.

### 3.5 The waterfall — the anti-black-box artifact

For each hypothesis the engine emits a **log-odds waterfall**: a bar for the prior, one
bar per evidence contribution (sized by w·τ·ln LR, colored blue for support / red for
against), a normalization bar, and the final posterior. The invariant is enforced in
tests: the cumulative of the last bar equals ln(posterior) to within 1e-9. Every bar links
back to its evidence item and its source rows. A skeptical reviewer can watch the belief
move one piece of evidence at a time and audit each step to the underlying data — the
whole reason we chose an explicit Bayesian update over a black-box classifier.

---

## 4. Decision & mission-risk analysis — from cause to action

Knowing the cause isn't the deliverable; knowing *what to do* is. This module builds an
explicit **expected-cost decision tree**: every candidate **action** evaluated against
every possible **world state** (each hypothesis being the true cause), weighted by the
posterior probability of that world.

### 4.1 The four actions

Ground until the Sol-320 resupply and replace the bearing; fly critical-only flights with
mitigations; resume the full manifest; or run an in-situ service, diagnose, then fly
critical-only. Each action's flight list is resolved from the mission timeline.

### 4.2 Loss-of-vehicle probability — the asserted layer, cited

For each (action, hypothesis) pair we need the per-flight probability of losing the
vehicle. **This cannot be computed from the files** — it is engineering judgment. So it
lives in a config file as a fixed, **cited** assertion (e.g., bearing degradation under
nominal flight: 4% per flight, cited to the ANM-010 seizure precedent; under a post-service
mitigated profile: 0.8%). The UI labels every one of these as an assumption. Over a
multi-flight action:

```
P(loss over action) = 1 − (1 − p_perflight) ^ (number of flights)
```

### 4.3 Sample-banking survival math — *how many samples do we still get home?*

**Method.** Flights are flown in sol order; each survives with probability (1 − p); a loss
aborts everything after it. A sample tube is "banked" only if the vehicle survives through
its retrieval flight *and* its dependent transport flight. Expected samples is a survival
walk — no hard-coded exponents, so it works for any manifest:

```
walk flights in order; survival ×= (1 − p) at each;
  add `survival` to the expected count at each banking flight.
```

For the grounding action, the bearing arrives and the repair completes *after* the
effective deadline, so batch-3 samples are forfeit: expected samples = 0.

### 4.4 Risk-adjusted expected cost — the ranking metric

Each (action, hypothesis) outcome is dollarized:

```
risk-adjusted cost = direct cost
                   + P(loss) × vehicle-loss penalty          (asserted, cited)
                   + samples short × sample-shortfall penalty (asserted, cited)
```

Direct cost is fully computed from the files: delay sols × $285K/sol, plus parts,
services, verification campaign, and the resupply slot fee — each line cited to its source.
The action's headline number is the posterior-weighted average across all nine world
states:

```
expected cost(action) = Σ_h posterior(h) × risk-adjusted cost(action, h)
```

**MSRH result (posterior-weighted):**

| Action | Expected cost | P(loss) | Samples |
|---|---|---|---|
| **In-situ service, diagnose, then fly critical-only** | **$32.8M** | 3.1% | 1.95 / 2 |
| Fly critical-only with mitigations | $57.2M | 5.7% | 1.93 / 2 |
| Resume full manifest | $197M | 21% | 1.80 / 2 |
| Ground until Sol 320 resupply | $325M | 0.05% | **0 / 2** |

The counterintuitive winner is the point of the whole exercise: **the safest-for-the-vehicle
option (grounding, 0.05% loss risk) is the most expensive overall**, because forfeiting
both irreplaceable samples and burning 85 sols of delay dwarfs the vehicle risk it avoids.
The recommended action services and diagnoses first, then flies only the critical
sample-retrieval flights under reduced load.

### 4.5 Budget violations & sensitivity

- **Budget checks** flag any action whose computed cost exceeds the remaining funds in the
  relevant budget line (grounding's 85-sol delay blows past the combined operations +
  schedule reserve — surfaced as a red flag).
- **Sensitivity analysis is computed, not asserted.** The engine re-runs the entire
  expected-cost tree across a grid of bearing-degradation posteriors (0.10 → 0.90) and
  reports where, if anywhere, the ranking flips. For MSRH it reports that the
  recommendation is **robust across the whole range** — and separately computes that
  grounding would only become competitive if the vehicle-loss penalty were ~14× its
  asserted value. This tells a reviewer exactly how much the conclusion depends on the
  soft assumptions.

---

## 5. Triage plan — the diagnosis sequence

**The problem.** Several causes still have non-trivial probability. Which test do you run
*first*? The one that best tells the leading suspects apart.

**Method — discrimination scoring.** Each candidate diagnostic (ground rotor-spin
spectrum, bearing-play re-measurement, blade imaging, sensor cross-check, …) declares its
*expected outcome per hypothesis* in a config catalog. Two hypotheses are "separated" by a
test if they predict different outcomes. The test's value is the posterior-weighted sum
over every separated pair:

```
score(test) = Σ over pairs (i,j) with different expected outcomes  posterior_i × posterior_j
```

Weighting by the product of posteriors means a test that distinguishes two *likely*
suspects scores higher than one that splits two long-shots. Tests are ordered by score,
scheduled sequentially in sols, and capped.

**MSRH result.** The **ground rotor-spin spectral run goes first** — it separates the
bearing signature (sub-harmonic sidebands) from a blade signature (once-per-rev) from a
clean spectrum (sensor artifact), which is the highest-value cut given the posteriors. The
full plan completes around Sol 254, comfortably inside the 75-sol margin.

**Decision gates.** Each step declares, per outcome, which hypotheses it would support and
which it would refute (only refuting causes above a 5% posterior, to avoid noise), plus the
follow-on action. This turns the plan into an if/then flowchart, not just a to-do list.

**Personnel matching.** Candidates are scored from the engineering-team file:

```
score = (2 × |matched expertise tags| + certification bonus) × availability weight
```

The multiplication by availability is deliberate — a perfectly-qualified engineer who
isn't available shouldn't top the list. The tool *ranks and explains*; a human picks. For
the spin test, Chen and Rodriguez (rotor dynamics, Level A, available) lead.

---

## 6. The LLM narrative layer — prose, strictly bounded

**Method.** The computed disposition (evidence, posteriors, decision table, triage plan)
is compacted into a small payload and sent to ChatHPC through a key-holding proxy. The
model is instructed — and structurally constrained — to do exactly one job: narrate.

- It **never sees raw files** and is told, in the system prompt, to do no arithmetic and to
  repeat provided numbers verbatim.
- Its response must be **strict JSON** validated against a schema (zod). Citations must
  reference real evidence IDs; invalid IDs are filtered out.
- It may propose *additional* hypotheses **only** with a concrete distinguishing test;
  proposals without one are dropped and counted. Proposals never receive a computed
  posterior and render with a distinct "AI-proposed" badge.
- On any failure — bad JSON, schema violation (one corrective retry is allowed), network
  error, or timeout — the app falls back to a **deterministic template narrative** built
  from the same computed values. The AI is an enhancement, never a dependency.

This is the philosophy from §0 made concrete: the LLM is powerful where language is the
point (explaining, summarizing) and fully fenced out of where numbers are the point.

---

## 7. Flight reconstruction — the 3D Flight Deck

**The problem.** The telemetry is per-flight *summaries* (duration, max altitude, average
RPM, one vibration figure), not time series. We can't show recorded flight paths because
they don't exist in the data.

**Method — honest reconstruction.** Each flight is rebuilt deterministically (seeded by
flight number, so it's identical every run) from its summary plus its objective: a
climb/cruise/descent altitude profile, an objective-clustered ground track, and channel
curves. Anomaly flags *shape* the curves — F47's vibration ramps to its recorded 0.22 g
across the final 30 seconds, matching the alert. Path color encodes vibration
(green → amber → red), so the fleet-wide wear drift is directly visible flight by flight.

**The ethic.** Every reconstructed view is permanently badged **"RECONSTRUCTED FROM SUMMARY
TELEMETRY."** The recorded values are the anchors; the curves between them are labeled
inference. We never dress up synthesis as measurement.

---

## 8. Communicating the analysis — the disposition UI

A correct analysis that a reviewer can't digest has failed. The interface applies
established information-design principles so the conclusion is graspable in seconds while
every derivation stays one click away:

- **BLUF / overview-first** (Shneiderman): a Briefing screen leads with the verdict — most
  likely cause, recommended action, schedule cushion — before any detail.
- **Progressive disclosure** (Nielsen Norman): the log-odds waterfalls, per-world cost
  tables, and provenance strings collapse by default and expand on demand; experts lose
  nothing, newcomers aren't buried.
- **Graphical encoding** (Tufte, Cleveland–McGill): rankings and comparisons are charts
  (posterior bars with prior ticks, a log-scale cost dot-plot, a samples-vs-risk scatter),
  because position and length are read faster and more accurately than numbers in a table.
- **Plain-language pairing:** every jargon term keeps its precise label but gains a
  plain-English partner ("confidence · posterior," "chance of losing the helicopter · P(LOV)").
- **Traceability as the drill-down:** clicking any evidence citation anywhere jumps to that
  evidence card and its source rows — the same "says who?" guarantee, made interactive.

---

## 9. How we know it's right — verification methodology

The credibility of a numbers-first tool *is* its verification:

1. **Golden-number tests.** Every statistic in §2–§4 was re-derived in an independent
   Python implementation, and those values are asserted in the Vitest suite to stated
   tolerances. If the TypeScript and the independent computation ever disagree, the build
   fails. (142 tests, including an end-to-end run over the real demo files.)
2. **Invariant tests.** Structural truths are checked directly — e.g., the waterfall's
   final bar must equal ln(posterior) to 1e-9; posteriors must sum to 1; expected samples
   must fall monotonically as loss probability rises.
3. **Adversarial framing in the analysis itself.** The engine actively emits evidence
   *against* the leading hypothesis (the recent software change, the acute departure that
   hints at impact), and tempering (§3.3) is a built-in brake on overconfidence. The tool
   is designed to be able to talk itself out of its own conclusion when the data warrants.
4. **Separation of concerns as a safety property.** Because asserted values are quarantined
   in config with citations and the LLM is fenced from arithmetic, the two most common
   failure modes of "AI analysis" — smuggled assumptions and hallucinated numbers — are
   structurally prevented, not just discouraged.

---

## Appendix — the MSRH Flight 47 disposition in one paragraph

Flight 47's vibration hit 0.22 g, ~14 robust sigma above the early-mission baseline and
~5 RMSE above its own 46-flight wear trend (slope 0.0245 g/hr, R² 0.80). Environment does
not explain it: a wind/temperature/RPM/duration regression leaves an 0.087 g residual
(4.8× its noise), and Flight 23 flew identical 11.9 m/s wind at only 0.148 g. Independent
maintenance data agrees — bearing play grew 0.002 → 0.003 → 0.0035 mm, now 87.5% of its
limit — and heritage fleet records make bearing/lubricant wear the dominant prior (36.5%).
The Bayesian update, tempered against double-counting, puts **progressive rotor bearing
degradation at 94.7%**. The cheapest defensible action is to **service and diagnose in
situ, then fly only the critical sample-retrieval flights** ($32.8M expected vs. $325M to
ground until resupply, which would forfeit both samples) — a recommendation that holds
across the full plausible range of the bearing posterior. Confirm it by running a **ground
rotor-spin spectral test first**, inside a 75-sol schedule margin.

---

*Generated for the JPL hackathon — Challenge 2, Incident Response for the Mars Sample
Return Helicopter. TRIAGE advises; humans decide.*
