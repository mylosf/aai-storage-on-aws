import { useMemo, useState } from "react";
import { cn } from "cn";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { api } from "@/api";
import { HBarChart } from "@/components/HBarChart";
import { JobProgress } from "@/components/JobProgress";
import { ROLE, SubHeader, TabHeader } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fmtBytes, fmtTime } from "@/format";
import { cityOf } from "@/geo";
import { useData, useJob } from "@/hooks";
import type { Config, LabRun, Metrics } from "@/types";

const SIZES = [
  { v: 10, label: "10 MiB" },
  { v: 100, label: "100 MiB" },
  { v: 1024, label: "1 GiB" },
];

const pendingLab = (runs: LabRun[] | undefined) => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  return (runs ?? []).some((r) => Date.parse(r.putDoneAt) > cutoff && (r.replicationStatus === "PENDING" || Object.keys(r.arrivals ?? {}).length < r.regions.length));
};

const maxLag = (r: LabRun) => Math.max(0, ...Object.values(r.arrivals ?? {}).map((a) => a.lagSec));

export function LabTab({ config }: { config: Config | null }) {
  const [size, setSize] = useState(100);
  const [regions, setRegions] = useState<string[]>(["sa-east-1", "af-south-1", "ap-southeast-1", "us-east-1"]);
  const [rtc, setRtc] = useState(true);
  const runs = useData(() => api.labRuns(), { pollMs: 3000, pollWhile: (d) => pendingLab(d?.runs), quiet: true });
  const metrics = useData(() => api.metrics(), { quiet: true });
  const job = useJob(() => void runs.reload());

  const latest = runs.data?.runs?.[0];

  return (
    <section className="space-y-10">
      <TabHeader title="Replication lab">
        <p>
          Upload a test object to Frankfurt with destination tags and watch it arrive. Each arrival is the
          “Object Created” event in the destination region; the lag is measured from the end of the upload. With
          Replication Time Control, S3 commits to 99.99 % of objects within 15 minutes and publishes per-rule metrics;
          without it, replication is best effort (usually as fast, with no SLA).
        </p>
      </TabHeader>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <ToggleGroup type="single" value={String(size)} onValueChange={(v) => v && setSize(Number(v))} variant="outline" size="sm">
            {SIZES.map((s) => (
              <ToggleGroupItem key={s.v} value={String(s.v)} className="px-3">
                {s.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={rtc} onChange={(e) => setRtc(e.target.checked)} className="accent-[#2f6fe4]" />
            Replication Time Control
          </label>
          <Button disabled={job.busy || regions.length === 0} onClick={() => void job.run(() => api.lab(size, regions, rtc))}>
            {job.busy ? "Uploading…" : `Replicate to ${regions.length} region${regions.length === 1 ? "" : "s"}`}
          </Button>
          <span className="text-xs text-muted-foreground">up to 9 regions (S3 allows 10 tags per object)</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {config?.replicas.map((r) => {
            const on = regions.includes(r.id);
            return (
              <button
                key={r.id}
                type="button"
                disabled={!on && regions.length >= 9}
                onClick={() => setRegions((s) => (on ? s.filter((x) => x !== r.id) : [...s, r.id]))}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs disabled:opacity-40",
                  on ? "border-[#2f6fe4]/50 bg-[#2f6fe4]/10 text-[#1f55b8]" : "hover:bg-accent",
                )}
              >
                {r.city}
              </button>
            );
          })}
        </div>
        <JobProgress job={job.job} />
      </div>

      {latest && (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <HBarChart
            title={`Latest run · ${latest.sizeMiB >= 1024 ? "1 GiB" : `${latest.sizeMiB} MiB`} · RTC ${latest.rtc ? "on" : "off"}`}
            subtitle={`seconds from end of upload to arrival · lower is better · RTC SLA is 900 s${maxLag(latest) > 300 ? " (line)" : ", far off this scale"}`}
            rows={latest.regions.map((r) => ({
              key: r,
              label: cityOf(config, r),
              value: latest.arrivals?.[r]?.lagSec ?? null,
              color: ROLE.replica,
              note: "pending",
            }))}
            format={(v) => `${v.toFixed(1)} s`}
            tickFormat={(v) => `${Math.round(v)} s`}
            reference={maxLag(latest) > 300 ? { value: 900, label: "15 min" } : undefined}
          />
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Recent runs</h4>
            <div className="divide-y border-y">
              {(runs.data?.runs ?? []).slice(0, 8).map((r) => (
                <div key={r.key} className="space-y-1.5 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="tabular font-medium">{fmtBytes(r.sizeMiB * 1048576)}</span>
                    <span className="text-muted-foreground">· {fmtTime(r.putDoneAt)} · RTC {r.rtc ? "on" : "off"}</span>
                    <StatusBadge s={r.replicationStatus} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {r.regions.map((g) => {
                      const a = r.arrivals?.[g];
                      return (
                        <span
                          key={g}
                          title={a ? `arrived ${fmtTime(a.eventTime)}` : "pending"}
                          className={cn("tabular rounded-md border px-1.5 py-0.5 text-[11px]", a ? "border-[#2f6fe4]/30 bg-[#2f6fe4]/10" : "animate-pulse text-muted-foreground")}
                        >
                          {cityOf(config, g)} {a ? `${a.lagSec.toFixed(1)} s` : "…"}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <SubHeader
          title="CloudWatch replication metrics, last 6 hours"
          actions={
            <Button variant="outline" size="sm" onClick={() => void metrics.reload()}>
              Refresh
            </Button>
          }
        >
          Published per rule because replication metrics are enabled on every rule. They appear a few minutes after
          traffic and only for rules that moved something, so a quiet region shows nothing.
        </SubHeader>
        <MetricsGrid config={config} metrics={metrics.data} />
      </div>
    </section>
  );
}

function StatusBadge({ s }: { s?: string }) {
  if (!s) return null;
  const tone = s === "COMPLETED" ? "bg-[#2f6fe4]/10 text-[#1f55b8] border-[#2f6fe4]/30" : s === "FAILED" ? "bg-destructive/10 text-destructive border-destructive/30" : "text-muted-foreground";
  return (
    <Badge variant="outline" className={cn("font-mono text-[10px]", tone)}>
      {s}
    </Badge>
  );
}

const SERIES = [
  { rule: "masters", color: ROLE.replica, label: "masters (tag rule, RTC)" },
  { rule: "proxies", color: ROLE.frankfurt, label: "proxies (prefix rule)" },
];

function MetricsGrid({ config, metrics }: { config: Config | null; metrics: Metrics | null }) {
  const byRegion = useMemo(() => {
    const m = new Map<string, { latency: Record<string, number | string>[]; pending: Record<string, number | string>[] }>();
    for (const s of metrics?.series ?? []) {
      if (s.metric !== "ReplicationLatency" && s.metric !== "BytesPendingReplication") continue;
      const kind = s.rule.startsWith("masters") ? "masters" : "proxies";
      const entry = m.get(s.region) ?? { latency: [], pending: [] };
      const arr = s.metric === "ReplicationLatency" ? entry.latency : entry.pending;
      for (const [t, v] of s.points) {
        let row = arr.find((x) => x.t === t);
        if (!row) arr.push((row = { t }));
        row[kind] = s.metric === "BytesPendingReplication" ? v / 1048576 : v;
      }
      m.set(s.region, entry);
    }
    for (const e of m.values()) {
      e.latency.sort((a, b) => String(a.t).localeCompare(String(b.t)));
      e.pending.sort((a, b) => String(a.t).localeCompare(String(b.t)));
    }
    return [...m.entries()];
  }, [metrics]);

  if (!byRegion.length) return <p className="text-sm text-muted-foreground">No replication metrics in the last 6 hours yet.</p>;
  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-xs text-muted-foreground">
        {SERIES.map((s) => (
          <span key={s.rule} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
        {byRegion.map(([region, d]) => (
          <div key={region} className="space-y-1">
            <div className="text-sm font-medium">{cityOf(config, region)}</div>
            <Mini data={d.latency} unit="s" title="replication latency (max)" />
            <Mini data={d.pending} unit="MiB" title="bytes pending" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Mini({ data, unit, title }: { data: Record<string, number | string>[]; unit: string; title: string }) {
  if (!data.length) return null;
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">
        {title}, {unit}
      </div>
      <div className="h-24">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
            <CartesianGrid vertical={false} stroke="#eceff3" />
            <XAxis dataKey="t" tickFormatter={(t: string) => t.slice(11, 16)} tick={{ fontSize: 10, fill: "#8a8f98" }} tickLine={false} axisLine={false} minTickGap={30} />
            <YAxis tick={{ fontSize: 10, fill: "#8a8f98" }} tickLine={false} axisLine={false} width={44} />
            <RTooltip
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              labelFormatter={(t) => String(t).slice(11, 16)}
              formatter={(v, name) => [`${Number(v).toFixed(1)} ${unit}`, String(name)]}
            />
            {SERIES.map((s) => (
              <Line key={s.rule} type="monotone" dataKey={s.rule} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
