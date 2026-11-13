import type { BenchResult, Info, Job, LoadResult, Outage, PathsResult, StormResult } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      signal: AbortSignal.timeout(15000),
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (err) {
    throw new ApiError(0, `network error calling ${path}: ${(err as Error).message}`);
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text.slice(0, 300) };
    }
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, msg);
  }
  return body as T;
}

const post = <T,>(path: string, payload?: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(payload ?? {}) });

// ---------------------------------------------------------------- archive
// When the instances behind the demo are gone, the page keeps serving the last
// recorded results from /data/snapshot.json (written by `make freeze`).
export interface Snapshot {
  frozenAt: string;
  info: Info;
  bench: Job<BenchResult> | null;
  loadtest: Job<LoadResult> | null;
  sim: { paths: Job<PathsResult> | null; storm: Job<StormResult> | null } | null;
}

let snapshotPromise: Promise<Snapshot | null> | null = null;
export const loadSnapshot = (): Promise<Snapshot | null> => {
  snapshotPromise ??= fetch("/data/snapshot.json", { cache: "no-cache" })
    .then((r) => (r.ok ? (r.json() as Promise<Snapshot>) : null))
    .catch(() => null);
  return snapshotPromise;
};

/** Try the live API; if it is unreachable and the snapshot has the answer, use that. */
const withArchive =
  <T,>(live: () => Promise<T>, pick: (s: Snapshot) => T | null | undefined) =>
  async (): Promise<T> => {
    try {
      return await live();
    } catch (err) {
      const s = await loadSnapshot();
      const v = s ? pick(s) : null;
      if (v != null) return v;
      throw err;
    }
  };

export const api = {
  info: withArchive(
    () => request<Info>("/api/info", { signal: AbortSignal.timeout(8000) }),
    (s) => ({ ...s.info, frozen: true, frozenAt: s.frozenAt }),
  ),
  job: <T,>(id: string) => request<Job<T>>(`/api/jobs/${encodeURIComponent(id)}`),

  benchRun: (opts: { runs: number; seqMiB: number; backends?: string[]; baseUrl?: string }) =>
    post<{ jobId: string }>("/api/bench/run", opts),
  benchLatest: withArchive(
    () => request<Job<BenchResult>>("/api/bench/latest"),
    (s) => s.bench,
  ),

  loadtestRun: (opts: {
    vus: number;
    durationSec: number;
    baseUrl: string;
    rendition: string;
    backends?: string[];
  }) => post<{ jobId: string }>("/api/loadtest/run", opts),
  loadtestLatest: withArchive(
    () => request<Job<LoadResult>>("/api/loadtest/latest"),
    (s) => s.loadtest,
  ),

  simPaths: (opts: { baseUrl: string; runs: number; seqMiB: number }) => post<{ jobId: string }>("/api/sim/paths", opts),
  simStorm: (opts: { baseUrl: string; stages: string; backends: string[]; rendition?: string }) =>
    post<{ jobId: string }>("/api/sim/storm", opts),
  simLatest: withArchive(
    () => request<{ paths: Job<PathsResult> | null; storm: Job<StormResult> | null }>("/api/sim/latest"),
    (s) => s.sim,
  ),
  outage: () => request<Outage>("/api/sim/outage"),
  outageStart: (seconds: number) => post<Outage>("/api/sim/outage", { seconds }),
  outageStop: () => request<Outage>("/api/sim/outage", { method: "DELETE" }),

  sync: () => post<{ jobId: string }>("/api/admin/sync"),
  dropCaches: () => post<{ dropped: boolean }>("/api/admin/drop-caches"),
};
