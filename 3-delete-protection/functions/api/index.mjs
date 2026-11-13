// API for the S3 delete-protection demo. Lambda function URL behind CloudFront (/api/*).
//
// Seven scenario buckets, each with one more (or a different) guard. Attacks run
// for real, as one of two actors the API assumes:
//   admin       s3:* on the demo buckets (misdirected terraform destroy, CI role, admin)
//   breakglass  the same, but named in every guard's exception
// After each attack the bucket is reset with the break-glass role.
//
//   GET  /api/config                         scenarios, roles, policy documents
//   GET  /api/status                         live state of every scenario bucket
//   GET  /api/guards                         probe: is each guard enforced right now?
//   POST /api/setup                          create/repair all scenario buckets (job)
//   POST /api/attack  {scenario,attack,actor,reset}   one attack (job)
//   POST /api/matrix  {actor}                every attack on every scenario (job)
//   GET  /api/results?actor=admin            latest result per scenario x attack
//   POST /api/reset   {scenario}             (job)
//   POST /api/teardown                       delete every scenario bucket (job)
//   GET  /api/events                         S3 "Object Deleted" events (EventBridge)
//   GET  /api/markers                        hidden objects (current version = delete marker) + lifecycle deadline
//   POST /api/delete-object  {scenario,key}  set a delete marker, no reset (job)
//   POST /api/restore-object {scenario,key,method: copy|remove-marker} (job)
//   GET  /api/jobs/:id
//
// EventBridge "Object Deleted" events from the scenario buckets also land here.

import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { ConfigServiceClient, GetComplianceDetailsByConfigRuleCommand, DescribeRemediationExecutionStatusCommand, StartConfigRulesEvaluationCommand } from "@aws-sdk/client-config-service";
import { DynamoDBClient, DeleteItemCommand, GetItemCommand, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteBucketPolicyCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketPolicyCommand,
  GetBucketTaggingCommand,
  GetBucketVersioningCommand,
  GetObjectLockConfigurationCommand,
  GetObjectRetentionCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketNotificationConfigurationCommand,
  PutBucketPolicyCommand,
  PutBucketTaggingCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  PutObjectLockConfigurationCommand,
  PutObjectRetentionCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";

const env = process.env;
const CFG = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
const REGION = CFG.region;
const TABLE = env.TABLE;
const SCENARIOS = CFG.scenarios;
const byId = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
const SEED_KEYS = ["vod/tatort-1187/master.mp4", "vod/tatort-1187/hls/1080p.m3u8", "vod/sportschau-2026-11-07/master.mp4"];

const ddb = new DynamoDBClient({});
const lambda = new LambdaClient({});
const sts = new STSClient({ region: REGION });
const cfgsvc = new ConfigServiceClient({ region: REGION });
const S3OPTS = { region: REGION, maxAttempts: 10, retryMode: "adaptive" };
const reader = new S3Client(S3OPTS); // the API's own role: read-only on the buckets

// ------------------------------------------------------------------ actors
const actorCache = new Map();
async function actor(name) {
  const hit = actorCache.get(name);
  if (hit && hit.exp > Date.now() + 5 * 60_000) return hit.client;
  const arn = CFG.roles[name];
  if (!arn) throw httpError(400, `unknown actor ${name}`);
  const r = await sts.send(new AssumeRoleCommand({ RoleArn: arn, RoleSessionName: `demo-${name}`, DurationSeconds: 3600 }));
  const c = r.Credentials;
  const client = new S3Client({
    ...S3OPTS,
    credentials: { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken },
  });
  actorCache.set(name, { client, exp: c.Expiration.getTime() });
  return client;
}
const bg = () => actor("breakglass");

// ------------------------------------------------------------------ dynamo
const S = (v) => ({ S: String(v) });
const ttl = (days) => ({ N: String(Math.floor(Date.now() / 1000) + days * 86400) });

async function putJson(pk, sk, data, days = 14) {
  await ddb.send(new PutItemCommand({ TableName: TABLE, Item: { pk: S(pk), sk: S(sk), data: S(JSON.stringify(data)), ttl: ttl(days) } }));
}
async function getJson(pk, sk) {
  const r = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: { pk: S(pk), sk: S(sk) } }));
  return r.Item ? JSON.parse(r.Item.data.S) : null;
}
async function queryJson(pk, limit = 500, forward = true) {
  const out = [];
  let ExclusiveStartKey;
  do {
    const r = await ddb.send(
      new QueryCommand({ TableName: TABLE, KeyConditionExpression: "pk = :p", ExpressionAttributeValues: { ":p": S(pk) }, ScanIndexForward: forward, Limit: Math.min(1000, limit - out.length), ExclusiveStartKey }),
    );
    for (const it of r.Items ?? []) out.push(JSON.parse(it.data.S));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey && out.length < limit);
  return out;
}

// ------------------------------------------------------------------ bucket generations
// pk "bucket", sk <scenario id> -> { bucket }. A new generation after every
// successful delete: a just-deleted name stays unusable for minutes.
// first generation is the plain base name (test-48213901), later ones get a suffix
const genName = (s, first) => (first ? s.base : `${s.base}-${String(Date.now()).slice(-7, -1)}`);
const scenarioOf = (name) => SCENARIOS.find((x) => name === x.base || name?.startsWith(`${x.base}-`));
async function hydrate(s) {
  const cur = await getJson("bucket", s.id);
  return { ...s, bucket: cur?.bucket ?? null };
}
async function hydrateAll() {
  const items = await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: "pk = :p", ExpressionAttributeValues: { ":p": S("bucket") } }));
  const map = Object.fromEntries((items.Items ?? []).map((it) => [it.sk.S, JSON.parse(it.data.S).bucket]));
  return SCENARIOS.map((s) => ({ ...s, bucket: map[s.id] ?? null }));
}
async function rotate(s, first = false) {
  const bucket = genName(s, first);
  await putJson("bucket", s.id, { bucket, since: new Date().toISOString() }, 3650);
  return { ...s, bucket };
}

