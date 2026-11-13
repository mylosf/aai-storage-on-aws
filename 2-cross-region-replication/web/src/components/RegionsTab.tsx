import { useMemo, useState } from "react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Chip, Empty, Stat, SubHeader, TabHeader } from "@/components/Layout";
import { ProbeActions } from "@/components/WhyTab";
import { fmtMs } from "@/format";
import { cell, cityOf } from "@/geo";
import type { Config, Matrix } from "@/types";

// Sequential single-hue ramp (reference palette, blue 100 -> 700)
const RAMP = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"];
type Metric = "ttfb" | "rtt" | "mbps";
const METRIC_LABEL: Record<Metric, string> = { ttfb: "first byte", rtt: "round trip", mbps: "throughput" };
const pick = (m: Metric, r?: { ttfbMs?: number; rttMs?: number; mbps?: number }) => (m === "ttfb" ? r?.ttfbMs : m === "rtt" ? r?.rttMs : r?.mbps);
const fmtMetric = (m: Metric, v?: number) => (v == null ? "—" : m === "mbps" ? `${Math.round(v)}` : fmtMs(v, v < 10 ? 1 : 0).replace(" ms", ""));

const PRICE = { standard: 0.023, transfer: 0.02 };
const usd = (v: number) => `$${Math.round(v).toLocaleString()}`;

interface Props {
  config: Config | null;
  matrix: Matrix | null;
  onMatrix: () => void;
}

