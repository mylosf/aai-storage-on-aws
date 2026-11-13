// Benchmark + helper API for the storage demo. Plain node:http, no framework.
//
//   GET  /api/info                 what is deployed, which backends are ready
//   GET  /api/hls/<path>.m3u8      playlists rewritten with presigned S3 URLs
//   POST /api/bench/run            {runs?, backends?}            -> {jobId}
//   GET  /api/bench/latest
//   POST /api/loadtest/run         {vus, durationSec}   -> {jobId}   (target: the demo's own URL, never from the request)
//   GET  /api/loadtest/latest
//   POST /api/sim/paths            {runs?}  edge hit vs miss per origin -> {jobId}
//   POST /api/sim/storm            {stages?, backends?}  miss storm via k6 -> {jobId}
//   GET  /api/sim/latest           latest paths + storm jobs
//   GET|POST|DELETE /api/sim/outage   simulated origin outage (nginx 503 on storage paths)
//   POST /api/admin/sync           copy video from S3 to EBS/EFS/NVMe -> {jobId}
//   POST /api/admin/drop-caches
//   GET  /api/jobs/:id

import http from "node:http";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { Jobs, progress } from "./jobs.mjs";
import { CONTENT, DEFAULTS, benchBackend, dropCaches, fsOps, httpOps, s3Ops } from "./bench.mjs";
import { presignedPlaylist } from "./hls.mjs";
import { runLoadTest, validateLoadTest, validateStorm } from "./loadtest.mjs";
import { clearStaleOutage, outageStatus, runPathsSim, startOutage, stopOutage, validatePaths } from "./sim.mjs";

const execFileP = promisify(execFile);

const env = {
  REGION: process.env.REGION ?? "eu-central-1",
  BUCKET: process.env.BUCKET ?? "",
  EBS_VOLUME_ID: process.env.EBS_VOLUME_ID ?? "",
  EFS_ID: process.env.EFS_ID ?? "",
  EBS_IOPS: process.env.EBS_IOPS ?? "",
  EBS_THROUGHPUT: process.env.EBS_THROUGHPUT ?? "",
  EFS_THROUGHPUT_MODE: process.env.EFS_THROUGHPUT_MODE ?? "",
  LOADGEN_INSTANCE_ID: process.env.LOADGEN_INSTANCE_ID ?? "",
  PORT: Number(process.env.PORT ?? 8080),
  RESULTS_DIR: process.env.RESULTS_DIR ?? "/var/lib/demo/results",
  VIDEO_PREFIX: "video/",
};

const s3 = new S3Client({ region: env.REGION });

// The only host benchmarks, load tests and simulations may target: this demo's
// CloudFront URL, written by Terraform to s3://$BUCKET/app/demo-origin.txt.
// Whatever baseUrl the browser sends is ignored.
let demoOriginCache = null;
async function demoOrigin() {
  if (demoOriginCache) return demoOriginCache;
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: env.BUCKET, Key: "app/demo-origin.txt" }));
    const v = (await r.Body.transformToString()).trim();
    if (/^https:\/\/[a-z0-9.-]+\.cloudfront\.net$/i.test(v)) demoOriginCache = v;
  } catch (err) {
    console.error("demo origin not readable:", err.message);
  }
  return demoOriginCache;
}
const jobs = new Jobs(env.RESULTS_DIR);

// ---------------------------------------------------------------------------
// Backends. `browserPrefix` is where the web app finds master.m3u8 for each.
// ---------------------------------------------------------------------------
const BACKENDS = [
  {
    id: "nvme",
    label: "Instance store (NVMe)",
    kind: "fs",
    root: "/mnt/nvme/video",
    browserPrefix: "/nvme/video",
    path: "browser → CloudFront (no cache) → nginx → local NVMe SSD",
    summary: "SSD inside the host. Ephemeral (gone on stop). On sizes below 4xlarge it is burstable: multi-GB/s with credit, ~150 MiB/s baseline.",
  },
  {
    id: "ebs",
    label: "EBS gp3",
    kind: "fs",
    root: "/mnt/ebs/video",
    browserPrefix: "/ebs/video",
    path: "browser → CloudFront (no cache) → nginx → EBS volume",
    summary: "Network block volume, attached to one instance in one AZ.",
  },
  {
    id: "efs",
    label: "EFS",
    kind: "fs",
    root: "/mnt/efs/video",
    browserPrefix: "/efs/video",
    path: "browser → CloudFront (no cache) → nginx → NFS → EFS",
    summary: "Regional NFS file system, shared by any number of instances.",
  },
  {
    id: "s3",
    label: "S3 (direct)",
    kind: "s3",
    browserPrefix: "/api/hls",
    path: "browser → S3 regional endpoint (presigned URLs)",
    summary: "Object storage. No server in the path; the browser talks to S3.",
  },
  {
    id: "cdn",
    label: "S3 + CloudFront",
    kind: "cdn",
    browserPrefix: "/video",
    path: "browser → CloudFront edge cache → S3",
    summary: "Same bucket, cached at the edge closest to the viewer.",
  },
];

