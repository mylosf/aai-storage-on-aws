// API for the replication demo. Runs behind a Lambda function URL, reached via
// CloudFront at /api/*. Long work runs as jobs: the API invokes itself
// asynchronously and the page polls /api/jobs/:id.
//
//   GET  /api/config                 regions, buckets, bureaus->regions, rules
//   POST /api/setup                  probe objects into all 16 buckets (job)
//   POST /api/matrix                 every region's probe against every bucket (job)
//   GET  /api/matrix                 latest matrix
//   POST /api/catalogue              generate the newsroom catalogue (job)
//   GET  /api/catalogue              objects in the source bucket + where they are
//   POST /api/assign                 {items:[{clip, bureaus|regions, rtc}]} -> writes a rundown
//   POST /api/rundown                {rundown} any rundown JSON
//   GET  /api/timeline               assignments with per-region arrival lag, replication events
//   POST /api/lab                    {sizeMiB, regions, rtc} replication lab object (job)
//   GET  /api/lab                    recent lab runs with per-region lag
//   GET  /api/metrics                CloudWatch replication metrics per region
//   GET  /api/late                   late-region rule status + backlog
//   POST /api/late                   {region, enabled}
//   POST /api/batch                  {region} S3 Batch Replication of the backlog
//   GET  /api/batch                  recent batch jobs
//   GET  /api/jobs/:id

import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  GetBucketReplicationCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketReplicationCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { CreateJobCommand, DescribeJobCommand, ListJobsCommand, S3ControlClient } from "@aws-sdk/client-s3-control";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const env = process.env;
// config.json is bundled by Terraform (env vars are limited to 4 KB)
const CFG = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
const SOURCE = env.SOURCE_BUCKET;
const SOURCE_REGION = env.SOURCE_REGION;
const REPLICAS = CFG.replicaBuckets; // region -> bucket
const PROBES = CFG.probeFunctions; // region -> function arn
const LATE = CFG.lateRegions ?? [];
const CLASSES = CFG.storageClasses;
const TABLE = env.TABLE;
const MiB = 1024 * 1024;

const ddb = new DynamoDBClient({});
const s3 = new S3Client({ region: SOURCE_REGION });
const cw = new CloudWatchClient({ region: SOURCE_REGION });
const s3c = new S3ControlClient({ region: SOURCE_REGION });
const s3For = new Map();
const s3In = (region) => {
  if (!s3For.has(region)) s3For.set(region, new S3Client({ region }));
  return s3For.get(region);
};
const lambdas = new Map();
const lambdaIn = (region) => {
  if (!lambdas.has(region)) lambdas.set(region, new LambdaClient({ region }));
  return lambdas.get(region);
};

// ------------------------------------------------------------------ dynamo
const S = (v) => ({ S: String(v) });
const ttl = (days = 14) => ({ N: String(Math.floor(Date.now() / 1000) + days * 86400) });
const unwrap = (item) =>
  Object.fromEntries(
    Object.entries(item).map(([k, v]) => [k, v.S ?? (v.N != null ? Number(v.N) : v.SS ? v.SS.filter((x) => x !== "-") : v.BOOL ?? null)]),
  );

async function query(pk, limit = 500, forward = false) {
  const out = [];
  let ExclusiveStartKey;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :p",
        ExpressionAttributeValues: { ":p": S(pk) },
        ScanIndexForward: forward,
        Limit: Math.min(limit - out.length, 1000),
        ExclusiveStartKey,
      }),
    );
    out.push(...(r.Items ?? []).map(unwrap));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey && out.length < limit);
  return out;
}

async function putJson(pk, sk, data, days = 14) {
  await ddb.send(new PutItemCommand({ TableName: TABLE, Item: { pk: S(pk), sk: S(sk), data: S(JSON.stringify(data)), ttl: ttl(days) } }));
}
async function getJson(pk, sk) {
  const r = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: { pk: S(pk), sk: S(sk) } }));
  return r.Item ? JSON.parse(r.Item.data.S) : null;
}
const latest = async (pk) => {
  const [item] = await query(pk, 1);
  return item ? JSON.parse(item.data) : null;
};

