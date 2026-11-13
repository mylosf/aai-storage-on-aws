import type { ActorId, AttackResult, Config, DeleteEvent, Guard, HiddenObject, Job, Status } from "./types";

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
  config: () => request<Config>("/api/config"),
  status: () => request<Status>("/api/status"),
  guards: () => request<{ at: string; guards: Guard[] }>("/api/guards"),
  results: (actor: ActorId) => request<{ actor: ActorId; results: AttackResult[] }>(`/api/results?actor=${actor}`),
  events: () => request<{ events: DeleteEvent[] }>("/api/events"),
  job: <T,>(id: string) => request<Job<T>>(`/api/jobs/${encodeURIComponent(id)}`),

  setup: () => post<Job>("/api/setup"),
  reset: (scenario: string) => post<Job>("/api/reset", { scenario }),
  attack: (scenario: string, attack: string, actor: ActorId, reset = true) => post<Job>("/api/attack", { scenario, attack, actor, reset }),
  matrix: (actor: ActorId) => post<Job>("/api/matrix", { actor }),
  markers: () => request<{ at: string; noncurrentDays: number; markers: HiddenObject[] }>("/api/markers"),
  deleteObject: (scenario: string, key: string) => post<Job>("/api/delete-object", { scenario, key }),
  restoreObject: (scenario: string, key: string, method: "copy" | "remove-marker", actor: ActorId = "admin") =>
    post<Job>("/api/restore-object", { scenario, key, method, actor }),
  configEval: () => post<{ started: boolean }>("/api/config-eval"),
};