// one job at a time: attacks and resets on shared buckets must not interleave
async function takeLock(jobId) {
  const now = Math.floor(Date.now() / 1000);
  try {
    await ddb.send(
      new PutItemCommand({
        TableName: TABLE,
        Item: { pk: S("lock"), sk: S("global"), job: S(jobId), until: { N: String(now + 900) }, ttl: { N: String(now + 1000) } },
        ConditionExpression: "attribute_not_exists(pk) OR #u < :now",
        ExpressionAttributeNames: { "#u": "until" },
        ExpressionAttributeValues: { ":now": { N: String(now) } },
      }),
    );
    return null;
  } catch (err) {
    if (err.name !== "ConditionalCheckFailedException") throw err;
    const r = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: { pk: S("lock"), sk: S("global") } }));
    return r.Item?.job?.S ?? "unknown";
  }
}
const releaseLock = () => ddb.send(new DeleteItemCommand({ TableName: TABLE, Key: { pk: S("lock"), sk: S("global") } })).catch(() => {});

// ------------------------------------------------------------------ jobs
async function startJob(type, params) {
  const id = `${type}-${Date.now().toString(36)}-${randomUUID().slice(0, 4)}`;
  const busy = await takeLock(id);
  if (busy) throw httpError(409, `Es läuft bereits ein Job (${busy}). Kurz warten.`, { running: busy });
  const job = { id, type, status: "queued", progress: "queued", createdAt: new Date().toISOString(), params };
  await putJson("job", id, job, 3);
  await lambda.send(new InvokeCommand({ FunctionName: env.SELF_FUNCTION, InvocationType: "Event", Payload: JSON.stringify({ job: { id, type, params } }) }));
  return job;
}

async function runJob({ id, type, params }) {
  const job = (await getJson("job", id)) ?? { id, type, params };
  const update = async (patch) => {
    Object.assign(job, patch);
    await putJson("job", id, job, 3);
  };
  await update({ status: "running", progress: "starting", startedAt: new Date().toISOString() });
  try {
    const result = await JOBS[type](params ?? {}, update);
    await update({ status: "done", progress: "done", result, finishedAt: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    await update({ status: "error", error: err.message, finishedAt: new Date().toISOString() });
  } finally {
    await releaseLock();
  }
}

// ------------------------------------------------------------------ helpers
/** Run fn over items with limited concurrency; returns Promise.allSettled-style results in order. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function httpError(status, message, extra) {
  return Object.assign(new Error(message), { status, extra });
}
const errCode = (e) => e?.Code ?? e?.name ?? "Error";
const errMsg = (e) => e?.Message ?? e?.message ?? String(e);

/** Which layer refused the request, read from the AccessDenied message. */
function deniedBy(code, message = "") {
  const m = message.toLowerCase();
  if (m.includes("service control policy")) return "SCP";
  if (m.includes("resource control policy")) return "RCP";
  if (m.includes("resource-based policy")) return "Bucket Policy";
  if (m.includes("identity-based policy")) return "IAM";
  if (m.includes("object lock") || m.includes("worm")) return "Object Lock";
  if (code === "InvalidBucketState") return "Object Lock";
  if (code === "InvalidArgument") return null;
  if (code === "BucketNotEmpty") return "Versionen vorhanden";
  if (code === "AccessDenied") return "Access Denied";
  return null;
}

/** Runs one S3 call and appends a log line; never throws for S3 errors. */
async function step(log, label, fn) {
  const t0 = Date.now();
  try {
    const out = await fn();
    log.push({ call: label, ok: true, ms: Date.now() - t0 });
    return { ok: true, out };
  } catch (e) {
    const code = errCode(e);
    const message = errMsg(e);
    log.push({ call: label, ok: false, code, message, by: deniedBy(code, message), ms: Date.now() - t0 });
    return { ok: false, code, message };
  }
}

async function listAllVersions(client, bucket, prefix) {
  const versions = [];
  const markers = [];
  let KeyMarker;
  let VersionIdMarker;
  do {
    const r = await client.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix, KeyMarker, VersionIdMarker }));
    versions.push(...(r.Versions ?? []));
    markers.push(...(r.DeleteMarkers ?? []));
    KeyMarker = r.NextKeyMarker;
    VersionIdMarker = r.NextVersionIdMarker;
    if (!r.IsTruncated) break;
  } while (true);
  return { versions, markers };
}

async function bucketExists(client, bucket) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch (e) {
    if (e.$metadata?.httpStatusCode === 404 || e.name === "NotFound" || e.name === "NoSuchBucket") return false;
    throw e;
  }
}

/** Bucket create/delete is eventually consistent: wait until HeadBucket agrees. */
async function waitBucket(client, bucket, exists, seconds = 90) {
  for (let i = 0; i < seconds / 3; i++) {
    if ((await bucketExists(client, bucket)) === exists) return true;
    await sleep(3000);
  }
  return false;
}
/** Retry a call that may see NoSuchBucket right after CreateBucket. */
async function retryNoSuchBucket(fn) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e.name !== "NoSuchBucket" || i >= 10) throw e;
      await sleep(2000);
    }
  }
}