export function RegionsTab({ config, matrix, onMatrix }: Props) {
  const [metric, setMetric] = useState<Metric>("ttfb");
  const [maxTtfb, setMaxTtfb] = useState(60);
  const [minMbps, setMinMbps] = useState(300);
  const [gbPerRegion, setGbPerRegion] = useState(2000);
  const [newGb, setNewGb] = useState(1500);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [dropped, setDropped] = useState<Set<string>>(new Set());

  const has = Boolean(config && matrix?.rows.length);
  const cols = config ? [config.source.id, ...config.replicas.map((r) => r.id)] : [];
  const probeRows = config ? config.replicas.map((r) => r.id).filter((id) => matrix?.rows.some((x) => x.from === id)) : [];

  // colour scale over the visible metric
  const scale = useMemo(() => {
    const vals = probeRows.flatMap((f) => cols.map((c) => pick(metric, cell(matrix, f, c)))).filter((v): v is number => v != null && v > 0);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return (v?: number) => {
      if (v == null || !vals.length) return null;
      const t = metric === "mbps" ? (v - lo) / (hi - lo || 1) : (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo) || 1);
      return Math.max(0, Math.min(RAMP.length - 1, Math.round(t * (RAMP.length - 1))));
    };
  }, [matrix, metric, probeRows, cols]);

  // ------------------------------------------------------------- planner
  const plan = useMemo(() => {
    if (!config || !matrix) return null;
    const bureaus = config.bureaus.filter((b) => !off.has(b.id));
    const ok = (bureauRegion: string, bucket: string) => {
      const c = cell(matrix, bureauRegion, bucket);
      return c?.ttfbMs != null && c.mbps != null && c.ttfbMs <= maxTtfb && c.mbps >= minMbps;
    };
    const chosen: string[] = [config.source.id];
    const covered = new Set(bureaus.filter((b) => ok(b.region, config.source.id)).map((b) => b.id));
    const candidates = config.replicas.map((r) => r.id).filter((id) => !dropped.has(id));
    for (;;) {
      let best: string | null = null;
      let bestGain = 0;
      let bestTtfb = Infinity;
      for (const c of candidates) {
        if (chosen.includes(c)) continue;
        const gain = bureaus.filter((b) => !covered.has(b.id) && ok(b.region, c));
        const ttfb = gain.reduce((a, b) => a + (cell(matrix, b.region, c)?.ttfbMs ?? 0), 0);
        if (gain.length > bestGain || (gain.length === bestGain && gain.length > 0 && ttfb < bestTtfb)) {
          best = c;
          bestGain = gain.length;
          bestTtfb = ttfb;
        }
      }
      if (!best || bestGain === 0) break;
      chosen.push(best);
      for (const b of bureaus) if (ok(b.region, best)) covered.add(b.id);
    }
    const serving = bureaus.map((b) => {
      const options = chosen
        .map((c) => ({ c, m: cell(matrix, b.region, c) }))
        .filter((x) => x.m?.ttfbMs != null)
        .sort((a, z) => (a.m!.ttfbMs ?? 0) - (z.m!.ttfbMs ?? 0));
      const good = options.find((x) => ok(b.region, x.c));
      const use = good ?? options[0];
      return { b, region: use?.c, ttfb: use?.m?.ttfbMs, mbps: use?.m?.mbps, ok: Boolean(good) };
    });
    const replicas = chosen.length - 1;
    return {
      chosen,
      serving,
      unmet: serving.filter((s) => !s.ok),
      storage: replicas * gbPerRegion * PRICE.standard,
      transfer: replicas * newGb * PRICE.transfer,
      replicas,
    };
  }, [config, matrix, off, dropped, maxTtfb, minMbps, gbPerRegion, newGb]);

  return (
    <section className="space-y-10">
      <TabHeader title="How many regions do we need?" actions={!has ? <ProbeActions onMatrix={onMatrix} /> : undefined}>
        <p>
          Every probe region reads every bucket. Each row is a place where cutters sit; each column is a bucket they
          could read from. The diagonal is “read from my own region”; the first column is “read from Frankfurt”.
        </p>
      </TabHeader>

      {!has || !config ? (
        <Empty title="No measurements yet">Run the probes on the “Why replicate” tab (or here) to fill the matrix.</Empty>
      ) : (
        <>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <ToggleGroup type="single" value={metric} onValueChange={(v) => v && setMetric(v as Metric)} variant="outline" size="sm">
                <ToggleGroupItem value="ttfb" className="px-3">first byte (ms)</ToggleGroupItem>
                <ToggleGroupItem value="rtt" className="px-3">round trip (ms)</ToggleGroupItem>
                <ToggleGroupItem value="mbps" className="px-3">throughput (Mbit/s)</ToggleGroupItem>
              </ToggleGroup>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{metric === "mbps" ? "lower" : "faster"}</span>
                <div className="flex">
                  {RAMP.map((c) => (
                    <span key={c} className="h-2.5 w-4" style={{ background: c }} />
                  ))}
                </div>
                <span>{metric === "mbps" ? "higher" : "slower"}</span>
                <span className="ml-2">{metric === "mbps" ? "linear" : "log"} scale</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-background pr-3 text-left align-bottom text-[11px] font-medium text-muted-foreground">cutter in ↓ · bucket in →</th>
                    {cols.map((c) => (
                      <th key={c} className="h-24 w-11 align-bottom">
                        <div className={cn("mx-auto w-4 rotate-180 whitespace-nowrap text-[11px] font-medium [writing-mode:vertical-rl]", c === config.source.id && "font-semibold")}>
                          {cityOf(config, c)}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {probeRows.map((f) => (
                    <tr key={f}>
                      <th className="sticky left-0 z-10 whitespace-nowrap bg-background py-0.5 pr-3 text-left text-[12px] font-medium">{cityOf(config, f)}</th>
                      {cols.map((c) => {
                        const r = cell(matrix, f, c);
                        const v = pick(metric, r);
                        const step = scale(v);
                        const diag = f === c;
                        return (
                          <td key={c} className="p-[1px]">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div
                                  className={cn("tabular flex h-7 w-11 items-center justify-center rounded-[3px] text-[11px]", diag && "ring-2 ring-foreground ring-inset")}
                                  style={{ background: step == null ? "#f3f4f6" : RAMP[step], color: step != null && step >= 7 ? "#fff" : "#111827" }}
                                >
                                  {r?.error ? "×" : fmtMetric(metric, v)}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                {cityOf(config, f)} reading the {cityOf(config, c)} bucket
                                {r?.error ? `: ${r.error}` : `: RTT ${fmtMs(r?.rttMs)}, first byte ${fmtMs(r?.ttfbMs)}, ${Math.round(r?.mbps ?? 0)} Mbit/s`}
                              </TooltipContent>
                            </Tooltip>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">Outlined: read from the local replica. Values are {METRIC_LABEL[metric]}; hover any cell for all three.</p>
          </div>

          <SubHeader title="Planner: the fewest regions that meet a service level">
            Set what a cutter needs. The planner starts with Frankfurt and greedily adds the replica region that brings
            the most still-unserved bureaus within the limits, until no region helps any more. Each bureau is measured
            through the probe in its nearest region: an approximation, its own last mile is not measured.
          </SubHeader>

          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div className="space-y-6">
              <Slider label="first byte at most" value={maxTtfb} set={setMaxTtfb} min={5} max={400} step={5} unit="ms" />
              <Slider label="throughput at least" value={minMbps} set={setMinMbps} min={20} max={1000} step={10} unit="Mbit/s" />
              <div className="grid grid-cols-2 gap-4">
                <Num label="masters kept per region" value={gbPerRegion} set={setGbPerRegion} unit="GB" />
                <Num label="new material per month" value={newGb} set={setNewGb} unit="GB" />
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">bureaus to serve</div>
                <div className="flex flex-wrap gap-1.5">
                  {config.bureaus.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setOff((s) => toggle(s, b.id))}
                      className={cn("rounded-md border px-2 py-1 text-xs", off.has(b.id) ? "text-muted-foreground line-through" : "border-[#f7b531]/60 bg-[#f7b531]/15")}
                    >
                      {b.city}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">what if we cannot use…</div>
                <div className="flex flex-wrap gap-1.5">
                  {config.replicas.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setDropped((s) => toggle(s, r.id))}
                      className={cn("rounded-md border px-2 py-1 text-xs", dropped.has(r.id) ? "border-destructive/40 text-destructive line-through" : "hover:bg-accent")}
                    >
                      {r.city}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {plan && (
              <div className="space-y-6">
                <div className="flex flex-wrap gap-10">
                  <Stat label="replica regions needed" value={plan.replicas} note={`plus Frankfurt · ${plan.serving.length - plan.unmet.length}/${plan.serving.length} bureaus served`} />
                  <Stat label="per month" value={usd(plan.storage + plan.transfer)} note={`${usd(plan.storage)} storage · ${usd(plan.transfer)} transfer`} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {plan.chosen.map((c) => (
                    <Chip key={c} tone={c === config.source.id ? "muted" : "replica"}>
                      {cityOf(config, c)}
                    </Chip>
                  ))}
                </div>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 font-medium">bureau</th>
                      <th className="py-2 font-medium">reads from</th>
                      <th className="py-2 text-right font-medium">first byte</th>
                      <th className="py-2 text-right font-medium">throughput</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.serving.map((s) => (
                      <tr key={s.b.id} className="border-b last:border-0">
                        <td className="py-1.5">{s.b.city}</td>
                        <td className="py-1.5">{s.region ? cityOf(config, s.region) : "—"}</td>
                        <td className={cn("tabular py-1.5 text-right", !s.ok && "text-destructive")}>{fmtMs(s.ttfb)}</td>
                        <td className={cn("tabular py-1.5 text-right", !s.ok && "text-destructive")}>{s.mbps != null ? `${Math.round(s.mbps)} Mbit/s` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {plan.unmet.length > 0 && (
                  <p className="text-sm text-destructive">
                    {plan.unmet.length} bureau{plan.unmet.length === 1 ? "" : "s"} cannot meet the limits from any allowed region:{" "}
                    {plan.unmet.map((u) => u.b.city).join(", ")}.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Cost: each replica region holds {gbPerRegion.toLocaleString()} GB of masters in S3 Standard (${PRICE.standard}/GB-month) and receives
                  the month’s new material at ${PRICE.transfer}/GB inter-region transfer (approximate list prices; some regions charge more).
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function toggle(s: Set<string>, id: string) {
  const n = new Set(s);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
}

function Slider({ label, value, set, min, max, step, unit }: { label: string; value: number; set: (v: number) => void; min: number; max: number; step: number; unit: string }) {
  return (
    <label className="block space-y-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular font-medium">
          {value} {unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} className="w-full accent-[#2f6fe4]" />
    </label>
  );
}

export function Num({ label, value, set, unit, step = 100 }: { label: string; value: number; set: (v: number) => void; unit: string; step?: number }) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <Input type="number" min={0} step={step} value={value} onChange={(e) => set(Math.max(0, Number(e.target.value) || 0))} className="tabular h-9 w-28" />
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
    </label>
  );
}
