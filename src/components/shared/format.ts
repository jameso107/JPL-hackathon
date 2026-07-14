/** Number formatting helpers shared across the dashboard. */

/** Compact USD: $24.5M, $285K, $142K, $1.2B. */
export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}$${trimZeros(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}$${trimZeros(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}$${trimZeros(abs / 1e3)}K`;
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
}

/** Full USD with thousands separators: $24,490,400. */
export function fmtUsdFull(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
}

function trimZeros(v: number): string {
  const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

/** Probability → percent string. */
export function fmtPct(p: number, digits = 1): string {
  if (!Number.isFinite(p)) return '—';
  const v = p * 100;
  if (p !== 0 && Math.abs(v) < Math.pow(10, -digits) / 2) {
    return `<${Math.pow(10, -digits).toFixed(digits)}%`;
  }
  return `${v.toFixed(digits)}%`;
}

/** Adaptive-precision number for value tables and labels. */
export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (abs >= 100) return trimTail(v.toFixed(1));
  if (abs >= 1) return trimTail(v.toFixed(2));
  if (abs >= 0.001) return trimTail(v.toFixed(4));
  return v.toPrecision(3);
}

function trimTail(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** Signed adaptive number: +0.42 / −1.31. */
export function fmtSigned(v: number): string {
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v))}`;
}

/** Truncate a string with an ellipsis. */
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
