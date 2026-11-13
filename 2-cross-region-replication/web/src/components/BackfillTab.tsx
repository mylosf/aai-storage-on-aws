import { useState, type ReactNode } from "react";
import { cn } from "cn";
import { toast } from "sonner";
import { api } from "@/api";
import { Empty, TabHeader } from "@/components/Layout";
import { TimelineView } from "@/components/PlacementTab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtTime } from "@/format";
import { cityOf } from "@/geo";
import { useData } from "@/hooks";
import type { Catalogue, Config, Timeline } from "@/types";

const DONE = ["Complete", "Failed", "Cancelled", "unknown"];

interface Props {
  config: Config | null;
  catalogue: Catalogue | null;
  timeline: Timeline | null;
  onTimeline: () => void;
}

export function BackfillTab({ config, catalogue, timeline, onTimeline }: Props) {
  const late = useData(() => api.late(), { quiet: true });
  const batch = useData(() => api.batchJobs(), { pollMs: 4000, pollWhile: (d) => (d?.jobs ?? []).some((j) => !DONE.includes(j.status ?? "")), quiet: true });
  const [working, setWorking] = useState(false);

  const region = config?.lateRegions[0] ?? "ap-east-1";
  const city = cityOf(config, region);
  const st = late.data?.regions.find((r) => r.region === region);
  // masters that never replicated anywhere: a copy-in-place of an already-replicated master would also
  // re-send it to its earlier regions and mark it COMPLETED, which Batch Replication's NONE filter skips
  const fresh = (catalogue?.objects ?? []).filter((o) => o.type === "master" && o.regions.length === 0).slice(0, 3);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setWorking(true);
    try {
      await fn();
      toast.success(ok);
      await Promise.all([late.reload(), batch.reload()]);
      window.setTimeout(onTimeline, 2500);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const hkTimeline: Timeline | null = timeline
    ? { assignments: timeline.assignments.filter((a) => (a.regions ?? []).includes(region)), replicationEvents: [] }
    : null;

  return (
    <section className="space-y-10">
      <TabHeader title={`The ${city} bureau opens late`}>
        <p>
          The {city} masters rule ships disabled. Rundowns still assign material to {city}: the tags are written and the
          master is copied in place, but no enabled rule matches, so nothing moves. Enabling the rule later does not
          help those objects — replication only evaluates new versions. S3 Batch Replication is the backfill: it lists
          objects whose replication status is NONE or FAILED and that match an enabled rule, and replicates them.
        </p>
      </TabHeader>

      {!catalogue?.objects.length ? (
        <Empty title="Generate the catalogue first">The scenario assigns masters from the newsroom catalogue (Placement tab).</Empty>
      ) : (
        <ol className="space-y-8">
          <Step n={1} title={`Assign masters to ${city}`}>
            <p className="text-sm text-muted-foreground">
              Uses masters that have not been replicated anywhere yet: {fresh.length ? fresh.map((f) => f.clip).join(", ") : "none left — all masters have moved somewhere"}.
            </p>
            <Button
              variant="outline"
              disabled={working || fresh.length === 0}
              onClick={() => void act(() => api.assign("backfill-demo", fresh.map((f) => ({ clip: f.key, regions: [region], rtc: true }))), `Assigned ${fresh.length} masters to ${city}`)}
            >
              Send rundown for {city}
            </Button>
          </Step>

          <Step n={2} title="Backlog">
            <div className="flex items-baseline gap-3">
              <span className="tabular text-3xl font-semibold">{st?.backlog.length ?? "—"}</span>
              <span className="text-sm text-muted-foreground">
                of {st?.assigned ?? 0} assigned masters not in {city} · rule {st?.ruleEnabled ? "enabled" : "disabled"}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void late.reload()}>
                Refresh
              </Button>
            </div>
            {st?.backlog.length ? <p className="font-mono text-xs text-muted-foreground">{st.backlog.join(" · ")}</p> : null}
          </Step>

          <Step n={3} title={`Enable the ${city} masters rule`}>
            <p className="text-sm text-muted-foreground">
              Changes the bucket’s replication configuration (rule <code className="font-mono text-xs">masters-{region}</code>). From now on new assignments flow; the backlog stays where it is.
            </p>
            <div className="flex gap-3">
              <Button disabled={working || st?.ruleEnabled} onClick={() => void act(() => api.setLate(region, true), "Rule enabled")}>
                Enable rule
              </Button>
              <Button variant="outline" disabled={working || !st?.ruleEnabled} onClick={() => void act(() => api.setLate(region, false), "Rule disabled again")}>
                Disable rule again (reset)
              </Button>
            </div>
          </Step>

          <Step n={4} title="Run Batch Replication">
            <p className="text-sm text-muted-foreground">
              Creates an S3 Batch Operations job with a generated manifest: prefix masters/, eligible for replication, status NONE or FAILED. It takes a few minutes to start; the completion report lands in batch-reports/.
            </p>
            <Button disabled={working || !st?.ruleEnabled} onClick={() => void act(() => api.batch(region), "Batch Replication job created")}>
              Run Batch Replication
            </Button>
            {!st?.ruleEnabled && <p className="text-xs text-muted-foreground">Enable the rule first: Batch Replication only replicates objects that match an enabled rule.</p>}
            {batch.data?.jobs.length ? (
              <div className="divide-y border-y">
                {batch.data.jobs.map((j) => (
                  <div key={j.jobId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <Badge variant="outline" className={cn("font-mono text-[10px]", j.status === "Complete" && "border-[#2f6fe4]/30 bg-[#2f6fe4]/10 text-[#1f55b8]", j.status === "Failed" && "border-destructive/30 text-destructive")}>
                      {j.status ?? "…"}
                    </Badge>
                    <span className="font-mono text-xs">{j.jobId}</span>
                    <span className="text-muted-foreground">→ {cityOf(config, j.region)}</span>
                    <span className="tabular text-muted-foreground">
                      {j.total != null ? `${j.succeeded ?? 0}/${j.total} tasks${j.failed ? `, ${j.failed} failed` : ""}` : "manifest being generated"}
                    </span>
                    <span className="text-xs text-muted-foreground">{fmtTime(j.created)}</span>
                    {j.reasons?.length ? <span className="text-xs text-destructive">{j.reasons.join("; ")}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </Step>

          <Step n={5} title={`Arrivals in ${city}`}>
            <TimelineView config={config} timeline={hkTimeline} limit={6} bare />
          </Step>
        </ol>
      )}
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid gap-4 md:grid-cols-[40px_minmax(0,1fr)]">
      <span className="flex size-8 items-center justify-center rounded-full border text-sm font-medium">{n}</span>
      <div className="space-y-3">
        <h3 className="pt-1 text-base font-medium">{title}</h3>
        {children}
      </div>
    </li>
  );
}