// ------------------------------------------------------------------ jobs
async function startJob(type, params) {
  const id = `${type}-${Date.now().toString(36)}-${randomUUID().slice(0, 4)}`;
  const job = { id, type, status: "queued", progress: "queued", createdAt: new Date().toISOString(), params };
  await putJson("job", id, job, 3);
  await lambdaIn(SOURCE_REGION).send(
    new InvokeCommand({ FunctionName: env.SELF_FUNCTION, InvocationType: "Event", Payload: JSON.stringify({ job: { id, type, params } }) }),
  );
  return job;
}

async function updateJob(id, patch) {
  const cur = (await getJson("job", id)) ?? { id };
  await putJson("job", id, { ...cur, ...patch, updatedAt: new Date().toISOString() }, 3);
}

// ------------------------------------------------------------------ geography
const rad = (d) => (d * Math.PI) / 180;
const km = (a, b) => {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
};
const nearestRegion = (p) => CFG.replicas.reduce((best, r) => (km(p, r) < km(p, best) ? r : best), CFG.replicas[0]);

// ------------------------------------------------------------------ object writer
// Synthetic media: random bytes at realistic sizes. One random 16 MiB block is
// reused per part with a part-specific header, so generation is CPU-cheap.
const BLOCK = randomBytes(16 * MiB);
async function writeObject({ bucket, key, bytes, contentType, tags, metadata, region = SOURCE_REGION }) {
  const client = s3In(region);
  const Tagging = tags ? new URLSearchParams(tags).toString() : undefined;
  if (bytes <= 32 * MiB) {
    const body = Buffer.alloc(bytes);
    for (let o = 0; o < bytes; o += BLOCK.length) BLOCK.copy(body, o, 0, Math.min(BLOCK.length, bytes - o));
    body.write(`${key}|${Date.now()}`, 0);
    const r = await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, Tagging, Metadata: metadata }));
    return { versionId: r.VersionId };
  }
  const part = 16 * MiB;
  const parts = Math.ceil(bytes / part);
  const { UploadId } = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType, Tagging, Metadata: metadata }));
  try {
    const etags = new Array(parts);
    let next = 0;
    const worker = async () => {
      while (next < parts) {
        const i = next++;
        const len = Math.min(part, bytes - i * part);
        const body = Buffer.from(BLOCK.subarray(0, len));
        body.write(`${key}|part ${i + 1}|${Date.now()}`, 0);
        const r = await client.send(new UploadPartCommand({ Bucket: bucket, Key: key, UploadId, PartNumber: i + 1, Body: body }));
        etags[i] = { ETag: r.ETag, PartNumber: i + 1 };
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    const done = await client.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId, MultipartUpload: { Parts: etags } }));
    return { versionId: done.VersionId };
  } catch (err) {
    await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId })).catch(() => {});
    throw err;
  }
}

// ------------------------------------------------------------------ catalogue
// An evening news production in Frankfurt with correspondents abroad, plus a
// documentary built on Netflix Open Content (CC BY 4.0) real masters.
const SHOWS = [
  {
    show: "tagesschau",
    date: "2026-11-12",
    clips: [
      ["washington-wahlnacht", "washington", 1400],
      ["sao-paulo-amazonas-brand", "sao-paulo", 900],
      ["nairobi-duerre", "nairobi", 700],
      ["tokio-erdbebenuebung", "tokyo", 600],
      ["singapur-hafen", "singapore", 500],
      ["kapstadt-energiekrise", "johannesburg", 800],
    ],
  },
  {
    show: "weltspiegel",
    date: "2026-11-15",
    clips: [
      ["mexiko-stadt-wasser", "mexico-city", 1200],
      ["delhi-smog", "delhi", 1000],
      ["dubai-klimakonferenz", "dubai", 900],
      ["sydney-buschfeuer", "sydney", 1100],
    ],
  },
  {
    show: "sport",
    date: "2026-11-14",
    clips: [
      ["buenos-aires-derby", "buenos-aires", 1600],
      ["lagos-marathon", "lagos", 700],
    ],
  },
];
const NETFLIX = [
  {
    from: "Meridian/Meridian_UHD4k5994_HDR_P3PQ.mp4",
    show: "doku-meridian",
    clip: "meridian-uhd-hdr",
    ext: "mp4",
    type: "video/mp4",
    bureau: "los-angeles",
  },
  {
    from: "Meridian/MER_SHR_C_EN-XX_US-NR_51_LTRT_UHD_20160913_OV/MER_SHR_C_EN-XX_US-NR_51_LTRT_UHD_20160913_OV/MER_SHR_C_EN-XX_US-NR_51_LTRT_UHD_20160913_OV_01_EN_51_A.mxf",
    show: "doku-meridian",
    clip: "meridian-audio-51",
    ext: "mxf",
    type: "application/mxf",
    bureau: "los-angeles",
  },
];

