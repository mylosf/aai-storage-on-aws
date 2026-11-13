import { useMemo, useState } from "react";
import { cn } from "cn";
import { toast } from "sonner";
import { api } from "@/api";
import { JobProgress } from "@/components/JobProgress";
import { Chip, Empty, SubHeader, TabHeader } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtBytes, fmtTime, median } from "@/format";
import { CLIP_BUREAU, cityOf } from "@/geo";
import { useJob } from "@/hooks";
import type { Assignment, Catalogue, Config, Rundown, Timeline } from "@/types";

const GB = 1024 ** 3;
const TRANSFER = 0.02;
const STANDARD = 0.023;
const usd = (v: number) => (v < 10 ? `$${v.toFixed(2)}` : `$${Math.round(v).toLocaleString()}`);

interface Props {
  config: Config | null;
  catalogue: Catalogue | null;
  timeline: Timeline | null;
  onCatalogue: () => void;
  onTimeline: () => void;
}

export function PlacementTab({ config, catalogue, timeline, onCatalogue, onTimeline }: Props) {
  const gen = useJob(() => onCatalogue());
  const masters = useMemo(() => (catalogue?.objects ?? []).filter((o) => o.type === "master"), [catalogue]);
  const small = useMemo(() => (catalogue?.objects ?? []).filter((o) => o.type !== "master"), [catalogue]);
  const nReplicas = config?.replicas.length ?? 15;

  const shows = useMemo(() => {
    const m = new Map<string, typeof masters>();
    for (const o of masters) m.set(o.show, [...(m.get(o.show) ?? []), o]);
    return [...m.entries()];
  }, [masters]);

  const smallCoverage = median(small.map((o) => o.regions.length)) ?? 0;

  // ---------------------------------------------------------- strategies
  const strategies = useMemo(() => {
    const totalGB = masters.reduce((a, o) => a + o.size, 0) / GB;
    const assigned = (timeline?.assignments ?? []).filter((a) => !a.error);
    const assignedGB = assigned.reduce((a, x) => a + ((x.size ?? 0) / GB) * (x.regions?.length ?? 0), 0);
    const lags = assigned.flatMap((a) => Object.values(a.arrivals ?? {}).map((x) => x.lagSec));
    const medLag = median(lags);
    return [
      {
        name: "Everything everywhere",
        storedGB: totalGB * nReplicas,
        transferGB: totalGB * nReplicas,
        ttfe: "No wait for anyone: every master is already in every region before it is asked for.",
        verdict: "Simplest, and the most expensive by an order of magnitude. Most copies are never opened.",
      },
      {
        name: "By bureau rules",
        storedGB: totalGB,
        transferGB: totalGB,
        ttfe: "No wait for the bureau that shot it; anyone else who needs the clip waits for an assignment.",
        verdict: "Good when ownership is stable (“Washington cuts Washington”). Breaks down for shared stories.",
      },
      {
        name: "On assignment",
        storedGB: assignedGB,
        transferGB: assignedGB,
        ttfe: medLag != null ? `Waits for replication after the rundown: median ${Math.round(medLag)} s measured here.` : "Waits for replication after the rundown; send one below to measure it.",
        verdict: "Only what is actually cut moves. The rundown already exists, so the trigger is free.",
      },
    ];
  }, [masters, timeline, nReplicas]);

  return (
    <section className="space-y-10">
      <TabHeader title="Which files go where?">
        <p>
          Proxies and sidecars are small and everyone browses them, so one prefix rule per region sends them
          everywhere. Camera masters are big and only the bureau cutting the piece needs them, so they move only when
          a rundown assigns them. The trigger is a tag on the object; the replication rule for a region matches
          “dest-&lt;region&gt;=1”.
        </p>
      </TabHeader>

      {!catalogue || masters.length === 0 ? (
        <Empty title="No catalogue yet" action="Generate the newsroom catalogue" onAction={() => void gen.run(api.generateCatalogue)} busy={gen.busy}>
          Creates an evening-news production in Frankfurt: 14 camera masters (0.5–1.6 GB of synthetic bytes plus two
          real Meridian masters from Netflix Open Content), their proxies and XML/SRT sidecars. Proxies and sidecars
          replicate to all 15 regions automatically: about 10 GB of inter-region transfer, roughly $0.20.
          <div className="mt-3">
            <JobProgress job={gen.job} />
          </div>
        </Empty>
      ) : (
        <>
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-base font-medium">Masters in Frankfurt</h3>
              <p className="text-sm text-muted-foreground">
                {small.length} proxies and sidecars, each in <span className="tabular text-foreground">{smallCoverage}/{nReplicas}</span> regions
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">show</TableHead>
                  <TableHead>clip</TableHead>
                  <TableHead className="text-right">size</TableHead>
                  <TableHead>bureau</TableHead>
                  <TableHead>replicated to</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shows.flatMap(([show, list]) =>
                  list.map((o, i) => {
                    const bureau = CLIP_BUREAU[o.clip];
                    return (
                      <TableRow key={o.key}>
                        <TableCell className="font-medium">{i === 0 ? show : ""}</TableCell>
                        <TableCell className="font-mono text-xs">{o.key.split("/").pop()}</TableCell>
                        <TableCell className="tabular text-right">{fmtBytes(o.size)}</TableCell>
                        <TableCell>{bureau ? <Chip tone="bureau">{config?.bureaus.find((b) => b.id === bureau)?.city ?? bureau}</Chip> : "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {o.regions.length ? o.regions.map((r) => <Chip key={r}>{cityOf(config, r)}</Chip>) : <span className="text-xs text-muted-foreground">Frankfurt only</span>}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }),
                )}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {strategies.map((s) => (
              <div key={s.name} className="space-y-3 rounded-xl border p-5">
                <h4 className="font-medium">{s.name}</h4>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">stored in replicas</dt>
                    <dd className="tabular text-lg font-semibold">{Math.round(s.storedGB)} GB</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">one-time transfer</dt>
                    <dd className="tabular text-lg font-semibold">{usd(s.transferGB * TRANSFER)}</dd>
                    <dd className="text-xs text-muted-foreground">{Math.round(s.transferGB)} GB</dd>
                  </div>
                </dl>
                <p className="text-xs text-muted-foreground">storage {usd(s.storedGB * STANDARD)}/month in S3 Standard</p>
                <p className="text-sm">{s.ttfe}</p>
                <p className="text-sm text-muted-foreground">{s.verdict}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            For this {fmtBytes(masters.reduce((a, o) => a + o.size, 0))} catalogue; a real archive is thousands of times larger, the ratios stay the same.
            “On assignment” counts what the rundowns sent so far.
          </p>

          <RundownBuilder config={config} masters={masters.map((m) => m.key)} onSent={onTimeline} />
        </>
      )}

      <TimelineView config={config} timeline={timeline} />
    </section>
  );
}

// ---------------------------------------------------------- rundown builder
function RundownBuilder({ config, masters, onSent }: { config: Config | null; masters: string[]; onSent: () => void }) {
  const [clips, setClips] = useState<Set<string>>(new Set());
  const [bureaus, setBureaus] = useState<Set<string>>(new Set());
  const [rtc, setRtc] = useState(true);
  const [show, setShow] = useState("tagesschau");
  const [sending, setSending] = useState(false);
  const example: Rundown = {
    show: "weltspiegel",
    date: "2026-11-15",
    items: [
      { clip: masters[0] ?? "masters/tagesschau/washington-wahlnacht.mxf", bureaus: ["washington"] },
      { clip: masters[1] ?? "masters/tagesschau/sao-paulo-amazonas-brand.mxf", bureaus: ["sao-paulo", "buenos-aires"], rtc: false },
    ],
  };
  const [raw, setRaw] = useState(JSON.stringify(example, null, 2));

  const send = async (fn: () => Promise<{ rundownKey: string }>) => {
    setSending(true);
    try {
      const r = await fn();
      toast.success(`Rundown written: ${r.rundownKey}`);
      window.setTimeout(onSent, 2500);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <SubHeader title="Send a rundown">
        The rundown is the assignment. Writing it to <code className="font-mono text-xs">rundowns/</code> in the source
        bucket fires an S3 event; a Lambda maps each bureau to its nearest region, adds the tags and copies the master
        onto itself, because replication only looks at new versions.
      </SubHeader>
      <div className="grid gap-10 lg:grid-cols-2">
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">masters</div>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2">
              {masters.map((m) => (
                <label key={m} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent">
                  <input type="checkbox" checked={clips.has(m)} onChange={() => setClips((s) => flip(s, m))} className="accent-[#2f6fe4]" />
                  <span className="font-mono text-xs">{m.replace("masters/", "")}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">for the bureaus (nearest region in brackets)</div>
            <div className="flex flex-wrap gap-1.5">
              {config?.bureaus.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBureaus((s) => flip(s, b.id))}
                  className={cn("rounded-md border px-2 py-1 text-xs", bureaus.has(b.id) ? "border-[#f7b531] bg-[#f7b531]/25" : "hover:bg-accent")}
                >
                  {b.city} <span className="text-muted-foreground">({cityOf(config, b.region)})</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Input value={show} onChange={(e) => setShow(e.target.value)} className="h-9 w-40" aria-label="show" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={rtc} onChange={(e) => setRtc(e.target.checked)} className="accent-[#2f6fe4]" />
              Replication Time Control (15-min SLA)
            </label>
            <Button
              disabled={sending || clips.size === 0 || bureaus.size === 0}
              onClick={() => void send(() => api.assign(show, [...clips].map((clip) => ({ clip, bureaus: [...bureaus], rtc }))))}
            >
              Send rundown
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">or paste the rundown a MAM would export</div>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            spellCheck={false}
            className="h-64 w-full rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed outline-none focus:ring-2 focus:ring-ring"
          />
          <Button
            variant="outline"
            disabled={sending}
            onClick={() => {
              let parsed: Rundown;
              try {
                parsed = JSON.parse(raw);
              } catch (err) {
                toast.error(`Not valid JSON: ${(err as Error).message}`);
                return;
              }
              void send(() => api.rundown(parsed));
            }}
          >
            Upload rundown JSON
          </Button>
        </div>
      </div>
    </div>
  );
}

function flip(s: Set<string>, v: string) {
  const n = new Set(s);
  if (n.has(v)) n.delete(v);
  else n.add(v);
  return n;
}

// ---------------------------------------------------------- timeline
const SLA = 900;

export function pendingAssignments(t: Timeline | null) {
  const cutoff = Date.now() - 30 * 60 * 1000;
  return (t?.assignments ?? []).some(
    (a) => !a.error && a.copiedAt && Date.parse(a.copiedAt) > cutoff && Object.keys(a.arrivals ?? {}).length < (a.regions?.length ?? 0),
  );
}

export function TimelineView({ config, timeline, limit = 12, bare }: { config: Config | null; timeline: Timeline | null; limit?: number; bare?: boolean }) {
  const items = (timeline?.assignments ?? []).slice(0, limit);
  const events = timeline?.replicationEvents ?? [];
  return (
    <div className="space-y-4">
      {!bare && (
      <SubHeader title="Timeline">
        Rundown written → tags added and master copied in place → “Object Created” in each destination region,
        forwarded to Frankfurt. Lag is arrival minus the moment the copy finished. The grey line is the 15-minute
        Replication Time Control SLA.
      </SubHeader>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No assignments yet.</p>
      ) : (
        <div className="divide-y border-y">
          {items.map((a) => (
            <AssignmentRow key={`${a.copiedAt}-${a.key}`} a={a} config={config} />
          ))}
        </div>
      )}
      {events.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Replication events</h4>
          <ul className="space-y-1 text-sm">
            {events.slice(0, 10).map((e, i) => (
              <li key={i} className="tabular text-muted-foreground">
                {fmtTime(e.at)} · <span className="text-foreground">{e.event}</span> · {e.key} · {e.rule}
                {e.reason ? ` · ${e.reason}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AssignmentRow({ a, config }: { a: Assignment; config: Config | null }) {
  if (a.error) {
    return (
      <div className="py-3 text-sm">
        <span className="font-mono text-xs">{a.key}</span> <span className="text-destructive">· {a.error}</span>
      </div>
    );
  }
  const regions = a.regions ?? [];
  return (
    <div className="grid gap-3 py-4 md:grid-cols-[280px_minmax(0,1fr)]">
      <div className="space-y-1">
        <div className="font-mono text-xs">{a.key.replace("masters/", "")}</div>
        <div className="text-xs text-muted-foreground">
          {fmtBytes(a.size)} · {a.show ?? "rundown"} · RTC {a.rtc === "no" ? "off" : "on"}
        </div>
        <div className="text-xs text-muted-foreground">copied in place {fmtTime(a.copiedAt)}</div>
      </div>
      <div className="space-y-1.5">
        {regions.map((r) => {
          const arr = a.arrivals?.[r];
          const pct = arr ? Math.max(0.6, Math.min(100, (arr.lagSec / SLA) * 100)) : 0;
          return (
            <div key={r} className="grid grid-cols-[120px_minmax(0,1fr)_70px] items-center gap-3 text-xs">
              <span>{cityOf(config, r)}</span>
              <div className="relative h-2.5 rounded-sm bg-muted">
                {arr ? (
                  <div className="h-full rounded-r-[4px] bg-[#2f6fe4]" style={{ width: `${pct}%` }} />
                ) : (
                  <div className="h-full w-1/4 animate-pulse rounded-sm bg-[#2f6fe4]/25" />
                )}
                <div className="absolute inset-y-[-3px] right-0 w-px bg-foreground/40" title="15-min RTC SLA" />
              </div>
              <span className="tabular text-right">{arr ? `${arr.lagSec.toFixed(1)} s` : "pending"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
