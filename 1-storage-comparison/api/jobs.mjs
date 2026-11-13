// Tiny in-memory job runner. Jobs run one at a time (a benchmark and a content
// sync running together would distort the numbers). Finished results are
// persisted to disk so "latest" survives an API restart.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const PERSISTED = ["bench", "loadtest", "sim", "storm"];

export class Jobs {
  constructor(dir) {
    this.dir = dir;
    this.jobs = new Map();
    this.latest = {};
    this.chain = Promise.resolve();
  }

  async init() {
    await mkdir(this.dir, { recursive: true });
    for (const type of PERSISTED) {
      try {
        this.latest[type] = JSON.parse(await readFile(`${this.dir}/${type}-latest.json`, "utf8"));
      } catch {
        /* no previous result */
      }
    }
  }

  create(type, runner) {
    const id = `${type}-${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;
    const job = {
      id,
      type,
      status: "queued",
      progress: { current: 0, total: 0, message: "queued" },
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
    };
    this.jobs.set(id, job);

    this.chain = this.chain.then(async () => {
      job.status = "running";
      job.startedAt = new Date().toISOString();
      try {
        job.result = await runner(job);
        job.status = "done";
      } catch (err) {
        job.status = "error";
        job.error = err?.message ?? String(err);
        console.error(`[job ${id}] failed:`, err);
      } finally {
        job.finishedAt = new Date().toISOString();
      }
      if (job.status === "done" && PERSISTED.includes(type)) {
        this.latest[type] = job;
        await this.persist(job).catch((e) => console.error("persist failed", e));
      }
    });

    return job;
  }

  get(id) {
    return this.jobs.get(id) ?? null;
  }

  async persist(job) {
    const body = JSON.stringify(job, null, 2);
    await writeFile(`${this.dir}/${job.id}.json`, body);
    await writeFile(`${this.dir}/${job.type}-latest.json`, body);
  }
}

export function progress(job, current, total, message) {
  job.progress = { current, total, message };
}