const opsFor = (b, baseUrl) =>
  b.kind === "fs"
    ? fsOps(b.root)
    : b.kind === "s3"
      ? s3Ops(s3, env.BUCKET, env.VIDEO_PREFIX)
      : b.kind === "cdn" && baseUrl
        ? httpOps(baseUrl, `${b.browserPrefix}/`)
        : null;

async function mountedPaths() {
  try {
    const mounts = await readFile("/proc/mounts", "utf8");
    return new Set(mounts.split("\n").map((l) => l.split(" ")[1]));
  } catch {
    return new Set();
  }
}

async function describeBackends() {
  const mounted = await mountedPaths();
  const s3ready = await s3Ops(s3, env.BUCKET, env.VIDEO_PREFIX).ready();
  return Promise.all(
    BACKENDS.map(async (b) => {
      let available = true;
      let ready = s3ready;
      if (b.kind === "fs") {
        available = mounted.has(b.root.replace(/\/video$/, ""));
        ready = available && (await fsOps(b.root).ready());
      }
      const { root, ...pub } = b;
      return { ...pub, available, ready, master: `${b.browserPrefix}/${CONTENT.master}` };
    }),
  );
}

// ---------------------------------------------------------------------------
// Instance metadata (IMDSv2); silently absent when running locally.
// ---------------------------------------------------------------------------
async function instanceInfo() {
  const base = "http://169.254.169.254/latest";
  try {
    const tok = await fetch(`${base}/api/token`, {
      method: "PUT",
      headers: { "X-aws-ec2-metadata-token-ttl-seconds": "21600" },
      signal: AbortSignal.timeout(1500),
    }).then((r) => r.text());
    const get = (p) =>
      fetch(`${base}/meta-data/${p}`, {
        headers: { "X-aws-ec2-metadata-token": tok },
        signal: AbortSignal.timeout(1500),
      }).then((r) => r.text());
    const [id, type, az] = await Promise.all([
      get("instance-id"),
      get("instance-type"),
      get("placement/availability-zone"),
    ]);
    return { id, type, az };
  } catch {
    return { id: "local", type: "unknown", az: "unknown" };
  }
}
const instance = await instanceInfo();

// ---------------------------------------------------------------------------
// Job runners
// ---------------------------------------------------------------------------
async function benchRunner(job, opts, selected, baseUrl) {
  const results = {};
  const total = selected.length;
  for (const [i, b] of selected.entries()) {
    const ops = opsFor(b, baseUrl);
    if (!(await ops.ready())) {
      results[b.id] = { label: b.label, error: "content missing on this backend (run sync)" };
      continue;
    }
    results[b.id] = {
      label: b.label,
      ...(await benchBackend(ops, opts, (msg) => progress(job, i, total, `${b.label}: ${msg}`))),
    };
  }
  progress(job, total, total, "done");
  return {
    generatedAt: new Date().toISOString(),
    instance,
    config: {
      ...opts,
      smallFile: CONTENT.small,
      bigFile: CONTENT.big,
      smallFileDir: CONTENT.dir,
      ebs: { type: "gp3", iops: env.EBS_IOPS, throughputMiBps: env.EBS_THROUGHPUT },
      efs: { throughputMode: env.EFS_THROUGHPUT_MODE },
    },
    backends: results,
  };
}

