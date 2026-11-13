import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Config, Rule } from "@/types";

type Kind = "all" | "proxies" | "sidecars" | "masters" | "nortc";
const kindOf = (id: string): Exclude<Kind, "all"> =>
  id.startsWith("proxies-") ? "proxies" : id.startsWith("sidecars-") ? "sidecars" : id.startsWith("masters-nortc-") ? "nortc" : "masters";

const CLASS = { STANDARD: "Standard", ONEZONE_IA: "One Zone-IA", STANDARD_IA: "Standard-IA", GLACIER_IR: "Glacier IR" } as Record<string, string>;

/** Every replication rule on the source bucket, as S3 returns it. */
export function RulesTable({ config }: { config: Config }) {
  const [kind, setKind] = useState<Kind>("all");
  const [q, setQ] = useState("");
  const city = useMemo(() => Object.fromEntries(config.replicas.map((r) => [r.id, r])), [config.replicas]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...config.rules]
      .sort((a, b) => a.priority - b.priority)
      .filter((r) => kind === "all" || kindOf(r.id) === kind)
      .filter((r) => !needle || [r.id, r.filter, r.region, city[r.region ?? ""]?.city].join(" ").toLowerCase().includes(needle));
  }, [config.rules, kind, q, city]);

  const enabled = config.rules.filter((r) => r.status === "Enabled").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {config.rules.length} rules · {enabled} enabled · {config.rules.length - enabled} disabled. Sorted by priority
          (when two rules for the same destination match, the higher priority wins).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" value={kind} onValueChange={(v) => v && setKind(v as Kind)} variant="outline" size="sm">
            <ToggleGroupItem value="all" className="px-3">all</ToggleGroupItem>
            <ToggleGroupItem value="proxies" className="px-3">proxies</ToggleGroupItem>
            <ToggleGroupItem value="sidecars" className="px-3">sidecars</ToggleGroupItem>
            <ToggleGroupItem value="masters" className="px-3">masters (RTC)</ToggleGroupItem>
            <ToggleGroupItem value="nortc" className="px-3">masters (no RTC)</ToggleGroupItem>
          </ToggleGroup>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter: region, city, rule…" className="h-8 w-56" />
        </div>
      </div>

      <div className="max-h-[640px] overflow-auto rounded-lg border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="text-right">priority</TableHead>
              <TableHead>rule id</TableHead>
              <TableHead>status</TableHead>
              <TableHead>condition (filter)</TableHead>
              <TableHead>destination</TableHead>
              <TableHead>replica bucket</TableHead>
              <TableHead>storage class</TableHead>
              <TableHead>timing</TableHead>
              <TableHead>metrics</TableHead>
              <TableHead>delete markers</TableHead>
              <TableHead>trigger</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r: Rule) => {
              const rep = city[r.region ?? ""];
              const k = kindOf(r.id);
              return (
                <TableRow key={r.id} className={r.status === "Enabled" ? "tabular" : "tabular bg-red-50/60"}>
                  <TableCell className="text-right">{r.priority}</TableCell>
                  <TableCell className="font-mono text-xs">{r.id}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "Enabled" ? "secondary" : "destructive"} className="font-normal">
                      {r.status === "Enabled" ? "enabled" : "disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.filter}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {rep?.city ?? "—"} <span className="font-mono text-xs text-muted-foreground">{r.region}</span>
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground" title={rep?.bucket}>…{rep?.bucket.slice(rep.bucket.lastIndexOf("-", rep.bucket.length - (r.region?.length ?? 0) - 1))}</TableCell>
                  <TableCell>{CLASS[r.storageClass] ?? r.storageClass}</TableCell>
                  <TableCell>{r.rtc ? `RTC · ${config.rtcMinutes} min SLA` : "best effort"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.rtc ? `on · alert > ${config.rtcMinutes} min` : "on"}</TableCell>
                  <TableCell className="text-xs">{r.deleteMarkers ? "replicated" : "not replicated"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {k === "proxies" || k === "sidecars" ? "any new version under the prefix" : k === "masters" ? "rundown assignment, lab, batch backfill" : "lab or rundown with rtc: false"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Every rule has replica-modification sync enabled (only matters for two-way replication). Rules are evaluated per new
        object version; there is no schedule. Tag-filtered rules cannot replicate delete markers.
      </p>
    </div>
  );
}