const lifecycleStandard = () => ({
  Rules: [
    {
      ID: `noncurrent-${CFG.noncurrentDays}d`,
      Status: "Enabled",
      Filter: { Prefix: "" },
      NoncurrentVersionExpiration: { NoncurrentDays: CFG.noncurrentDays },
      Expiration: { ExpiredObjectDeleteMarker: true },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
    },
  ],
});

// ------------------------------------------------------------------ reset (break-glass)
/** Create or repair a scenario bucket: config, guards, seed objects, no delete markers. */
async function ensureScenario(s0, note = () => {}) {
  let s = await hydrate(s0);
  if (!s.bucket) s = await rotate(s0, true);
  for (let attempt = 0; ; attempt++) {
    try {
      await ensureOnce(s, note);
      return s;
    } catch (e) {
      if (e.name !== "NoSuchBucket" || attempt >= 2) throw e;
      // stale name (deleted moments ago): move on to a fresh generation
      note(`${s.id}: Name noch blockiert, neue Generation`);
      s = await rotate(s0);
    }
  }
}

async function ensureOnce(s, note) {
  const bgc = await bg();
  // every call on a just-created bucket may briefly answer NoSuchBucket
  const c = {
    send: (cmd) =>
      retryNoSuchBucket(() => bgc.send(cmd)).catch((e) => {
        e.message = `${s.id} ${cmd.constructor.name}: ${e.message}`;
        throw e;
      }),
  };
  const B = s.bucket;
  // CreateBucket is the authoritative existence check: HeadBucket can still say
  // "exists" for a while after DeleteBucket. BucketAlreadyOwnedByYou = it exists.
  let created = false;
  for (let i = 0; ; i++) {
    try {
      await bgc.send(
        new CreateBucketCommand({
          Bucket: B,
          CreateBucketConfiguration: { LocationConstraint: REGION },
          ObjectLockEnabledForBucket: s.lock ? true : undefined,
        }),
      );
      created = true;
      break;
    } catch (e) {
      if (e.name === "BucketAlreadyOwnedByYou") break;
      // a just-deleted name is briefly unavailable (OperationAborted / 409)
      if (i >= 24 || (!["OperationAborted", "Conflict", "SlowDown"].includes(e.name) && e.$metadata?.httpStatusCode !== 409)) throw e;
      await sleep(5000);
    }
  }
  if (created) {
    note(`${s.id}: Bucket neu angelegt`);
    await waitBucket(bgc, B, true);
    await c.send(new PutBucketNotificationConfigurationCommand({ Bucket: B, NotificationConfiguration: { EventBridgeConfiguration: {} } }));
  }
  await c.send(new PutBucketVersioningCommand({ Bucket: B, VersioningConfiguration: { Status: "Enabled" } }));
  await c.send(new PutBucketLifecycleConfigurationCommand({ Bucket: B, LifecycleConfiguration: lifecycleStandard() }));
  if (s.lock) {
    await c.send(
      new PutObjectLockConfigurationCommand({
        Bucket: B,
        ObjectLockConfiguration: { ObjectLockEnabled: "Enabled", Rule: { DefaultRetention: { Mode: s.lock.mode, Days: s.lock.days } } },
      }),
    );
  }
  if (s.bucketPolicy) await c.send(new PutBucketPolicyCommand({ Bucket: B, Policy: JSON.stringify(CFG.policies.bucketPolicy).replaceAll("__BUCKET__", B) }));
  else await c.send(new DeleteBucketPolicyCommand({ Bucket: B })).catch(() => {});
  const tags = [
    { Key: "Project", Value: "protect-demo" },
    { Key: "Scenario", Value: s.id },
  ];
  if (s.config) tags.push({ Key: "ConfigRemediation", Value: "versioning" });
  await c.send(new PutBucketTaggingCommand({ Bucket: B, Tagging: { TagSet: tags } }));

  // remove delete markers (restores the objects), re-upload what is missing
  const { versions, markers } = await listAllVersions(c, B);
  if (markers.length) {
    for (let i = 0; i < markers.length; i += 1000) {
      await c.send(
        new DeleteObjectsCommand({ Bucket: B, Delete: { Objects: markers.slice(i, i + 1000).map((m) => ({ Key: m.Key, VersionId: m.VersionId })), Quiet: true } }),
      );
    }
  }
  let have = new Set(versions.filter((v) => v.IsLatest).map((v) => v.Key));
  for (let round = 0; round < 6; round++) {
    const missing = SEED_KEYS.filter((k) => !have.has(k));
    if (!missing.length) break;
    if (round) await sleep(3000);
    for (const key of missing) {
      await c.send(new PutObjectCommand({ Bucket: B, Key: key, Body: randomBytes(key.endsWith(".mp4") ? 32 * 1024 : 2048), ContentType: key.endsWith(".mp4") ? "video/mp4" : "application/vnd.apple.mpegurl" }));
    }
    // verify: a re-created bucket can briefly list empty
    have = new Set((await listAllVersions(c, B)).versions.filter((v) => v.IsLatest).map((v) => v.Key));
  }
  // rolling retention: push the lock on every current version forward again
  if (s.lock) {
    const until = new Date(Date.now() + s.lock.days * 86400_000);
    const { versions: now } = await listAllVersions(c, B);
    for (const v of now.filter((v) => v.IsLatest)) {
      await c
        .send(new PutObjectRetentionCommand({ Bucket: B, Key: v.Key, VersionId: v.VersionId, Retention: { Mode: s.lock.mode, RetainUntilDate: until } }))
        .catch(() => {}); // COMPLIANCE can only be extended; an earlier call may already be later
    }
  }
}