async function syncRunner(job) {
  progress(job, 0, 1, "aws s3 sync → EBS / EFS / NVMe");
  const { stdout, stderr } = await execFileP("/opt/demo/api/sync.sh", [], { maxBuffer: 4 * 1024 * 1024 });
  progress(job, 1, 1, "done");
  return { output: `${stdout}${stderr}`.trim().split("\n").slice(-50) };
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------
function send(res, status, body, headers = {}) {
  const isText = typeof body === "string";
  res.writeHead(status, {
    "Content-Type": isText ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...headers,
  });
  res.end(isText ? body : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 64 * 1024) reject(Object.assign(new Error("body too large"), { status: 413 }));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(Object.assign(new Error("invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

const jobView = (job) => ({ ...job });

async function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method;

  if (method === "OPTIONS") return send(res, 204, "");
  if (path === "/api/healthz") return send(res, 200, "ok\n");

  if (method === "GET" && path === "/api/info") {
    return send(res, 200, {
      instance,
      region: env.REGION,
      bucket: env.BUCKET,
      ebs: { volumeId: env.EBS_VOLUME_ID, type: "gp3", iops: env.EBS_IOPS, throughputMiBps: env.EBS_THROUGHPUT },
      efs: { id: env.EFS_ID, throughputMode: env.EFS_THROUGHPUT_MODE },
      loadgen: { enabled: Boolean(env.LOADGEN_INSTANCE_ID) },
      backends: await describeBackends(),
      content: CONTENT,
      benchDefaults: DEFAULTS,
    });
  }

  if (method === "GET" && path.startsWith("/api/hls/")) {
    const rel = decodeURIComponent(path.slice("/api/hls/".length));
    const body = await presignedPlaylist({
      s3,
      bucket: env.BUCKET,
      prefix: env.VIDEO_PREFIX,
      relPath: rel,
      selfBase: "/api/hls",
    });
    return send(res, 200, body, { "Content-Type": "application/vnd.apple.mpegurl" });
  }

  if (method === "POST" && path === "/api/bench/run") {
    const body = await readJson(req);
    const runs = Math.min(10, Math.max(1, Number(body.runs ?? DEFAULTS.runs) | 0));
    const seqMiB = Math.min(1024, Math.max(16, Number(body.seqMiB ?? DEFAULTS.seqBytes / 1048576) | 0));
    const wanted = Array.isArray(body.backends) ? body.backends : null;
    // The CloudFront row targets the demo's own URL only (see demoOrigin), never a host from the request.
    const baseUrl = await demoOrigin();
    const selected = BACKENDS.filter(
      (b) => (b.kind === "fs" || b.kind === "s3" || (b.kind === "cdn" && baseUrl)) && (!wanted || wanted.includes(b.id)),
    );
    const opts = { ...DEFAULTS, runs, seqBytes: seqMiB * 1048576 };
    const job = jobs.create("bench", (j) => benchRunner(j, opts, selected, baseUrl));
    return send(res, 202, { jobId: job.id });
  }

  if (method === "GET" && path === "/api/bench/latest") {
    const job = jobs.latest.bench;
    return job ? send(res, 200, jobView(job)) : send(res, 404, { error: "no benchmark run yet" });
  }

  if (method === "POST" && path === "/api/loadtest/run") {
    const body = { ...(await readJson(req)), baseUrl: await demoOrigin() };
    const available = (await describeBackends()).filter((b) => b.ready).map((b) => b.id);
    const cfg = validateLoadTest(body, available);
    const job = jobs.create("loadtest", (j) => runLoadTest({ job: j, cfg, env, s3 }));
    return send(res, 202, { jobId: job.id });
  }

  // --- simulations (Analysis tab) ----------------------------------------
  if (method === "POST" && path === "/api/sim/paths") {
    const cfg = validatePaths({ ...(await readJson(req)), baseUrl: await demoOrigin() });
    const mounted = new Set((await describeBackends()).filter((b) => b.kind === "fs" && b.ready).map((b) => b.id));
    const job = jobs.create("sim", (j) => runPathsSim({ job: j, cfg, mounted }));
    return send(res, 202, { jobId: job.id });
  }

  if (method === "POST" && path === "/api/sim/storm") {
    const body = { ...(await readJson(req)), baseUrl: await demoOrigin() };
    const available = (await describeBackends()).filter((b) => b.ready).map((b) => b.id);
    const cfg = validateStorm(body, available);
    const job = jobs.create("storm", (j) => runLoadTest({ job: j, cfg, env, s3 }));
    return send(res, 202, { jobId: job.id });
  }

  if (method === "GET" && path === "/api/sim/latest") {
    return send(res, 200, { paths: jobs.latest.sim ?? null, storm: jobs.latest.storm ?? null });
  }

  if (path === "/api/sim/outage") {
    if (method === "GET") return send(res, 200, outageStatus());
    if (method === "POST") return send(res, 200, await startOutage((await readJson(req)).seconds));
    if (method === "DELETE") return send(res, 200, await stopOutage());
  }

  if (method === "GET" && path === "/api/loadtest/latest") {
    const job = jobs.latest.loadtest;
    return job ? send(res, 200, jobView(job)) : send(res, 404, { error: "no load test run yet" });
  }

  if (method === "POST" && path === "/api/admin/sync") {
    const job = jobs.create("sync", syncRunner);
    return send(res, 202, { jobId: job.id });
  }

  if (method === "POST" && path === "/api/admin/drop-caches") {
    return send(res, 200, { dropped: await dropCaches() });
  }

  if (method === "GET" && path.startsWith("/api/jobs/")) {
    const job = jobs.get(path.slice("/api/jobs/".length));
    return job ? send(res, 200, jobView(job)) : send(res, 404, { error: "unknown job" });
  }

  return send(res, 404, { error: "not found" });
}

await jobs.init();
await clearStaleOutage();

http
  .createServer((req, res) => {
    route(req, res).catch((err) => {
      const status = err.status ?? 500;
      if (status >= 500) console.error(err);
      send(res, status, { error: err.message ?? "internal error" });
    });
  })
  .listen(env.PORT, "127.0.0.1", () => {
    console.log(`storage-demo api on :${env.PORT} (${instance.type} in ${instance.az}, bucket ${env.BUCKET})`);
  });
