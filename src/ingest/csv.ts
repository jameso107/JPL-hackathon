/**
 * Hand-rolled CSV parser (no deps) per docs/CONTRACTS.md §Ingest.
 *
 * Handles: quoted fields containing commas / escaped quotes ("") / newlines,
 * CRLF and LF line endings, trailing newline (no phantom empty record), and
 * empty trailing fields (`a,b,` → ['a','b','']).
 *
 * Row numbers are 1-based over physical records including the header, matching
 * what a user sees in an editor (header = row 1, first data row = 2).
 */

export interface CsvRow {
  cells: string[];
  /** 1-based row number in the source file (header = row 1) */
  rowNumber: number;
}

export interface CsvTable {
  header: string[];
  rows: CsvRow[];
}

/** Parse raw CSV text into rows of string cells. Never throws. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      endField();
      i += 1;
      continue;
    }
    if (c === '\r') {
      if (text[i + 1] === '\n') i += 1; // CRLF
      endRow();
      i += 1;
      continue;
    }
    if (c === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // Final record only if there is pending content (trailing newline → nothing pending).
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * Parse CSV text into a header + data rows with 1-based row numbers.
 * Blank physical rows are dropped (but still consume a row number).
 * Returns null when there is no header row at all.
 */
export function parseCsvTable(text: string): CsvTable | null {
  const raw = parseCsvRows(text);
  const nonEmpty: CsvRow[] = [];
  raw.forEach((cells, idx) => {
    const isBlank = cells.length === 1 && cells[0].trim() === '';
    if (!isBlank) nonEmpty.push({ cells, rowNumber: idx + 1 });
  });
  if (nonEmpty.length === 0) return null;
  const headerRow = nonEmpty[0];
  return {
    header: headerRow.cells.map((c) => c.trim()),
    rows: nonEmpty.slice(1),
  };
}

/** Zip a header with a row's cells; short rows yield '' for missing cells. */
export function rowToObject(header: string[], cells: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  header.forEach((h, i) => {
    out[h] = cells[i] ?? '';
  });
  return out;
}