// ------------------------------------------------------------------ attacks
const ATTACKS = {
  "rb-force": {
    cmd: (B) => `aws s3 rb s3://${B} --force`,
    async run(c, s, log) {
      const B = s.bucket;
      const list = await step(log, "ListObjectsV2", () => c.send(new ListObjectsV2Command({ Bucket: B })));
      const keys = (list.out?.Contents ?? []).map((o) => ({ Key: o.Key }));
      let markers = 0;
      if (keys.length) {
        const del = await step(log, `DeleteObjects (${keys.length} Keys, ohne VersionId)`, () => c.send(new DeleteObjectsCommand({ Bucket: B, Delete: { Objects: keys } })));
        markers = (del.out?.Deleted ?? []).filter((d) => d.DeleteMarker).length;
        const errs = del.out?.Errors ?? [];
        if (del.ok) log[log.length - 1].note = `${markers} Delete-Marker gesetzt${errs.length ? `, ${errs.length} Fehler (${errs[0].Code})` : ""}`;
      }
      const rb = await step(log, "DeleteBucket", () => c.send(new DeleteBucketCommand({ Bucket: B })));
      if (rb.ok) return { outcome: "destroyed", summary: "Bucket gelöscht.", bucketGone: true };
      if (markers) return { outcome: "outage", summary: `Bucket bleibt (${rb.code}), aber ${markers} Delete-Marker: Objekte für die App weg. Lifecycle löscht die nun nicht-aktuellen Versionen nach ${CFG.noncurrentDays} Tagen endgültig.` };
      return { outcome: "blocked", summary: `Nichts gelöscht (${rb.code}).` };
    },
  },
  "tf-destroy": {
    cmd: (B) => `terraform destroy   # aws_s3_bucket "${B}" mit force_destroy = true, prevent_destroy entfernt`,
    async run(c, s, log) {
      const B = s.bucket;
      log.push({
        call: s.lock
          ? "terraform: force_destroy leert den Bucket inkl. aller Versionen, bei Object Lock mit x-amz-bypass-governance-retention"
          : "terraform: force_destroy leert den Bucket inkl. aller Versionen",
        ok: true,
        info: true,
      });
      const listed = await step(log, "ListObjectVersions", () => listAllVersions(c, B));
      const all = [...(listed.out?.versions ?? []), ...(listed.out?.markers ?? [])].map((v) => ({ Key: v.Key, VersionId: v.VersionId }));
      let deleted = 0;
      if (all.length) {
        // the header is only valid on Object Lock buckets (InvalidArgument otherwise)
        const del = await step(log, `DeleteObjects (${all.length} Versionen${s.lock ? ", BypassGovernanceRetention" : ""})`, () =>
          c.send(new DeleteObjectsCommand({ Bucket: B, BypassGovernanceRetention: s.lock ? true : undefined, Delete: { Objects: all } })),
        );
        deleted = (del.out?.Deleted ?? []).filter((d) => !d.DeleteMarker).length;
        const errs = del.out?.Errors ?? [];
        if (del.ok) {
          const last = log[log.length - 1];
          last.note = `${deleted} Versionen endgültig gelöscht, ${errs.length} verweigert`;
          if (errs.length) {
            last.ok = deleted > 0;
            last.code = errs[0].Code;
            last.message = errs[0].Message;
            last.by = deniedBy(errs[0].Code, errs[0].Message);
          }
        }
      }
      const rb = await step(log, "DeleteBucket", () => c.send(new DeleteBucketCommand({ Bucket: B })));
      if (rb.ok) return { outcome: "destroyed", summary: "Alle Versionen und der Bucket sind weg. Unwiderruflich.", bucketGone: true };
      if (deleted) return { outcome: "destroyed", summary: `${deleted} Versionen endgültig gelöscht; Bucket bleibt (${rb.code}).` };
      return { outcome: "blocked", summary: "Keine Version gelöscht, Bucket bleibt." };
    },
  },
  "delete-version": {
    cmd: (B) => `aws s3api delete-object --bucket ${B} --key ${SEED_KEYS[0]} --version-id <id>`,
    async run(c, s, log) {
      const B = s.bucket;
      const v = await step(log, "ListObjectVersions", () => c.send(new ListObjectVersionsCommand({ Bucket: B, Prefix: SEED_KEYS[0] })));
      const ver = (v.out?.Versions ?? []).find((x) => x.Key === SEED_KEYS[0] && x.IsLatest);
      if (!ver) return { outcome: "error", summary: "Seed-Objekt fehlt." };
      const d = await step(log, `DeleteObject VersionId=${ver.VersionId.slice(0, 8)}…`, () => c.send(new DeleteObjectCommand({ Bucket: B, Key: SEED_KEYS[0], VersionId: ver.VersionId })));
      return d.ok ? { outcome: "destroyed", summary: "Version endgültig gelöscht." } : { outcome: "blocked", summary: `Verweigert (${d.code}).` };
    },
  },
  "suspend-versioning": {
    cmd: (B) => `aws s3api put-bucket-versioning --bucket ${B} --versioning-configuration Status=Suspended`,
    async run(c, s, log) {
      const r = await step(log, "PutBucketVersioning Suspended", () => c.send(new PutBucketVersioningCommand({ Bucket: s.bucket, VersioningConfiguration: { Status: "Suspended" } })));
      return r.ok
        ? { outcome: "weakened", summary: "Versioning ausgesetzt: ab jetzt überschreibt/löscht jedes DELETE/PUT endgültig (Version null)." }
        : { outcome: "blocked", summary: `Verweigert (${r.code}).` };
    },
  },
  "lifecycle-expire": {
    cmd: (B) => `aws s3api put-bucket-lifecycle-configuration --bucket ${B}   # Expiration 1 Tag, NoncurrentVersionExpiration 1 Tag`,
    async run(c, s, log) {
      const r = await step(log, "PutBucketLifecycleConfiguration (alles nach 1 Tag)", () =>
        c.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: s.bucket,
            LifecycleConfiguration: { Rules: [{ ID: "expire-everything", Status: "Enabled", Filter: { Prefix: "" }, Expiration: { Days: 1 }, NoncurrentVersionExpiration: { NoncurrentDays: 1 } }] },
          }),
        ),
      );
      if (!r.ok) return { outcome: "blocked", summary: `Verweigert (${r.code}).` };
      return s.lock
        ? { outcome: "weakened", summary: "Regel akzeptiert. Lifecycle respektiert Object Lock: gesperrte Versionen bleiben bis retain-until, danach greift die Regel." }
        : { outcome: "weakened", summary: "Regel akzeptiert: S3 selbst löscht in ~1–2 Tagen alles. Kein Principal-Call, also greift dann keine SCP/RCP mehr." };
    },
  },
  "delete-policy": {
    cmd: (B) => `aws s3api delete-bucket-policy --bucket ${B}`,
    async run(c, s, log) {
      const r = await step(log, "DeleteBucketPolicy", () => c.send(new DeleteBucketPolicyCommand({ Bucket: s.bucket })));
      if (!r.ok) return { outcome: "blocked", summary: `Verweigert (${r.code}).` };
      return s.bucketPolicy
        ? { outcome: "weakened", summary: "Bucket Policy entfernt: der Riegel ist weg, der nächste Befehl löscht frei." }
        : { outcome: "noop", summary: "Erlaubt, aber hier gab es keine Bucket Policy." };
    },
  },
  "bypass-governance": {
    cmd: (B) => `aws s3api delete-object --bucket ${B} --key ${SEED_KEYS[0]} --version-id <id> --bypass-governance-retention`,
    async run(c, s, log) {
      if (!s.lock) return { outcome: "na", summary: "Kein Object Lock in diesem Szenario." };
      const B = s.bucket;
      const v = await step(log, "ListObjectVersions", () => c.send(new ListObjectVersionsCommand({ Bucket: B, Prefix: SEED_KEYS[0] })));
      const ver = (v.out?.Versions ?? []).find((x) => x.Key === SEED_KEYS[0] && x.IsLatest);
      if (!ver) return { outcome: "error", summary: "Seed-Objekt fehlt." };
      const d = await step(log, `DeleteObject VersionId=${ver.VersionId.slice(0, 8)}… BypassGovernanceRetention`, () =>
        c.send(new DeleteObjectCommand({ Bucket: B, Key: SEED_KEYS[0], VersionId: ver.VersionId, BypassGovernanceRetention: true })),
      );
      return d.ok ? { outcome: "destroyed", summary: "Governance umgangen, Version endgültig gelöscht." } : { outcome: "blocked", summary: `Verweigert (${d.code}).` };
    },
  },
  restore: {
    cmd: (B) => `aws s3api delete-object --bucket ${B} --key ${SEED_KEYS[2]} --version-id <delete-marker-id>`,
    async run(c, s, log) {
      const B = s.bucket;
      const key = SEED_KEYS[2];
      const m = await step(log, `DeleteObject ${key} (setzt Delete-Marker)`, () => c.send(new DeleteObjectCommand({ Bucket: B, Key: key })));
      if (!m.ok || !m.out?.VersionId) return { outcome: "error", summary: `Konnte keinen Delete-Marker setzen (${m.code ?? "?"}).` };
      const r = await step(log, `DeleteObject VersionId=${m.out.VersionId.slice(0, 8)}… (Delete-Marker entfernen)`, () =>
        c.send(new DeleteObjectCommand({ Bucket: B, Key: key, VersionId: m.out.VersionId })),
      );
      return r.ok
        ? { outcome: "restorable", summary: "Delete-Marker entfernt, Objekt wieder da." }
        : { outcome: "needs-breakglass", summary: `Wiederherstellen braucht s3:DeleteObjectVersion: verweigert (${r.by ?? r.code}). Nur Break-Glass kann zurückholen.` };
    },
  },
  "restore-copy": {
    cmd: (B) => `aws s3api copy-object --bucket ${B} --key ${SEED_KEYS[2]} --copy-source "${B}/${SEED_KEYS[2]}?versionId=<vorversion>"`,
    async run(c, s, log) {
      const B = s.bucket;
      const key = SEED_KEYS[2];
      const m = await step(log, `DeleteObject ${key} (setzt Delete-Marker)`, () => c.send(new DeleteObjectCommand({ Bucket: B, Key: key })));
      if (!m.ok || !m.out?.VersionId) return { outcome: "error", summary: `Konnte keinen Delete-Marker setzen (${m.code ?? "?"}).` };
      const r = await step(log, "Vorversion kopieren (CopyObject, wird neue aktuelle Version)", () => restoreByCopy(c, B, key));
      return r.ok
        ? { outcome: "restorable", summary: "Vorversion als neue aktuelle Version kopiert: Objekt wieder da, ohne s3:DeleteObjectVersion. Der Marker bleibt als nicht-aktuelle Version und läuft per Lifecycle ab." }
        : { outcome: "needs-breakglass", summary: `Kopieren verweigert (${r.by ?? r.code}).` };
    },
  },
};

