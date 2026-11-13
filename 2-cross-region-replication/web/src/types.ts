// Mirrors replication/functions/api/index.mjs. Everything from the network may be partial.

export interface Place {
  id: string;
  city: string;
  lat: number;
  lon: number;
}
export interface Replica extends Place {
  bucket: string;
  kmFromSource: number;
  optIn?: boolean;
}
export interface Bureau extends Place {
  /** serving replica region (nearest by great-circle distance) */
  region: string;
  km: number;
}
export interface Rule {
  id: string;
  status: "Enabled" | "Disabled";
  priority: number;
  filter: string;
  region?: string;
  storageClass: string;
  rtc: boolean;
  deleteMarkers: boolean;
}
export interface Config {
  source: Place & { bucket: string };
  replicas: Replica[];
  bureaus: Bureau[];
  storageClasses: { masters: string; proxies: string };
  rtcMinutes: number;
  lateRegions: string[];
  replicaExpiryDays?: number | null;
  rules: Rule[];
}

export interface Job<T = unknown> {
  id: string;
  type: string;
  status: "queued" | "running" | "done" | "error";
  progress?: string;
  current?: number;
  total?: number;
  result?: T;
  error?: string;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ProbeResult {
  region: string;
  bucket: string;
  rttMs?: number;
  ttfbMs?: number;
  bytes?: number;
  seconds?: number;
  mbps?: number;
  error?: string;
}
export interface MatrixRow {
  from: string;
  at?: string;
  results: ProbeResult[];
  error?: string;
}
export interface Matrix {
  at?: string;
  probeBytes?: number;
  rows: MatrixRow[];
}

export interface CatalogueObject {
  key: string;
  size: number;
  lastModified?: string;
  type: "master" | "proxy" | "sidecar";
  show: string;
  clip: string;
  regions: string[];
}
export interface Catalogue {
  objects: CatalogueObject[];
}

export interface Arrival {
  eventTime: string;
  lagSec: number;
}
export interface Assignment {
  key: string;
  versionId?: string;
  regions?: string[];
  bureaus?: string[];
  rundown?: string;
  show?: string;
  rtc?: "yes" | "no";
  size?: number;
  assignedAt?: string;
  copiedAt?: string;
  error?: string;
  arrivals: Record<string, Arrival>;
}
export interface ReplicationEvent {
  event?: string;
  key?: string;
  versionId?: string;
  rule?: string;
  destination?: string;
  reason?: string;
  threshold?: string;
  replicationTime?: string;
  at?: string;
}
export interface Timeline {
  assignments: Assignment[];
  replicationEvents: ReplicationEvent[];
}

export interface LabRun {
  key: string;
  versionId?: string;
  sizeMiB: number;
  regions: string[];
  rtc: boolean;
  putStart: string;
  putDoneAt: string;
  arrivals: Record<string, Arrival>;
  replicationStatus?: string;
}

export interface MetricSeries {
  metric: "ReplicationLatency" | "BytesPendingReplication" | "OperationsPendingReplication" | "OperationsFailedReplication";
  rule: string;
  region: string;
  points: [string, number][];
}
export interface Metrics {
  start: string;
  end: string;
  series: MetricSeries[];
}

export interface LateRegion {
  region: string;
  city?: string;
  ruleEnabled: boolean;
  assigned: number;
  backlog: string[];
}
export interface BatchJob {
  jobId: string;
  region: string;
  status?: string;
  created?: string;
  total?: number;
  succeeded?: number;
  failed?: number;
  reasons?: string[];
  error?: string;
}

export interface RundownItem {
  clip: string;
  bureaus?: string[];
  regions?: string[];
  rtc?: boolean;
}
export interface Rundown {
  show: string;
  date?: string;
  source?: string;
  items: RundownItem[];
  bureauRegions?: Record<string, string>;
}

// ---------------------------------------------------------------- upload tab
export interface UploadCopy {
  region: string;
  city: string;
  bucket: string;
  url: string;
  present: boolean;
  versionId?: string;
  storageClass?: string;
  replicationStatus?: string;
  arrivedAt?: string;
  lagSec?: number;
}
export interface UploadStatus {
  key: string;
  size: number;
  contentType: string;
  source: { region: string; city: string; bucket: string; url: string; versionId: string; createdAt: string; replicationStatus: string };
  replicas: UploadCopy[];
}
