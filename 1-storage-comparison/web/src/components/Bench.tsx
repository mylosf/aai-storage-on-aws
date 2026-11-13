import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Dot } from "@/components/Dot";
import { Explainer } from "@/components/Explainer";
import { HBarChart, type HBarRow } from "@/components/HBarChart";
import { JobProgress } from "@/components/JobProgress";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fmtMiBps, fmtMs, fmtTime } from "@/format";
import { BACKEND_SHORT, colorOf } from "@/palette";
import { BACKEND_ORDER, type BackendId, type BenchResult, type Info } from "@/types";
import { useJob } from "@/useJob";

const RUNS = [1, 3, 5];
const SEQ = [64, 256, 512];
const tickMs = (v: number) => fmtMs(v, v < 10 ? 1 : 0);

export function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function Bench({ info, frozen }: { info: Info | null; frozen?: boolean }) {
  const [runs, setRuns] = useState(3);
  const [seqMiB, setSeqMiB] = useState(256);
  const { job, busy, error, run, clearError } = useJob<BenchResult>(api.benchLatest);

  useEffect(() => {
    if (error) {
      toast.error(`Benchmark: ${error}`);
      clearError();
    }
  }, [error, clearError]);

  const result = job?.status === "done" ? job.result : null;
  const ids = BACKEND_ORDER.filter((id) => result?.backends[id]);
  const ok = (id: BackendId) => {
    const b = result?.backends[id];
    return b && !b.error ? b : null;
  };

  const rows = (pick: (id: BackendId) => number | null | undefined, note?: (id: BackendId) => string | undefined): HBarRow[] =>
    ids.map((id) => ({
      key: id,
      label: id === "cdn" ? `${BACKEND_SHORT[id]} · edge hit` : BACKEND_SHORT[id],
      value: ok(id) ? pick(id) : null,
      color: colorOf(id),
      note: ok(id) ? (note?.(id) ?? (ok(id)?.edgeHit ? "warm CloudFront edge, same region" : undefined)) : result?.backends[id]?.error,
    }));

  const seqRows: HBarRow[] = [
    ...rows((id) => ok(id)?.seq_mbps?.p50, () => "single stream"),
    ...ids
      .filter((id) => ok(id)?.parallel_mbps?.p50 != null)
      .map((id) => ({
        key: `${id}-par`,
        label: `${BACKEND_SHORT[id]} · ${result?.config.parallelStreams ?? 8}×`,
        value: ok(id)?.parallel_mbps?.p50,
        color: colorOf(id),
        muted: true,
        note: "parallel ranged GETs",
      })),
  ];

  const coldNote = ids.some((id) => ok(id)?.coldCache === false)
    ? "The page cache could not be dropped on at least one run; file-system numbers may be from RAM."
    : null;

  return (
    <section className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-3xl space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">Storage benchmark</h2>
          <p className="text-sm text-muted-foreground">
            Runs on the EC2 instance itself ({info?.instance.type ?? "…"} in {info?.instance.az ?? "…"}), reading the
            same files from each backend with the page cache dropped first, so it measures the storage and not RAM or
            the room's wifi. S3 is read over the VPC endpoint. S3 + CloudFront is fetched over HTTPS through the
            distribution after an untimed warm-up pass, so its row shows an edge cache hit from inside the region.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Control label="runs">
            <ToggleGroup type="single" variant="outline" size="sm" value={String(runs)} onValueChange={(v) => v && setRuns(Number(v))} disabled={busy}>
              {RUNS.map((r) => (
                <ToggleGroupItem key={r} value={String(r)} className="tabular px-3">
                  {r}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Control>
          <Control label="sequential">
            <ToggleGroup type="single" variant="outline" size="sm" value={String(seqMiB)} onValueChange={(v) => v && setSeqMiB(Number(v))} disabled={busy}>
              {SEQ.map((s) => (
                <ToggleGroupItem key={s} value={String(s)} className="tabular px-3">
                  {s} MiB
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Control>
          <Button disabled={busy || frozen} onClick={() => void run(() => api.benchRun({ runs, seqMiB, baseUrl: window.location.origin }))}>
            {busy ? "Running…" : "Run benchmark"}
          </Button>
        </div>
      </header>

      <JobProgress job={job} />

      {result ? (
        <>
          <p className="text-xs text-muted-foreground">
            Last run {fmtTime(result.generatedAt)} · {result.config.runs} run{result.config.runs === 1 ? "" : "s"} ·
            sequential {Math.round(result.config.seqBytes / 1048576)} MiB · {result.config.randomReads} × 1 MiB random
            reads · {result.config.smallFiles} × 4 KiB small-file reads
            {result.config.ebs?.iops ? ` · EBS gp3 ${result.config.ebs.iops} IOPS / ${result.config.ebs.throughputMiBps} MiB/s` : ""}
            {result.config.efs?.throughputMode ? ` · EFS ${result.config.efs.throughputMode}` : ""}
          </p>
          {coldNote && <p className="text-sm text-amber-700">{coldNote}</p>}

          <div className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
            <HBarChart
              title="First byte"
              subtitle="how long until the storage starts answering · median · lower is better"
              rows={rows((id) => ok(id)?.ttfb_ms?.p50)}
              format={(v) => fmtMs(v)}
              tickFormat={tickMs}
            />
            <HBarChart
              title="Sequential read"
              subtitle={`one stream reading ${Math.round(result.config.seqBytes / 1048576)} MiB of the MP4 · higher is better`}
              rows={seqRows}
              format={(v) => fmtMiBps(v)}
            />
            <HBarChart
              title="Random 1 MiB read · p95"
              subtitle="a viewer skipping ahead, slow tail: one seek in twenty is at least this slow"
              rows={rows((id) => ok(id)?.random_ms?.p95)}
              format={(v) => fmtMs(v)}
              tickFormat={tickMs}
            />
            <HBarChart
              title="Small file"
              subtitle="open a file and read 4 KiB: the cost of touching one more file · median · lower is better"
              rows={rows((id) => ok(id)?.smallfile_ms?.p50)}
              format={(v) => fmtMs(v)}
              tickFormat={tickMs}
            />
          </div>

          <Explainer group="bench" />

          <Table className="tabular">
            <TableHeader>
              <TableRow>
                <TableHead>backend</TableHead>
                <TableHead className="text-right">first byte p50</TableHead>
                <TableHead className="text-right">first byte p95</TableHead>
                <TableHead className="text-right">small file total</TableHead>
                <TableHead className="text-right">sequential</TableHead>
                <TableHead className="text-right">parallel</TableHead>
                <TableHead className="text-right">random p50</TableHead>
                <TableHead className="text-right">random p95</TableHead>
                <TableHead className="text-right">random max</TableHead>
                <TableHead className="text-right">small file p50</TableHead>
                <TableHead className="text-right">small file p95</TableHead>
                <TableHead className="text-right">cold cache</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ids.map((id) => {
                const b = result.backends[id];
                const o = ok(id);
                return (
                  <TableRow key={id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <Dot id={id} />
                        {b?.label ?? BACKEND_SHORT[id]}
                      </span>
                    </TableCell>
                    {o ? (
                      <>
                        <TableCell className="text-right">{fmtMs(o.ttfb_ms?.p50)}</TableCell>
                        <TableCell className="text-right">{fmtMs(o.ttfb_ms?.p95)}</TableCell>
                        <TableCell className="text-right">{fmtMs(o.small_total_ms?.p50)}</TableCell>
                        <TableCell className="text-right">{fmtMiBps(o.seq_mbps?.p50)}</TableCell>
                        <TableCell className="text-right">{o.parallel_mbps ? fmtMiBps(o.parallel_mbps.p50) : "—"}</TableCell>
                        <TableCell className="text-right">{fmtMs(o.random_ms?.p50)}</TableCell>
                        <TableCell className="text-right">{fmtMs(o.random_ms?.p95)}</TableCell>
                        <TableCell className="text-right">{fmtMs(o.random_ms?.max)}</TableCell>
                        <TableCell className="text-right">{fmtMs(o.smallfile_ms?.p50)}</TableCell>
                        <TableCell className="text-right">{fmtMs(o.smallfile_ms?.p95)}</TableCell>
                        <TableCell className="text-right">{o.coldCache == null ? "n/a" : o.coldCache ? "yes" : "no"}</TableCell>
                      </>
                    ) : (
                      <TableCell colSpan={11} className="text-muted-foreground">
                        {b?.error ?? "no data"}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="max-w-4xl text-xs text-muted-foreground">
            Measured on the EC2 instance, cold page cache; S3 over the VPC endpoint. EBS, EFS and instance store are read
            through the file system; S3 through the SDK. "Parallel" is S3 only: {result.config.parallelStreams ?? 8}{" "}
            concurrent ranged GETs of the same bytes, the way real S3 clients get throughput.
          </p>
        </>
      ) : (
        !busy && <p className="py-12 text-center text-sm text-muted-foreground">No benchmark yet. Press Run benchmark.</p>
      )}
    </section>
  );
}