/** Restore a key hidden by a delete marker: copy the newest real version onto itself. */
async function restoreByCopy(c, bucket, key) {
  const r = await c.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key }));
  const prev = (r.Versions ?? []).filter((v) => v.Key === key).sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified))[0];
  if (!prev) throw Object.assign(new Error("keine Vorversion vorhanden"), { name: "NoVersion" });
  // CopyObject handles up to 5 GB; larger masters need UploadPartCopy (multipart copy)
  return c.send(new CopyObjectCommand({ Bucket: bucket, Key: key, CopySource: `${bucket}/${encodeURIComponent(key)}?versionId=${encodeURIComponent(prev.VersionId)}` }));
}

/** Lifecycle NoncurrentVersionExpiration: successor time + N days, rounded up to the next 00:00 UTC. */
function expiryFor(markerTime, days) {
  const t = new Date(new Date(markerTime).getTime() + days * 86400_000);
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  if (d.getTime() < t.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** Every key whose current version is a delete marker, with the lifecycle deadline. */
async function markers() {
  const cur = await hydrateAll();
  const out = [];
  await Promise.all(
    cur.filter((s) => s.bucket).map(async (s) => {
      let v;
      try {
        v = await listAllVersions(reader, s.bucket);
      } catch {
        return;
      }
      for (const m of v.markers.filter((x) => x.IsLatest)) {
        const prev = v.versions.filter((x) => x.Key === m.Key).sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified))[0];
        out.push({
          scenario: s.id,
          bucket: s.bucket,
          key: m.Key,
          markerVersionId: m.VersionId,
          deletedAt: m.LastModified,
          previousVersionId: prev?.VersionId ?? null,
          previousSize: prev?.Size ?? null,
          expiresAt: prev ? expiryFor(m.LastModified, CFG.noncurrentDays) : null,
          locked: !!s.lock,
        });
      }
    }),
  );
  return out.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
}
const ATTACK_IDS = Object.keys(ATTACKS);

