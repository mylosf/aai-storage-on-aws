import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Job } from "./types";

// Starts a job via `start`, then polls /api/jobs/:id every second until it
// settles. `latest` is a loader for the last finished job of this type.
export function useJob<T>(latest?: () => Promise<Job<T>>) {
  const [job, setJob] = useState<Job<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => {
    if (!latest) return;
    let cancelled = false;
    latest()
      .then((j) => {
        if (!cancelled) setJob(j);
      })
      .catch(() => {
        /* no previous run: fine */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => stop, [stop]);

  const poll = useCallback(
    (id: string) => {
      stop();
      const tick = async () => {
        try {
          const j = await api.job<T>(id);
          setJob(j);
          if (j.status === "done" || j.status === "error") {
            if (j.status === "error") setError(j.error ?? "job failed");
            return;
          }
        } catch (err) {
          setError((err as Error).message);
          return;
        }
        timer.current = window.setTimeout(tick, 1000);
      };
      void tick();
    },
    [stop],
  );

  const run = useCallback(
    async (start: () => Promise<{ jobId: string }>) => {
      setError(null);
      try {
        const { jobId } = await start();
        setJob({
          id: jobId,
          type: "bench",
          status: "queued",
          progress: { current: 0, total: 0, message: "queued" },
          result: null,
          error: null,
        });
        poll(jobId);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [poll],
  );

  const busy = job?.status === "queued" || job?.status === "running";
  return { job, busy, error, run, clearError: () => setError(null) };
}
