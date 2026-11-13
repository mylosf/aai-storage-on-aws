export type ActorId = "admin" | "breakglass";

export interface Scenario {
  id: string;
  base: string;
  pattern: string;
  lock: { mode: "GOVERNANCE" | "COMPLIANCE"; days: number } | null;
  bucketPolicy: boolean;
  org: "scp" | "rcp" | "rcp-extended" | null;
  config: boolean;
}

export interface Config {
  region: string;
  account: string;
  prefix: string;
  noncurrentDays: number;
  seedKeys: string[];
  scenarios: Scenario[];
  attacks: { id: string; cmd: string }[];
  roles: Record<ActorId, string>;
  configRule: string | null;
  policies: {
    customerActions: string[];
    extendedActions: string[];
    bucketPolicy: unknown;
    scp: unknown;
    rcp: unknown;
  };
}

export interface ScenarioStatus {
  id: string;
  bucket: string;
  exists: boolean;
  error?: string;
  versioning?: string | null;
  objectLock?: { enabled: boolean; mode: string | null; days: number | null } | null;
  lifecycle?: { id: string; status: string; expirationDays: number | null; noncurrentDays: number | null }[];
  bucketPolicy?: boolean;
  tags?: Record<string, string>;
  current?: number;
  noncurrent?: number;
  deleteMarkers?: number;
  hidden?: number;
  retainUntil?: string | null;
}

export interface ConfigStatus {
  rule: string;
  bucket: string;
  compliance: { value: string; at: string } | null;
  remediation: { state: string; at: string; steps: { name: string; state: string; error: string | null }[] } | null;
  error?: string;
  remediationError?: string;
}

export interface Status {
  at: string;
  scenarios: ScenarioStatus[];
  config: ConfigStatus | null;
}

export interface Guard {
  id: string;
  expected: string;
  enforced: boolean;
  by: string | null;
  code: string | null;
  message: string | null;
}

export type Outcome = "blocked" | "outage" | "weakened" | "destroyed" | "noop" | "na" | "restorable" | "needs-breakglass" | "error";

export interface LogLine {
  call: string;
  ok: boolean;
  info?: boolean;
  cmd?: boolean;
  code?: string;
  message?: string;
  by?: string | null;
  note?: string;
  ms?: number;
}

export interface AttackResult {
  scenario: string;
  attack: string;
  actor: ActorId;
  outcome: Outcome;
  summary: string;
  log: LogLine[];
  at: string;
  ms: number;
}

export interface DeleteEvent {
  time: string;
  bucket: string;
  scenario: string | null;
  key: string;
  versionId: string | null;
  deletionType: string | null;
  reason: string | null;
  requester: string | null;
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
}

export interface HiddenObject {
  scenario: string;
  bucket: string;
  key: string;
  markerVersionId: string;
  deletedAt: string;
  previousVersionId: string | null;
  previousSize: number | null;
  expiresAt: string | null;
  locked: boolean;
}