async function runAttack({ scenario, attack, actor: who = "admin", reset = true }, note = () => {}) {
  const a = ATTACKS[attack];
  if (!byId[scenario]) throw httpError(400, `unknown scenario ${scenario}`);
  const s = await hydrate(byId[scenario]);
  if (!s.bucket) throw httpError(409, `${scenario}: noch nicht angelegt (Szenarien vorbereiten)`);
  if (!a) throw httpError(400, `unknown attack ${attack}`);
  if (!CFG.roles[who]) throw httpError(400, `unknown actor ${who}`);
  const c = await actor(who);
  const log = [{ call: `$ ${a.cmd(s.bucket)}`, ok: true, info: true, cmd: true }];
  const t0 = Date.now();
  let res;
  try {
    res = await a.run(c, s, log);
  } catch (e) {
    res = { outcome: "error", summary: errMsg(e) };
  }
  const { bucketGone, ...shown } = res;
  if (bucketGone) await rotate(byId[scenario]);
  const result = { scenario, attack, actor: who, bucket: s.bucket, ...shown, log, at: new Date().toISOString(), ms: Date.now() - t0 };
  await putJson(`result#${who}`, `${scenario}#${attack}`, result, 30);
  if (reset && res.outcome !== "na") {
    note(`${scenario}: zurücksetzen`);
    await ensureScenario(byId[scenario]);
  }
  return result;
}

// ------------------------------------------------------------------ status
async function scenarioStatus(s) {
  const B = s.bucket;
  const out = { id: s.id, bucket: B, exists: false };
  if (!B) return out;
  try {
    out.exists = await bucketExists(reader, B);
  } catch (e) {
    out.error = errMsg(e);
    return out;
  }
  if (!out.exists) return out;
  const safe = (p) => p.catch((e) => ({ __err: errCode(e) }));
  const [ver, lock, lc, pol, tags, vers] = await Promise.all([
    safe(reader.send(new GetBucketVersioningCommand({ Bucket: B }))),
    safe(reader.send(new GetObjectLockConfigurationCommand({ Bucket: B }))),
    safe(reader.send(new GetBucketLifecycleConfigurationCommand({ Bucket: B }))),
    safe(reader.send(new GetBucketPolicyCommand({ Bucket: B }))),
    safe(reader.send(new GetBucketTaggingCommand({ Bucket: B }))),
    safe(listAllVersions(reader, B)),
  ]);
  out.versioning = ver.__err ? null : (ver.Status ?? "Off");
  const rule = lock.ObjectLockConfiguration?.Rule?.DefaultRetention;
  out.objectLock = lock.__err ? null : { enabled: lock.ObjectLockConfiguration?.ObjectLockEnabled === "Enabled", mode: rule?.Mode ?? null, days: rule?.Days ?? null };
  out.lifecycle = lc.__err ? [] : (lc.Rules ?? []).map((r) => ({ id: r.ID, status: r.Status, expirationDays: r.Expiration?.Days ?? null, noncurrentDays: r.NoncurrentVersionExpiration?.NoncurrentDays ?? null }));
  out.bucketPolicy = !pol.__err;
  out.tags = tags.__err ? {} : Object.fromEntries((tags.TagSet ?? []).map((t) => [t.Key, t.Value]));
  if (!vers.__err) {
    out.current = vers.versions.filter((v) => v.IsLatest).length;
    out.noncurrent = vers.versions.filter((v) => !v.IsLatest).length;
    out.deleteMarkers = vers.markers.length;
    out.hidden = vers.markers.filter((m) => m.IsLatest).length;
    if (s.lock) {
      const latest = vers.versions.find((v) => v.IsLatest);
      if (latest) {
        const r = await safe(reader.send(new GetObjectRetentionCommand({ Bucket: B, Key: latest.Key, VersionId: latest.VersionId })));
        out.retainUntil = r.Retention?.RetainUntilDate ?? null;
      }
    }
  }
  return out;
}

