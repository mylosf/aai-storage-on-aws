// Mirrors api/server.mjs, api/bench.mjs, api/loadtest.mjs and loadtest/viewers.js.
// Everything coming from the network is treated as possibly partial.

export type BackendId = "nvme" | "ebs" | "efs" | "s3" | "cdn";
export const BACKEND_ORDER: BackendId[] = ["nvme", "ebs", "efs", "s3", "cdn"];

export interface Backend {
  id: BackendId;
  label: string;
  kind: "fs" | "s3" | "cdn";
  browserPrefix: string;
  path: string;
  summary: string;
  available: boolean;
  ready: boolean;
  master: string;
}

export interface Info {
  instance: { id: string; type: string; az: string };
  region: string;
  bucket: string;
  ebs: { volumeId: string; type: string; iops: string; throughputMiBps: string };
  efs: { id: string; throughputMode: string };
  loadgen: { enabled: boolean };
  backends: Backend[];
  content: { master: string; small: string; big: string; dir: string };
  /** set by the client when the page is serving archived results */
  frozen?: boolean;
  frozenAt?: string;
  benchDefaults: {
    runs: number;
    seqBytes: number;
    randomReads: number;
    randomBytes: number;
    smallFiles: number;
    smallFileBytes: number;
    parallelStreams: number;
  };
}

export interface Stats {
  p50: number;
  p95: number;
  min: number;
  max: number;
  mean: number;
  n: number;
  samples?: number[];
}

export interface BenchBackendResult {
  label: string;
  error?: string;
  coldCache?: boolean | null;
  /** true for the CloudFront row: measured after an untimed warm-up, i.e. edge cache hits */
  edgeHit?: boolean;
  ttfb_ms?: Stats | null;
  small_total_ms?: Stats | null;
  seq_mbps?: Stats | null;
  random_ms?: Stats | null;
  smallfile_ms?: Stats | null;
  parallel_mbps?: Stats | null;
}

export interface BenchResult {
  generatedAt: string;
  instance: { id: string; type: string; az: string };
  config: {
    runs: number;
    seqBytes: number;
    randomReads: number;
    randomBytes: number;
    smallFiles: number;
    smallFileBytes: number;
    parallelStreams: number;
    smallFile: string;
    bigFile: string;
    statDir: string;
    ebs?: { type: string; iops: string; throughputMiBps: string };
    efs?: { throughputMode: string };
  };
  backends: Partial<Record<BackendId, BenchBackendResult>>;
}

export interface LoadTrend {
  avg?: number;
  p50?: number;
  p90?: number;
  p95?: number;
  max?: number;
}

export interface LoadBackendResult {
  requests: number;
  ttfb_ms: LoadTrend;
  fetch_ms: LoadTrend;
  stall_rate: number;
  error_rate: number;
  bytes: number;
}

export interface LoadResult {
  generatedAt: string;
  config: {
    vus: number;
    durationSec: number;
    rendition: string;
    segmentSeconds: number;
    baseUrl: string;
    backends?: BackendId[];
  };
  backends: Partial<Record<BackendId, LoadBackendResult>>;
}

export type JobStatus = "queued" | "running" | "done" | "error";

export interface Job<T = unknown> {
  id: string;
  type: "bench" | "loadtest" | "sync";
  status: JobStatus;
  progress: { current: number; total: number; message: string };
  createdAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  result: T | null;
  error: string | null;
}

// ---------------------------------------------------------------- analysis
export type OriginId = "nvme" | "ebs" | "efs" | "s3";

export interface PathsBackend {
  label: string;
  hitPath: string;
  missPath: string;
  hit_ttfb_ms: Stats | null;
  miss_ttfb_ms: Stats | null;
  hit_mbps: Stats | null;
  miss_mbps: Stats | null;
}

export interface PathsResult {
  generatedAt: string;
  config: { baseUrl: string; runs: number; seqBytes: number };
  backends: Partial<Record<OriginId, PathsBackend>>;
}

export interface StormStage {
  rate: number;
  seconds: number;
  requests: number;
  ttfb_p50?: number;
  ttfb_p95?: number;
  fetch_p95?: number;
  error_rate: number;
}

export interface StormResult {
  generatedAt: string;
  mode: "storm";
  config: {
    baseUrl: string;
    rendition: string;
    stages: { rate: number; seconds: number }[];
    stagesText?: string;
    backends?: BackendId[];
  };
  backends: Partial<Record<BackendId, LoadBackendResult & { dropped?: number; stages?: StormStage[] }>>;
}

export interface Outage {
  active: boolean;
  until: string | null;
  remainingSec: number;
}