const sidecarXml = (show, clip, bureau, date) => `<?xml version="1.0" encoding="UTF-8"?>
<asset xmlns="urn:demo:mam:1">
  <id>${show}/${clip}</id>
  <production>${show}</production>
  <broadcastDate>${date}</broadcastDate>
  <bureau>${bureau}</bureau>
  <rights territory="worldwide" embargo="none"/>
  <video codec="XDCAM HD422" resolution="1920x1080" fps="50i"/>
  <audio channels="8" layout="stereo+stereo+mm"/>
  <source>Frankfurt master archive</source>
</asset>
`;
const srt = (clip) => `1\n00:00:01,000 --> 00:00:04,000\n[${clip}] Untertitel – Muster\n\n2\n00:00:04,500 --> 00:00:08,000\nDieses Material ist synthetisch.\n`;

async function generateCatalogue(jobId) {
  const tasks = [];
  for (const s of SHOWS) {
    for (const [clip, bureau, mb] of s.clips) {
      tasks.push({ kind: "master", key: `masters/${s.show}/${clip}.mxf`, bytes: mb * MiB, type: "application/mxf", meta: { show: s.show, bureau, date: s.date } });
      tasks.push({ kind: "proxy", key: `proxies/${s.show}/${clip}.mp4`, bytes: (25 + Math.round(mb / 40)) * MiB, type: "video/mp4", meta: { show: s.show, bureau } });
      tasks.push({ kind: "sidecar", key: `sidecars/${s.show}/${clip}.xml`, body: sidecarXml(s.show, clip, bureau, s.date), type: "application/xml" });
      tasks.push({ kind: "sidecar", key: `sidecars/${s.show}/${clip}.de.srt`, body: srt(clip), type: "application/x-subrip" });
    }
  }
  for (const n of NETFLIX) {
    tasks.push({ kind: "netflix", key: `masters/${n.show}/${n.clip}.${n.ext}`, from: n.from, type: n.type, meta: { show: n.show, bureau: n.bureau, source: "Netflix Open Content, CC BY 4.0" } });
    tasks.push({ kind: "proxy", key: `proxies/${n.show}/${n.clip}.mp4`, bytes: 40 * MiB, type: "video/mp4", meta: { show: n.show, bureau: n.bureau } });
    tasks.push({ kind: "sidecar", key: `sidecars/${n.show}/${n.clip}.xml`, body: sidecarXml(n.show, n.clip, n.bureau, "2026-11-20"), type: "application/xml" });
  }

  let done = 0;
  const errors = [];
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const t = tasks[next++];
      try {
        if (t.kind === "sidecar") {
          await s3.send(new PutObjectCommand({ Bucket: SOURCE, Key: t.key, Body: t.body, ContentType: t.type }));
        } else if (t.kind === "netflix") {
          await s3.send(
            new CopyObjectCommand({
              Bucket: SOURCE,
              Key: t.key,
              CopySource: `download.opencontent.netflix.com/${t.from}`,
              ContentType: t.type,
              MetadataDirective: "REPLACE",
              Metadata: t.meta,
            }),
          );
        } else {
          await writeObject({ bucket: SOURCE, key: t.key, bytes: t.bytes, contentType: t.type, metadata: t.meta });
        }
      } catch (err) {
        errors.push(`${t.key}: ${err.name}: ${err.message}`);
      }
      done++;
      if (done % 4 === 0 || done === tasks.length) await updateJob(jobId, { progress: `${done}/${tasks.length} objects`, current: done, total: tasks.length });
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
  return { objects: tasks.length, errors };
}

// ------------------------------------------------------------------ probes
const PROBE_KEYS = { pingKey: "probe/ping.bin", smallKey: "probe/1MiB.bin", bigKey: "probe/64MiB.bin" };
const allBuckets = () => [{ region: SOURCE_REGION, bucket: SOURCE }, ...Object.entries(REPLICAS).map(([region, bucket]) => ({ region, bucket }))];

