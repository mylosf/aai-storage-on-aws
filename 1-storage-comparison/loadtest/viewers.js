// k6: N simulated HLS viewers per backend, one backend after another.
//
// Each VU behaves like a player: fetch one segment, then wait until the
// segment's playback duration has elapsed before fetching the next. So 200 VUs
// really means 200 concurrent viewers, not 200 tight download loops, and the
// interesting numbers are per-segment first-byte latency, fetch time and the
// share of fetches slower than the segment itself (= a rebuffer).
//
// MODE=storm instead fires a constant request rate in stages (STAGES="50:15,200:15,500:15")
// at the paths CloudFront never caches, so every request reaches the origin: a cache
// purge or launch day. `cdn` is the edge-hit reference in that mode.
//
// Env: BASE_URL, MODE (viewers|storm), VUS, DURATION (e.g. 30s), STAGES, BACKENDS (csv), RENDITION, OUT
import http from "k6/http";
import exec from "k6/execution";
import { sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL;
const MODE = __ENV.MODE === "storm" ? "storm" : "viewers";
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || "30s";
const DURATION_SEC = parseInt(DURATION, 10);
const BACKENDS = (__ENV.BACKENDS || "ebs,efs,s3,cdn").split(",").filter(Boolean);
const RENDITION = __ENV.RENDITION || (MODE === "storm" ? "360p" : "720p");
const SEGMENT_SECONDS = 4; // must match -hls_time in content/prepare.sh
const GAP_SECONDS = 5; // must match GAP_SECONDS in api/loadtest.mjs

// storm stages: [{rate, seconds}], flat steps
const STAGES = (__ENV.STAGES || "50:15,200:15,500:15").split(",").map((s) => {
  const [rate, seconds] = s.split(":").map(Number);
  return { rate, seconds };
});
const STORM_SEC = STAGES.reduce((a, s) => a + s.seconds, 0);
const SCENARIO_SEC = MODE === "storm" ? STORM_SEC : DURATION_SEC;

function scenarioFor(b, i) {
  const common = { startTime: `${i * (SCENARIO_SEC + GAP_SECONDS)}s`, gracefulStop: "3s", env: { BACKEND: b }, tags: { backend: b } };
  if (MODE === "storm") {
    const stages = [];
    for (const s of STAGES) {
      stages.push({ duration: "0s", target: s.rate }); // jump
      stages.push({ duration: `${s.seconds}s`, target: s.rate }); // hold
    }
    return {
      ...common,
      executor: "ramping-arrival-rate",
      startRate: STAGES[0].rate,
      timeUnit: "1s",
      preAllocatedVUs: 100,
      maxVUs: 1500,
      stages,
      exec: "storm",
    };
  }
  return { ...common, executor: "constant-vus", vus: VUS, duration: DURATION, exec: "viewer" };
}

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "max", "count"],
  scenarios: Object.fromEntries(BACKENDS.map((b, i) => [b, scenarioFor(b, i)])),
  // make per-scenario dropped iterations visible in the summary (generator could not keep up)
  thresholds: Object.fromEntries(BACKENDS.map((b) => [`dropped_iterations{scenario:${b}}`, ["count>=0"]])),
};

const metrics = {};
for (const b of BACKENDS) {
  metrics[b] = {
    ttfb: new Trend(`ttfb_${b}`, true),
    fetch: new Trend(`fetch_${b}`, true),
    stall: new Rate(`stall_${b}`),
    error: new Rate(`error_${b}`),
    bytes: new Counter(`bytes_${b}`),
    stages: STAGES.map((_, i) => ({
      ttfb: new Trend(`ttfb_${b}_s${i}`, true),
      fetch: new Trend(`fetch_${b}_s${i}`, true),
      error: new Rate(`error_${b}_s${i}`),
      requests: new Counter(`requests_${b}_s${i}`),
    })),
  };
}

function playlistUrl(backend) {
  if (MODE === "storm") {
    // never-cached paths (every request reaches the origin), except cdn = edge hit reference
    if (backend === "cdn") return `${BASE}/video/${RENDITION}/index.m3u8`;
    if (backend === "s3") return `${BASE}/video-miss/${RENDITION}/index.m3u8`;
    return `${BASE}/${backend}/video/${RENDITION}/index.m3u8`;
  }
  if (backend === "cdn") return `${BASE}/video/${RENDITION}/index.m3u8`;
  if (backend === "s3") return `${BASE}/api/hls/${RENDITION}/index.m3u8`;
  return `${BASE}/${backend}/video/${RENDITION}/index.m3u8`;
}

