import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SubHeader, TabHeader } from "@/components/Layout";
import { cityOf } from "@/geo";
import type { Config } from "@/types";

const METRICS: { name: string; unit: string; what: string; how: string }[] = [
  { name: "Round trip (RTT)", unit: "ms", what: "Network distance between a cutter’s region and a bucket.", how: "Median of five HEAD requests on a 1 KiB object from the probe Lambda, after one warm-up request." },
  { name: "First byte", unit: "ms", what: "How long a cutter waits before media starts arriving: every scrub and relink pays it.", how: "GET of a 1 MiB object until the response headers arrive; median of three." },
  { name: "Throughput", unit: "Mbit/s", what: "How fast a large file streams over one connection.", how: "One GET of a 64 MiB object, bytes divided by time. Lambda networking caps it below workstation speeds." },
  { name: "Replication lag", unit: "s", what: "Time until a copy is usable in the destination region.", how: "“Object Created” event time in the destination minus the moment the upload (lab) or copy-in-place (rundown) finished in Frankfurt." },
  { name: "ReplicationLatency", unit: "s", what: "CloudWatch: how far behind the destination is for a rule.", how: "Published per rule and destination when replication metrics are enabled; maximum per 5 minutes." },
  { name: "BytesPendingReplication", unit: "bytes", what: "CloudWatch: data waiting to be replicated for a rule.", how: "Rises during a large upload, returns to zero when the destination has caught up." },
  { name: "OperationsFailedReplication", unit: "count", what: "CloudWatch: objects that could not be replicated (permissions, KMS, deleted source).", how: "Sum per 5 minutes; also delivered as an s3:Replication:OperationFailedReplication event." },
  { name: "RTC SLA", unit: "15 min", what: "Replication Time Control: 99.99 % of new objects replicated within 15 minutes, with an SLA and the metrics above.", how: "Enabled per rule; costs about $0.015/GB. Missing the threshold emits OperationMissedThreshold." },
];

const GOTCHAS = [
  "Replication evaluates new object versions only. Changing tags on an existing object does not start replication for a rule it did not match before: write a new version (copy the object onto itself).",
  "Copy-in-place with CopyObject works up to 5 GB; larger masters need a multipart copy (UploadPartCopy).",
  "No chaining: a replica is not replicated again by a rule on the destination unless that bucket has its own configuration (and then it is a separate copy).",
  "Delete markers are not replicated by tag-filtered rules; only prefix rules can replicate them.",
  "An object carries at most 10 tags, which caps how many dest-<region> tags one master can carry.",
  "Existing objects are not replicated when a rule is added or enabled: S3 Batch Replication does the backfill.",
  "Multi-Region Access Points route a request to the nearest bucket but do not fetch a missing object from another one; replication still has to put it there.",
  "Replication metrics and events appear a few minutes after traffic and only for rules that moved data.",
  "Replication requires versioning on both buckets; noncurrent versions need lifecycle rules or they accumulate.",
  "Each rule has a destination storage class: replicas can be cheaper than the source.",
];

export function ReferenceTab({ config }: { config: Config | null }) {
  const ex = config?.replicas[6]?.id ?? "sa-east-1";
  const rules = config?.rules ?? [];
  return (
    <section className="space-y-10">
      <TabHeader title="Reference">
        <p>Every number on this page, the replication rules as deployed, and what to watch out for.</p>
      </TabHeader>

      <dl className="divide-y border-y">
        {METRICS.map((m) => (
          <div key={m.name} className="grid gap-2 py-4 md:grid-cols-[220px_minmax(0,1fr)] md:gap-10">
            <dt>
              <div className="text-sm font-medium">{m.name}</div>
              <div className="font-mono text-xs text-muted-foreground">{m.unit}</div>
            </dt>
            <dd className="max-w-3xl space-y-1 text-sm">
              <p>{m.what}</p>
              <p className="text-muted-foreground">{m.how}</p>
            </dd>
          </div>
        ))}
      </dl>

      <div className="space-y-4">
        <SubHeader title={`Replication rules on the source bucket (${rules.length})`}>
          Four rules per destination: proxies and sidecars by prefix, masters by tag with and without Replication Time
          Control. Priorities only matter when two rules target the same destination.
        </SubHeader>
        <div className="max-h-[420px] overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>id</TableHead>
                <TableHead>status</TableHead>
                <TableHead>filter</TableHead>
                <TableHead>destination</TableHead>
                <TableHead>storage class</TableHead>
                <TableHead>RTC</TableHead>
                <TableHead>delete markers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.id}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={r.status === "Enabled" ? "" : "text-muted-foreground"}>
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.filter}</TableCell>
                  <TableCell>{r.region ? cityOf(config, r.region) : "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.storageClass}</TableCell>
                  <TableCell>{r.rtc ? "yes" : "—"}</TableCell>
                  <TableCell>{r.deleteMarkers ? "yes" : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Json
            title="prefix rule: proxies to every region"
            value={{
              ID: `proxies-${ex}`,
              Status: "Enabled",
              Filter: { Prefix: "proxies/" },
              DeleteMarkerReplication: { Status: "Enabled" },
              Destination: { Bucket: `arn:aws:s3:::…-${ex}`, StorageClass: config?.storageClasses.proxies ?? "ONEZONE_IA", Metrics: { Status: "Enabled", EventThreshold: { Minutes: 15 } } },
            }}
          />
          <Json
            title="tag rule: masters only when assigned, with RTC"
            value={{
              ID: `masters-${ex}`,
              Status: "Enabled",
              Filter: { Tag: { Key: `dest-${ex}`, Value: "1" } },
              DeleteMarkerReplication: { Status: "Disabled" },
              Destination: {
                Bucket: `arn:aws:s3:::…-${ex}`,
                StorageClass: config?.storageClasses.masters ?? "STANDARD",
                ReplicationTime: { Status: "Enabled", Time: { Minutes: 15 } },
                Metrics: { Status: "Enabled", EventThreshold: { Minutes: 15 } },
              },
            }}
          />
        </div>
      </div>

      <div className="space-y-4">
        <SubHeader title="Limits and gotchas" />
        <ul className="max-w-4xl list-disc space-y-2 pl-5 text-sm">
          {GOTCHAS.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Json({ title, value }: { title: string; value: unknown }) {
  return (
    <figure className="space-y-2">
      <figcaption className="text-xs text-muted-foreground">{title}</figcaption>
      <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed">{JSON.stringify(value, null, 2)}</pre>
    </figure>
  );
}
