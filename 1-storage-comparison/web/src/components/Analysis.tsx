import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Dot } from "@/components/Dot";
import { HBarChart, type HBarRow } from "@/components/HBarChart";
import { JobProgress } from "@/components/JobProgress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fmtMiBps, fmtMs, fmtNum, fmtPct, fmtTime } from "@/format";
import { BACKEND_SHORT, colorOf } from "@/palette";
import { useJob } from "@/useJob";
import type { BackendId, OriginId, PathsResult, StormResult } from "@/types";

const ORIGINS: OriginId[] = ["nvme", "ebs", "efs", "s3"];
// In the hit/miss experiment "s3" is the bucket behind CloudFront, not the presigned direct path.
const ORIGIN_LABEL: Record<OriginId, string> = { nvme: "Instance store", ebs: "EBS gp3", efs: "EFS", s3: "S3" };
const tickMs = (v: number) => fmtMs(v, v < 10 ? 1 : 0);
const base = () => window.location.origin;

// ===================================================================== page
export function Analysis({ loadgen, frozen }: { loadgen: boolean; frozen?: boolean }) {
  const paths = useJob<PathsResult>(() => api.simLatest().then((x) => x.paths ?? Promise.reject(new Error("none"))));
  const storm = useJob<StormResult>(() => api.simLatest().then((x) => x.storm ?? Promise.reject(new Error("none"))));
  const [outageSummary, setOutageSummary] = useState<string | null>(null);
  const [costSummary, setCostSummary] = useState<string | null>(null);

  const pr = paths.job?.status === "done" ? paths.job.result : null;
  const sr = storm.job?.status === "done" ? storm.job.result : null;

  const listP = (pick: (b: NonNullable<PathsResult["backends"][OriginId]>) => number | null | undefined, f: (v: number) => string) =>
    pr
      ? ORIGINS.filter((id) => pr.backends[id])
          .map((id) => `${ORIGIN_LABEL[id]} ${f(pick(pr.backends[id]!) ?? NaN)}`)
          .join(" · ")
      : null;

  const stormEvidence = (() => {
    if (!sr) return null;
    const ids = (Object.keys(sr.backends) as BackendId[]).filter((id) => sr.backends[id]?.stages?.length);
    const last = sr.config.stages[sr.config.stages.length - 1];
    if (!last) return null;
    return (
      `at ${last.rate} req/s: ` +
      ids
        .map((id) => {
          const st = sr.backends[id]!.stages!.at(-1)!;
          return `${BACKEND_SHORT[id]} p95 ${fmtMs(st.ttfb_p95)}${st.error_rate ? `, ${fmtPct(st.error_rate, 1)} errors` : ""}`;
        })
        .join(" · ")
    );
  })();

  const rows = [
    {
      situation: "Cache hit (the common case)",
      winner: "tie",
      evidence: listP((b) => b.hit_ttfb_ms?.p50, fmtMs) ?? "run “CloudFront in front of all” below",
      claim: "Once the edge has the object, the origin is out of the picture.",
    },
    {
      situation: "Single miss, first byte",
      winner: "NVMe ≈ EBS, then EFS, then S3",
      evidence: listP((b) => b.miss_ttfb_ms?.p50, fmtMs) ?? "run “CloudFront in front of all” below",
      claim: "nginx on the instance answers in milliseconds; the edge’s round trip to S3 costs tens.",
    },
    {
      situation: "Single miss, big-file throughput",
      winner: "instance origins, S3 single-stream last",
      evidence: listP((b) => b.miss_mbps?.p50, fmtMiBps) ?? "run “CloudFront in front of all” below",
      claim: "A cold gp3 volume is capped at 125 MiB/s; CloudFront pulls from S3 with one connection per object.",
    },
    {
      situation: "Many simultaneous misses",
      winner: "S3, once a single origin’s ceiling is reached",
      evidence: stormEvidence ?? (loadgen ? "run “Miss storm” below" : "needs the load generator"),
      claim: "At hundreds of requests per second one instance holds fine; the difference is the ceiling. One NIC and two vCPUs versus S3 scaling horizontally, and a same-sized generator gives out before the origin does.",
    },
    {
      situation: "Origin failure",
      winner: "S3 (and anything already cached)",
      evidence: outageSummary ?? (frozen ? "recorded during the workshop: uncached EC2 paths returned 503 within seconds; EBS through the edge cache, S3 + CloudFront and S3 direct kept serving" : "run “Origin outage” below"),
      claim: "The EC2 origin is one instance in one AZ. S3 is regional; the edge keeps serving what it has.",
    },
    {
      situation: "Cost of keeping the origin",
      winner: "S3",
      evidence: costSummary ?? "see the calculator below",
      claim: "Object storage per GB plus no instance, versus a volume or file system plus the EC2 hours.",
    },
  ];

  return (
    <section className="space-y-14">
      <header className="max-w-3xl space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">If CloudFront sat in front of everything</h2>
        <p className="text-sm text-muted-foreground">
          With a warm edge the five backends become indistinguishable, so the question turns into who serves the
          misses, the storms and the outages. Each row below is an experiment you can run against this deployment;
          the Evidence column fills in from the latest result.
        </p>
      </header>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-56">Situation</TableHead>
            <TableHead className="w-56">Winner</TableHead>
            <TableHead>Evidence from this stack</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.situation} className="hover:bg-transparent">
              <TableCell className="whitespace-normal py-3 align-top text-sm font-medium">{r.situation}</TableCell>
              <TableCell className="whitespace-normal py-3 align-top text-sm">{r.winner}</TableCell>
              <TableCell className="whitespace-normal py-3 align-top text-sm">
                <div className="tabular">{r.evidence}</div>
                <div className="text-xs text-muted-foreground">{r.claim}</div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <PathsExperiment job={paths} frozen={frozen} />
      {loadgen && <StormExperiment job={storm} frozen={frozen} />}
      {!frozen && <OutageExperiment onSummary={setOutageSummary} />}
      <CostCalculator onSummary={setCostSummary} />
    </section>
  );
}

