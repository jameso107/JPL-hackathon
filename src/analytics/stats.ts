/**
 * Deterministic statistics helpers for the analytics engine.
 * Pure functions, no external deps: robust location/scale (median/MAD),
 * simple OLS with inference stats, and multivariate OLS solved via
 * normal equations + Gaussian elimination (partial pivoting).
 */

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median absolute deviation about `center` (defaults to the sample median). */
export function mad(xs: number[], center?: number): number {
  if (xs.length === 0) return NaN;
  const c = center ?? median(xs);
  return median(xs.map((v) => Math.abs(v - c)));
}

/** Consistency constant: robust sigma = MAD_TO_SIGMA * MAD (normal-consistent). */
export const MAD_TO_SIGMA = 1.4826;

export interface SimpleOlsResult {
  slope: number;
  intercept: number;
  /** coefficient of determination */
  r2: number;
  /** t-statistic of the slope: slope / SE(slope) */
  tStat: number;
  /** residual standard error: sqrt(SSres / (n - 2)) */
  rmse: number;
  n: number;
  predict(x: number): number;
}

/** Ordinary least squares y ~ a + b*x. Returns null when underdetermined. */
export function olsSimple(x: number[], y: number[]): SimpleOlsResult | null {
  const n = x.length;
  if (n < 3 || y.length !== n) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2;
    sxy += (x[i] - mx) * (y[i] - my);
    syy += (y[i] - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let ssRes = 0;
  for (let i = 0; i < n; i++) ssRes += (y[i] - (slope * x[i] + intercept)) ** 2;
  const r2 = syy === 0 ? 0 : 1 - ssRes / syy;
  const rmse = Math.sqrt(ssRes / (n - 2));
  const seSlope = rmse / Math.sqrt(sxx);
  const tStat = seSlope === 0 ? 0 : slope / seSlope;
  return { slope, intercept, r2, tStat, rmse, n, predict: (xv) => slope * xv + intercept };
}

/**
 * Solve A·x = b via Gauss-Jordan elimination with partial pivoting.
 * Returns null when the system is (numerically) singular.
 */
export function solveLinearSystem(a: number[][], b: number[]): number[] | null {
  const k = b.length;
  // augmented copy
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < k; col++) {
    // partial pivot
    let pivot = col;
    for (let r = col + 1; r < k; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    if (pivot !== col) [m[col], m[pivot]] = [m[pivot], m[col]];
    // eliminate all other rows
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      if (f === 0) continue;
      for (let c = col; c <= k; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[k] / row[i]);
}

export interface MultiOlsResult {
  /** coefficients, in the column order of the design matrix */
  beta: number[];
  r2: number;
  /** residual standard error: sqrt(SSres / (n - k)) */
  rmse: number;
  n: number;
  k: number;
  predict(row: number[]): number;
}

/**
 * Multivariate OLS y ~ X·beta via the normal equations (XᵀX)beta = Xᵀy,
 * solved by Gaussian elimination. Rows of `X` must include the intercept
 * column explicitly (a leading 1). Returns null when underdetermined/singular.
 */
export function olsMulti(X: number[][], y: number[]): MultiOlsResult | null {
  const n = X.length;
  if (n === 0 || y.length !== n) return null;
  const k = X[0].length;
  if (n <= k) return null;
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      xty[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) xtx[a][b] += X[i][a] * X[i][b];
    }
  }
  const beta = solveLinearSystem(xtx, xty);
  if (!beta) return null;
  const predict = (row: number[]) => row.reduce((s, v, j) => s + v * beta[j], 0);
  const my = y.reduce((a, b) => a + b, 0) / n;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssRes += (y[i] - predict(X[i])) ** 2;
    ssTot += (y[i] - my) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const rmse = Math.sqrt(ssRes / (n - k));
  return { beta, r2, rmse, n, k, predict };
}

/** Fraction of `values` ≤ `v` (ties count). */
export function percentileOf(values: number[], v: number): number {
  if (values.length === 0) return NaN;
  return values.filter((x) => x <= v).length / values.length;
}

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return v > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, v));
}
