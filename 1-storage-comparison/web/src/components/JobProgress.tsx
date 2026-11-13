import { Progress } from "@/components/ui/progress";
import type { Job } from "@/types";

export function JobProgress({ job }: { job: Job<unknown> | null }) {
  if (!job || (job.status !== "queued" && job.status !== "running")) return null;
  const { current, total, message } = job.progress ?? { current: 0, total: 0, message: "" };
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : null;
  return (
    <div className="space-y-2">
      <Progress value={pct ?? 0} className={pct == null ? "animate-pulse" : ""} />
      <p className="tabular text-sm text-muted-foreground">
        {job.status === "queued" ? "queued · " : ""}
        {message}
        {pct != null ? ` · ${pct} %` : ""}
      </p>
    </div>
  );
}