async function setupProbeObjects(jobId) {
  const targets = allBuckets();
  let n = 0;
  await Promise.all(
    targets.map(async (t) => {
      await writeObject({ region: t.region, bucket: t.bucket, key: PROBE_KEYS.pingKey, bytes: 1024, contentType: "application/octet-stream" });
      await writeObject({ region: t.region, bucket: t.bucket, key: PROBE_KEYS.smallKey, bytes: MiB, contentType: "application/octet-stream" });
      await writeObject({ region: t.region, bucket: t.bucket, key: PROBE_KEYS.bigKey, bytes: 64 * MiB, contentType: "application/octet-stream" });
      n++;
      await updateJob(jobId, { progress: `${n}/${targets.length} buckets`, current: n, total: targets.length });
    }),
  );
  return { buckets: targets.length };
}

async function runMatrix(jobId) {
  const targets = allBuckets();
  let n = 0;
  const rows = await Promise.all(
    Object.entries(PROBES).map(async ([region, fn]) => {
      try {
        const r = await lambdaIn(region).send(new InvokeCommand({ FunctionName: fn, Payload: JSON.stringify({ targets, ...PROBE_KEYS }) }));
        const out = JSON.parse(Buffer.from(r.Payload).toString());
        if (r.FunctionError) throw new Error(out.errorMessage ?? r.FunctionError);
        return out;
      } catch (err) {
        return { from: region, error: `${err.name}: ${err.message}`, results: [] };
      } finally {
        n++;
        await updateJob(jobId, { progress: `${n}/${Object.keys(PROBES).length} probe regions done`, current: n, total: Object.keys(PROBES).length });
      }
    }),
  );
  const result = { at: new Date().toISOString(), probeBytes: 64 * MiB, rows };
  await putJson("matrix", result.at, result, 30);
  return result;
}

// ------------------------------------------------------------------ catalogue view
async function listSource(prefix) {
  const out = [];
  let ContinuationToken;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: SOURCE, Prefix: prefix, ContinuationToken }));
    out.push(...(r.Contents ?? []).map((o) => ({ key: o.Key, size: o.Size, lastModified: o.LastModified })));
    ContinuationToken = r.NextContinuationToken;
  } while (ContinuationToken);
  return out;
}

async function catalogue() {
  const [masters, proxies, sidecars, arrivals] = await Promise.all([
    listSource("masters/"),
    listSource("proxies/"),
    listSource("sidecars/"),
    query("arrival", 5000),
  ]);
  const where = {};
  for (const a of arrivals) (where[a.key] ??= new Set()).add(a.region);
  const bureauOf = {};
  for (const s of SHOWS) for (const [clip, bureau] of s.clips) bureauOf[`${s.show}/${clip}`] = bureau;
  for (const n of NETFLIX) bureauOf[`${n.show}/${n.clip}`] = n.bureau;
  const tag = (o, type) => ({ ...o, type, bureau: bureauOf[o.key.split("/").slice(1).join("/").replace(/(\.de)?\.[^.]+$/, "")], show: o.key.split("/")[1], clip: o.key.split("/")[2]?.replace(/\.[^.]+$/, "").replace(/\.de$/, ""), regions: [...(where[o.key] ?? [])] });
  return {
    objects: [...masters.map((o) => tag(o, "master")), ...proxies.map((o) => tag(o, "proxy")), ...sidecars.map((o) => tag(o, "sidecar"))],
  };
}

// ------------------------------------------------------------------ assignment
async function writeRundown(rundown) {
  const key = `rundowns/${new Date().toISOString().replace(/[:.]/g, "-")}-${(rundown.show ?? "adhoc").replace(/[^a-z0-9-]/gi, "")}.json`;
  await s3.send(new PutObjectCommand({ Bucket: SOURCE, Key: key, Body: JSON.stringify(rundown, null, 2), ContentType: "application/json" }));
  return key;
}

function joinArrivals(items, arrivals) {
  const byVersion = {};
  for (const a of arrivals) if (a.versionId) (byVersion[a.versionId] ??= []).push(a);
  return items.map((it) => {
    const start = Date.parse(it.copiedAt ?? it.putDoneAt ?? it.at);
    const arr = {};
    for (const a of byVersion[it.versionId] ?? []) {
      const t = Date.parse(a.eventTime);
      arr[a.region] = { eventTime: a.eventTime, lagSec: Math.max(0, (t - start) / 1000) };
    }
    return { ...it, arrivals: arr };
  });
}

async function timeline() {
  const [assigns, arrivals, repl] = await Promise.all([query("assign", 200), query("arrival", 5000), query("repl", 200)]);
  return { assignments: joinArrivals(assigns, arrivals), replicationEvents: repl };
}

