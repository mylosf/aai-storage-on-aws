// Probe: runs in every replica region and stands in for a cutter's workstation
// there. For each target bucket it measures
//   rttMs     median of 5 HEADs on a tiny object (after one warm-up)  -> latency
//   ttfbMs    GET of a 1 MiB object: time until the response headers   -> first byte
//   mbps      GET of the big probe object, bytes / time                -> throughput
//
// event: { targets: [{ region, bucket }], bigKey, smallKey, pingKey }
// Lambda networking tops out around 0.5–1 Gbit/s: absolute throughput is lower
// than a workstation's, the comparison between targets is what matters.

import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

const clients = new Map();
const client = (region) => {
  if (!clients.has(region)) clients.set(region, new S3Client({ region }));
  return clients.get(region);
};

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

async function drain(body) {
  let n = 0;
  for await (const c of body) n += c.length;
  return n;
}

async function measure({ region, bucket }, keys) {
  const s3 = client(region);
  const out = { region, bucket };
  try {
    // latency: warm the connection, then 5 HEADs
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: keys.pingKey }));
    const rtts = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: keys.pingKey }));
      rtts.push(performance.now() - t0);
    }
    out.rttMs = median(rtts);

    // first byte of a 1 MiB object (3 tries, median)
    const ttfbs = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: keys.smallKey }));
      ttfbs.push(performance.now() - t0);
      await drain(res.Body);
    }
    out.ttfbMs = median(ttfbs);

    // throughput: one GET of the big probe object
    const t0 = performance.now();
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: keys.bigKey }));
    const bytes = await drain(res.Body);
    const sec = (performance.now() - t0) / 1000;
    out.bytes = bytes;
    out.seconds = sec;
    out.mbps = (bytes * 8) / 1e6 / sec;
  } catch (err) {
    out.error = `${err.name}: ${err.message}`;
  }
  return out;
}

export const handler = async (event) => {
  const keys = {
    pingKey: event.pingKey ?? "probe/ping.bin",
    smallKey: event.smallKey ?? "probe/1MiB.bin",
    bigKey: event.bigKey ?? "probe/64MiB.bin",
  };
  const results = [];
  // sequential: parallel GETs would share the Lambda's network and skew each other
  for (const t of event.targets ?? []) results.push(await measure(t, keys));
  return { from: process.env.PROBE_REGION, at: new Date().toISOString(), results };
};
