import { useMemo } from "react";
import { geoEquirectangular, geoInterpolate, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import land110 from "world-atlas/land-110m.json";
import { AWS_ICON, type AwsIcon } from "@/assets/aws";
import { Canvas } from "@/components/Canvas";
import { RulesDiagram } from "@/components/RulesDiagram";
import { RulesTable } from "@/components/RulesTable";
import { ROLE, SubHeader, TabHeader } from "@/components/Layout";
import { fmtMs } from "@/format";
import { cell } from "@/geo";
import type { Config, Matrix, Timeline } from "@/types";

// ---------------------------------------------------------------- world map
const W = 1200;
const TOP_LAT = 76;
const BOTTOM_LAT = -58;
const H = ((TOP_LAT - BOTTOM_LAT) / 180) * (W / 2);
const projection = geoEquirectangular()
  .scale(W / (2 * Math.PI))
  .translate([W / 2, (TOP_LAT / 180) * (W / 2)]);
const path = geoPath(projection);
const topo = land110 as unknown as Topology<{ land: GeometryCollection }>;
const LAND = feature(topo, topo.objects.land);
const LAND_D = path(LAND) ?? "";
const P = (lon: number, lat: number) => projection([lon, lat]) as [number, number];

interface Props {
  config: Config | null;
  matrix: Matrix | null;
  timeline: Timeline | null;
}

export function MapTab({ config, matrix, timeline }: Props) {
  const lastLag = useMemo(() => {
    const out: Record<string, { lagSec: number; at: string }> = {};
    for (const a of timeline?.assignments ?? []) {
      for (const [region, arr] of Object.entries(a.arrivals ?? {})) {
        if (!out[region] || arr.eventTime > out[region].at) out[region] = { lagSec: arr.lagSec, at: arr.eventTime };
      }
    }
    return out;
  }, [timeline]);

  return (
    <section className="space-y-10">
      <TabHeader title="Frankfurt is the truth; the cutters are everywhere">
        <p>
          The master archive lives in eu-central-1. Correspondents’ bureaus (amber) cut their pieces locally, so the
          material they need is replicated into the AWS region nearest to them (blue). Each arc shows the latest
          measured round trip from that region to the Frankfurt bucket and, once something has been replicated, how
          long the last copy took to arrive.
        </p>
      </TabHeader>

      {config ? (
        <Canvas
          width={W}
          height={H}
          className="h-[560px]"
          legend={
            <>
              <Legend color={ROLE.source} label="source (Frankfurt)" />
              <Legend color={ROLE.replica} label="replica region" />
              <Legend color={ROLE.bureau} label="bureau" />
              <span className="hidden sm:inline">arc label: RTT to Frankfurt · last replication lag</span>
            </>
          }
        >
          <path d={LAND_D} fill="#eef1f5" stroke="#d6dce5" strokeWidth={0.6} />

          {/* bureau -> serving region */}
          {config.bureaus.map((b) => {
            const r = config.replicas.find((x) => x.id === b.region);
            if (!r) return null;
            const [x1, y1] = P(b.lon, b.lat);
            const [x2, y2] = P(r.lon, r.lat);
            return <line key={`bl-${b.id}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={ROLE.bureau} strokeWidth={0.9} strokeDasharray="2 2" />;
          })}

          {/* Frankfurt -> region arcs */}
          {config.replicas.map((r) => {
            const d = path({ type: "LineString", coordinates: [[config.source.lon, config.source.lat], [r.lon, r.lat]] }) ?? "";
            const mid = geoInterpolate([config.source.lon, config.source.lat], [r.lon, r.lat])(0.62);
            const [mx, my] = P(mid[0], mid[1]);
            const rtt = cell(matrix, r.id, config.source.id)?.rttMs;
            const lag = lastLag[r.id];
            const label = [rtt != null ? fmtMs(rtt, 0) : null, lag ? `${Math.round(lag.lagSec)} s` : null].filter(Boolean).join(" · ");
            const far = r.kmFromSource > 1800;
            return (
              <g key={`arc-${r.id}`}>
                <title>{`${config.source.city} → ${r.city}: ${r.kmFromSource.toLocaleString()} km${rtt != null ? `, RTT ${fmtMs(rtt)}` : ""}${lag ? `, last lag ${lag.lagSec.toFixed(1)} s` : ""}`}</title>
                <path d={d} fill="none" stroke={ROLE.replica} strokeOpacity={0.45} strokeWidth={1.2} />
                {label && far && (
                  <text x={mx} y={my} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="#1f2937" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3.5, strokeLinejoin: "round" }}>
                    {label}
                  </text>
                )}
              </g>
            );
          })}

          {/* bureaus */}
          {config.bureaus.map((b) => {
            const [x, y] = P(b.lon, b.lat);
            return (
              <g key={`b-${b.id}`}>
                <title>{`${b.city} bureau → ${b.region} (${b.km.toLocaleString()} km)`}</title>
                <circle cx={x} cy={y} r={3} fill={ROLE.bureau} stroke="#fff" strokeWidth={1} />
              </g>
            );
          })}

          {/* replica regions */}
          {config.replicas.map((r) => {
            const [x, y] = P(r.lon, r.lat);
            return (
              <g key={`r-${r.id}`}>
                <title>{`${r.city} · ${r.id}${r.optIn ? " (opt-in region)" : ""}`}</title>
                <circle cx={x} cy={y} r={5} fill={ROLE.replica} stroke="#fff" strokeWidth={1.5} />
                <text x={x + 7} y={y + 3.5} fontSize={9.5} fill="#334155" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3, strokeLinejoin: "round" }}>
                  {r.city}
                </text>
              </g>
            );
          })}

          {/* Frankfurt */}
          {(() => {
            const [x, y] = P(config.source.lon, config.source.lat);
            return (
              <g>
                <circle cx={x} cy={y} r={7} fill={ROLE.source} stroke="#fff" strokeWidth={2} />
                <text x={x + 9} y={y - 7} fontSize={11} fontWeight={700} fill={ROLE.source} style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3.5, strokeLinejoin: "round" }}>
                  Frankfurt · source
                </text>
              </g>
            );
          })()}
        </Canvas>
      ) : (
        <div className="h-[560px] animate-pulse rounded-xl border bg-muted/40" />
      )}

      <div className="space-y-4">
        <SubHeader title="How it is built">
          Everything is serverless: replication is configured on the Frankfurt bucket, arrivals in every region are
          forwarded to one EventBridge bus, and a Lambda turns rundowns into tags. Idle cost is storage only.
        </SubHeader>
        <ArchDiagram />
      </div>

      {config && (
        <div className="space-y-4">
          <SubHeader title="Replication rules in detail">
            Every bucket and every one of the {config.rules.length} rules: what creates a new version (left), which lane of
            the Frankfurt bucket it lands in, the rule group that matches it with its filter, storage class, timing and
            delete handling, and one arrow per rule to each replica bucket. Live from the bucket’s replication
            configuration; a disabled rule shows red.
          </SubHeader>
          <RulesDiagram config={config} />
        </div>
      )}

      {config && (
        <div className="space-y-4">
          <SubHeader title="All replication rules">
            The same configuration as a list, one row per rule, exactly as S3 returns it from the Frankfurt bucket.
          </SubHeader>
          <RulesTable config={config} />
        </div>
      )}
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block size-2.5 rounded-full" style={{ background: color }} /> {label}
    </span>
  );
}

// ---------------------------------------------------------------- architecture
const ICON = 40;
function Node({ x, y, icon, label, sub, stack }: { x: number; y: number; icon: AwsIcon; label: string; sub?: string; stack?: boolean }) {
  return (
    <g>
      {stack && <image href={AWS_ICON[icon]} x={x - ICON / 2 + 8} y={y - ICON / 2 - 8} width={ICON} height={ICON} opacity={0.35} />}
      {stack && <image href={AWS_ICON[icon]} x={x - ICON / 2 + 4} y={y - ICON / 2 - 4} width={ICON} height={ICON} opacity={0.6} />}
      <image href={AWS_ICON[icon]} x={x - ICON / 2} y={y - ICON / 2} width={ICON} height={ICON} />
      <text x={x} y={y + ICON / 2 + 15} textAnchor="middle" fontSize={12.5} fontWeight={600} fill="#111827">
        {label}
      </text>
      {sub && (
        <text x={x} y={y + ICON / 2 + 30} textAnchor="middle" fontSize={11} fill="#64748b">
          {sub}
        </text>
      )}
    </g>
  );
}

function Edge({ d, label, lx, ly, dashed, anchor = "middle" }: { d: string; label?: string; lx?: number; ly?: number; dashed?: boolean; anchor?: "start" | "middle" | "end" }) {
  return (
    <g>
      <path d={d} fill="none" stroke="#9aa8ba" strokeWidth={1.4} strokeDasharray={dashed ? "5 4" : undefined} markerEnd="url(#arch-arrow)" />
      {label && lx != null && ly != null && (
        <text x={lx} y={ly} textAnchor={anchor} fontSize={11} fill="#475569" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 4, strokeLinejoin: "round" }}>
          {label}
        </text>
      )}
    </g>
  );
}

function ArchDiagram() {
  return (
    <div className="overflow-x-auto">
      <svg viewBox="0 0 1180 470" className="block h-auto w-full min-w-[900px]" role="img" aria-label="Architecture of the replication demo">
        <defs>
          <marker id="arch-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto">
            <path d="M 1 1 L 8 5 L 1 9" fill="none" stroke="#9aa8ba" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>

        {/* row 1: page -> CloudFront -> API -> probes / metrics / batch */}
        <Edge d="M 100 60 L 222 60" />
        <Edge d="M 278 60 L 402 60" />
        <Edge d="M 458 60 L 632 60" label="invoke ×15" lx={545} ly={52} />
        <Edge d="M 430 34 L 430 18 L 860 18 L 860 36" label="GetMetricData" lx={760} ly={13} />
        <Edge d="M 430 34 L 430 18 L 1060 18 L 1060 36" label="CreateJob" lx={1000} ly={13} />
        {/* probes read every bucket */}
        <Edge d="M 660 116 L 660 166 L 830 166 L 830 198" label="GET / HEAD, every bucket" lx={668} ly={160} anchor="start" />
        {/* batch -> source */}
        <Edge d="M 1060 116 L 1060 140 L 360 140 L 360 198" dashed label="backfill: InitiateReplication" lx={1052} ly={134} anchor="end" />

        <Node x={72} y={60} icon="client" label="Demo page" sub="this site" />
        <Node x={250} y={60} icon="cloudfront" label="CloudFront" sub="/ and /api/*" />
        <Node x={430} y={60} icon="lambda" label="API Lambda" sub="jobs, timeline, lab" />
        <Node x={660} y={60} icon="lambda" label="Probe Lambdas" sub="one per region" stack />
        <Node x={860} y={60} icon="cloudwatch" label="CloudWatch" sub="replication metrics" />
        <Node x={1060} y={60} icon="batch" label="Batch Operations" sub="Batch Replication" />

        {/* row 2: rundown -> source -> rules -> replicas -> forward */}
        <Edge d="M 100 230 L 302 230" label="PUT rundowns/*.json" lx={200} ly={222} />
        <Edge d="M 358 230 L 532 230" />
        <Edge d="M 588 230 L 798 230" label="new versions only" lx={693} ly={222} />
        <Edge d="M 858 230 L 1032 230" label="Object Created" lx={945} ly={222} />

        <Node x={72} y={230} icon="object" label="Rundown" sub="who cuts what, where" />
        <Node x={330} y={230} icon="s3" label="Source bucket" sub="eu-central-1 · versioned" />
        <Node x={560} y={230} icon="replication" label="Replication rules" sub="60 rules: prefix + tag" />
        <Node x={830} y={230} icon="bucket" label="15 replica buckets" sub="One Zone-IA / Standard" stack />
        <Node x={1060} y={230} icon="eventbridge" label="EventBridge" sub="rule in each region" stack />

        {/* row 3: ingest, dynamo, central bus */}
        <Edge d="M 1060 290 L 1060 400 L 858 400" label="forward to central bus" lx={1052} ly={394} anchor="end" />
        <Edge d="M 802 400 L 358 400" label="arrivals" lx={580} ly={392} />
        <Edge d="M 302 400 L 158 400" label="timeline" lx={230} ly={392} />
        <Edge d="M 320 290 L 320 372" label="rundown event" lx={312} ly={335} anchor="end" />
        <Edge d="M 340 372 L 340 292" dashed label="tag + copy in place" lx={348} ly={335} anchor="start" />

        <Node x={130} y={400} icon="dynamodb" label="DynamoDB" sub="timeline, runs" />
        <Node x={330} y={400} icon="lambda" label="Ingest Lambda" sub="arrivals, rundowns" />
        <Node x={830} y={400} icon="eventbridge" label="Central bus" sub="eu-central-1" />
      </svg>
    </div>
  );
}
