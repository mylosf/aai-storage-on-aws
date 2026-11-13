import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "./api";
import type { Job } from "./types";

/** Load once, reload on demand, and optionally keep polling while `pollWhile(data)` is true. */
export function useData<T>(load: () => Promise<T>, opts: { pollMs?: number; pollWhile?: (d: T | null) => boolean; quiet?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const reload = useCallback(async () => {
    try {
      const d = await loadRef.current();
      setData(d);
      setError(null);
      return d;
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      if (!optsRef.current.quiet) toast.error(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // re-armed after every load: polls while the predicate holds for the latest data
  useEffect(() => {
    const { pollMs, pollWhile } = optsRef.current;
    if (!pollMs || !pollWhile || !pollWhile(data)) return;
    const t = window.setTimeout(() => void reload(), pollMs);
    return () => window.clearTimeout(t);
  }, [data, reload]);

  return { data, error, loading, reload, setData };
}

/** Start an API job and poll /api/jobs/:id every 1.5 s until it settles. */
export function useJob<T = unknown>(onDone?: (job: Job<T>) => void) {
  const [job, setJob] = useState<Job<T> | null>(null);
  const timer = useRef<number | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

  const poll = useCallback((id: string) => {
    const tick = async () => {
      try {
        const j = await api.job<T>(id);
        setJob(j);
        if (j.status === "done") {
          doneRef.current?.(j);
          return;
        }
        if (j.status === "error") {
          toast.error(j.error ?? "job failed");
          return;
        }
      } catch (err) {
        toast.error((err as Error).message);
        return;
      }
      timer.current = window.setTimeout(tick, 1500);
    };
    void tick();
  }, []);

  const run = useCallback(
    async (start: () => Promise<Job>) => {
      try {
        const j = (await start()) as Job<T>;
        setJob(j);
        poll(j.id);
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [poll],
  );

  const busy = job?.status === "queued" || job?.status === "running";
  return { job, busy, run };
}
