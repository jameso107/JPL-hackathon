/**
 * STUB — implemented by the ingest agent. See docs/CONTRACTS.md §Ingest.
 *
 * Parses raw files (CSV/JSON), matches them against schema-mapping profiles
 * (config/schema_mappings), builds the canonical MissionModel, and reports
 * notices + degradation (missing roles). Telemetry is the only required role.
 */
import type { IngestResult, RawFile } from '../types';

export function ingestFiles(_files: RawFile[]): IngestResult {
  throw new Error('not implemented: ingestFiles');
}