// ------------------------------------------------------------------ lab
async function runLab(jobId, { sizeMiB, regions, rtc }) {
  const run = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `lab/${run}/${sizeMiB}MiB.bin`;
  const tags = Object.fromEntries(regions.map((r) => [rtc ? `dest-${r}` : `dest-nortc-${r}`, "1"]));
  await updateJob(jobId, { progress: `uploading ${sizeMiB} MiB to Frankfurt` });
  const putStart = new Date().toISOString();
  const { versionId } = await writeObject({ bucket: SOURCE, key, bytes: sizeMiB * MiB, contentType: "application/octet-stream", tags });
  const putDoneAt = new Date().toISOString();
  const item = { key, versionId, sizeMiB, regions, rtc, putStart, putDoneAt };
  await putJson("lab", putDoneAt, item, 14);
  return item;
}

async function labRuns() {
  const [runs, arrivals] = await Promise.all([query("lab", 30), query("arrival", 5000)]);
  const parsed = runs.map((r) => JSON.parse(r.data));
  const joined = joinArrivals(parsed, arrivals);
  // overall replication status on the source object (PENDING -> COMPLETED / FAILED)
  await Promise.all(
    joined.slice(0, 8).map(async (r) => {
      try {
        const h = await s3.send(new HeadObjectCommand({ Bucket: SOURCE, Key: r.key, VersionId: r.versionId }));
        r.replicationStatus = h.ReplicationStatus ?? "NONE";
      } catch {
        r.replicationStatus = "deleted";
      }
    }),
  );
  return { runs: joined };
}

// ------------------------------------------------------------------ metrics
async function metrics(hours = 6) {
  const queries = [];
  const id = (s) => s.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  for (const [region, bucket] of Object.entries(REPLICAS)) {
    for (const rule of [`masters-${region}`, `masters-nortc-${region}`, `proxies-${region}`]) {
      const dims = [
        { Name: "SourceBucket", Value: SOURCE },
        { Name: "DestinationBucket", Value: bucket },
        { Name: "RuleId", Value: rule },
      ];
      for (const [metric, stat] of [
        ["ReplicationLatency", "Maximum"],
        ["BytesPendingReplication", "Maximum"],
        ["OperationsPendingReplication", "Maximum"],
        ["OperationsFailedReplication", "Sum"],
      ]) {
        queries.push({ Id: id(`m_${metric}_${rule}`), Label: `${metric}|${rule}|${region}`, MetricStat: { Metric: { Namespace: "AWS/S3", MetricName: metric, Dimensions: dims }, Period: 300, Stat: stat } });
      }
    }
  }
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600 * 1000);
  const series = [];
  for (let i = 0; i < queries.length; i += 400) {
    const r = await cw.send(new GetMetricDataCommand({ MetricDataQueries: queries.slice(i, i + 400), StartTime: start, EndTime: end, ScanBy: "TimestampAscending" }));
    for (const m of r.MetricDataResults ?? []) {
      const [metric, rule, region] = m.Label.split("|");
      if (!m.Values?.length) continue;
      series.push({ metric, rule, region, points: m.Timestamps.map((t, j) => [t.toISOString(), m.Values[j]]) });
    }
  }
  return { start: start.toISOString(), end: end.toISOString(), series };
}

// ------------------------------------------------------------------ rules / late region / batch
async function replicationRules() {
  const r = await s3.send(new GetBucketReplicationCommand({ Bucket: SOURCE }));
  return r.ReplicationConfiguration;
}

function summarizeRules(conf) {
  const bucketRegion = Object.fromEntries(Object.entries(REPLICAS).map(([r, b]) => [`arn:aws:s3:::${b}`, r]));
  return (conf?.Rules ?? []).map((r) => ({
    id: r.ID,
    status: r.Status,
    priority: r.Priority,
    filter: r.Filter?.Prefix != null ? `prefix ${r.Filter.Prefix}` : r.Filter?.Tag ? `tag ${r.Filter.Tag.Key}=${r.Filter.Tag.Value}` : "all",
    region: bucketRegion[r.Destination?.Bucket],
    storageClass: r.Destination?.StorageClass ?? "STANDARD",
    rtc: r.Destination?.ReplicationTime?.Status === "Enabled",
    deleteMarkers: r.DeleteMarkerReplication?.Status === "Enabled",
  }));
}