// ================================================================ hit / miss
function PathsExperiment({ job, frozen }: { job: ReturnType<typeof useJob<PathsResult>>; frozen?: boolean }) {
  const [runs, setRuns] = useState(3);
  const [seqMiB, setSeqMiB] = useState(64);
  useEffect(() => {
    if (job.error) {
      toast.error(`Hit vs miss: ${job.error}`);
      job.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.error]);
  const r = job.job?.status === "done" ? job.job.result : null;
  const ids = ORIGINS.filter((id) => r?.backends[id]);

  const pair = (pick: (b: NonNullable<PathsResult["backends"][OriginId]>, kind: "hit" | "miss") => number | null | undefined): HBarRow[] =>
    ids.flatMap((id) => {
      const b = r!.backends[id]!;
      return [
        { key: `${id}-hit`, label: `${ORIGIN_LABEL[id]} · hit`, value: pick(b, "hit"), color: colorOf(id), note: `warm edge, ${b.hitPath}` },
        { key: `${id}-miss`, label: `${ORIGIN_LABEL[id]} · miss`, value: pick(b, "miss"), color: colorOf(id), muted: true, note: `never cached, ${b.missPath}` },
      ];
    });

  return (
    <Experiment
      title="CloudFront in front of all: hit versus miss"
      lede="Every origin fetched through the distribution twice: once through a path the edge caches (after one warm-up request) and once through a path it never caches, with the instance’s page cache dropped so EC2 origins really read their storage. Measured from the instance, so the viewer-side latency is left out and the comparison is between origins."
      controls={
        <>
          <Seg label="runs" value={runs} set={setRuns} options={[1, 3, 5]} disabled={job.busy} />
          <Seg label="file" value={seqMiB} set={setSeqMiB} options={[64, 128, 256]} unit=" MiB" disabled={job.busy} />
          <Button disabled={job.busy || frozen} onClick={() => void job.run(() => api.simPaths({ baseUrl: base(), runs, seqMiB }))}>
            {job.busy ? "Running…" : "Run"}
          </Button>
        </>
      }
      job={job.job}
    >
      {r && (
        <>
          <p className="text-xs text-muted-foreground">
            Last run {fmtTime(r.generatedAt)} · {r.config.runs} runs · {Math.round(r.config.seqBytes / 1048576)} MiB file
          </p>
          <div className="grid gap-8 lg:grid-cols-2">
            <HBarChart
              title="First byte through the edge"
              subtitle="solid: cache hit · faded: miss, origin answers · lower is better"
              rows={pair((b, k) => (k === "hit" ? b.hit_ttfb_ms?.p50 : b.miss_ttfb_ms?.p50))}
              format={(v) => fmtMs(v)}
              tickFormat={tickMs}
            />
            <HBarChart
              title={`Throughput through the edge, ${Math.round(r.config.seqBytes / 1048576)} MiB`}
              subtitle="solid: cache hit · faded: miss, origin streams · higher is better"
              rows={pair((b, k) => (k === "hit" ? b.hit_mbps?.p50 : b.miss_mbps?.p50))}
              format={(v) => fmtMiBps(v)}
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>origin</TableHead>
                <TableHead className="text-right">hit first byte</TableHead>
                <TableHead className="text-right">miss first byte</TableHead>
                <TableHead className="text-right">hit throughput</TableHead>
                <TableHead className="text-right">miss throughput</TableHead>
                <TableHead>cached path</TableHead>
                <TableHead>miss path</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ids.map((id) => {
                const b = r.backends[id]!;
                return (
                  <TableRow key={id} className="tabular">
                    <TableCell className="flex items-center gap-2">
                      <Dot id={id} />
                      {ORIGIN_LABEL[id]}
                    </TableCell>
                    <TableCell className="text-right">{fmtMs(b.hit_ttfb_ms?.p50)}</TableCell>
                    <TableCell className="text-right">{fmtMs(b.miss_ttfb_ms?.p50)}</TableCell>
                    <TableCell className="text-right">{fmtMiBps(b.hit_mbps?.p50)}</TableCell>
                    <TableCell className="text-right">{fmtMiBps(b.miss_mbps?.p50)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{b.hitPath}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{b.missPath}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </>
      )}
    </Experiment>
  );
}

// ==================================================================== storm
const STORM_BACKENDS: BackendId[] = ["nvme", "ebs", "efs", "s3", "cdn"];

function StormExperiment({ job, frozen }: { job: ReturnType<typeof useJob<StormResult>>; frozen?: boolean }) {
  const [stages, setStages] = useState("50:15,200:15,500:15");
  const [backends, setBackends] = useState<string[]>(["ebs", "s3", "cdn"]);
  useEffect(() => {
    if (job.error) {
      toast.error(`Miss storm: ${job.error}`);
      job.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.error]);
  const r = job.job?.status === "done" ? job.job.result : null;
  const ids = STORM_BACKENDS.filter((id) => r?.backends[id]?.stages?.length);
  const totalSec = stages
    .split(",")
    .map((s) => Number(s.split(":")[1] ?? 0))
    .reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const expectedMin = Math.max(1, Math.round(((totalSec + 5) * backends.length + 15) / 60));

  return (
    <Experiment
      title="Miss storm: every request reaches the origin"
      lede="A cache purge or a launch: k6 on the second instance fires a fixed number of requests per second, in stages, at the paths CloudFront never caches. EC2 origins serve from nginx; S3 is reached through the edge on every request. S3 + CloudFront is the edge-hit reference. Watch p95 first byte and errors as the rate climbs; “dropped” means the generator itself could not keep up."
      controls={
        <>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">stages</span>
            <Input value={stages} onChange={(e) => setStages(e.target.value)} className="h-9 w-56 font-mono text-xs" disabled={job.busy} />
            <span className="text-xs text-muted-foreground">req/s : seconds</span>
          </label>
          <ToggleGroup type="multiple" value={backends} onValueChange={(v) => v.length && setBackends(v)} variant="outline" size="sm" disabled={job.busy}>
            {STORM_BACKENDS.map((id) => (
              <ToggleGroupItem key={id} value={id} className="gap-1.5 px-3">
                <Dot id={id} />
                {BACKEND_SHORT[id]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            disabled={job.busy || frozen}
            onClick={() => void job.run(() => api.simStorm({ baseUrl: base(), stages, backends }))}
          >
            {job.busy ? "Running…" : `Run (~${expectedMin} min)`}
          </Button>
        </>
      }
      job={job.job}
    >
      {r && (
        <>
          <p className="text-xs text-muted-foreground">
            Last run {fmtTime(r.generatedAt)} · {r.config.rendition} segments · stages{" "}
            {r.config.stages.map((s) => `${s.rate} req/s × ${s.seconds} s`).join(", ")}
          </p>
          <div className="grid gap-8 lg:grid-cols-3">
            {ids.map((id) => (
              <HBarChart
                key={id}
                title={`${BACKEND_SHORT[id]} · first byte p95`}
                subtitle={id === "cdn" ? "edge hits, for reference" : "misses, every request at the origin"}
                rows={r.backends[id]!.stages!.map((s) => ({
                  key: `${id}-${s.rate}`,
                  label: `${s.rate} req/s`,
                  value: s.ttfb_p95,
                  color: colorOf(id),
                  note: `${fmtNum(s.requests)} requests${s.error_rate ? `, ${fmtPct(s.error_rate, 1)} errors` : ""}`,
                }))}
                format={(v) => fmtMs(v)}
                tickFormat={tickMs}
              />
            ))}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>backend</TableHead>
                <TableHead className="text-right">stage</TableHead>
                <TableHead className="text-right">requests</TableHead>
                <TableHead className="text-right">first byte p50</TableHead>
                <TableHead className="text-right">first byte p95</TableHead>
                <TableHead className="text-right">fetch p95</TableHead>
                <TableHead className="text-right">errors</TableHead>
                <TableHead className="text-right">dropped by generator</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ids.flatMap((id) =>
                r.backends[id]!.stages!.map((s, i) => (
                  <TableRow key={`${id}-${i}`} className="tabular">
                    <TableCell className="flex items-center gap-2">
                      {i === 0 && (
                        <>
                          <Dot id={id} />
                          {BACKEND_SHORT[id]}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{s.rate} req/s</TableCell>
                    <TableCell className="text-right">{fmtNum(s.requests)}</TableCell>
                    <TableCell className="text-right">{fmtMs(s.ttfb_p50)}</TableCell>
                    <TableCell className="text-right">{fmtMs(s.ttfb_p95)}</TableCell>
                    <TableCell className="text-right">{fmtMs(s.fetch_p95)}</TableCell>
                    <TableCell className="text-right">{fmtPct(s.error_rate)}</TableCell>
                    <TableCell className="text-right">{i === 0 ? fmtNum(r.backends[id]!.dropped) : ""}</TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Both the origin and the load generator are 2-vCPU instances with burstable network, so at high rates the
            generator may be the limit before the origin is. A non-zero “dropped” column means exactly that; raise the
            generator size, not the conclusion.
          </p>
        </>
      )}
    </Experiment>
  );
}

// =================================================================== outage
interface Probe {
  id: string;
  backend: BackendId;
  label: string;
  url: string;
}
interface Sample {
  t: number;
  ok: boolean;
  ms: number;
  status: number;
}

function OutageExperiment({ onSummary }: { onSummary: (s: string) => void }) {
  const [seconds, setSeconds] = useState(60);
  const [phase, setPhase] = useState<"idle" | "baseline" | "outage" | "recovery" | "done">("idle");
  const [samples, setSamples] = useState<Record<string, Sample[]>>({});
  const [probes, setProbes] = useState<Probe[]>([]);
  const timer = useRef<number | null>(null);
  const t0 = useRef(0);

  useEffect(() => () => void (timer.current && window.clearInterval(timer.current)), []);

  const buildProbes = async (): Promise<Probe[]> => {
    const seg = "360p/seg_00001.ts";
    const list: Probe[] = [
      { id: "nvme", backend: "nvme", label: "Instance store, uncached", url: `/nvme/video/${seg}` },
      { id: "ebs", backend: "ebs", label: "EBS, uncached", url: `/ebs/video/${seg}` },
      { id: "efs", backend: "efs", label: "EFS, uncached", url: `/efs/video/${seg}` },
      { id: "ebs-cached", backend: "ebs", label: "EBS through the CloudFront cache", url: `/cached/ebs/video/${seg}` },
      { id: "cdn", backend: "cdn", label: "S3 + CloudFront", url: `/video/${seg}` },
    ];
    try {
      const m3u8 = await fetch(`/api/hls/360p/index.m3u8?r=${Date.now()}`).then((r) => r.text());
      const first = m3u8.split("\n").find((l) => /^https?:\/\//.test(l.trim()));
      if (first) list.push({ id: "s3", backend: "s3", label: "S3 direct (presigned)", url: first.trim() });
    } catch {
      /* S3 direct row omitted */
    }
    return list;
  };

  const tick = async (list: Probe[]) => {
    const t = Math.round((Date.now() - t0.current) / 1000);
    const results = await Promise.all(
      list.map(async (p) => {
        const start = performance.now();
        try {
          const res = await fetch(p.url, { cache: "no-store", headers: { Range: "bytes=0-1023" } });
          return { id: p.id, s: { t, ok: res.status === 200 || res.status === 206, ms: performance.now() - start, status: res.status } };
        } catch {
          return { id: p.id, s: { t, ok: false, ms: performance.now() - start, status: 0 } };
        }
      }),
    );
    setSamples((prev) => {
      const next = { ...prev };
      for (const r of results) next[r.id] = [...(next[r.id] ?? []), r.s];
      return next;
    });
  };

  const start = async () => {
    const list = await buildProbes();
    setProbes(list);
    setSamples({});
    t0.current = Date.now();
    setPhase("baseline");
    for (let i = 0; i < 3; i++) await tick(list);
    try {
      await api.outageStart(seconds);
    } catch (err) {
      toast.error(`Outage: ${(err as Error).message}`);
      setPhase("idle");
      return;
    }
    setPhase("outage");
    const outageEnd = Date.now() + seconds * 1000;
    const stopAt = outageEnd + 12000;
    timer.current = window.setInterval(() => {
      void tick(list);
      if (Date.now() > outageEnd) setPhase("recovery");
      if (Date.now() > stopAt) {
        if (timer.current) window.clearInterval(timer.current);
        timer.current = null;
        setPhase("done");
      }
    }, 2000);
  };

  const stop = async () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    await api.outageStop().catch(() => {});
    setPhase("done");
  };

  useEffect(() => {
    if (phase !== "done" || !probes.length) return;
    const fails = (id: string) => (samples[id] ?? []).filter((s) => !s.ok).length;
    const n = (id: string) => (samples[id] ?? []).length;
    const ec2 = ["nvme", "ebs", "efs"].filter((id) => samples[id]);
    const ec2Fails = ec2.reduce((a, id) => a + fails(id), 0);
    const ec2N = ec2.reduce((a, id) => a + n(id), 0);
    onSummary(
      `origin down ${seconds} s: uncached EC2 paths failed ${ec2Fails}/${ec2N} probes · EBS via cache ${fails("ebs-cached")}/${n("ebs-cached")} · S3 + CloudFront ${fails("cdn")}/${n("cdn")}${samples.s3 ? ` · S3 direct ${fails("s3")}/${n("s3")}` : ""}`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const running = phase === "baseline" || phase === "outage" || phase === "recovery";

  return (
    <Experiment
      title="Origin outage"
      lede="nginx on the EC2 instance is told to answer 503 on the storage paths for a while, as if the instance or its AZ were gone. This page then probes every path through CloudFront every two seconds, from your browser. Uncached EC2 paths fail immediately; S3 is untouched; the edge keeps serving what it has already cached. Switch to the Players tab during the window to watch the tiles stall and recover."
      controls={
        <>
          <Seg label="outage" value={seconds} set={setSeconds} options={[30, 60, 120]} unit=" s" disabled={running} />
          {running ? (
            <Button variant="outline" onClick={() => void stop()}>
              Restore origin now
            </Button>
          ) : (
            <Button onClick={() => void start()}>Break the origin</Button>
          )}
          {phase !== "idle" && (
            <span className="text-sm text-muted-foreground">
              {phase === "baseline" ? "baseline…" : phase === "outage" ? "origin down" : phase === "recovery" ? "origin back, watching recovery" : "done"}
            </span>
          )}
        </>
      }
      job={null}
    >
      {probes.length > 0 && (
        <div className="space-y-2">
          {probes.map((p) => {
            const list = samples[p.id] ?? [];
            const fails = list.filter((s) => !s.ok).length;
            return (
              <div key={p.id} className="grid items-center gap-3 md:grid-cols-[260px_minmax(0,1fr)_200px]">
                <div className="flex items-center gap-2 text-sm">
                  <Dot id={p.backend} />
                  {p.label}
                </div>
                <div className="flex flex-wrap gap-0.5" aria-label={`${p.label} probes`}>
                  {list.map((s, i) => (
                    <span
                      key={i}
                      title={`t+${s.t}s · HTTP ${s.status || "—"} · ${fmtMs(s.ms)}`}
                      className="size-3 rounded-[2px]"
                      style={{ background: s.ok ? "var(--backend-efs)" : "var(--destructive)", opacity: s.ok ? 0.75 : 1 }}
                    />
                  ))}
                </div>
                <div className="tabular text-right text-sm text-muted-foreground">
                  {fails ? `${fails} of ${list.length} failed` : `${list.length} of ${list.length} ok`}
                </div>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">
            Green: 200/206 within the probe. Red: error or no answer. “EBS through the CloudFront cache” shows the
            edge serving a stale copy while its origin is down; the uncached EC2 rows show what a viewer sees without
            a cache in front.
          </p>
        </div>
      )}
    </Experiment>
  );
}

// ===================================================================== cost
const PRICE = {
  s3: 0.023,
  ebs: 0.08,
  efsStorage: 0.3,
  efsRead: 0.03,
  cfEgress: 0.085,
  cfFreeGB: 1024,
  hours: 730,
  ec2: [
    { name: "m6id.large", gb: 118, hour: 0.1187 },
    { name: "m6id.xlarge", gb: 237, hour: 0.2373 },
    { name: "m6id.2xlarge", gb: 474, hour: 0.4746 },
    { name: "m6id.4xlarge", gb: 950, hour: 0.9492 },
    { name: "m6id.8xlarge", gb: 1900, hour: 1.8984 },
    { name: "m6id.12xlarge", gb: 2850, hour: 2.8476 },
    { name: "m6id.16xlarge", gb: 3800, hour: 3.7968 },
    { name: "m6id.24xlarge", gb: 5700, hour: 5.6952 },
    { name: "m6id.32xlarge", gb: 7600, hour: 7.5936 },
  ],
};
const usd = (v: number) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function CostCalculator({ onSummary }: { onSummary: (s: string) => void }) {
  const [libraryTB, setLibraryTB] = useState(1);
  const [servedTB, setServedTB] = useState(10);
  const [hitPct, setHitPct] = useState(90);

  const rows = useMemo(() => {
    const libGB = libraryTB * 1024;
    const servedGB = servedTB * 1024;
    const originGB = servedGB * (1 - hitPct / 100);
    const egress = Math.max(0, servedGB - PRICE.cfFreeGB) * PRICE.cfEgress;
    const small = PRICE.ec2[0]!;
    const nvmeType = PRICE.ec2.find((t) => t.gb >= libGB);
    const inst = small.hour * PRICE.hours;
    return [
      { id: "cdn" as BackendId, name: "S3 + CloudFront", storage: libGB * PRICE.s3, reads: 0, compute: 0, egress, note: "no instance; S3 → CloudFront transfer is free" },
      { id: "ebs" as BackendId, name: "EBS gp3 + EC2 + CloudFront", storage: libGB * PRICE.ebs, reads: 0, compute: inst, egress, note: `one ${small.name}; a second AZ doubles the instance and the volume` },
      { id: "efs" as BackendId, name: "EFS + EC2 + CloudFront", storage: libGB * PRICE.efsStorage, reads: originGB * PRICE.efsRead, compute: inst, egress, note: "Elastic throughput bills every byte the origin reads on a miss" },
      {
        id: "nvme" as BackendId,
        name: "Instance store + EC2 + CloudFront",
        storage: 0,
        reads: 0,
        compute: nvmeType ? nvmeType.hour * PRICE.hours : NaN,
        egress,
        note: nvmeType ? `${nvmeType.name} is the smallest with ${nvmeType.gb} GB of NVMe; data must be re-copied on every stop` : "no single instance holds that much",
      },
    ].map((r) => ({ ...r, total: r.storage + r.reads + r.compute + r.egress }));
  }, [libraryTB, servedTB, hitPct]);

  useEffect(() => {
    const byTotal = [...rows].filter((r) => Number.isFinite(r.total)).sort((a, b) => a.total - b.total);
    if (byTotal.length) onSummary(`${libraryTB} TB library, ${servedTB} TB/month: ` + byTotal.map((r) => `${r.name.split(" +")[0]} ${usd(r.total)}`).join(" · "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  return (
    <Experiment
      title="Cost of keeping the origin"
      lede="Monthly list prices (us-east-1, late 2026; verify before quoting) with CloudFront in front of every option, so the CDN egress is identical and the difference is the origin. Cache hit ratio decides how many bytes the origin actually serves."
      controls={
        <>
          <Num label="library" value={libraryTB} set={setLibraryTB} unit="TB" />
          <Num label="served" value={servedTB} set={setServedTB} unit="TB / month" />
          <Num label="cache hit" value={hitPct} set={setHitPct} unit="%" max={100} />
        </>
      }
      job={null}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>option</TableHead>
            <TableHead className="text-right">storage</TableHead>
            <TableHead className="text-right">origin reads</TableHead>
            <TableHead className="text-right">compute</TableHead>
            <TableHead className="text-right">CloudFront egress</TableHead>
            <TableHead className="text-right">per month</TableHead>
            <TableHead>note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className="tabular">
              <TableCell className="flex items-center gap-2 whitespace-normal">
                <Dot id={r.id} />
                {r.name}
              </TableCell>
              <TableCell className="text-right">{usd(r.storage)}</TableCell>
              <TableCell className="text-right">{usd(r.reads)}</TableCell>
              <TableCell className="text-right">{Number.isFinite(r.compute) ? usd(r.compute) : "—"}</TableCell>
              <TableCell className="text-right">{usd(r.egress)}</TableCell>
              <TableCell className="text-right font-medium">{Number.isFinite(r.total) ? usd(r.total) : "—"}</TableCell>
              <TableCell className="whitespace-normal text-xs text-muted-foreground">{r.note}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Prices used: S3 Standard $0.023/GB, EBS gp3 $0.08/GB, EFS Standard $0.30/GB + $0.03/GB read, CloudFront
        $0.085/GB after the first 1 TB free, m6id on-demand from $0.1187/h. Requests, snapshots and support are left
        out; they do not change the order.
      </p>
    </Experiment>
  );
}

// ================================================================== helpers
function Experiment({
  title,
  lede,
  controls,
  job,
  children,
}: {
  title: string;
  lede: string;
  controls: React.ReactNode;
  job: ReturnType<typeof useJob>["job"] | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-5 border-t pt-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-3xl space-y-1.5">
          <h3 className="text-base font-medium">{title}</h3>
          <p className="text-sm text-muted-foreground">{lede}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">{controls}</div>
      </div>
      <JobProgress job={job} />
      {children}
    </div>
  );
}

function Seg<T extends number>({ label, value, set, options, unit = "", disabled }: { label: string; value: T; set: (v: T) => void; options: T[]; unit?: string; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <ToggleGroup type="single" value={String(value)} onValueChange={(v) => v && set(Number(v) as T)} variant="outline" size="sm" disabled={disabled}>
        {options.map((o) => (
          <ToggleGroupItem key={o} value={String(o)} className="tabular px-3">
            {o}
            {unit}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

function Num({ label, value, set, unit, max }: { label: string; value: number; set: (v: number) => void; unit: string; max?: number }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type="number"
        min={0}
        max={max}
        step={label === "cache hit" ? 5 : 0.5}
        value={value}
        onChange={(e) => set(Math.max(0, Math.min(max ?? 1e9, Number(e.target.value))))}
        className="tabular h-9 w-24"
      />
      <span className="text-xs text-muted-foreground">{unit}</span>
    </label>
  );
}
