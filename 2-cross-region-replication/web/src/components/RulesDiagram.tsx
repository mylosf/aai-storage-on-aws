import { useMemo, useState } from "react";
import { AWS_ICON, type AwsIcon } from "@/assets/aws";
import { Canvas } from "@/components/Canvas";
import type { Config, Rule } from "@/types";

// ------------------------------------------------------------------ rule kinds
type Kind = "proxies" | "sidecars" | "masters" | "nortc";

const KINDS: {
  kind: Kind;
  title: string;
  match: (id: string) => boolean;
  lane: string;
  color: string;
  dash?: string;
  width: number;
}[] = [
  { kind: "proxies", title: "proxies-<region>", match: (id) => id.startsWith("proxies-"), lane: "prefix  proxies/", color: "#2f6fe4", width: 1.4 },
  { kind: "sidecars", title: "sidecars-<region>", match: (id) => id.startsWith("sidecars-"), lane: "prefix  sidecars/", color: "#7ea6e8", dash: "2 3", width: 1.4 },
  { kind: "masters", title: "masters-<region>", match: (id) => id.startsWith("masters-") && !id.startsWith("masters-nortc-"), lane: "tag  dest-<region> = 1", color: "#111827", width: 1.8 },
  { kind: "nortc", title: "masters-nortc-<region>", match: (id) => id.startsWith("masters-nortc-"), lane: "tag  dest-nortc-<region> = 1", color: "#94a3b8", dash: "6 4", width: 1.4 },
];
const kindOf = (id: string): Kind | undefined => KINDS.find((k) => k.match(id))?.kind;

// ------------------------------------------------------------------ layout
const W = 1780;
const H = 1210;
const ROW0 = 150;
const ROW_H = 64;
const LANE_Y: Record<Kind | "none", number> = { proxies: 262, sidecars: 425, masters: 610, nortc: 800, none: 1010 };

const SRC = { x: 440, w: 250, top: 150, bottom: 1100 };
const RULE = { x: 790, w: 290, h: 132 };
const REP = { x: 1200, w: 420 };
const BUS_X = 1690;

const short = (cls: string) =>
  ({ STANDARD: "Standard", ONEZONE_IA: "One Zone-IA", STANDARD_IA: "Standard-IA", GLACIER_IR: "Glacier IR", INTELLIGENT_TIERING: "Int.-Tiering" })[cls] ?? cls;

function Icon({ icon, x, y, s = 32 }: { icon: AwsIcon; x: number; y: number; s?: number }) {
  return <image href={AWS_ICON[icon]} x={x} y={y} width={s} height={s} />;
}

function Arrow({ d, color = "#9aa8ba", dash, width = 1.4, opacity = 1, marker = "rd-arrow" }: { d: string; color?: string; dash?: string; width?: number; opacity?: number; marker?: string }) {
  return <path d={d} fill="none" stroke={color} strokeWidth={width} strokeDasharray={dash} opacity={opacity} markerEnd={`url(#${marker})`} strokeLinecap="round" />;
}

function T({ x, y, children, size = 12, weight = 400, color = "#111827", anchor = "start", mono }: { x: number; y: number; children: React.ReactNode; size?: number; weight?: number; color?: string; anchor?: "start" | "middle" | "end"; mono?: boolean }) {
  return (
    <text x={x} y={y} fontSize={size} fontWeight={weight} fill={color} textAnchor={anchor} fontFamily={mono ? "var(--font-mono)" : undefined}>
      {children}
    </text>
  );
}