async function setLate(region, enabled) {
  if (!LATE.includes(region)) throw Object.assign(new Error(`${region} is not a late region`), { status: 400 });
  const conf = await replicationRules();
  const rule = conf.Rules.find((r) => r.ID === `masters-${region}`);
  if (!rule) throw new Error(`rule masters-${region} not found`);
  rule.Status = enabled ? "Enabled" : "Disabled";
  await s3.send(new PutBucketReplicationCommand({ Bucket: SOURCE, ReplicationConfiguration: conf }));
  return { region, enabled };
}

async function lateStatus() {
  const conf = await replicationRules();
  const assigns = await query("assign", 500);
  const arrivals = await query("arrival", 5000);
  const arrived = new Set(arrivals.map((a) => `${a.key}#${a.region}`));
  return LATE.map((region) => {
    const rule = conf.Rules.find((r) => r.ID === `masters-${region}`);
    const assigned = assigns.filter((a) => (a.regions ?? []).includes(region));
    const keys = [...new Set(assigned.map((a) => a.key))];
    return {
      region,
      city: CFG.replicas.find((r) => r.id === region)?.city,
      ruleEnabled: rule?.Status === "Enabled",
      assigned: keys.length,
      backlog: keys.filter((k) => !arrived.has(`${k}#${region}`)),
    };
  });
}

async function startBatch(region) {
  const token = randomUUID();
  const r = await s3c.send(
    new CreateJobCommand({
      AccountId: env.ACCOUNT_ID,
      ConfirmationRequired: false,
      Operation: { S3ReplicateObject: {} },
      Priority: 10,
      RoleArn: env.BATCH_ROLE_ARN,
      ClientRequestToken: token,
      Description: `media-rep backfill masters -> ${region}`,
      Report: {
        Enabled: true,
        Bucket: `arn:aws:s3:::${SOURCE}`,
        Prefix: "batch-reports",
        Format: "Report_CSV_20180820",
        ReportScope: "AllTasks",
      },
      ManifestGenerator: {
        S3JobManifestGenerator: {
          SourceBucket: `arn:aws:s3:::${SOURCE}`,
          EnableManifestOutput: false,
          Filter: {
            EligibleForReplication: true,
            ObjectReplicationStatuses: ["NONE", "FAILED"],
            KeyNameConstraint: { MatchAnyPrefix: ["masters/"] },
          },
        },
      },
    }),
  );
  await putJson("batch", new Date().toISOString(), { jobId: r.JobId, region }, 14);
  return { jobId: r.JobId };
}

async function batchJobs() {
  const mine = (await query("batch", 10)).map((x) => JSON.parse(x.data));
  const jobs = await Promise.all(
    mine.map(async (m) => {
      try {
        const d = await s3c.send(new DescribeJobCommand({ AccountId: env.ACCOUNT_ID, JobId: m.jobId }));
        const j = d.Job;
        return {
          ...m,
          status: j.Status,
          created: j.CreationTime,
          total: j.ProgressSummary?.TotalNumberOfTasks,
          succeeded: j.ProgressSummary?.NumberOfTasksSucceeded,
          failed: j.ProgressSummary?.NumberOfTasksFailed,
          reasons: j.FailureReasons?.map((f) => f.FailureReason),
        };
      } catch (err) {
        return { ...m, status: "unknown", error: err.message };
      }
    }),
  );
  return { jobs };
}

// ------------------------------------------------------------------ upload tab
// The browser PUTs straight to Frankfurt with a presigned URL (size is part of the
// signature). proxies/uploads/* matches the existing proxies-<region> rules, so
// S3 replicates it to all 15 regions; that prefix is public-read on every bucket
// and expires after one day.
const UPLOAD_MAX = 50 * MiB;
const publicUrl = (bucket, region, key) => `https://${bucket}.s3.${region}.amazonaws.com/${key.split("/").map(encodeURIComponent).join("/")}`;