async function configStatus(cur) {
  if (!CFG.configRule) return null;
  const base = cur.find((s) => s.config);
  const out = { rule: CFG.configRule, bucket: base?.bucket, compliance: null, remediation: null };
  try {
    const r = await cfgsvc.send(new GetComplianceDetailsByConfigRuleCommand({ ConfigRuleName: CFG.configRule, Limit: 20 }));
    const hit = (r.EvaluationResults ?? []).find((e) => e.EvaluationResultIdentifier?.EvaluationResultQualifier?.ResourceId === base?.bucket);
    if (hit) out.compliance = { value: hit.ComplianceType, at: hit.ResultRecordedTime };
  } catch (e) {
    out.error = errMsg(e);
  }
  try {
    const r = await cfgsvc.send(new DescribeRemediationExecutionStatusCommand({ ConfigRuleName: CFG.configRule, ResourceKeys: [{ resourceType: "AWS::S3::Bucket", resourceId: base.bucket }] }));
    const x = r.RemediationExecutionStatuses?.[0];
    if (x) out.remediation = { state: x.State, at: x.LastUpdatedTime, steps: (x.StepDetails ?? []).map((s) => ({ name: s.Name, state: s.State, error: s.ErrorMessage ?? null })) };
  } catch (e) {
    out.remediationError = errMsg(e);
  }
  return out;
}

/** Probe every guard with a harmless call: PutBucketVersioning Enabled on an already versioned bucket. */
async function guards() {
  const c = await actor("admin");
  const cur = await hydrateAll();
  return Promise.all(
    cur.filter((s) => (s.org || s.bucketPolicy) && s.bucket).map(async (s) => {
      const log = [];
      const r = await step(log, "PutBucketVersioning Enabled (no-op)", () => c.send(new PutBucketVersioningCommand({ Bucket: s.bucket, VersioningConfiguration: { Status: "Enabled" } })));
      const expected = s.org ? (s.org.startsWith("rcp") ? "RCP" : "SCP") : "Bucket Policy";
      return { id: s.id, expected, enforced: !r.ok && r.code === "AccessDenied", by: r.ok ? null : deniedBy(r.code, r.message), code: r.code ?? null, message: r.message ?? null };
    }),
  );
}

// ------------------------------------------------------------------ job types
const JOBS = {
  async setup(_p, update) {
    let i = 0;
    for (const s of SCENARIOS) {
      await update({ progress: `${s.id} vorbereiten`, current: i++, total: SCENARIOS.length });
      await ensureScenario(s);
    }
    return { scenarios: SCENARIOS.length };
  },
  async reset({ scenario }, update) {
    const s = byId[scenario];
    if (!s) throw new Error(`unknown scenario ${scenario}`);
    await update({ progress: `${scenario} zurücksetzen` });
    await ensureScenario(s);
    return { scenario };
  },
  async attack(p, update) {
    await update({ progress: `${p.attack} auf ${p.scenario} als ${p.actor ?? "admin"}` });
    return runAttack(p, (msg) => void update({ progress: msg }));
  },
  async matrix({ actor: who = "admin" }, update) {
    const total = SCENARIOS.length * ATTACK_IDS.length;
    let done = 0;
    const tick = () => update({ progress: `${done}/${total} Angriffe als ${who}`, current: done, total });
    await tick();
    // scenarios in parallel, attacks within a scenario one after another
    // allSettled: one failing scenario must not release the lock while others still run
    const settled = await pool(SCENARIOS, 4, async (s) => {
        await ensureScenario(s);
        for (const attack of ATTACK_IDS) {
          await runAttack({ scenario: s.id, attack, actor: who, reset: true });
          done++;
          await tick();
        }
    });
    const failed = settled.map((r, i) => (r.status === "rejected" ? `${SCENARIOS[i].id}: ${r.reason?.message ?? r.reason}` : null)).filter(Boolean);
    if (failed.length) throw new Error(failed.join("; "));
    return { actor: who, total };
  },
  async "delete-object"({ scenario, key, actor: who = "admin" }) {
    const s = await hydrate(byId[scenario]);
    const c = await actor(who);
    const log = [];
    const r = await step(log, `DeleteObject ${key}`, () => c.send(new DeleteObjectCommand({ Bucket: s.bucket, Key: key })));
    return { ok: r.ok, log };
  },
  async "restore-object"({ scenario, key, method = "copy", actor: who = "admin" }) {
    const s = await hydrate(byId[scenario]);
    const c = await actor(who);
    const log = [];
    let r;
    if (method === "copy") r = await step(log, `CopyObject ${key} aus Vorversion`, () => restoreByCopy(c, s.bucket, key));
    else {
      const v = await c.send(new ListObjectVersionsCommand({ Bucket: s.bucket, Prefix: key }));
      const m = (v.DeleteMarkers ?? []).find((x) => x.Key === key && x.IsLatest);
      if (!m) return { ok: false, log: [{ call: "kein aktueller Delete-Marker", ok: false }] };
      r = await step(log, `DeleteObject ${key} VersionId=${m.VersionId.slice(0, 8)}… (Marker entfernen)`, () => c.send(new DeleteObjectCommand({ Bucket: s.bucket, Key: key, VersionId: m.VersionId })));
    }
    return { ok: r.ok, log };
  },
  async teardown(_p, update) {
    const c = await bg();
    const { ListBucketsCommand } = await import("@aws-sdk/client-s3");
    const all = (await c.send(new ListBucketsCommand({ Prefix: CFG.prefix }))).Buckets ?? [];
    const left = [];
    for (const b of all) {
      const name = b.Name;
      const s = scenarioOf(name);
      await update({ progress: `${name} löschen` });
      try {
        const { versions, markers } = await listAllVersions(c, name);
        const objs = [...versions, ...markers].map((v) => ({ Key: v.Key, VersionId: v.VersionId }));
        for (let i = 0; i < objs.length; i += 1000) {
          await c.send(new DeleteObjectsCommand({ Bucket: name, BypassGovernanceRetention: s?.lock ? true : undefined, Delete: { Objects: objs.slice(i, i + 1000), Quiet: true } }));
        }
        await c.send(new DeleteBucketCommand({ Bucket: name }));
      } catch (e) {
        left.push({ bucket: name, reason: `${errCode(e)}: ${errMsg(e)}` });
      }
    }
    for (const s of SCENARIOS) {
      if (!left.some((l) => scenarioOf(l.bucket)?.id === s.id)) await ddb.send(new DeleteItemCommand({ TableName: TABLE, Key: { pk: S("bucket"), sk: S(s.id) } }));
    }
    return { deleted: all.length - left.length, left };
  },
};

