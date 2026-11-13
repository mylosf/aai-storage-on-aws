import { useEffect, useMemo, useState } from "react";
import { api } from "@/api";
import { JobProgress } from "@/components/JobProgress";
import { SubHeader, TabHeader } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ATTACK_META, OUTCOME_META, SCENARIO_META } from "@/content";
import { useData, useJob } from "@/hooks";
import type { ActorId, AttackResult, Config, Guard, HiddenObject, ScenarioStatus, Status } from "@/types";

const ATTACK_ORDER = ["rb-force", "tf-destroy", "delete-version", "suspend-versioning", "lifecycle-expire", "delete-policy", "bypass-governance", "restore", "restore-copy"];

export function LiveTab({ config }: { config: Config | null }) {
  const [who, setWho] = useState<ActorId>("admin");
  const [sel, setSel] = useState<{ scenario: string; attack: string } | null>(null);

  const status = useData(() => api.status(), { quiet: true, pollMs: 10_000, pollWhile: () => true });
  const guards = useData(() => api.guards(), { quiet: true });
  const results = useData(() => api.results(who), { quiet: true });
  const events = useData(() => api.events(), { quiet: true, pollMs: 8000, pollWhile: () => true });
  const markers = useData(() => api.markers(), { quiet: true, pollMs: 10_000, pollWhile: () => true });

  const refresh = () => {
    void markers.reload();
    void status.reload();
    void results.reload();
    void events.reload();
  };
  const job = useJob(() => {
    refresh();
    void guards.reload();
  });

  const byCell = useMemo(() => {
    const m = new Map<string, AttackResult>();
    for (const r of results.data?.results ?? []) m.set(`${r.scenario}#${r.attack}`, r);
    return m;
  }, [results.data]);

  const reloadResults = results.reload;
  useEffect(() => {
    void reloadResults();
  }, [who, reloadResults]);
  const switchActor = (v: string) => {
    if (v) setWho(v as ActorId);
  };

  const scenarios = config?.scenarios ?? [];
  const selected = sel ? byCell.get(`${sel.scenario}#${sel.attack}`) : undefined;
  const statusOf = (id: string) => status.data?.scenarios.find((s) => s.id === id);

  return (
    <section className="space-y-10">
      <TabHeader
        title="Live-Test: acht Angriffe gegen sieben Riegel"
        actions={
          <>
            <ToggleGroup type="single" variant="outline" value={who} onValueChange={switchActor}>
              <ToggleGroupItem value="admin" className="px-3">
                als Admin (s3:*)
              </ToggleGroupItem>
              <ToggleGroupItem value="breakglass" className="px-3">
                als Break-Glass
              </ToggleGroupItem>
            </ToggleGroup>
            <Button variant="outline" disabled={job.busy} onClick={() => void job.run(() => api.setup())}>
              Szenarien vorbereiten
            </Button>
            <Button disabled={job.busy} onClick={() => void job.run(() => api.matrix(who))}>
              Alle Angriffe ausführen
            </Button>
          </>
        }
      >
        <p>
          Jede Zelle ist ein echter API-Call im Demo-Account {config?.account ?? "…"} ({config?.region ?? "…"}). Der Akteur
          „Admin“ hat <code className="font-mono">s3:*</code> auf die Demo-Buckets, wie ein fehlgeleiteter Pipeline-Lauf
          oder ein Mensch mit AdministratorAccess. „Break-Glass“ hat dieselben Rechte und steht in jeder Ausnahme. Nach
          jedem Angriff setzt die API den Bucket mit Break-Glass zurück (gelöschte Buckets werden neu angelegt).
        </p>
        <p>Zelle anklicken: Log mit den tatsächlichen Fehlermeldungen. AWS nennt darin, welche Policy-Art verweigert hat.</p>
      </TabHeader>

      <JobProgress job={job.job} />

      <GuardStrip guards={guards.data?.guards ?? null} onProbe={() => void guards.reload()} />

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-left align-bottom">
              <th className="w-52 px-3 py-2 font-medium">Angriff ↓ / Szenario →</th>
              {scenarios.map((s) => (
                <th key={s.id} className="px-2 py-2 font-medium">
                  <div>{SCENARIO_META[s.id]?.title ?? s.id}</div>
                  <div className="text-[11px] font-normal leading-tight text-muted-foreground">{SCENARIO_META[s.id]?.sub}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ATTACK_ORDER.map((a) => (
              <tr key={a} className="border-b last:border-0">
                <td className="px-3 py-2 align-top">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help font-medium">{ATTACK_META[a]?.title ?? a}</span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-sm">{ATTACK_META[a]?.what}</TooltipContent>
                  </Tooltip>
                </td>
                {scenarios.map((s) => {
                  const r = byCell.get(`${s.id}#${a}`);
                  const meta = r ? OUTCOME_META[r.outcome] : null;
                  const active = sel?.scenario === s.id && sel?.attack === a;
                  return (
                    <td key={s.id} className="px-1.5 py-1.5 align-top">
                      <button
                        type="button"
                        onClick={() => setSel({ scenario: s.id, attack: a })}
                        className={`w-full rounded-md border px-2 py-1.5 text-left text-xs transition ${meta ? meta.cls : "border-dashed text-muted-foreground"} ${active ? "ring-2 ring-foreground/40" : "hover:ring-1 hover:ring-foreground/20"}`}
                      >
                        <div className="font-medium">{meta ? meta.label : "–"}</div>
                        {r?.log.find((l) => !l.ok && l.by) && <div className="truncate text-[10px] opacity-75">{r.log.find((l) => !l.ok && l.by)?.by}</div>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Legend />

      {sel && (
        <Detail
          key={`${sel.scenario}#${sel.attack}#${who}`}
          scenario={sel.scenario}
          attack={sel.attack}
          who={who}
          result={selected}
          busy={job.busy}
          onRun={() => void job.run(() => api.attack(sel.scenario, sel.attack, who))}
        />
      )}

      <div className="space-y-4">
        <SubHeader title="Zustand der Buckets" actions={<Button variant="outline" size="sm" onClick={() => void status.reload()}>Aktualisieren</Button>}>
          Live gelesen von der API-Rolle (nur Lesen). Alle 10 s aktualisiert.
        </SubHeader>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {scenarios.map((s) => (
            <StatusCard key={s.id} st={statusOf(s.id)} id={s.id} onReset={() => void job.run(() => api.reset(s.id))} busy={job.busy} />
          ))}
        </div>
      </div>

      <MarkerCheck
        config={config}
        markers={markers.data?.markers ?? null}
        days={markers.data?.noncurrentDays ?? config?.noncurrentDays ?? 7}
        busy={job.busy}
        onDelete={(scenario, key) => void job.run(() => api.deleteObject(scenario, key))}
        onRestore={(m, method) => void job.run(() => api.restoreObject(m.scenario, m.key, method))}
      />

      <ConfigDemo status={status.data} busy={job.busy} onSuspend={() => void job.run(() => api.attack("baseline", "suspend-versioning", "admin", false))} />

      <div className="space-y-4">
        <SubHeader title="Erkennung: S3 „Object Deleted“-Events über EventBridge">
          Jeder Delete-Marker und jede endgültige Löschung (auch durch Lifecycle) erscheint hier nach Sekunden. In
          Produktion ginge dasselbe Event an SNS/Chat: das ist die Woche Vorwarnzeit nach einem <code className="font-mono">rb --force</code>.
          Resets der Demo erzeugen ebenfalls Events.
        </SubHeader>
        <EventList events={events.data?.events ?? []} />
      </div>
    </section>
  );
}

function GuardStrip({ guards, onProbe }: { guards: Guard[] | null; onProbe: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm">
      <span className="text-muted-foreground">Riegel aktiv?</span>
      {(guards ?? []).map((g) => (
        <Tooltip key={g.id}>
          <TooltipTrigger asChild>
            <span
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${g.enforced ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}
            >
              <span className="font-medium">{SCENARIO_META[g.id]?.title ?? g.id}</span>
              <span>{g.enforced ? `greift${g.by && g.by !== g.expected ? ` (${g.by})` : ""}` : `${g.expected} nicht angehängt`}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-md">
            Probe: Admin ruft PutBucketVersioning(Enabled) auf, eine Änderung ohne Wirkung. {g.message ?? "Erlaubt: kein Riegel aktiv."}
          </TooltipContent>
        </Tooltip>
      ))}
      <Button variant="ghost" size="sm" onClick={onProbe}>
        erneut prüfen
      </Button>
      {guards?.some((g) => !g.enforced && g.expected !== "Bucket Policy") && (
        <span className="basis-full text-xs text-muted-foreground">
          SCP/RCP liegen im Management-Account (<code className="font-mono">make org-enable && make org-apply</code>). Solange sie
          fehlen, verhalten sich „SCP“, „RCP“ und „Empfehlung“ wie ihre Szenarien ohne Org-Policy.
        </span>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {(["blocked", "outage", "weakened", "destroyed", "noop", "na", "restorable", "needs-breakglass"] as const).map((o) => (
        <Tooltip key={o}>
          <TooltipTrigger asChild>
            <span className={`cursor-help rounded-md border px-2 py-0.5 ${OUTCOME_META[o].cls}`}>{OUTCOME_META[o].label}</span>
          </TooltipTrigger>
          <TooltipContent>{OUTCOME_META[o].help}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

function Detail({ scenario, attack, who, result, busy, onRun }: { scenario: string; attack: string; who: ActorId; result?: AttackResult; busy: boolean; onRun: () => void }) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm font-medium">
            {ATTACK_META[attack]?.title} · {SCENARIO_META[scenario]?.title} · als {who === "admin" ? "Admin" : "Break-Glass"}
          </div>
          <div className="max-w-3xl text-sm text-muted-foreground">{result ? result.summary : ATTACK_META[attack]?.what}</div>
        </div>
        <div className="flex items-center gap-3">
          {result && <span className="tabular text-xs text-muted-foreground">{new Date(result.at).toLocaleTimeString()} · {result.ms} ms</span>}
          <Button size="sm" disabled={busy} onClick={onRun}>
            {result ? "erneut ausführen" : "ausführen"}
          </Button>
        </div>
      </div>
      {result && (
        <pre className="overflow-x-auto rounded-md bg-neutral-950 p-3 font-mono text-[11.5px] leading-relaxed text-neutral-100">
          {result.log.map((l, i) => (
            <div key={i} className={l.cmd ? "text-sky-300" : l.info ? "text-neutral-400" : l.ok ? "text-emerald-300" : "text-red-300"}>
              {l.cmd || l.info ? l.call : `${l.ok ? "✓" : "✗"} ${l.call}${l.note ? `  → ${l.note}` : ""}`}
              {!l.ok && l.code && (
                <div className="pl-4 text-red-200/90">
                  {l.code}
                  {l.by ? ` [${l.by}]` : ""}: {l.message}
                </div>
              )}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

function StatusCard({ id, st, onReset, busy }: { id: string; st?: ScenarioStatus; onReset: () => void; busy: boolean }) {
  const lc = st?.lifecycle?.[0];
  return (
    <div className="space-y-2 rounded-lg border p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{SCENARIO_META[id]?.title ?? id}</div>
          <div className="break-all font-mono text-[10px] text-muted-foreground">{st?.bucket ?? "—"}</div>
        </div>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={busy} onClick={onReset}>
          Reset
        </Button>
      </div>
      {!st?.exists ? (
        <div className="text-muted-foreground">{st ? "existiert nicht" : "…"}</div>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt className="text-muted-foreground">Versioning</dt>
          <dd className={st.versioning === "Enabled" ? "" : "font-medium text-red-700"}>{st.versioning}</dd>
          <dt className="text-muted-foreground">Object Lock</dt>
          <dd>{st.objectLock?.enabled ? `${st.objectLock.mode} ${st.objectLock.days} d` : "—"}</dd>
          {st.retainUntil && (
            <>
              <dt className="text-muted-foreground">retain-until</dt>
              <dd className="tabular">{new Date(st.retainUntil).toLocaleString()}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Lifecycle</dt>
          <dd className={lc?.expirationDays ? "font-medium text-red-700" : ""}>
            {lc ? (lc.expirationDays ? `alles nach ${lc.expirationDays} d` : `nicht-aktuell nach ${lc.noncurrentDays} d`) : "—"}
          </dd>
          <dt className="text-muted-foreground">Bucket Policy</dt>
          <dd>{st.bucketPolicy ? "Deny" : "—"}</dd>
          <dt className="text-muted-foreground">Objekte</dt>
          <dd className="tabular">
            {st.current} aktuell · {st.noncurrent} alt · <span className={st.deleteMarkers ? "font-medium text-amber-700" : ""}>{st.deleteMarkers} Delete-Marker</span>
          </dd>
        </dl>
      )}
    </div>
  );
}

function ConfigDemo({ status, busy, onSuspend }: { status: Status | null; busy: boolean; onSuspend: () => void }) {
  const cfg = status?.config;
  const base = status?.scenarios.find((s) => s.id === "baseline");
  if (!cfg) return null;
  return (
    <div className="space-y-4">
      <SubHeader
        title="Detektiv statt präventiv: AWS Config repariert Versioning"
        actions={
          <>
            <Button variant="outline" size="sm" disabled={busy} onClick={onSuspend}>
              Versioning im Ist-Zustand aussetzen (ohne Reset)
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void api.configEval()}>
              Regel jetzt auswerten
            </Button>
          </>
        }
      >
        Regel <code className="font-mono">{cfg.rule}</code> (s3-bucket-versioning-enabled) mit automatischer Remediation
        (SSM AWS-ConfigureS3BucketVersioning). Nach dem Aussetzen dauert es einige Minuten, bis Config die Änderung sieht und
        zurückstellt. In der Zwischenzeit löscht jedes DELETE endgültig.
      </SubHeader>
      <div className="flex flex-wrap gap-8 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Versioning jetzt</div>
          <div className={`text-2xl font-semibold ${base?.versioning === "Enabled" ? "" : "text-red-700"}`}>{base?.versioning ?? "—"}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Config-Bewertung</div>
          <div className="text-2xl font-semibold">{cfg.compliance?.value ?? "noch keine"}</div>
          {cfg.compliance && <div className="tabular text-xs text-muted-foreground">{new Date(cfg.compliance.at).toLocaleTimeString()}</div>}
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Remediation</div>
          <div className="text-2xl font-semibold">{cfg.remediation?.state ?? "—"}</div>
          {cfg.remediation && <div className="tabular text-xs text-muted-foreground">{new Date(cfg.remediation.at).toLocaleTimeString()}</div>}
        </div>
      </div>
    </div>
  );
}

function EventList({ events }: { events: { time: string; scenario: string | null; key: string; deletionType: string | null; reason: string | null }[] }) {
  if (!events.length) return <p className="text-sm text-muted-foreground">Noch keine Events.</p>;
  return (
    <div className="max-h-72 overflow-y-auto rounded-lg border">
      <table className="w-full text-xs">
        <tbody>
          {events.slice(0, 60).map((e, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="tabular px-3 py-1.5 text-muted-foreground">{new Date(e.time).toLocaleTimeString()}</td>
              <td className="px-3 py-1.5">{SCENARIO_META[e.scenario ?? ""]?.title ?? e.scenario}</td>
              <td className="px-3 py-1.5 font-mono">{e.key}</td>
              <td className="px-3 py-1.5">
                <Badge variant="outline" className={e.deletionType === "Permanently Deleted" ? "border-red-300 text-red-800" : "border-amber-300 text-amber-800"}>
                  {e.deletionType}
                </Badge>
              </td>
              <td className="px-3 py-1.5 text-muted-foreground">{e.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function remaining(iso: string | null) {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "fällig";
  const d = Math.floor(ms / 86400_000);
  const h = Math.floor((ms % 86400_000) / 3600_000);
  return d ? `${d} T ${h} h` : `${h} h`;
}

function MarkerCheck({
  config,
  markers,
  days,
  busy,
  onDelete,
  onRestore,
}: {
  config: Config | null;
  markers: HiddenObject[] | null;
  days: number;
  busy: boolean;
  onDelete: (scenario: string, key: string) => void;
  onRestore: (m: HiddenObject, method: "copy" | "remove-marker") => void;
}) {
  const [scenario, setScenario] = useState("baseline");
  const [key, setKey] = useState<string>("");
  const keys = config?.seedKeys ?? [];
  const k = key || keys[0] || "";
  return (
    <div className="space-y-4">
      <SubHeader title={`Delete-Marker prüfen: ${days} Tage bis zur endgültigen Löschung`}>
        Delete-Marker bleiben erlaubt, die Anwendung darf löschen. Jeder Marker macht die Vorversion nicht-aktuell; die
        Lifecycle-Regel löscht sie nach Marker-Zeit + {days} Tagen, aufgerundet auf 00:00 UTC. Bis dahin listet diese
        Prüfung jedes versteckte Objekt mit Frist. Zurückholen per <b>Copy der Vorversion</b> braucht nur GetObjectVersion +
        PutObject und funktioniert deshalb auch unter SCP/RCP ohne Break-Glass. Marker hier bleiben stehen, bis jemand
        wiederherstellt (ein Reset oder „Alle Angriffe ausführen“ räumt sie ebenfalls ab).
      </SubHeader>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Objekt löschen (Delete-Marker setzen):</span>
        <select className="h-8 rounded-md border bg-background px-2 text-sm" value={scenario} onChange={(e) => setScenario(e.target.value)}>
          {(config?.scenarios ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {SCENARIO_META[s.id]?.title ?? s.id}
            </option>
          ))}
        </select>
        <select className="h-8 rounded-md border bg-background px-2 font-mono text-xs" value={k} onChange={(e) => setKey(e.target.value)}>
          {keys.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" disabled={busy || !k} onClick={() => onDelete(scenario, k)}>
          als Admin löschen
        </Button>
      </div>
      {!markers ? (
        <p className="text-sm text-muted-foreground">lade…</p>
      ) : !markers.length ? (
        <p className="text-sm text-muted-foreground">Keine versteckten Objekte: kein aktueller Delete-Marker in den Demo-Buckets.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Szenario</th>
                <th className="px-3 py-2 font-medium">Objekt</th>
                <th className="px-3 py-2 font-medium">gelöscht</th>
                <th className="px-3 py-2 font-medium">endgültig weg ab</th>
                <th className="px-3 py-2 font-medium">verbleibend</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {markers.map((m) => (
                <tr key={`${m.bucket}/${m.key}`} className="border-t">
                  <td className="px-3 py-2">{SCENARIO_META[m.scenario]?.title ?? m.scenario}</td>
                  <td className="px-3 py-2 font-mono text-xs">{m.key}</td>
                  <td className="tabular px-3 py-2 text-xs">{new Date(m.deletedAt).toLocaleString()}</td>
                  <td className="tabular px-3 py-2 text-xs">
                    {m.expiresAt ? new Date(m.expiresAt).toLocaleString() : "—"}
                    {m.locked && <span className="ml-1 text-muted-foreground">(Object Lock hält länger)</span>}
                  </td>
                  <td className="tabular px-3 py-2 text-xs font-medium text-amber-800">{remaining(m.expiresAt)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" disabled={busy} onClick={() => onRestore(m, "copy")}>
                        Vorversion kopieren
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => onRestore(m, "remove-marker")}>
                        Marker entfernen
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Produktion: EventBridge-Regel auf „Object Deleted“ mit deletion-type „Delete Marker Created“ → SNS/Chat, dazu ein
        Schwellwert-Alarm für Massenlöschungen und eine tägliche Liste (Lambda wie hier oder S3 Inventory mit Versionen:
        Felder IsLatest, IsDeleteMarker, LastModifiedDate, abgefragt mit Athena).
      </p>
    </div>
  );
}