// ------------------------------------------------------------------ component
export function RulesDiagram({ config }: { config: Config }) {
  const [hover, setHover] = useState<{ kind?: Kind; region?: string } | null>(null);
  const expiry = config.replicaExpiryDays ?? 30;

  const rulesByRegion = useMemo(() => {
    const m: Record<string, Partial<Record<Kind, Rule>>> = {};
    for (const r of config.rules) {
      const k = kindOf(r.id);
      if (!k || !r.region) continue;
      (m[r.region] ??= {})[k] = r;
    }
    return m;
  }, [config.rules]);

  const stats = useMemo(
    () =>
      Object.fromEntries(
        KINDS.map((k) => {
          const rs = config.rules.filter((r) => k.match(r.id));
          return [k.kind, { total: rs.length, enabled: rs.filter((r) => r.status === "Enabled").length, sample: rs[0] }];
        }),
      ) as Record<Kind, { total: number; enabled: number; sample?: Rule }>,
    [config.rules],
  );

  const rowY = (i: number) => ROW0 + i * ROW_H + ROW_H / 2;
  const lit = (kind: Kind, region: string) => !hover || (hover.kind ? hover.kind === kind : true) && (hover.region ? hover.region === region : true);

  return (
    <Canvas
      width={W}
      height={H}
      className="h-[900px]"
      legend={
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {KINDS.map((k) => (
            <span key={k.kind} className="flex items-center gap-1.5">
              <svg width="26" height="8">
                <line x1="0" y1="4" x2="26" y2="4" stroke={k.color} strokeWidth={k.width + 0.4} strokeDasharray={k.dash} />
              </svg>
              <span className="font-mono">{k.title}</span>
            </span>
          ))}
          <span>hover a rule group or a region to isolate its arrows</span>
        </span>
      }
    >
      <defs>
        <marker id="rd-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 1 1 L 8 5 L 1 9" fill="none" stroke="#64748b" strokeWidth="1.6" strokeLinecap="round" />
        </marker>
      </defs>

      {/* --------------------------------------------------- column titles + scheduling note */}
      <T x={40} y={40} size={13} weight={600} color="#64748b">TRIGGERS · what creates a new object version</T>
      <T x={SRC.x} y={40} size={13} weight={600} color="#64748b">SOURCE · eu-central-1</T>
      <T x={RULE.x} y={40} size={13} weight={600} color="#64748b">REPLICATION RULES · {config.rules.length} on the source bucket</T>
      <T x={REP.x} y={40} size={13} weight={600} color="#64748b">DESTINATIONS · {config.replicas.length} replica buckets</T>
      <rect x={40} y={62} width={W - 80} height={52} rx={8} fill="#f8fafc" stroke="#e2e8f0" />
      <T x={58} y={84} size={12.5} weight={600}>No schedule.</T>
      <T x={150} y={84} size={12.5} color="#334155">
        S3 evaluates every rule when a new object version is written and copies asynchronously (seconds to minutes). With Replication Time Control: 99.99 % within {config.rtcMinutes} min, SLA-backed.
      </T>
      <T x={58} y={103} size={12.5} color="#334155">
        Existing objects are never picked up by a new or re-enabled rule; S3 Batch Replication is the only “run it over what is already there”. Lifecycle runs daily, asynchronously.
      </T>

      {/* --------------------------------------------------- triggers */}
      <Trigger y={LANE_Y.proxies - 40} icon="app" title="MAM / editor upload" lines={["PUT proxies/<show>/<clip>.mp4", "replicates immediately"]} />
      <Trigger y={LANE_Y.sidecars - 40} icon="app" title="MAM / editor upload" lines={["PUT sidecars/<show>/<clip>.xml | .srt", "replicates immediately"]} />

      {/* rundown chain */}
      <g>
        <rect x={40} y={LANE_Y.masters - 108} width={330} height={150} rx={10} fill="#fff" stroke="#cbd5e1" />
        <T x={56} y={LANE_Y.masters - 86} size={12.5} weight={600}>Rundown (the assignment)</T>
        <Icon icon="object" x={60} y={LANE_Y.masters - 72} />
        <Icon icon="eventbridge" x={170} y={LANE_Y.masters - 72} />
        <Icon icon="lambda" x={280} y={LANE_Y.masters - 72} />
        <Arrow d={`M 98 ${LANE_Y.masters - 56} L 164 ${LANE_Y.masters - 56}`} />
        <Arrow d={`M 208 ${LANE_Y.masters - 56} L 274 ${LANE_Y.masters - 56}`} />
        <T x={76} y={LANE_Y.masters - 24} size={11} color="#475569" anchor="middle">rundown.json</T>
        <T x={186} y={LANE_Y.masters - 24} size={11} color="#475569" anchor="middle">S3 event</T>
        <T x={296} y={LANE_Y.masters - 24} size={11} color="#475569" anchor="middle">ingest</T>
        <T x={56} y={LANE_Y.masters + 2} size={11.5} color="#334155">bureau → nearest region, tag dest-&lt;region&gt;=1 (new</T>
        <T x={56} y={LANE_Y.masters + 18} size={11.5} color="#334155">regions only), CopyObject onto itself = new version</T>
        <T x={56} y={LANE_Y.masters + 34} size={11} color="#64748b">history in x-amz-meta-assigned-regions</T>
      </g>
      <Arrow d={`M 370 ${LANE_Y.masters - 30} L ${SRC.x - 6} ${LANE_Y.masters - 30}`} color="#111827" width={1.6} />

      {/* batch replication */}
      <g>
        <rect x={40} y={LANE_Y.masters + 62} width={330} height={74} rx={10} fill="#fff" stroke="#cbd5e1" strokeDasharray="5 4" />
        <Icon icon="batch" x={56} y={LANE_Y.masters + 76} />
        <T x={98} y={LANE_Y.masters + 84} size={12.5} weight={600}>S3 Batch Replication (on demand)</T>
        <T x={98} y={LANE_Y.masters + 101} size={11.5} color="#334155">filter: eligible · status NONE | FAILED</T>
        <T x={98} y={LANE_Y.masters + 117} size={11.5} color="#334155">prefix masters/ · backfills late rules</T>
      </g>
      <Arrow d={`M 370 ${LANE_Y.masters + 99} C 405 ${LANE_Y.masters + 99}, 405 ${LANE_Y.masters + 6}, ${SRC.x - 6} ${LANE_Y.masters + 6}`} color="#111827" dash="5 4" />

      {/* lab */}
      <Trigger y={LANE_Y.nortc - 40} icon="app" title="Replication lab (this page)" lines={["PUT lab/<run>/<size>.bin with tags", "dest-… (RTC) or dest-nortc-… (no RTC)"]} />
      <Arrow d={`M 370 ${LANE_Y.nortc - 20} C 410 ${LANE_Y.nortc - 20}, 410 ${LANE_Y.masters + 26}, ${SRC.x - 6} ${LANE_Y.masters + 26}`} color="#111827" dash="2 3" opacity={0.6} />

      {/* not replicated */}
      <Trigger y={LANE_Y.none - 40} icon="app" title="Writes no rule matches" lines={["rundowns/  probe/  batch-reports/", "untagged masters stay in Frankfurt"]} muted />

      {/* trigger → lanes */}
      {(["proxies", "sidecars", "nortc"] as const).map((k) => (
        <Arrow key={k} d={`M 370 ${LANE_Y[k]} L ${SRC.x - 6} ${LANE_Y[k]}`} color={KINDS.find((x) => x.kind === k)!.color} dash={KINDS.find((x) => x.kind === k)!.dash} width={1.6} />
      ))}
      <Arrow d={`M 370 ${LANE_Y.none} L ${SRC.x - 6} ${LANE_Y.none}`} />

      {/* --------------------------------------------------- source bucket */}
      <rect x={SRC.x} y={SRC.top} width={SRC.w} height={SRC.bottom - SRC.top} rx={12} fill="#fff" stroke="#111827" strokeWidth={1.5} />
      <Icon icon="s3" x={SRC.x + 16} y={SRC.top + 16} s={36} />
      <T x={SRC.x + 62} y={SRC.top + 32} size={14} weight={600}>Frankfurt source</T>
      <T x={SRC.x + 62} y={SRC.top + 49} size={11} color="#64748b" mono>{`…${config.source.bucket.slice(-20)}`}</T>
      <T x={SRC.x + 16} y={SRC.top + 70} size={11.5} color="#334155">versioned · SSE-S3 · Standard</T>
      {(Object.keys(LANE_Y) as (Kind | "none")[]).map((k) => {
        const spec = KINDS.find((x) => x.kind === k);
        const y = LANE_Y[k];
        return (
          <g key={k}>
            <rect x={SRC.x + 12} y={y - 26} width={SRC.w - 24} height={52} rx={8} fill={k === "none" ? "#f1f5f9" : "#f8fafc"} stroke="#e2e8f0" />
            <T x={SRC.x + 24} y={y - 6} size={12} weight={600}>
              {k === "proxies" ? "proxies/" : k === "sidecars" ? "sidecars/" : k === "masters" ? "masters/ · lab/" : k === "nortc" ? "masters/ · lab/" : "everything else"}
            </T>
            <T x={SRC.x + 24} y={y + 12} size={11} color="#475569" mono>
              {spec ? spec.lane : "no rule matches → stays"}
            </T>
          </g>
        );
      })}
      {/* source-side notifications + lifecycle */}
      <T x={SRC.x + 16} y={SRC.bottom - 46} size={11} color="#475569">lifecycle: lab/ expires 2 d · old versions 3 d</T>
      <T x={SRC.x + 16} y={SRC.bottom - 28} size={11} color="#475569">notifications: missed threshold, failed,</T>
      <T x={SRC.x + 16} y={SRC.bottom - 12} size={11} color="#475569">after threshold → ingest Lambda → timeline</T>

      {/* lanes → rule groups */}
      {KINDS.map((k) => (
        <Arrow key={k.kind} d={`M ${SRC.x + SRC.w} ${LANE_Y[k.kind]} L ${RULE.x - 6} ${LANE_Y[k.kind]}`} color={k.color} dash={k.dash} width={k.width + 0.4} />
      ))}

      {/* --------------------------------------------------- rule groups */}
      {KINDS.map((k) => {
        const s = stats[k.kind];
        const y0 = LANE_Y[k.kind] - RULE.h / 2;
        const sample = s.sample;
        const dim = hover?.kind && hover.kind !== k.kind;
        return (
          <g key={k.kind} onMouseEnter={() => setHover({ kind: k.kind })} onMouseLeave={() => setHover(null)} opacity={dim ? 0.45 : 1} className="cursor-default">
            <rect x={RULE.x} y={y0} width={RULE.w} height={RULE.h} rx={10} fill="#fff" stroke={k.color} strokeWidth={1.5} strokeDasharray={k.dash} />
            <Icon icon="replication" x={RULE.x + 12} y={y0 + 12} s={28} />
            <T x={RULE.x + 48} y={y0 + 26} size={12.5} weight={600} mono>{k.title}</T>
            <T x={RULE.x + 48} y={y0 + 42} size={11} color="#64748b">
              {s.enabled}/{s.total} enabled · priority {k.kind === "proxies" ? "4i" : k.kind === "sidecars" ? "4i+1" : k.kind === "masters" ? "4i+2" : "4i+3"}
            </T>
            <T x={RULE.x + 14} y={y0 + 66} size={11.5} color="#334155">filter   {(sample?.filter ?? "—").replace(sample?.region ?? "§", "<region>")}</T>
            <T x={RULE.x + 14} y={y0 + 83} size={11.5} color="#334155">class    {short(sample?.storageClass ?? "")}</T>
            <T x={RULE.x + 14} y={y0 + 100} size={11.5} color="#334155">
              time     {sample?.rtc ? `RTC ${config.rtcMinutes} min SLA + metrics` : "best effort, metrics on"}
            </T>
            <T x={RULE.x + 14} y={y0 + 117} size={11.5} color="#334155">
              deletes  {sample?.deleteMarkers ? "delete markers replicated" : "delete markers not replicated (tag filter)"}
            </T>
          </g>
        );
      })}

      {/* rule groups → replica buckets: one arrow per rule */}
      {config.replicas.flatMap((rep, i) =>
        KINDS.map((k) => {
          const rule = rulesByRegion[rep.id]?.[k.kind];
          if (!rule) return null;
          const on = rule.status === "Enabled";
          const ky = LANE_Y[k.kind] + ((i - 7) * 4);
          const ry = rowY(i) + (KINDS.indexOf(k) - 1.5) * 6;
          const x1 = RULE.x + RULE.w;
          const x2 = REP.x - 6;
          const mid = (x1 + x2) / 2;
          return (
            <g key={`${rep.id}-${k.kind}`}>
              <title>{`${rule.id} · ${rule.status} · ${rule.filter} → ${rep.city} (${short(rule.storageClass)}${rule.rtc ? ", RTC" : ""})`}</title>
              <Arrow
                d={`M ${x1} ${ky} C ${mid} ${ky}, ${mid} ${ry}, ${x2} ${ry}`}
                color={on ? k.color : "#dc2626"}
                dash={on ? k.dash : "2 4"}
                width={k.width}
                opacity={lit(k.kind, rep.id) ? (on ? 0.55 : 0.8) : 0.06}
              />
            </g>
          );
        }),
      )}

      {/* --------------------------------------------------- replica buckets */}
      {config.replicas.map((rep, i) => {
        const y = rowY(i);
        const rules = rulesByRegion[rep.id] ?? {};
        const dim = hover?.region && hover.region !== rep.id;
        return (
          <g key={rep.id} onMouseEnter={() => setHover({ region: rep.id })} onMouseLeave={() => setHover(null)} opacity={dim ? 0.4 : 1} className="cursor-default">
            <rect x={REP.x} y={y - ROW_H / 2 + 5} width={REP.w} height={ROW_H - 10} rx={8} fill="#fff" stroke="#cbd5e1" />
            <Icon icon="bucket" x={REP.x + 10} y={y - 15} s={30} />
            <T x={REP.x + 50} y={y - 3} size={12.5} weight={600}>{rep.city}</T>
            <T x={REP.x + 50} y={y + 13} size={11} color="#64748b" mono>{rep.id}</T>
            {KINDS.map((k, j) => {
              const r = rules[k.kind];
              const on = r?.status === "Enabled";
              const cx = REP.x + 168 + j * 42;
              return (
                <g key={k.kind}>
                  <title>{r ? `${r.id}: ${r.status}` : "no rule"}</title>
                  <rect x={cx} y={y - 11} width={36} height={20} rx={5} fill={on ? k.color : "#fff"} stroke={on ? k.color : "#dc2626"} strokeDasharray={on ? undefined : "3 2"} opacity={on && k.kind === "nortc" ? 0.85 : 1} />
                  <T x={cx + 18} y={y + 3} size={10.5} weight={600} anchor="middle" color={on ? (k.kind === "sidecars" || k.kind === "nortc" ? "#0f172a" : "#fff") : "#dc2626"}>
                    {k.kind === "proxies" ? "P" : k.kind === "sidecars" ? "S" : k.kind === "masters" ? (on ? "M" : "M off") : "M·n"}
                  </T>
                </g>
              );
            })}
            <T x={REP.x + 342} y={y - 3} size={10.5} color="#475569">expire {expiry} d</T>
            <T x={REP.x + 342} y={y + 12} size={10.5} color="#475569">old ver. 1 d</T>
            {/* arrival event → bus */}
            <Arrow d={`M ${REP.x + REP.w} ${y} L ${BUS_X - 4} ${y}`} color="#e11d74" width={1.2} opacity={0.6} />
          </g>
        );
      })}

      {/* --------------------------------------------------- arrivals bus */}
      <line x1={BUS_X} y1={rowY(0) - 20} x2={BUS_X} y2={rowY(config.replicas.length - 1) + 20} stroke="#e11d74" strokeWidth={3} strokeLinecap="round" />
      <Icon icon="eventbridge" x={BUS_X - 18} y={rowY(config.replicas.length - 1) + 34} s={36} />
      <T x={BUS_X} y={rowY(config.replicas.length - 1) + 90} size={12} weight={600} anchor="middle">central bus</T>
      <T x={BUS_X} y={rowY(config.replicas.length - 1) + 106} size={10.5} color="#64748b" anchor="middle">Object Created,</T>
      <T x={BUS_X} y={rowY(config.replicas.length - 1) + 120} size={10.5} color="#64748b" anchor="middle">forwarded per region</T>
      <T x={BUS_X} y={rowY(config.replicas.length - 1) + 134} size={10.5} color="#64748b" anchor="middle">→ ingest → timeline</T>

      {/* chip legend */}
      <T x={REP.x} y={ROW0 - 14} size={11} color="#64748b">
        P proxies · S sidecars · M masters (RTC) · M·n masters without RTC · red dashed = rule disabled
      </T>
    </Canvas>
  );
}

function Trigger({ y, icon, title, lines, muted }: { y: number; icon: AwsIcon; title: string; lines: string[]; muted?: boolean }) {
  return (
    <g opacity={muted ? 0.7 : 1}>
      <rect x={40} y={y} width={330} height={80} rx={10} fill={muted ? "#f8fafc" : "#fff"} stroke="#cbd5e1" />
      <Icon icon={icon} x={56} y={y + 14} />
      <T x={98} y={y + 24} size={12.5} weight={600}>{title}</T>
      {lines.map((l, i) => (
        <T key={i} x={98} y={y + 42 + i * 16} size={11.5} color="#334155" mono={i === 0}>
          {l}
        </T>
      ))}
    </g>
  );
}