// ------------------------------------------------------------------ events
async function onS3Event(ev) {
  const d = ev.detail ?? {};
  const rec = {
    time: ev.time,
    bucket: d.bucket?.name,
    scenario: scenarioOf(d.bucket?.name)?.id ?? null,
    key: d.object?.key,
    versionId: d.object?.["version-id"] ?? null,
    deletionType: d["deletion-type"] ?? null,
    reason: d.reason ?? null,
    requester: d.requester ?? null,
  };
  await putJson("event", `${ev.time}#${ev.id}`, rec, 2);
}

// ------------------------------------------------------------------ http
let query_ = new URLSearchParams();
async function route(method, path, body) {
  if (method === "GET" && path === "/api/config")
    return {
      region: CFG.region,
      account: CFG.account,
      prefix: CFG.prefix,
      noncurrentDays: CFG.noncurrentDays,
      seedKeys: SEED_KEYS,
      scenarios: SCENARIOS,
      attacks: ATTACK_IDS.map((id) => ({ id, cmd: ATTACKS[id].cmd("<bucket>") })),
      roles: CFG.roles,
      configRule: CFG.configRule,
      policies: CFG.policies,
    };
  if (method === "GET" && path === "/api/status") {
    const cur = await hydrateAll();
    const [scenarios, config] = await Promise.all([Promise.all(cur.map(scenarioStatus)), configStatus(cur)]);
    return { at: new Date().toISOString(), scenarios, config };
  }
  if (method === "GET" && path === "/api/guards") return { at: new Date().toISOString(), guards: await guards() };
  if (method === "GET" && path === "/api/results") {
    const who = query_.get("actor") ?? "admin";
    return { actor: who, results: await queryJson(`result#${who}`) };
  }
  if (method === "GET" && path === "/api/events") {
    const events = await queryJson("event", 100, false);
    return { events };
  }
  if (method === "POST" && path === "/api/setup") return startJob("setup", {});
  if (method === "POST" && path === "/api/reset") return startJob("reset", { scenario: body.scenario });
  if (method === "POST" && path === "/api/attack") {
    if (!byId[body.scenario] || !ATTACKS[body.attack]) throw httpError(400, "scenario/attack unbekannt");
    return startJob("attack", { scenario: body.scenario, attack: body.attack, actor: body.actor === "breakglass" ? "breakglass" : "admin", reset: body.reset !== false });
  }
  if (method === "POST" && path === "/api/matrix") return startJob("matrix", { actor: body.actor === "breakglass" ? "breakglass" : "admin" });
  if (method === "POST" && path === "/api/config-eval") {
    if (!CFG.configRule) throw httpError(400, "AWS Config ist nicht aktiviert");
    await cfgsvc.send(new StartConfigRulesEvaluationCommand({ ConfigRuleNames: [CFG.configRule] }));
    return { started: true };
  }
  if (method === "POST" && path === "/api/teardown") return startJob("teardown", {});
  if (method === "GET" && path === "/api/markers") return { at: new Date().toISOString(), noncurrentDays: CFG.noncurrentDays, markers: await markers() };
  if (method === "POST" && path === "/api/delete-object") {
    if (!byId[body.scenario] || !SEED_KEYS.includes(body.key)) throw httpError(400, "scenario/key unbekannt");
    return startJob("delete-object", { scenario: body.scenario, key: body.key, actor: body.actor === "breakglass" ? "breakglass" : "admin" });
  }
  if (method === "POST" && path === "/api/restore-object") {
    if (!byId[body.scenario] || !SEED_KEYS.includes(body.key)) throw httpError(400, "scenario/key unbekannt");
    return startJob("restore-object", { scenario: body.scenario, key: body.key, method: body.method === "remove-marker" ? "remove-marker" : "copy", actor: body.actor === "breakglass" ? "breakglass" : "admin" });
  }
  const m = path.match(/^\/api\/jobs\/([\w-]+)$/);
  if (method === "GET" && m) {
    const job = await getJson("job", m[1]);
    if (!job) throw httpError(404, "job not found");
    return job;
  }
  throw httpError(404, `no route ${method} ${path}`);
}

const json = (statusCode, body) => ({ statusCode, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) });

export const handler = async (event) => {
  if (event.job) return runJob(event.job);
  if (event.source === "aws.s3") return onS3Event(event);
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
    return json(status, { error: err.message, ...(err.extra ?? {}) });
  }
};
