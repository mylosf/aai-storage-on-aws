import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, Upload } from "lucide-react";
import { api } from "@/api";
import { AWS_ICON } from "@/assets/aws";
import { Stat, SubHeader, TabHeader } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Config, UploadCopy, UploadStatus } from "@/types";

const MiB = 1024 * 1024;
const MAX = 50 * MiB;
const fmtSize = (b: number) => (b >= MiB ? `${(b / MiB).toFixed(1)} MiB` : `${Math.max(1, Math.round(b / 1024))} KiB`);
const fmtSec = (s?: number) => (s == null ? "—" : s < 100 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`);

type Phase = "idle" | "signing" | "uploading" | "replicating" | "done" | "error";

interface Run {
  file: File;
  key?: string;
  uploadPct: number;
  tStart: number;
  tUploaded?: number;
  seen: Record<string, number>; // region -> client time first seen present
  status?: UploadStatus;
}

export function UploadTab({ config }: { config: Config | null }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [run, setRun] = useState<Run | null>(null);
  const [now, setNow] = useState(Date.now());
  const input = useRef<HTMLInputElement>(null);
  const poll = useRef<number | null>(null);

  useEffect(() => () => void (poll.current && window.clearTimeout(poll.current)), []);
  useEffect(() => {
    if (phase !== "uploading" && phase !== "replicating") return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [phase]);

  const start = async (file: File) => {
    if (file.size > MAX) return toast.error(`Max ${MAX / MiB} MiB for this demo (${fmtSize(file.size)} selected)`);
    if (poll.current) window.clearTimeout(poll.current);
    const r: Run = { file, uploadPct: 0, tStart: Date.now(), seen: {} };
    setRun(r);
    setPhase("signing");
    try {
      const signed = await api.uploadUrl({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream" });
      setRun((x) => x && { ...x, key: signed.key });
      setPhase("uploading");
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signed.url);
        xhr.setRequestHeader("Content-Type", signed.contentType);
        xhr.setRequestHeader("Content-Disposition", signed.contentDisposition);
        xhr.upload.onprogress = (e) => e.lengthComputable && setRun((x) => x && { ...x, uploadPct: (e.loaded / e.total) * 100 });
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`S3 answered ${xhr.status}: ${xhr.responseText.slice(0, 200)}`)));
        xhr.onerror = () => reject(new Error("network error during upload"));
        xhr.send(file);
      });
      const tUploaded = Date.now();
      setRun((x) => x && { ...x, uploadPct: 100, tUploaded });
      setPhase("replicating");
      const tick = async () => {
        try {
          const s = await api.uploadStatus(signed.key);
          const t = Date.now();
          setRun((x) => {
            if (!x) return x;
            const seen = { ...x.seen };
            for (const c of s.replicas) if (c.present && !seen[c.region]) seen[c.region] = t;
            return { ...x, status: s, seen };
          });
          if (s.replicas.every((c) => c.present) && s.source.replicationStatus === "COMPLETED") return setPhase("done");
        } catch {
          /* transient */
        }
        if (Date.now() - tUploaded < 15 * 60 * 1000) poll.current = window.setTimeout(tick, 2000);
      };
      void tick();
    } catch (err) {
      setPhase("error");
      toast.error((err as Error).message);
    }
  };

  const status = run?.status;
  const copies: UploadCopy[] =
    status?.replicas ??
    (config?.replicas.map((r) => ({ region: r.id, city: r.city, bucket: r.bucket, url: "", present: false })) ?? []);
  const arrived = copies.filter((c) => c.present).length;
  const uploadSec = run?.tUploaded ? (run.tUploaded - run.tStart) / 1000 : run && phase === "uploading" ? (now - run.tStart) / 1000 : undefined;
  const since = run?.tUploaded ? ((phase === "done" ? Math.max(...Object.values(run.seen), run.tUploaded) : now) - run.tUploaded) / 1000 : undefined;
  const lagOf = (c: UploadCopy) => c.lagSec ?? (run?.seen[c.region] && run.tUploaded ? (run.seen[c.region]! - run.tUploaded) / 1000 : undefined);

  return (
    <section className="space-y-10">
      <TabHeader title="Upload a file, watch it replicate">
        Pick any file up to 50 MiB. Your browser uploads it straight into the Frankfurt bucket under{" "}
        <code className="font-mono text-xs">proxies/uploads/</code>; no Lambda touches the bytes. That prefix matches the
        15 <code className="font-mono text-xs">proxies-&lt;region&gt;</code> rules, so S3 copies it into every replica
        bucket on its own. Every copy has a public URL, so you can open them and check for yourself. Uploads are deleted
        after one day everywhere.
      </TabHeader>

      <div
        className="flex flex-wrap items-center gap-4 rounded-xl border border-dashed p-6"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f && phase !== "uploading" && phase !== "signing") void start(f);
        }}
      >
        <input ref={input} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && void start(e.target.files[0])} />
        <Button onClick={() => input.current?.click()} disabled={phase === "uploading" || phase === "signing"}>
          <Upload className="mr-1.5 size-4" /> Choose a file
        </Button>
        <span className="text-sm text-muted-foreground">or drop it here · max 50 MiB · public for 24 h</span>
        {run && (
          <span className="ml-auto text-sm">
            <span className="font-medium">{run.file.name}</span> <span className="text-muted-foreground">· {fmtSize(run.file.size)}</span>
          </span>
        )}
      </div>

      {/* ---------------------------------------------------------- steps */}
      <ol className="grid gap-4 md:grid-cols-4">
        <Step n={1} title="Signed upload URL" state={phase === "signing" ? "active" : run?.key ? "done" : "todo"}>
          API Lambda presigns a PUT for exactly this size, valid 10 min
        </Step>
        <Step n={2} title="Browser → Frankfurt" state={phase === "uploading" ? "active" : run?.tUploaded ? "done" : "todo"}>
          {phase === "uploading" ? `${run?.uploadPct.toFixed(0)} % · ${fmtSec(uploadSec)}` : run?.tUploaded ? `done in ${fmtSec(uploadSec)} · ${((run.file.size / MiB) / (uploadSec || 1)).toFixed(1)} MiB/s` : "direct PUT to S3 eu-central-1"}
        </Step>
        <Step n={3} title="S3 matches 15 rules" state={status ? (status.source.replicationStatus === "COMPLETED" ? "done" : "active") : "todo"}>
          {status ? `x-amz-replication-status: ${status.source.replicationStatus}` : "prefix proxies/ → proxies-<region>"}
        </Step>
        <Step n={4} title="Copies arrive" state={phase === "done" ? "done" : phase === "replicating" ? "active" : "todo"}>
          {run?.tUploaded ? `${arrived}/15 regions · ${fmtSec(since)}` : "One Zone-IA in each region"}
        </Step>
      </ol>
      {phase === "uploading" && <Progress value={run?.uploadPct ?? 0} />}

      {/* ---------------------------------------------------------- flow graphic */}
      <FlowGraphic copies={copies} phase={phase} uploadPct={run?.uploadPct ?? 0} lagOf={lagOf} sourceCity={config?.source.city ?? "Frankfurt"} />

      {run?.tUploaded && (
        <div className="flex flex-wrap gap-10">
          <Stat label="upload to Frankfurt" value={fmtSec(uploadSec)} note={fmtSize(run.file.size)} />
          <Stat label="first copy arrived" value={arrived ? fmtSec(Math.min(...copies.filter((c) => c.present).map((c) => lagOf(c) ?? Infinity))) : "…"} note="after upload finished" />
          <Stat label="last copy arrived" value={arrived === 15 ? fmtSec(Math.max(...copies.map((c) => lagOf(c) ?? 0))) : "…"} note={`${arrived}/15 regions`} />
        </div>
      )}

      {/* ---------------------------------------------------------- urls */}
      {status && (
        <div className="space-y-4">
          <SubHeader title="Public URLs">
            Open any of these in a new tab (or with curl) to see that the copy really is there. The arrival time comes from
            the S3 “Object Created” event in that region; “present” is a HEAD request the API makes against that bucket.
          </SubHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>bucket</TableHead>
                <TableHead>status</TableHead>
                <TableHead className="text-right">arrived after</TableHead>
                <TableHead>storage class</TableHead>
                <TableHead>public URL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <UrlRow city={`${status.source.city} (source)`} region={status.source.region} url={status.source.url} badge={<Badge>source</Badge>} lag="0 s" cls="Standard" />
              {status.replicas.map((c) => (
                <UrlRow
                  key={c.region}
                  city={c.city}
                  region={c.region}
                  url={c.url}
                  badge={c.present ? <Badge variant="secondary" className="font-normal text-emerald-700">arrived</Badge> : <Badge variant="outline" className="font-normal text-muted-foreground">pending</Badge>}
                  lag={fmtSec(lagOf(c))}
                  cls={c.storageClass === "ONEZONE_IA" ? "One Zone-IA" : (c.storageClass ?? "—")}
                  disabled={!c.present}
                />
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Only <code className="font-mono">proxies/uploads/*</code> is public (bucket policy); masters, other proxies and
            sidecars stay private. S3 keeps the version id across regions: source version{" "}
            <code className="font-mono">{status.source.versionId}</code>.
          </p>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ pieces
function Step({ n, title, state, children }: { n: number; title: string; state: "todo" | "active" | "done"; children: React.ReactNode }) {
  return (
    <li className={`rounded-lg border p-4 ${state === "active" ? "border-foreground" : ""} ${state === "todo" ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className={`flex size-5 items-center justify-center rounded-full text-[11px] ${state === "done" ? "bg-emerald-600 text-white" : state === "active" ? "bg-foreground text-background" : "border"}`}>
          {state === "done" ? <Check className="size-3" /> : n}
        </span>
        {title}
      </div>
      <p className="tabular mt-1.5 text-xs text-muted-foreground">{children}</p>
    </li>
  );
}