// Uploads become public URLs in 16 buckets, so they must not turn into free web
// hosting: only media types are served as-is (inline); anything else is stored
// as application/octet-stream, forced to download, and loses its extension.
// A global hourly cap limits abuse (the API is unauthenticated).
const UPLOAD_TYPES = new Map([
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/webm", "webm"],
  ["video/x-matroska", "mkv"],
  ["application/mxf", "mxf"],
  ["audio/mpeg", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/wav", "wav"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
]);
const UPLOADS_PER_HOUR = Number(env.UPLOADS_PER_HOUR ?? 60);

async function countUpload() {
  const hour = new Date().toISOString().slice(0, 13);
  const r = await ddb.send(
    new UpdateItemCommand({
      TableName: TABLE,
      Key: { pk: S("uploadcount"), sk: S(hour) },
      UpdateExpression: "ADD n :one SET #t = :ttl",
      ExpressionAttributeNames: { "#t": "ttl" },
      ExpressionAttributeValues: { ":one": { N: "1" }, ":ttl": ttl(1) },
      ReturnValues: "UPDATED_NEW",
    }),
  );
  return Number(r.Attributes.n.N);
}

async function presignUpload(body) {
  const size = Number(body.size);
  if (!Number.isInteger(size) || size < 1 || size > UPLOAD_MAX) throw bad(`size must be 1 byte … ${UPLOAD_MAX / MiB} MiB`);
  if ((await countUpload()) > UPLOADS_PER_HOUR) throw Object.assign(new Error(`upload limit reached (${UPLOADS_PER_HOUR} per hour for this demo)`), { status: 429 });
  const requested = String(body.contentType ?? "").toLowerCase();
  const media = UPLOAD_TYPES.has(requested);
  const contentType = media ? requested : "application/octet-stream";
  const contentDisposition = media ? "inline" : "attachment";
  let clean = String(body.name ?? "file").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "file";
  // the extension follows the stored type, never the client's file name
  clean = `${clean.replace(/\.[^.]*$/, "") || "file"}.${media ? UPLOAD_TYPES.get(requested) : "bin"}`;
  const key = `proxies/uploads/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 6)}-${clean}`;
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: SOURCE, Key: key, ContentType: contentType, ContentDisposition: contentDisposition, ContentLength: size }),
    { expiresIn: 600, signableHeaders: new Set(["content-type", "content-length", "content-disposition"]) },
  );
  return { key, url, contentType, contentDisposition, maxBytes: UPLOAD_MAX };
}

async function uploadStatus(key) {
  if (!key.startsWith("proxies/uploads/")) throw bad("key must be under proxies/uploads/");
  const src = await s3.send(new HeadObjectCommand({ Bucket: SOURCE, Key: key }));
  const createdAt = src.LastModified?.toISOString();
  const arrivals = (await query("arrival", 5000)).filter((a) => a.key === key);
  const eventBy = Object.fromEntries(arrivals.map((a) => [a.region, a.eventTime]));
  const replicas = await Promise.all(
    CFG.replicas.map(async (r) => {
      const bucket = REPLICAS[r.id];
      const out = { region: r.id, city: r.city, bucket, url: publicUrl(bucket, r.id, key), present: false };
      try {
        const h = await s3In(r.id).send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        out.present = true;
        out.versionId = h.VersionId;
        out.storageClass = h.StorageClass ?? "STANDARD";
        out.replicationStatus = h.ReplicationStatus; // REPLICA
      } catch {
        /* not there yet */
      }
      if (eventBy[r.id]) {
        out.arrivedAt = eventBy[r.id];
        out.lagSec = (Date.parse(eventBy[r.id]) - Date.parse(createdAt)) / 1000;
      }
      return out;
    }),
  );
  return {
    key,
    size: src.ContentLength,
    contentType: src.ContentType,
    source: {
      region: SOURCE_REGION,
      city: CFG.source.city,
      bucket: SOURCE,
      url: publicUrl(SOURCE, SOURCE_REGION, key),
      versionId: src.VersionId,
      createdAt,
      replicationStatus: src.ReplicationStatus ?? "NONE",
    },
    replicas,
  };
}

// ------------------------------------------------------------------ http
const json = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(body),
});
const bad = (message) => Object.assign(new Error(message), { status: 400 });

function config() {
  const bureaus = CFG.bureaus.map((b) => {
    const r = nearestRegion(b);
    return { ...b, region: r.id, km: km(b, r) };
  });
  return {
    source: { ...CFG.source, bucket: SOURCE },
    replicas: CFG.replicas.map((r) => ({ ...r, bucket: REPLICAS[r.id], kmFromSource: km(CFG.source, r) })),
    bureaus,
    storageClasses: CLASSES,
    rtcMinutes: Number(env.RTC_MINUTES ?? 15),
    lateRegions: LATE,
    replicaExpiryDays: CFG.replicaExpiryDays ?? null,
  };
}

