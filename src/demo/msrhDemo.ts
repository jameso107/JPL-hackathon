/**
 * Bundled MSRH Flight 47 demo case — the seven challenge files, imported raw at
 * build time so "Load demo" works offline with zero fetches.
 */
import type { RawFile } from '../types';

import telemetry from '../../examples/msrh/telemetry_flights.csv?raw';
import maintenance from '../../examples/msrh/maintenance_log.json?raw';
import anomalyHistory from '../../examples/msrh/anomaly_history.json?raw';
import inventory from '../../examples/msrh/parts_inventory.csv?raw';
import timeline from '../../examples/msrh/mission_timeline.json?raw';
import team from '../../examples/msrh/engineering_team.json?raw';
import budget from '../../examples/msrh/budget_contingency.csv?raw';

export const msrhDemoFiles: RawFile[] = [
  { name: 'telemetry_flights.csv', text: telemetry },
  { name: 'maintenance_log.json', text: maintenance },
  { name: 'anomaly_history.json', text: anomalyHistory },
  { name: 'parts_inventory.csv', text: inventory },
  { name: 'mission_timeline.json', text: timeline },
  { name: 'engineering_team.json', text: team },
  { name: 'budget_contingency.csv', text: budget },
];
