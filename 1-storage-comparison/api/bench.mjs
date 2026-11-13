// Storage benchmark. Runs *on the instance*, so it measures storage, not the
// room wifi. Every test reads the same files from each backend:
//
//   ttfb       first byte of a small HLS segment (~300 KB), cold cache
//   seq        sequential read of the first N MiB of the big MP4 (MiB/s)
//   random     1 MiB reads at random offsets in the MP4 (= a viewer seeking)
//   smallfile  open + read the first 4 KiB of N segment files (one storage
//              round trip per file; stat() alone is answered from the kernel's
//              attribute cache after readdir, even on NFS, so it shows nothing)
//   parallel   (S3 only) N concurrent ranged GETs of the same N MiB
//
// Linux caches file reads in RAM, so before every file-system test we drop the
// page cache. Without that, EBS/EFS/NVMe would all measure memory on run two.

import { open, stat, readdir, writeFile, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const execFileP = promisify(execFile);
const MiB = 1024 * 1024;

// Layout produced by content/prepare.sh (relative to the video root).
export const CONTENT = {
  master: "master.m3u8",
  small: "360p/seg_00000.ts",
  big: "source.mp4",
  dir: "720p",
};

export const DEFAULTS = {
  runs: 3,
  seqBytes: 256 * MiB,
  randomReads: 40,
  randomBytes: 1 * MiB,
  smallFiles: 50,
  smallFileBytes: 4096,
  parallelStreams: 8,
};

// Deterministic random offsets so a warm-up pass can touch exactly the ranges
// the timed pass will read (needed for the CloudFront backend); mulberry32.
export function offsetsFor(total, size, count, seed) {
  let t = (seed >>> 0) || 1;
  const rand = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const span = Math.max(1, total - size);
  return Array.from({ length: count }, () => Math.floor(rand() * span));
}

export async function dropCaches() {
  try {
    await execFileP("sync");
    await writeFile("/proc/sys/vm/drop_caches", "3");
    return true;
  } catch {
    return false;
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function summarize(samples) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    n: sorted.length,
    samples,
  };
}

// ---------------------------------------------------------------------------
// File-system backend (EBS / EFS / instance store), all via POSIX reads.
// ---------------------------------------------------------------------------
export function fsOps(root) {
  const p = (rel) => `${root}/${rel}`;

  return {
    cold: true,

    async ready() {
      try {
        await access(p(CONTENT.master));
        await access(p(CONTENT.big));
        return true;
      } catch {
        return false;
      }
    },

    async readSmall(rel) {
      const t0 = performance.now();
      const fh = await open(p(rel), "r");
      try {
        const head = Buffer.alloc(64 * 1024);
        const first = await fh.read(head, 0, head.length, 0);
        const tFirst = performance.now();
        let pos = first.bytesRead;
        const chunk = Buffer.alloc(MiB);
        for (;;) {
          const r = await fh.read(chunk, 0, chunk.length, pos);
          if (r.bytesRead === 0) break;
          pos += r.bytesRead;
        }
        return { ttfb: tFirst - t0, total: performance.now() - t0, bytes: pos };
      } finally {
        await fh.close();
      }
    },

    async readSeq(rel, maxBytes) {
      const fh = await open(p(rel), "r");
      try {
        const chunk = Buffer.alloc(4 * MiB);
        let pos = 0;
        const t0 = performance.now();
        while (pos < maxBytes) {
          const want = Math.min(chunk.length, maxBytes - pos);
          const r = await fh.read(chunk, 0, want, pos);
          if (r.bytesRead === 0) break;
          pos += r.bytesRead;
        }
        return { ms: performance.now() - t0, bytes: pos };
      } finally {
        await fh.close();
      }
    },

    async randomRead(rel, size, count, seed) {
      const info = await stat(p(rel));
      const fh = await open(p(rel), "r");
      const buf = Buffer.alloc(size);
      const out = [];
      try {
        for (const offset of offsetsFor(info.size, size, count, seed)) {
          const t0 = performance.now();
          await fh.read(buf, 0, size, offset);
          out.push(performance.now() - t0);
        }
      } finally {
        await fh.close();
      }
      return out;
    },

    async openMany(dirRel, n, bytes) {
      const names = (await readdir(p(dirRel))).sort().slice(0, n);
      const buf = Buffer.alloc(bytes);
      const out = [];
      for (const name of names) {
        const t0 = performance.now();
        const fh = await open(p(`${dirRel}/${name}`), "r");
        try {
          await fh.read(buf, 0, bytes, 0);
        } finally {
          await fh.close();
        }
        out.push(performance.now() - t0);
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// S3 backend, via the SDK over the VPC gateway endpoint.
// ---------------------------------------------------------------------------
export function s3Ops(s3, bucket, prefix) {
  const key = (rel) => `${prefix}${rel}`;

  async function drain(body, onFirst) {
    let bytes = 0;
    let first = false;
    for await (const chunk of body) {
      if (!first) {
        first = true;
        onFirst?.();
      }
      bytes += chunk.length;
    }
    return bytes;
  }

  async function rangeGet(rel, start, end) {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key(rel), Range: `bytes=${start}-${end}` }),
    );
    return drain(res.Body);
  }

  return {
    cold: false, // nothing to drop: every GET is a network round trip

    async ready() {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key(CONTENT.master) }));
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key(CONTENT.big) }));
        return true;
      } catch {
        return false;
      }
    },

    async readSmall(rel) {
      const t0 = performance.now();
      let tFirst = 0;
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key(rel) }));
      const bytes = await drain(res.Body, () => (tFirst = performance.now()));
      return { ttfb: tFirst - t0, total: performance.now() - t0, bytes };
    },

    async readSeq(rel, maxBytes) {
      const t0 = performance.now();
      const bytes = await rangeGet(rel, 0, maxBytes - 1);
      return { ms: performance.now() - t0, bytes };
    },

    async readParallel(rel, maxBytes, streams) {
      const part = Math.ceil(maxBytes / streams);
      const t0 = performance.now();
      const sizes = await Promise.all(
        Array.from({ length: streams }, (_, i) =>
          rangeGet(rel, i * part, Math.min(maxBytes, (i + 1) * part) - 1),
        ),
      );
      return { ms: performance.now() - t0, bytes: sizes.reduce((a, b) => a + b, 0) };
    },

    async randomRead(rel, size, count, seed) {
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key(rel) }));
      const total = head.ContentLength ?? size;
      const out = [];
      for (const offset of offsetsFor(total, size, count, seed)) {
        const t0 = performance.now();
        await rangeGet(rel, offset, offset + size - 1);
        out.push(performance.now() - t0);
      }
      return out;
    },

    async openMany(dirRel, n, bytes) {
      const list = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: key(`${dirRel}/`), MaxKeys: n }),
      );
      const out = [];
      for (const obj of list.Contents ?? []) {
        const t0 = performance.now();
        const res = await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: obj.Key, Range: `bytes=0-${bytes - 1}` }),
        );
        await drain(res.Body);
        out.push(performance.now() - t0);
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP backend: the same files fetched through the CloudFront distribution.
// Not a storage system but the path a viewer takes; `warm()` runs one untimed
// pass so the timed runs measure edge cache hits (the first viewer in a city
// pays the origin fetch, everyone after gets this).
// ---------------------------------------------------------------------------
export function httpOps(baseUrl, prefix) {
  const url = (rel) => `${baseUrl}${prefix}${rel}`;

  async function get(rel, range) {
    const res = await fetch(url(rel), range ? { headers: { Range: `bytes=${range[0]}-${range[1]}` } } : undefined);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url(rel)}`);
    return res;
  }

  async function drain(res, onFirst) {
    let bytes = 0;
    let first = false;
    for await (const chunk of res.body) {
      if (!first) {
        first = true;
        onFirst?.();
      }
      bytes += chunk.length;
    }
    return bytes;
  }

  async function segmentNames(dirRel, n) {
    const text = await (await get(`${dirRel}/index.m3u8`)).text();
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .slice(0, n)
      .map((name) => `${dirRel}/${name}`);
  }

  async function size(rel) {
    const res = await fetch(url(rel), { method: "HEAD" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url(rel)}`);
    return Number(res.headers.get("content-length") ?? 0);
  }

  return {
    cold: false,
    edge: true,

    async ready() {
      try {
        return (await fetch(url(CONTENT.master), { method: "HEAD" })).ok;
      } catch {
        return false;
      }
    },

    async warm(opts) {
      await drain(await get(CONTENT.small));
      await drain(await get(CONTENT.big, [0, opts.seqBytes - 1]));
      const part = Math.ceil(opts.seqBytes / opts.parallelStreams);
      await Promise.all(
        Array.from({ length: opts.parallelStreams }, (_, i) =>
          get(CONTENT.big, [i * part, Math.min(opts.seqBytes, (i + 1) * part) - 1]).then((r) => drain(r)),
        ),
      );
      const total = await size(CONTENT.big);
      for (let seed = 1; seed <= opts.runs; seed++) {
        for (const o of offsetsFor(total, opts.randomBytes, opts.randomReads, seed)) {
          await drain(await get(CONTENT.big, [o, o + opts.randomBytes - 1]));
        }
      }
      for (const rel of await segmentNames(CONTENT.dir, opts.smallFiles)) {
        await drain(await get(rel, [0, opts.smallFileBytes - 1]));
      }
    },

    async readSmall(rel) {
      const t0 = performance.now();
      let tFirst = 0;
      const bytes = await drain(await get(rel), () => (tFirst = performance.now()));
      return { ttfb: tFirst - t0, total: performance.now() - t0, bytes };
    },

    async readSeq(rel, maxBytes) {
      const t0 = performance.now();
      const bytes = await drain(await get(rel, [0, maxBytes - 1]));
      return { ms: performance.now() - t0, bytes };
    },

    async readParallel(rel, maxBytes, streams) {
      const part = Math.ceil(maxBytes / streams);
      const t0 = performance.now();
      const sizes = await Promise.all(
        Array.from({ length: streams }, (_, i) =>
          get(rel, [i * part, Math.min(maxBytes, (i + 1) * part) - 1]).then((r) => drain(r)),
        ),
      );
      return { ms: performance.now() - t0, bytes: sizes.reduce((a, b) => a + b, 0) };
    },

    async randomRead(rel, bytesPer, count, seed) {
      const total = await size(rel);
      const out = [];
      for (const o of offsetsFor(total, bytesPer, count, seed)) {
        const t0 = performance.now();
        await drain(await get(rel, [o, o + bytesPer - 1]));
        out.push(performance.now() - t0);
      }
      return out;
    },

    async openMany(dirRel, n, bytes) {
      const out = [];
      for (const rel of await segmentNames(dirRel, n)) {
        const t0 = performance.now();
        await drain(await get(rel, [0, bytes - 1]));
        out.push(performance.now() - t0);
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Run every test `runs` times against one backend.
// ---------------------------------------------------------------------------
export async function benchBackend(ops, opts, report) {
  const raw = {
    ttfb_ms: [],
    small_total_ms: [],
    seq_mbps: [],
    random_ms: [],
    smallfile_ms: [],
    parallel_mbps: [],
  };
  let coldOk = true;
  const cold = async () => {
    if (ops.cold) coldOk = (await dropCaches()) && coldOk;
  };

  if (ops.warm) {
    report("warming the edge cache (untimed)");
    await ops.warm(opts);
  }

  for (let r = 1; r <= opts.runs; r++) {
    report(`run ${r}/${opts.runs}: first byte`);
    await cold();
    const small = await ops.readSmall(CONTENT.small);
    raw.ttfb_ms.push(small.ttfb);
    raw.small_total_ms.push(small.total);

    report(`run ${r}/${opts.runs}: sequential read`);
    await cold();
    const seq = await ops.readSeq(CONTENT.big, opts.seqBytes);
    raw.seq_mbps.push(seq.bytes / MiB / (seq.ms / 1000));

    report(`run ${r}/${opts.runs}: random reads`);
    await cold();
    raw.random_ms.push(...(await ops.randomRead(CONTENT.big, opts.randomBytes, opts.randomReads, r)));

    report(`run ${r}/${opts.runs}: small files`);
    await cold();
    raw.smallfile_ms.push(...(await ops.openMany(CONTENT.dir, opts.smallFiles, opts.smallFileBytes)));

    if (ops.readParallel) {
      report(`run ${r}/${opts.runs}: parallel read`);
      const par = await ops.readParallel(CONTENT.big, opts.seqBytes, opts.parallelStreams);
      raw.parallel_mbps.push(par.bytes / MiB / (par.ms / 1000));
    }
  }

  return {
    coldCache: ops.cold ? coldOk : null,
    edgeHit: ops.edge ? true : undefined,
    ttfb_ms: summarize(raw.ttfb_ms),
    small_total_ms: summarize(raw.small_total_ms),
    seq_mbps: summarize(raw.seq_mbps),
    random_ms: summarize(raw.random_ms),
    smallfile_ms: summarize(raw.smallfile_ms),
    parallel_mbps: summarize(raw.parallel_mbps),
  };
}