let query_ = new URLSearchParams();
async function route(method, path, body) {
  if (method === "GET" && path === "/api/config") return { ...config(), rules: summarizeRules(await replicationRules()) };
  if (method === "POST" && path === "/api/setup") return startJob("setup", {});
  if (method === "POST" && path === "/api/matrix") return startJob("matrix", {});
  if (method === "GET" && path === "/api/matrix") return (await latest("matrix")) ?? { rows: [] };
  if (method === "POST" && path === "/api/catalogue") return startJob("catalogue", {});
  if (method === "GET" && path === "/api/catalogue") return catalogue();
  if (method === "GET" && path === "/api/timeline") return timeline();
  if (method === "GET" && path === "/api/lab") return labRuns();
  if (method === "GET" && path === "/api/metrics") return metrics();
  if (method === "GET" && path === "/api/late") return { regions: await lateStatus() };
  if (method === "GET" && path === "/api/batch") return batchJobs();

  if (method === "POST" && path === "/api/assign") {
    const items = (body.items ?? []).map((i) => ({
      clip: String(i.clip ?? ""),
      bureaus: (i.bureaus ?? []).map(String),
      regions: (i.regions ?? []).map(String).filter((r) => REPLICAS[r]),
      rtc: i.rtc !== false,
    }));
    if (!items.length || items.some((i) => !i.clip.startsWith("masters/"))) throw bad("items[].clip must be keys under masters/");
    const rundown = { show: String(body.show ?? "adhoc"), date: new Date().toISOString().slice(0, 10), source: "demo page", items };
    return { rundownKey: await writeRundown(rundown), rundown };
  }
  if (method === "POST" && path === "/api/rundown") {
    const rundown = body.rundown;
    if (!rundown || !Array.isArray(rundown.items)) throw bad("rundown.items must be an array");
    if (JSON.stringify(rundown).length > 64 * 1024) throw bad("rundown too large");
    return { rundownKey: await writeRundown(rundown), rundown };
  }
  if (method === "POST" && path === "/api/lab") {
    const sizeMiB = Number(body.sizeMiB);
    const regions = (body.regions ?? []).filter((r) => REPLICAS[r]);
    if (![10, 100, 1024].includes(sizeMiB)) throw bad("sizeMiB must be 10, 100 or 1024");
    if (!regions.length || regions.length > 9) throw bad("pick 1–9 regions (S3 allows 10 tags per object)");
    return startJob("lab", { sizeMiB, regions, rtc: body.rtc !== false });
  }
  if (method === "POST" && path === "/api/upload") return presignUpload(body);
  if (method === "GET" && path === "/api/upload") return uploadStatus(decodeURIComponent(query_.get("key") ?? ""));
  if (method === "POST" && path === "/api/late") return setLate(String(body.region), Boolean(body.enabled));
  if (method === "POST" && path === "/api/batch") return startBatch(String(body.region ?? LATE[0]));
  if (method === "GET" && path.startsWith("/api/jobs/")) {
    const job = await getJson("job", path.slice("/api/jobs/".length));
    if (!job) throw Object.assign(new Error("unknown job"), { status: 404 });
    return job;
  }
  throw Object.assign(new Error("not found"), { status: 404 });
}

async function runJob({ id, type, params }) {
  await updateJob(id, { status: "running", startedAt: new Date().toISOString() });
  try {
    const result =
      type === "setup" ? await setupProbeObjects(id)
      : type === "matrix" ? await runMatrix(id)
      : type === "catalogue" ? await generateCatalogue(id)
      : type === "lab" ? await runLab(id, params)
      : null;
    await updateJob(id, { status: "done", progress: "done", finishedAt: new Date().toISOString(), result });
  } catch (err) {
    console.error(err);
    await updateJob(id, { status: "error", error: `${err.name}: ${err.message}`, finishedAt: new Date().toISOString() });
  }
}

export const handler = async (event) => {
  if (event.job) return runJob(event.job);
  const method = event.requestContext?.http?.method ?? "GET";
  const path = (event.rawPath ?? "/").replace(/\/+$/, "");
  query_ = new URLSearchParams(event.rawQueryString ?? "");
  try {
    let body = {};
    if (event.body) body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body);
    return json(200, await route(method, path, body));
  } catch (err) {
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    return json(status, { error: err.message });
  }
};