function UrlRow({ city, region, url, badge, lag, cls, disabled }: { city: string; region: string; url: string; badge: React.ReactNode; lag: string; cls: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <TableRow className="tabular">
      <TableCell className="whitespace-nowrap">
        {city} <span className="font-mono text-xs text-muted-foreground">{region}</span>
      </TableCell>
      <TableCell>{badge}</TableCell>
      <TableCell className="text-right">{lag}</TableCell>
      <TableCell className="text-sm">{cls}</TableCell>
      <TableCell className="max-w-[520px]">
        <div className="flex items-center gap-1.5">
          <span className={`truncate font-mono text-[11px] ${disabled ? "text-muted-foreground/60" : ""}`} title={url}>
            {url}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 shrink-0 p-0"
            aria-label="copy URL"
            onClick={() => {
              void navigator.clipboard.writeText(url);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-7 w-7 shrink-0 p-0" aria-label="open URL">
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ------------------------------------------------------------------ graphic
const GW = 1200;
const ROW = 38;
function FlowGraphic({
  copies,
  phase,
  uploadPct,
  lagOf,
  sourceCity,
}: {
  copies: UploadCopy[];
  phase: Phase;
  uploadPct: number;
  lagOf: (c: UploadCopy) => number | undefined;
  sourceCity: string;
}) {
  const GH = Math.max(420, copies.length * ROW + 70);
  const B = { x: 80, y: GH / 2 };
  const S = { x: 340, y: GH / 2 };
  const BOX = { x: 640, w: 230 };
  const BAR = { x: 900, w: 260 };
  const rowY = (i: number) => 52 + i * ROW;
  const uploading = phase === "uploading" || phase === "signing";
  const uploaded = phase === "replicating" || phase === "done";
  const GREEN = "#059669";
  const lags = copies.map((c) => (c.present ? lagOf(c) : undefined)).filter((v): v is number => v != null);
  const scaleMax = Math.max(30, ...lags) * 1.1;

  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <svg viewBox={`0 0 ${GW} ${GH}`} className="block h-auto w-full min-w-[860px]">
        <defs>
          <style>{`.flow{animation:dash 0.9s linear infinite}@keyframes dash{to{stroke-dashoffset:-18}}`}</style>
          <marker id="up-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M 1 1 L 8 5 L 1 9" fill="none" stroke="#64748b" strokeWidth="1.6" strokeLinecap="round" />
          </marker>
          <marker id="up-arrow-ok" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M 1 1 L 8 5 L 1 9" fill="none" stroke={GREEN} strokeWidth="1.6" strokeLinecap="round" />
          </marker>
        </defs>

        <text x={(B.x + S.x) / 2} y={28} textAnchor="middle" fontSize={12} fill="#64748b">1 · upload</text>
        <text x={(S.x + BOX.x) / 2} y={28} textAnchor="middle" fontSize={12} fill="#64748b">2 · S3 replication (15 rules)</text>
        <text x={BAR.x} y={28} fontSize={12} fill="#64748b">arrived after upload finished</text>

        {/* browser → frankfurt */}
        <path
          d={`M ${B.x + 34} ${B.y} L ${S.x - 52} ${S.y}`}
          stroke={uploaded ? GREEN : "#64748b"}
          strokeWidth={2.5}
          strokeDasharray={uploading ? "6 3" : undefined}
          className={uploading ? "flow" : undefined}
          markerEnd={uploaded ? "url(#up-arrow-ok)" : "url(#up-arrow)"}
        />
        <text x={(B.x + S.x) / 2} y={B.y - 14} textAnchor="middle" fontSize={12} fill="#334155">
          {uploading ? `PUT · ${uploadPct.toFixed(0)} %` : uploaded ? "PUT · done" : "HTTPS PUT (presigned)"}
        </text>
        <image href={AWS_ICON.client} x={B.x - 28} y={B.y - 28} width={56} height={56} />
        <text x={B.x} y={B.y + 48} textAnchor="middle" fontSize={13} fontWeight={600}>Your browser</text>

        {/* frankfurt */}
        <rect x={S.x - 46} y={S.y - 46} width={92} height={92} rx={12} fill={uploaded ? "#ecfdf5" : "#fff"} stroke={uploaded ? GREEN : "#111827"} strokeWidth={1.5} />
        <image href={AWS_ICON.s3} x={S.x - 26} y={S.y - 26} width={52} height={52} />
        <text x={S.x} y={S.y + 68} textAnchor="middle" fontSize={13} fontWeight={600}>{sourceCity}</text>
        <text x={S.x} y={S.y + 84} textAnchor="middle" fontSize={11} fill="#64748b">source · eu-central-1</text>
        <text x={S.x} y={S.y + 100} textAnchor="middle" fontSize={11} fill="#64748b">proxies/uploads/…</text>

        {/* frankfurt → replicas (one column: no crossings) */}
        {copies.map((c, i) => {
          const y = rowY(i);
          const mid = (S.x + 46 + BOX.x) / 2;
          return (
            <path
              key={`e-${c.region}`}
              d={`M ${S.x + 46} ${S.y} C ${mid} ${S.y}, ${mid} ${y}, ${BOX.x - 6} ${y}`}
              fill="none"
              stroke={c.present ? GREEN : "#94a3b8"}
              strokeWidth={c.present ? 1.6 : 1.2}
              strokeDasharray={c.present ? undefined : "5 4"}
              className={!c.present && uploaded ? "flow" : undefined}
              opacity={uploaded || c.present ? 1 : 0.4}
              markerEnd={c.present ? "url(#up-arrow-ok)" : "url(#up-arrow)"}
            />
          );
        })}
        {/* axis for the timing bars */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={BAR.x + f * BAR.w} y1={rowY(0) - 14} x2={BAR.x + f * BAR.w} y2={rowY(copies.length - 1) + 14} stroke="#eef2f6" />
            <text x={BAR.x + f * BAR.w} y={rowY(copies.length - 1) + 30} textAnchor="middle" fontSize={10.5} fill="#94a3b8">
              {Math.round(f * scaleMax)} s
            </text>
          </g>
        ))}
        {copies.map((c, i) => {
          const y = rowY(i);
          const lag = c.present ? lagOf(c) : undefined;
          return (
            <g key={c.region}>
              <rect x={BOX.x} y={y - 15} width={BOX.w} height={30} rx={7} fill={c.present ? "#ecfdf5" : "#fff"} stroke={c.present ? GREEN : "#cbd5e1"} strokeDasharray={c.present ? undefined : "4 3"} />
              <image href={AWS_ICON.bucket} x={BOX.x + 6} y={y - 11} width={22} height={22} opacity={c.present ? 1 : 0.45} />
              <text x={BOX.x + 36} y={y + 4} fontSize={12} fontWeight={600}>{c.city}</text>
              <text x={BOX.x + BOX.w - 10} y={y + 4} fontSize={11} textAnchor="end" fill={c.present ? GREEN : "#94a3b8"} fontFamily="var(--font-mono)">
                {c.present ? "✓" : uploaded ? "…" : c.region}
              </text>
              {lag != null && (
                <>
                  <rect x={BAR.x} y={y - 6} width={Math.max(2, (lag / scaleMax) * BAR.w)} height={12} rx={3} fill={GREEN} opacity={0.85} />
                  <text x={BAR.x + Math.max(2, (lag / scaleMax) * BAR.w) + 6} y={y + 4} fontSize={11} fill="#111827">{fmtSec(lag)}</text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
