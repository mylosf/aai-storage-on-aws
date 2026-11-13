import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Control } from "@/components/Bench";
import { Dot } from "@/components/Dot";
import { Explainer } from "@/components/Explainer";
import { HBarChart, type HBarRow } from "@/components/HBarChart";
import { JobProgress } from "@/components/JobProgress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fmtBytes, fmtMs, fmtNum, fmtPct, fmtTime } from "@/format";
import { BACKEND_SHORT, colorOf } from "@/palette";
import { BACKEND_ORDER, type Backend, type BackendId, type LoadResult } from "@/types";
import { useJob } from "@/useJob";

const VU_PRESETS = [10, 50, 200, 500];
const RENDITIONS = ["360p", "720p", "1080p"];
const tickMs = (v: number) => fmtMs(v, v < 10 ? 1 : 0);

export function LoadTest({ backends, frozen }: { backends: Backend[]; frozen?: boolean }) {
  const [vus, setVus] = useState(50);
  const [durationSec, setDurationSec] = useState(30);
  const [rendition, setRendition] = useState("720p");
  const { job, busy, error, run, clearError } = useJob<LoadResult>(api.loadtestLatest);

  useEffect(() => {
    if (error) {
      toast.error(`Load test: ${error}`);
      clearError();
    }
  }, [error, clearError]);

  const result = job?.status === "done" ? job.result : null;
  const ids = BACKEND_ORDER.filter((id) => result?.backends[id]);
  const ready = backends.filter((b) => b.ready).map((b) => b.id);
  const segMs = (result?.config.segmentSeconds ?? 4) * 1000;
  const expectedSec = ready.length * (durationSec + 5) + 15;

  const rows = (pick: (id: BackendId) => number | null | undefined): HBarRow[] =>
    ids.map((id) => ({
      key: id,
      label: BACKEND_SHORT[id],
      value: pick(id),
      color: colorOf(id),
      note: `${fmtNum(result?.backends[id]?.requests)} requests`,
    }));

  return (
    <section className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-3xl space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">Concurrent viewers</h2>
          <p className="text-sm text-muted-foreground">
            A second instance plays the film as many viewers at once, one backend after another. Each viewer fetches a
            segment and then waits out the rest of its 4 seconds, like a real player. A fetch slower than the segment is
            a stall. Run it twice: the first pass warms the CloudFront cache.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Control label="viewers">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={VU_PRESETS.includes(vus) ? String(vus) : ""}
              onValueChange={(v) => v && setVus(Number(v))}
              disabled={busy}
            >
              {VU_PRESETS.map((v) => (
                <ToggleGroupItem key={v} value={String(v)} className="tabular px-3">
                  {v}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Input
              type="number"
              min={1}
              max={2000}
              value={vus}
              disabled={busy}
              onChange={(e) => setVus(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))}
              className="tabular h-8 w-20"
            />
          </Control>
          <Control label="duration">
            <Input
              type="number"
              min={10}
              max={300}
              step={5}
              value={durationSec}
              disabled={busy}
              onChange={(e) => setDurationSec(Math.max(10, Math.min(300, Number(e.target.value) || 10)))}
              className="tabular h-8 w-20"
            />
            <span className="text-xs text-muted-foreground">s</span>
          </Control>
          <Control label="rendition">
            <Select value={rendition} onValueChange={setRendition} disabled={busy}>
              <SelectTrigger size="sm" className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RENDITIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Control>
          <Button
            disabled={busy || frozen || ready.length === 0}
            onClick={() =>
              void run(() =>
                api.loadtestRun({ vus, durationSec, rendition, baseUrl: window.location.origin, backends: ready }),
              )
            }
          >
            {busy ? "Running…" : `Run · ~${Math.max(1, Math.round(expectedSec / 60))} min`}
          </Button>
        </div>
      </header>

      <JobProgress job={job} />

      {result ? (
        <>
          <p className="text-xs text-muted-foreground">
            Last run {fmtTime(result.generatedAt)} · {result.config.vus} viewers × {result.config.durationSec} s per
            backend · {result.config.rendition} · via {result.config.baseUrl}
          </p>

          <div className="grid gap-x-12 gap-y-8 lg:grid-cols-3">
            <HBarChart
              title="Segment first byte · p95"
              subtitle="slow tail of time to first byte under load · lower is better"
              rows={rows((id) => result.backends[id]?.ttfb_ms?.p95)}
              format={(v) => fmtMs(v)}
              tickFormat={tickMs}
            />
            <HBarChart
              title="Segment fetch time · p95"
              subtitle="past the segment length the player stalls"
              rows={rows((id) => result.backends[id]?.fetch_ms?.p95)}
              format={(v) => fmtMs(v)}
              tickFormat={tickMs}
              reference={{ value: segMs, label: `${segMs / 1000} s segment` }}
            />
            <HBarChart
              title="Stall rate"
              subtitle="share of fetches slower than the segment · lower is better"
              rows={rows((id) => (result.backends[id]?.stall_rate ?? 0) * 100)}
              format={(v) => `${v.toFixed(v < 1 ? 2 : 1)} %`}
            />
          </div>

          <Explainer group="load" />

          <Table className="tabular">
            <TableHeader>
              <TableRow>
                <TableHead>backend</TableHead>
                <TableHead className="text-right">requests</TableHead>
                <TableHead className="text-right">bytes</TableHead>
                <TableHead className="text-right">first byte p50</TableHead>
                <TableHead className="text-right">first byte p95</TableHead>
                <TableHead className="text-right">fetch p50</TableHead>
                <TableHead className="text-right">fetch p95</TableHead>
                <TableHead className="text-right">fetch max</TableHead>
                <TableHead className="text-right">stalls</TableHead>
                <TableHead className="text-right">errors</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ids.map((id) => {
                const b = result.backends[id];
                return (
                  <TableRow key={id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <Dot id={id} />
                        {BACKEND_SHORT[id]}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{fmtNum(b?.requests)}</TableCell>
                    <TableCell className="text-right">{fmtBytes(b?.bytes)}</TableCell>
                    <TableCell className="text-right">{fmtMs(b?.ttfb_ms?.p50)}</TableCell>
                    <TableCell className="text-right">{fmtMs(b?.ttfb_ms?.p95)}</TableCell>
                    <TableCell className="text-right">{fmtMs(b?.fetch_ms?.p50)}</TableCell>
                    <TableCell className="text-right">{fmtMs(b?.fetch_ms?.p95)}</TableCell>
                    <TableCell className="text-right">{fmtMs(b?.fetch_ms?.max)}</TableCell>
                    <TableCell className="text-right">{fmtPct(b?.stall_rate)}</TableCell>
                    <TableCell className="text-right">{fmtPct(b?.error_rate)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="max-w-4xl text-xs text-muted-foreground">
            Requests travel the same path a viewer's would: through CloudFront for EBS/EFS/NVMe (cache disabled) and
            S3 + CloudFront (cached), and straight to S3 for the presigned variant. The load generator sits in the same
            region as the origin, so its latencies are optimistic; compare backends against each other.
          </p>
        </>
      ) : (
        !busy && <p className="py-12 text-center text-sm text-muted-foreground">No load test yet. Choose a viewer count and press Run.</p>
      )}
    </section>
  );
}
