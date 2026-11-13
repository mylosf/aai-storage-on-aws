import { readFileSync } from "node:fs";
// Ingest: three kinds of input, one timeline in DynamoDB.
//
// 1. "Object Created" in a replica bucket (forwarded from every region to the
//    central bus)  -> arrival record. Replication keeps the version id, so the
//    API joins arrivals to assignments / lab runs by version id.
// 2. "Object Created" for rundowns/*.json in the source bucket -> the
//    assignment trigger: map bureaus to regions, add dest-<region>=1 tags to
//    the listed masters and copy each object onto itself. The copy is a new
//    version, which is what replication rules evaluate: a tag change alone
//    never starts replication for an object that did not match before.
// 3. S3 replication notifications (missed 15-min threshold, failed, …).

import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const ddb = new DynamoDBClient({});
const s3 = new S3Client({});
const TABLE = process.env.TABLE;
const SOURCE = process.env.SOURCE_BUCKET;
const CFG = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
const TTL_DAYS = 14;

const ttl = () => Math.floor(Date.now() / 1000) + TTL_DAYS * 86400;
const S = (v) => ({ S: String(v) });
const N = (v) => ({ N: String(v) });

async function put(pk, sk, fields) {
  const item = { pk: S(pk), sk: S(sk), ttl: N(ttl()) };
  for (const [k, v] of Object.entries(fields)) {
    if (v == null) continue;
    item[k] = typeof v === "number" ? N(v) : Array.isArray(v) ? { SS: v.length ? v.map(String) : ["-"] } : S(v);
  }
  await ddb.send(new PutItemCommand({ TableName: TABLE, Item: item }));
}

// ---------------------------------------------------------------- geography
const rad = (d) => (d * Math.PI) / 180;
const km = (a, b) => {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

/** A bureau is served by the replica region nearest to it unless the rundown names regions. */
export function regionForBureau(bureauId, mapping = {}) {
  if (mapping[bureauId]) return mapping[bureauId];
  const b = CFG.bureaus.find((x) => x.id === bureauId);
  if (!b) return null;
  return CFG.replicas.reduce((best, r) => (km(b, r) < km(b, best) ? r : best), CFG.replicas[0]).id;
}

// ---------------------------------------------------------------- rundowns
async function applyRundown(key) {
  const obj = await s3.send(new GetObjectCommand({ Bucket: SOURCE, Key: key }));
  const rundown = JSON.parse(await obj.Body.transformToString());
  const mapping = rundown.bureauRegions ?? {};
  const results = [];

  for (const item of rundown.items ?? []) {
    const clip = item.clip;
    const regions = new Set(item.regions ?? []);
    for (const b of item.bureaus ?? []) {
      const r = regionForBureau(b, mapping);
      if (r) regions.add(r);
    }
    const rtc = item.rtc !== false;
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: SOURCE, Key: clip }));
      // Where has this master been sent before? Kept in metadata, not tags: a new
      // version is replicated by every rule its tags match, so carrying the old
      // dest-* tags would re-send the whole file to every earlier region.
      const before = new Set((head.Metadata?.["assigned-regions"] ?? "").split(",").filter(Boolean));
      const added = [...regions].filter((r) => !before.has(r));
      const tags = Object.fromEntries(added.map((r) => [rtc ? `dest-${r}` : `dest-nortc-${r}`, "1"]));
      if (Object.keys(tags).length > 10) throw new Error("more than 10 new regions: S3 allows 10 tags per object");
      if (!added.length) {
        results.push({ clip, skipped: "already assigned to these regions" });
        continue;
      }
      const all = [...before, ...added].join(",");
      const assignedAt = new Date().toISOString();
      const copy = await s3.send(
        new CopyObjectCommand({
          Bucket: SOURCE,
          Key: clip,
          CopySource: `${SOURCE}/${encodeURIComponent(clip).replace(/%2F/g, "/")}`,
          MetadataDirective: "REPLACE",
          ContentType: head.ContentType,
          Metadata: { ...(head.Metadata ?? {}), "assigned-at": assignedAt, "assigned-regions": all, rundown: key.slice(0, 200) },
          TaggingDirective: "REPLACE",
          Tagging: new URLSearchParams(tags).toString(),
        }),
      );
      const copiedAt = new Date().toISOString();
      await put("assign", `${copiedAt}#${clip}`, {
        key: clip,
        versionId: copy.VersionId,
        regions: added,
        bureaus: item.bureaus ?? [],
        rundown: key,
        show: rundown.show,
        rtc: rtc ? "yes" : "no",
        size: head.ContentLength ?? 0,
        assignedAt,
        copiedAt,
      });
      results.push({ clip, versionId: copy.VersionId, regions: added });
    } catch (err) {
      await put("assign", `${new Date().toISOString()}#${clip}`, { key: clip, rundown: key, error: `${err.name}: ${err.message}` });
      results.push({ clip, error: err.message });
    }
  }
  console.log("rundown", key, JSON.stringify(results));
  return results;
}

// ---------------------------------------------------------------- handler
export const handler = async (event) => {
  // S3 notification (replication events)
  if (Array.isArray(event.Records)) {
    for (const rec of event.Records) {
      const d = rec.replicationEventData ?? {};
      await put("repl", `${rec.eventTime}#${rec.s3?.object?.key}#${d.replicationRuleId ?? ""}`, {
        event: rec.eventName,
        key: decodeURIComponent((rec.s3?.object?.key ?? "").replace(/\+/g, " ")),
        versionId: rec.s3?.object?.versionId,
        rule: d.replicationRuleId,
        destination: d.destinationBucket,
        reason: d.failureReason,
        threshold: d.threshold,
        replicationTime: d.replicationTime,
        at: rec.eventTime,
      });
    }
    return { ok: true };
  }

  // EventBridge "Object Created"
  if (event["detail-type"] === "Object Created") {
    const bucket = event.detail?.bucket?.name;
    const key = event.detail?.object?.key;
    if (bucket === SOURCE) {
      if (key?.startsWith("rundowns/")) return { results: await applyRundown(key) };
      return { ignored: key };
    }
    if (key?.startsWith("probe/")) return { ignored: key }; // probe objects are written directly, not replicated
    await put("arrival", `${key}#${event.region}#${event.time}`, {
      key,
      region: event.region,
      bucket,
      size: event.detail?.object?.size ?? 0,
      versionId: event.detail?.object?.["version-id"],
      eventTime: event.time,
      receivedAt: new Date().toISOString(),
      reason: event.detail?.reason,
    });
    return { arrival: key };
  }

  return { ignored: true };
};
