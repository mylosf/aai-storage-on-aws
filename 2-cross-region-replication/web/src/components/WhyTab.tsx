import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/api";
import { JobProgress } from "@/components/JobProgress";
import { Empty, ROLE, Stat, TabHeader } from "@/components/Layout";
import { fmtMs, fmtTime, median } from "@/format";
import { cell } from "@/geo";
import { useJob } from "@/hooks";
import type { Config, Matrix } from "@/types";

interface Props {
  config: Config | null;
  matrix: Matrix | null;
  onMatrix: () => void;
}

const fmtMbit = (v?: number) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(2)} Gbit/s` : `${Math.round(v)} Mbit/s`);

/** Probe actions shared by the "why" and "how many" tabs. */
export function ProbeActions({ onMatrix }: { onMatrix: () => void }) {
  const setup = useJob();
  const measure = useJob(() => onMatrix());
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={setup.busy} onClick={() => void setup.run(api.setup)}>
          {setup.busy ? "Preparing…" : "1 · Prepare probe objects"}
        </Button>
        <Button disabled={measure.busy} onClick={() => void measure.run(api.measure)}>
          {measure.busy ? "Measuring…" : "2 · Measure all regions"}
        </Button>
      </div>
      <JobProgress job={setup.job} />
      <JobProgress job={measure.job} />
    </div>
  );
}

export function WhyTab({ config, matrix, onMatrix }: Props) {
  const has = Boolean(matrix?.rows.length && config);
  const rows =
    config && matrix
      ? [...config.replicas]
          .sort((a, b) => a.kmFromSource - b.kmFromSource)
          .map((r) => ({ r, remote: cell(matrix, r.id, config.source.id), local: cell(matrix, r.id, r.id) }))
      : [];

  const ttfbGain = median(rows.filter((x) => x.remote?.ttfbMs && x.local?.ttfbMs).map((x) => x.remote!.ttfbMs! / x.local!.ttfbMs!));
  const tputGain = median(rows.filter((x) => x.remote?.mbps && x.local?.mbps).map((x) => x.local!.mbps! / x.remote!.mbps!));
  const worst = rows.filter((x) => x.remote?.ttfbMs != null).sort((a, b) => b.remote!.ttfbMs! - a.remote!.ttfbMs!)[0];

  const max = {
    rtt: Math.max(1, ...rows.flatMap((x) => [x.remote?.rttMs ?? 0, x.local?.rttMs ?? 0])),
    ttfb: Math.max(1, ...rows.flatMap((x) => [x.remote?.ttfbMs ?? 0, x.local?.ttfbMs ?? 0])),
    mbps: Math.max(1, ...rows.flatMap((x) => [x.remote?.mbps ?? 0, x.local?.mbps ?? 0])),
  };

  return (
    <section className="space-y-10">
      <TabHeader title="Why copy the files at all?" actions={<ProbeActions onMatrix={onMatrix} />}>
        <p>
          A probe in each region stands in for a cutter’s workstation there. It reads the same objects twice: from the
          Frankfurt bucket across the world, and from the replica bucket in its own region. The difference is what a
          cutter feels on every scrub, every relink, every export.
        </p>
        <p>
          Probes run as Lambda functions; their network tops out around 0.5–1 Gbit/s, so absolute throughput is lower
          than a 10 Gbit edit suite, but the comparison between remote and local holds.
        </p>
      </TabHeader>

      {!has ? (
        <Empty title="No measurements yet">
          Prepare the probe objects once (a 1 KiB, 1 MiB and 64 MiB object in each of the 16 buckets), then measure all
          regions. A full run takes one to two minutes and costs a few cents of inter-region transfer.
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-12">
            <Stat label="first byte, Frankfurt vs local (median)" value={ttfbGain ? `${ttfbGain.toFixed(1)}× faster` : "—"} note="local replica" />
            <Stat label="throughput, local vs Frankfurt (median)" value={tputGain ? `${tputGain.toFixed(1)}× more` : "—"} note="64 MiB single stream" />
            <Stat
              label="worst first byte from Frankfurt"
              value={worst ? fmtMs(worst.remote!.ttfbMs!, 0) : "—"}
              note={worst ? `${worst.r.city} · ${worst.r.kmFromSource.toLocaleString()} km` : undefined}
            />
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: ROLE.frankfurt }} /> from Frankfurt
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: ROLE.replica }} /> from the local replica
              </span>
              <span>· measured {fmtTime(matrix?.at)} · regions sorted by distance from Frankfurt</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="w-44 py-2 font-medium">cutter region</th>
                    <th className="py-2 font-medium">round trip · lower is better</th>
                    <th className="py-2 font-medium">first byte (1 MiB GET) · lower is better</th>
                    <th className="py-2 font-medium">throughput (64 MiB) · higher is better</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ r, remote, local }) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2.5 pr-4 align-middle">
                        <div className="font-medium">{r.city}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.id} · {r.kmFromSource.toLocaleString()} km
                        </div>
                      </td>
                      <td className="py-2.5 pr-6">
                        <Pair a={remote?.rttMs} b={local?.rttMs} max={max.rtt} fmt={(v) => fmtMs(v)} />
                      </td>
                      <td className="py-2.5 pr-6">
                        <Pair a={remote?.ttfbMs} b={local?.ttfbMs} max={max.ttfb} fmt={(v) => fmtMs(v)} />
                      </td>
                      <td className="py-2.5">
                        <Pair a={remote?.mbps} b={local?.mbps} max={max.mbps} fmt={fmtMbit} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Pair({ a, b, max, fmt }: { a?: number; b?: number; max: number; fmt: (v: number) => string }) {
  return (
    <div className="space-y-1">
      <Bar v={a} max={max} color={ROLE.frankfurt} fmt={fmt} label="from Frankfurt" />
      <Bar v={b} max={max} color={ROLE.replica} fmt={fmt} label="local replica" />
    </div>
  );
}

function Bar({ v, max, color, fmt, label }: { v?: number; max: number; color: string; fmt: (v: number) => string; label: string }) {
  const w = v == null ? 0 : Math.max(1.5, (v / max) * 100);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2">
          <div className="h-2.5 flex-1">
            <div className="h-full rounded-r-[4px]" style={{ width: `${w}%`, background: color }} />
          </div>
          <span className="tabular w-24 shrink-0 text-xs">{v == null ? "—" : fmt(v)}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="left">
        {label}: {v == null ? "no data" : fmt(v)}
      </TooltipContent>
    </Tooltip>
  );
}
