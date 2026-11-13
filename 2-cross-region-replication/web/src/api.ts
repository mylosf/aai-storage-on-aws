import type { BatchJob, Catalogue, Config, Job, LabRun, LateRegion, Matrix, Metrics, Rundown, RundownItem, Timeline } from "./types";
import type { UploadStatus } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  } catch (err) {
    throw new ApiError(0, `network error calling ${path}: ${(err as Error).message}`);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text.slice(0, 300) };
  }
  if (!res.ok) {
    const msg = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, msg);
  }
  return body as T;
}
const post = <T,>(path: string, payload?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(payload ?? {}) });

export const api = {
  uploadUrl: (p: { name: string; size: number; contentType: string }) =>
    post<{ key: string; url: string; contentType: string; contentDisposition: string; maxBytes: number }>("/api/upload", p),
  uploadStatus: (key: string) => request<UploadStatus>(`/api/upload?key=${encodeURIComponent(key)}`),
  config: () => request<Config>("/api/config"),
  job: <T,>(id: string) => request<Job<T>>(`/api/jobs/${encodeURIComponent(id)}`),

  setup: () => post<Job>("/api/setup"),
  measure: () => post<Job>("/api/matrix"),
  matrix: () => request<Matrix>("/api/matrix"),

  generateCatalogue: () => post<Job>("/api/catalogue"),
  catalogue: () => request<Catalogue>("/api/catalogue"),

  assign: (show: string, items: RundownItem[]) => post<{ rundownKey: string; rundown: Rundown }>("/api/assign", { show, items }),
  rundown: (rundown: Rundown) => post<{ rundownKey: string; rundown: Rundown }>("/api/rundown", { rundown }),
  timeline: () => request<Timeline>("/api/timeline"),

  lab: (sizeMiB: number, regions: string[], rtc: boolean) => post<Job>("/api/lab", { sizeMiB, regions, rtc }),
  labRuns: () => request<{ runs: LabRun[] }>("/api/lab"),
  metrics: () => request<Metrics>("/api/metrics"),

  late: () => request<{ regions: LateRegion[] }>("/api/late"),
  setLate: (region: string, enabled: boolean) => post<{ region: string; enabled: boolean }>("/api/late", { region, enabled }),
  batch: (region: string) => post<{ jobId: string }>("/api/batch", { region }),
  batchJobs: () => request<{ jobs: BatchJob[] }>("/api/batch"),
};
