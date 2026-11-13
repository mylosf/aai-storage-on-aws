// Scenario simulations for the Analysis tab.
//
//   paths   "CloudFront in front of all": for every origin, first byte and
//           throughput through the edge on a cache HIT (warmed) and on a MISS
//           (paths the distribution never caches; storage cold for EC2 origins).
//   outage  flag file that makes nginx answer 503 on the storage paths for a
//           while, so the page can show which viewers keep playing.

import { unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CONTENT, dropCaches, httpOps, summarize } from "./bench.mjs";
import { progress } from "./jobs.mjs";

const MiB = 1024 * 1024;

// Which URL prefix reaches each origin with the edge cache on / off.
export const SIM_ORIGINS = [
  { id: "nvme", label: "Instance store", fs: true, hit: "/cached/nvme/video/", miss: "/nvme/video/" },
  { id: "ebs", label: "EBS gp3", fs: true, hit: "/cached/ebs/video/", miss: "/ebs/video/" },
  { id: "efs", label: "EFS", fs: true, hit: "/cached/efs/video/", miss: "/efs/video/" },
  { id: "s3", label: "S3", fs: false, hit: "/video/", miss: "/video-miss/" },
];

export function validatePaths(body) {
  const baseUrl = String(body?.baseUrl ?? "");
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(baseUrl)) throw bad("demo URL unknown (app/demo-origin.txt missing; run terraform apply)");
  const runs = Math.min(10, Math.max(1, Number(body?.runs ?? 3) | 0));
  const seqMiB = Math.min(256, Math.max(16, Number(body?.seqMiB ?? 64) | 0));
  return { baseUrl, runs, seqBytes: seqMiB * MiB };
}

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

const segment = (n) => `360p/seg_${String(n).padStart(5, "0")}.ts`;

export async function runPathsSim({ job, cfg, mounted }) {
  const origins = SIM_ORIGINS.filter((o) => !o.fs || mounted.has(o.id));
  const results = {};
  const total = origins.length;
  let segCounter = 20; // misses use fresh segments; the first ones are warm from the players

  for (const [i, o] of origins.entries()) {
    const hit = httpOps(cfg.baseUrl, o.hit);
    const miss = httpOps(cfg.baseUrl, o.miss);
    const raw = { hit_ttfb_ms: [], miss_ttfb_ms: [], hit_mbps: [], miss_mbps: [] };
    const say = (m) => progress(job, i, total, `${o.label}: ${m}`);

    // --- edge hit: warm once, then time ------------------------------------
    say("warming the edge");
    await hit.readSmall(CONTENT.small);
    await hit.readSeq(CONTENT.big, cfg.seqBytes);
    for (let r = 0; r < cfg.runs; r++) {
      say(`edge hit, run ${r + 1}/${cfg.runs}`);
      const s = await hit.readSmall(CONTENT.small);
      raw.hit_ttfb_ms.push(s.ttfb);
      const q = await hit.readSeq(CONTENT.big, cfg.seqBytes);
      raw.hit_mbps.push(q.bytes / MiB / (q.ms / 1000));
    }

    // --- edge miss: never-cached path, storage cold for EC2 origins ----------
    for (let r = 0; r < cfg.runs; r++) {
      say(`edge miss, run ${r + 1}/${cfg.runs}`);
      if (o.fs) await dropCaches();
      const s = await miss.readSmall(segment(segCounter++));
      raw.miss_ttfb_ms.push(s.ttfb);
      if (o.fs) await dropCaches();
      const q = await miss.readSeq(CONTENT.big, cfg.seqBytes);
      raw.miss_mbps.push(q.bytes / MiB / (q.ms / 1000));
    }

    results[o.id] = {
      label: o.label,
      hitPath: o.hit,
      missPath: o.miss,
      hit_ttfb_ms: summarize(raw.hit_ttfb_ms),
      miss_ttfb_ms: summarize(raw.miss_ttfb_ms),
      hit_mbps: summarize(raw.hit_mbps),
      miss_mbps: summarize(raw.miss_mbps),
    };
  }
  progress(job, total, total, "done");
  return {
    generatedAt: new Date().toISOString(),
    config: { ...cfg, smallFile: "360p segments (~300 KB)", bigFile: CONTENT.big },
    backends: results,
  };
}

// ---------------------------------------------------------------- outage
const OUTAGE_FLAG = "/var/lib/demo/outage";
let outageUntil = null;
let outageTimer = null;

export async function startOutage(seconds) {
  const s = Math.min(600, Math.max(5, Number(seconds) | 0 || 60));
  await writeFile(OUTAGE_FLAG, `${new Date().toISOString()} ${s}s\n`);
  outageUntil = Date.now() + s * 1000;
  clearTimeout(outageTimer);
  outageTimer = setTimeout(() => void stopOutage(), s * 1000);
  return outageStatus();
}

export async function stopOutage() {
  clearTimeout(outageTimer);
  outageTimer = null;
  outageUntil = null;
  await unlink(OUTAGE_FLAG).catch(() => {});
  return outageStatus();
}

export function outageStatus() {
  const active = existsSync(OUTAGE_FLAG);
  if (!active && outageUntil) outageUntil = null;
  return {
    active,
    until: active && outageUntil ? new Date(outageUntil).toISOString() : null,
    remainingSec: active && outageUntil ? Math.max(0, Math.round((outageUntil - Date.now()) / 1000)) : 0,
  };
}

/** Make sure a stale flag from a crashed process does not outlive the API. */
export async function clearStaleOutage() {
  if (existsSync(OUTAGE_FLAG)) await stopOutage();
}

export const now = () => performance.now();