function stageIndex() {
  const elapsed = (Date.now() - exec.scenario.startTime) / 1000;
  let acc = 0;
  for (let i = 0; i < STAGES.length; i++) {
    acc += STAGES[i].seconds;
    if (elapsed < acc) return i;
  }
  return STAGES.length - 1;
}

export function storm(data) {
  const b = __ENV.BACKEND;
  const segs = data.segments[b];
  const m = metrics[b];
  const st = m.stages[stageIndex()];
  const idx = exec.scenario.iterationInTest % segs.length;
  const res = http.get(segs[idx], { tags: { backend: b } });
  const ok = res.status === 200 || res.status === 206;
  st.requests.add(1);
  st.error.add(!ok);
  m.error.add(!ok);
  if (ok) {
    st.ttfb.add(res.timings.waiting);
    st.fetch.add(res.timings.duration);
    m.ttfb.add(res.timings.waiting);
    m.fetch.add(res.timings.duration);
    m.bytes.add(Number(res.headers["Content-Length"] || 0));
  }
}

// Resolve every backend's segment list once, up front.
export function setup() {
  const segments = {};
  for (const b of BACKENDS) {
    const url = playlistUrl(b);
    const res = http.get(url, { responseType: "text" });
    if (res.status !== 200) throw new Error(`playlist ${url} -> HTTP ${res.status}`);
    const dir = url.substring(0, url.lastIndexOf("/") + 1);
    segments[b] = res.body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      // absolute segment URIs only for this demo or S3 (the presigned s3 backend);
      // a playlist must not be able to send the load to any other host
      .map((l) => (/^https?:\/\//.test(l) ? (l.startsWith(`${BASE}/`) || /^https:\/\/[a-z0-9.-]+\.s3\.[a-z0-9-]+\.amazonaws\.com\//.test(l) ? l : null) : dir + l))
      .filter(Boolean);
    if (!segments[b].length) throw new Error(`playlist ${url} has no segments`);
  }
  return { segments };
}

export function viewer(data) {
  const b = __ENV.BACKEND;
  const segs = data.segments[b];
  const m = metrics[b];

  // Spread viewers over the whole film so they are not all on segment 0.
  const idx = (__VU * 7 + __ITER) % segs.length;
  const res = http.get(segs[idx], { tags: { backend: b } });
  const ok = res.status === 200 || res.status === 206;

  m.error.add(!ok);
  if (ok) {
    m.ttfb.add(res.timings.waiting);
    m.fetch.add(res.timings.duration);
    m.stall.add(res.timings.duration > SEGMENT_SECONDS * 1000);
    m.bytes.add(Number(res.headers["Content-Length"] || 0));
  }

  const remaining = SEGMENT_SECONDS - res.timings.duration / 1000;
  if (remaining > 0) sleep(remaining);
}

export function handleSummary(data) {
  const pick = (name) => (data.metrics[name] && data.metrics[name].values) || {};
  const out = {
    generatedAt: new Date().toISOString(),
    mode: MODE,
    config: {
      vus: VUS,
      durationSec: DURATION_SEC,
      rendition: RENDITION,
      segmentSeconds: SEGMENT_SECONDS,
      baseUrl: BASE,
      stages: MODE === "storm" ? STAGES : undefined,
    },
    backends: {},
  };
  for (const b of BACKENDS) {
    const t = pick(`ttfb_${b}`);
    const f = pick(`fetch_${b}`);
    out.backends[b] = {
      requests: f.count || 0,
      ttfb_ms: { avg: t.avg, p50: t.med, p90: t["p(90)"], p95: t["p(95)"], max: t.max },
      fetch_ms: { avg: f.avg, p50: f.med, p90: f["p(90)"], p95: f["p(95)"], max: f.max },
      stall_rate: pick(`stall_${b}`).rate || 0,
      error_rate: pick(`error_${b}`).rate || 0,
      bytes: pick(`bytes_${b}`).count || 0,
    };
    if (MODE === "storm") {
      out.backends[b].dropped = pick(`dropped_iterations{scenario:${b}}`).count || 0;
      out.backends[b].stages = STAGES.map((s, i) => {
        const st = pick(`ttfb_${b}_s${i}`);
        const sf = pick(`fetch_${b}_s${i}`);
        return {
          rate: s.rate,
          seconds: s.seconds,
          requests: pick(`requests_${b}_s${i}`).count || 0,
          ttfb_p50: st.med,
          ttfb_p95: st["p(95)"],
          fetch_p95: sf["p(95)"],
          error_rate: pick(`error_${b}_s${i}`).rate || 0,
        };
      });
    }
  }
  const json = JSON.stringify(out, null, 2);
  return { [__ENV.OUT || "summary.json"]: json, stdout: json + "\n" };
}
