// Concurrent-viewer load test. k6 runs on the separate load-generator instance
// (so the origin is not also the client); we start it over SSM Run Command and
// read the summary it drops in the bucket.

import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from "@aws-sdk/client-ssm";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { progress } from "./jobs.mjs";

export const LOADTEST_BACKENDS = ["nvme", "ebs", "efs", "s3", "cdn"];
const GAP_SECONDS = 5; // pause between the per-backend scenarios (must match viewers.js)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function validateLoadTest(body, availableBackends) {
  const vus = Number(body?.vus ?? 50);
  const durationSec = Number(body?.durationSec ?? 30);
  const baseUrl = String(body?.baseUrl ?? "");
  const rendition = String(body?.rendition ?? "720p");
  const backends = Array.isArray(body?.backends) && body.backends.length
    ? body.backends
    : availableBackends;

  if (!Number.isInteger(vus) || vus < 1 || vus > 2000) throw bad("vus must be an integer 1..2000");
  if (!Number.isInteger(durationSec) || durationSec < 10 || durationSec > 300) throw bad("durationSec must be 10..300");
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(baseUrl)) throw bad("demo URL unknown (app/demo-origin.txt missing; run terraform apply)");
  if (!/^[a-z0-9]+$/i.test(rendition)) throw bad("bad rendition");
  if (!backends.length) throw bad("no backend has content yet (run sync first)");
  for (const b of backends) {
    if (!LOADTEST_BACKENDS.includes(b)) throw bad(`unknown backend ${b}`);
    if (!availableBackends.includes(b)) throw bad(`backend ${b} is not available on this deployment`);
  }
  return { mode: "viewers", vus, durationSec, baseUrl, rendition, backends, totalSec: durationSec };
}

/**
 * Miss storm: constant request rates in stages (e.g. "50:15,200:15,500:15" =
 * 50 req/s for 15 s, then 200, then 500) against the paths CloudFront never
 * caches, so every request reaches the origin. `cdn` is the edge-hit reference.
 */
export function validateStorm(body, availableBackends) {
  const baseUrl = String(body?.baseUrl ?? "");
  const rendition = String(body?.rendition ?? "360p");
  const stagesText = String(body?.stages ?? "50:15,200:15,500:15").replace(/\s+/g, "");
  const backends = Array.isArray(body?.backends) && body.backends.length ? body.backends : ["ebs", "s3", "cdn"];

  if (!/^https:\/\/[a-z0-9.-]+$/i.test(baseUrl)) throw bad("demo URL unknown (app/demo-origin.txt missing; run terraform apply)");
  if (!/^[a-z0-9]+$/i.test(rendition)) throw bad("bad rendition");
  if (!/^\d{1,4}:\d{1,3}(,\d{1,4}:\d{1,3}){0,7}$/.test(stagesText)) throw bad('stages must look like "50:15,200:15,500:15"');
  const stages = stagesText.split(",").map((s) => {
    const [rate, seconds] = s.split(":").map(Number);
    return { rate, seconds };
  });
  const totalSec = stages.reduce((a, s) => a + s.seconds, 0);
  if (stages.some((s) => s.rate < 1 || s.rate > 2000 || s.seconds < 5)) throw bad("each stage: 1..2000 req/s for at least 5 s");
  if (totalSec > 300) throw bad("stages add up to more than 300 s");
  for (const b of backends) {
    if (!LOADTEST_BACKENDS.includes(b)) throw bad(`unknown backend ${b}`);
    if (!availableBackends.includes(b)) throw bad(`backend ${b} is not available on this deployment`);
  }
  return { mode: "storm", baseUrl, rendition, stages, stagesText, backends, totalSec };
}

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export async function runLoadTest({ job, cfg, env, s3 }) {
  if (!env.LOADGEN_INSTANCE_ID) throw new Error("load generator not deployed (enable_loadgen=false)");
  const ssm = new SSMClient({ region: env.REGION });
  const resultKey = `results/loadtest/${job.id}.json`;
  const expectedSec = cfg.backends.length * (cfg.totalSec + GAP_SECONDS) + 15;

  // Inputs are validated above (numbers, hostname, enum), so they are safe to
  // place in a shell command.
  const commands = [
    "set -eu",
    ". /etc/demo.env",
    `aws s3 cp "s3://${env.BUCKET}/app/loadtest/viewers.js" /opt/loadgen/viewers.js --region ${env.REGION} --only-show-errors`,
    "cd /opt/loadgen",
    `rm -f summary-${job.id}.json`,
    cfg.mode === "storm"
      ? `k6 run --quiet --no-color -e MODE=storm -e BASE_URL=${cfg.baseUrl} -e STAGES=${cfg.stagesText} ` +
        `-e BACKENDS=${cfg.backends.join(",")} -e RENDITION=${cfg.rendition} -e OUT=summary-${job.id}.json viewers.js`
      : `k6 run --quiet --no-color -e BASE_URL=${cfg.baseUrl} -e VUS=${cfg.vus} -e DURATION=${cfg.durationSec}s ` +
        `-e BACKENDS=${cfg.backends.join(",")} -e RENDITION=${cfg.rendition} -e OUT=summary-${job.id}.json viewers.js`,
    `aws s3 cp summary-${job.id}.json "s3://${env.BUCKET}/${resultKey}" --region ${env.REGION} --only-show-errors`,
  ];

  progress(job, 0, expectedSec, "starting k6 on the load generator");
  const sent = await ssm.send(
    new SendCommandCommand({
      InstanceIds: [env.LOADGEN_INSTANCE_ID],
      DocumentName: "AWS-RunShellScript",
      Comment: `storage-demo loadtest ${job.id}`,
      TimeoutSeconds: 120,
      Parameters: { commands, executionTimeout: [String(expectedSec + 600)] },
    }),
  );
  const commandId = sent.Command.CommandId;

  const started = Date.now();
  for (;;) {
    await sleep(3000);
    const elapsed = Math.round((Date.now() - started) / 1000);
    let inv;
    try {
      inv = await ssm.send(
        new GetCommandInvocationCommand({ CommandId: commandId, InstanceId: env.LOADGEN_INSTANCE_ID }),
      );
    } catch (err) {
      if (err.name === "InvocationDoesNotExist") continue; // not registered yet
      throw err;
    }
    const status = inv.Status;
    if (status === "Success") break;
    if (["Failed", "TimedOut", "Cancelled", "Cancelling"].includes(status)) {
      const detail = (inv.StandardErrorContent || inv.StandardOutputContent || "").slice(-1500);
      throw new Error(`k6 ${status}: ${detail}`);
    }
    const scenario = Math.min(cfg.backends.length - 1, Math.floor(elapsed / (cfg.totalSec + GAP_SECONDS)));
    const what = cfg.mode === "storm" ? `miss storm ${cfg.stagesText} req/s` : `${cfg.vus} viewers`;
    progress(job, Math.min(elapsed, expectedSec), expectedSec,
      `k6 running: ${what} on ${cfg.backends[scenario]} (${elapsed}s / ~${expectedSec}s)`);
  }

  progress(job, expectedSec, expectedSec, "collecting results");
  const obj = await s3.send(new GetObjectCommand({ Bucket: env.BUCKET, Key: resultKey }));
  const summary = JSON.parse(await obj.Body.transformToString());
  return { ...summary, config: { ...summary.config, ...cfg } };
}
