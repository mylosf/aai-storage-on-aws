import { Progress } from "@/components/ui/progress";
import type { Job } from "@/types";

export function JobProgress({ job }: { job: Job | null }) {
  if (!job || (job.status !== "queued" && job.status !== "running")) return null;
  const pct = job.total ? Math.min(100, Math.round(((job.current ?? 0) / job.total) * 100)) : null;
  return (
    <div className="max-w-xl space-y-1.5">
      <Progress value={pct ?? 8} className={pct == null ? "animate-pulse" : ""} />
      <p className="tabular text-xs text-muted-foreground">
        {job.status === "queued" ? "queued" : (job.progress ?? "running")}
        {pct != null ? ` · ${pct} %` : ""}
      </p>
    </div>
  );
}
