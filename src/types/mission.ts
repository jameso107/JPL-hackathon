/** Canonical mission data model. Built by src/ingest from raw files. */

export interface FlightRecord {
  flightNumber: number;
  sol: number;
  dateUtc: string;
  durationMin: number;
  cumulativeRotorHours: number;
  rotorRpmAvg: number;
  /** vibration amplitude, g */
  vibrationG: number;
  motorTempC: number;
  ambientTempC: number;
  batteryVStart: number;
  batteryVEnd: number;
  windSpeedMs: number;
  maxAltitudeM: number;
  objective: string;
  /** raw anomaly flag from telemetry, e.g. "VIBRATION_EXCEEDANCE" | "MINOR_VIBRATION_NOTE" */
  anomalyFlag?: string;
  /** 1-based row number in the source CSV (header = row 1) for provenance */
  sourceRow: number;
}

export type ExecutionMethod =
  | 'autonomous'
  | 'robotic_arm_commanded'
  | 'software_uplink'
  | 'remote_imaging_inspection'
  | 'telemetry_review'
  | 'unknown';

export interface MaintenanceRecord {
  actionId: string;
  sol: number;
  dateUtc: string;
  action: string;
  subsystem: string;
  /** Earth-based engineer who designed/commanded the procedure.
   *  Maps from `commanding_engineer` (current schema) or legacy `technician`. */
  commandingEngineer: string;
  executionMethod: ExecutionMethod;
  notes: string;
  durationHours: number;
}

export interface AnomalyRecord {
  anomalyId: string;
  vehicle: string;
  sol: number;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical' | string;
  description: string;
  rootCause: string;
  resolution: string;
  downtimeSols: number;
  relatedMaintenance: string;
}

export interface PartRecord {
  partNumber: string;
  description: string;
  quantityMarsDepot: number;
  quantityEarthStaging: number;
  nextResupplySol: number;
  unitCostUsd: number;
  leadTimeWeeksFromEarth: number;
  notes: string;
}

export interface ScheduledFlight {
  flightId: string;
  sol: number;
  objective: string;
  targetSite: string;
  priority: 'critical' | 'high' | 'medium' | 'low' | string;
  dependency: string;
  notes: string;
  estimatedDurationMin: number;
  status: string;
}

export interface EarthReturnWindow {
  windowOpenSol: number;
  windowCloseSol: number;
  samplesRequired: number;
  samplesCached: number;
  samplesPendingRetrieval: number;
  pendingSampleFlights: string[];
}

export interface MissionTimeline {
  currentSol: number;
  helicopterStatus: string;
  scheduledFlights: ScheduledFlight[];
  earthReturnWindow: EarthReturnWindow;
  delayCostPerSolUsd: number;
  notes: string;
}

export interface EngineerRecord {
  name: string;
  role: string;
  expertise: string[];
  certifications: string[];
  currentAssignment: string;
  shift: string;
  timezone: string;
  /** free text, e.g. "available", "partial — …", "limited — …", "available after Sol 250" */
  availability: string;
  yearsExperience: number;
}

export interface BudgetLine {
  category: string;
  allocatedUsd: number;
  spentUsd: number;
  remainingUsd: number;
  notes: string;
}

export interface SourceFileInfo {
  /** canonical role this file was mapped to */
  role: DatasetRole;
  fileName: string;
  /** id of the schema-mapping profile that matched */
  profileId: string;
  recordCount: number;
}

export type DatasetRole =
  | 'telemetry'
  | 'maintenance'
  | 'anomaly_history'
  | 'inventory'
  | 'timeline'
  | 'team'
  | 'budget';

export interface MissionModel {
  telemetry: FlightRecord[];
  maintenance?: MaintenanceRecord[];
  /** includes heritage vehicles — feeds Bayesian priors */
  anomalyHistory?: AnomalyRecord[];
  inventory?: PartRecord[];
  timeline?: MissionTimeline;
  team?: EngineerRecord[];
  budget?: BudgetLine[];
  meta: {
    vehicle: string;
    currentSol?: number;
    sources: SourceFileInfo[];
  };
}

/** A raw uploaded/bundled file, pre-parse. */
export interface RawFile {
  name: string;
  text: string;
}

export interface IngestNotice {
  level: 'info' | 'warning' | 'error';
  message: string;
  fileName?: string;
}

export interface IngestResult {
  model: MissionModel | null;
  notices: IngestNotice[];
  /** file names that matched no schema-mapping profile */
  unrecognized: string[];
  /** dataset roles that are absent → degraded capabilities (see degradation matrix) */
  missingRoles: DatasetRole[];
}
