# AWS storage comparison demo: video streaming

One short film, stored five ways, played side by side, benchmarked on the instance and load-tested with simulated viewers. Built for a 3-day storage-on-AWS workshop; one instructor deploys it, attendees open a URL.

| Backend | Path to the viewer | Teaching point |
|---|---|---|
| Instance store (NVMe) | browser → CloudFront (no cache) → nginx → local SSD | Fastest, ephemeral, this host only |
| EBS gp3 | browser → CloudFront (no cache) → nginx → EBS volume | Low latency, one instance, one AZ |
| EFS | browser → CloudFront (no cache) → nginx → NFS → EFS | Shared by many instances, higher per-op latency |
| S3 (direct) | browser → S3 regional endpoint (presigned URLs) | No server in the path, scales itself, higher first byte |
| S3 + CloudFront | browser → edge cache → S3 | The production answer |

```
Browser ──► CloudFront (one HTTPS URL)
              ├─ /                → S3  web/      (the app)              cached
              ├─ /video/*         → S3  video/    (HLS)                  cached   ← "S3 + CloudFront"
              ├─ /video-miss/*    → S3  video/    (rewritten)            never cached (Analysis: forced miss)
              ├─ /ebs/* /efs/* /nvme/*  → EC2 nginx → EBS | EFS | NVMe   not cached
              ├─ /cached/<b>/*    → EC2 nginx, same files                cached   (Analysis: CDN in front of all)
              └─ /api/*           → EC2 benchmark API                    not cached
                                                   ╰─ SSM ─► load generator (k6)
```

## What the web app shows

1. **Players**: one tile per backend, same film, live startup time, per-segment first-byte and download time, rendition, rebuffers. Buttons to restart, pause and seek all players at once.
2. **Storage benchmark**: runs *on the EC2 instance* with the page cache dropped before each test, so it measures storage, not the room wifi. First-byte latency, sequential MiB/s, random 1 MiB reads (seeking), per-file open+read cost, and S3 parallel-range throughput.
3. **Concurrent viewers**: k6 on a second instance simulates N players per backend, one backend after another, and reports segment TTFB/fetch-time percentiles, stall rate and errors.
4. **Analysis**: "what if CloudFront sat in front of everything" as runnable experiments: edge hit vs miss per origin (`/cached/*` and `/video-miss/*` paths), a k6 miss storm in request-rate stages, a simulated origin outage (nginx answers 503 for N seconds while the page probes every path), and a cost calculator.
5. **Choosing**: an interactive decision tree for S3 vs EFS vs EBS (with the FSx, instance-store, storage-class and CloudFront branches) plus the cross-cutting considerations table.
6. **Reference**: every metric explained, and scope, durability, scaling model and list prices side by side.

Expect single-viewer playback to look nearly identical everywhere; any of these can serve one 5 Mbps stream. The benchmark and the load test carry the comparison.

## Repo layout

```
infra/       Terraform (VPC, EC2 origin + EIP, EBS gp3, EFS, S3, CloudFront, optional k6 instance)
api/         Node API on the origin instance: benchmarks, presigned HLS playlists, job runner, load test trigger
web/         Vite + React single-page app (hls.js, recharts)
loadtest/    k6 viewer script (uploaded to S3, pulled by the load generator at each run)
content/     prepare.sh: Big Buck Bunny → HLS ladder (360p/720p/1080p, 4 s TS) + progressive MP4
scripts/     job.sh: start an API job and poll it
Makefile     the instructor workflow
```

## Prerequisites (laptop)

- Terraform ≥ 1.6, AWS CLI v2, Node ≥ 20, `jq`, `make`
- `ffmpeg` for packaging the video (`brew install ffmpeg`)
- An AWS account and a CLI profile for it (`export AWS_PROFILE=<your profile>`). Put the account ID in `infra/terraform.tfvars` (copy `infra/terraform.tfvars.example`). The provider pins `allowed_account_ids`, so a wrong profile fails fast.
- Session Manager plugin for `make shell` (optional)

## Deploy

```bash
export AWS_PROFILE=<your profile>
cp infra/terraform.tfvars.example infra/terraform.tfvars   # set account_id
make init
make apply        # ~8 min (CloudFront is the slow part)
make web          # build the SPA, publish to S3, invalidate CloudFront
make content      # download (725 MB) + transcode (~5-10 min on an M-series Mac) + upload + sync to EBS/EFS/NVMe
make url          # open it
```

`make deploy` runs apply + web + content in one go. `make status` shows whether every backend is mounted and has content.

Terraform state is local (`infra/terraform.tfstate`), which is fine for a single instructor; don't lose it before `make destroy`.

Running instances ignore AMI changes (`lifecycle.ignore_changes = [ami]`): AWS publishes a new AL2023 AMI every few weeks and that must not replace the demo mid-workshop. Taint an instance to rebuild it on purpose.

### Useful knobs (`infra/variables.tf`)

- `region` (default `eu-central-1`), `cloudfront_price_class`
- `origin_instance_type` (default `m6id.large`; the `d` gives the NVMe backend; use `m6i.large` to drop it)
- `ebs_iops` / `ebs_throughput_mbps` (defaults 3000 / 125, the gp3 baseline). Raising them and re-running the benchmark is a good live demo.
- `efs_throughput_mode` (`elastic` or `bursting`)
- `enable_loadgen` (default true; ~`c6i.large`)

## Running the demo

- Hand attendees the CloudFront URL. Everything is same-origin HTTPS.
- Benchmark takes ~1–2 min with 3 runs. Watch the progress message; results persist across API restarts (`/api/bench/latest`).
- Load test: 50 viewers × 30 s × 5 backends ≈ 3 min. Viewers are paced like real players (one 4 s segment per 4 s), so 200 VUs really is 200 concurrent viewers.
- `/ebs/video/`, `/efs/video/`, `/nvme/video/` have directory listings turned on for pointing at the files.
- Live storage changes attendees can watch: `terraform apply -var ebs_iops=6000 -var ebs_throughput_mbps=500` (gp3 modifies in place), then re-run the benchmark.
- Shell on the instance without SSH: `make shell` (SSM). Logs: `/var/log/demo-bootstrap.log`, `journalctl -u demo-api`, `/var/log/nginx/access.log`.

## After the workshop: freeze instead of destroy

`make freeze` keeps the CloudFront URL alive with the last recorded results and removes everything that costs money: it snapshots `/api/*` into `web/public/data/snapshot.json`, republishes the site, applies Terraform with `frozen = true` (instances, EBS, EFS, Elastic IP, IAM and the app objects go away; CloudFront drops the EC2 origin) and empties the `video/`, `results/` and `app/` prefixes. What remains is the distribution and a bucket holding a few MB: effectively free. The page shows an "Archive" banner; players and experiments are disabled, charts and tables come from the snapshot. `make thaw` brings the stack back (`make content` afterwards for the video). `make destroy` removes everything including the URL.

## Changing code

- API (`api/*.mjs`, `api/nginx.conf`): `make update-api` re-uploads the files, restarts the service and installs the nginx config via SSM (`api/install.sh` also runs as npm `postinstall` on a fresh instance).
- Web (`web/`): `make web`. For local development against the deployment: `DEMO_URL=$(make -s url) npm run dev` in `web/`.
- k6 script: re-uploaded by `make update-api`; the load generator pulls it fresh on every run.
- Content: edit `content/prepare.sh`, then `make content`. `CLIP_SECONDS=120 make content` builds a 2-minute set for quick tests.

## Security posture (worth mentioning in the workshop)

- Bucket is private; CloudFront reads via Origin Access Control, the browser reads S3 directly only through short-lived presigned URLs.
- The EC2 origin's security group only accepts port 80 from the CloudFront origin-facing prefix list. No SSH; SSM only.
- IMDSv2 required; S3 traffic from the instances goes over a VPC gateway endpoint.
- The API has no auth: anyone with the URL can start a benchmark. Acceptable for a short-lived demo; destroy it after the workshop.
- Benchmarks, load tests and simulations only ever target this demo's own CloudFront URL: Terraform writes it to `s3://<bucket>/app/demo-origin.txt`, the API reads it from there and ignores any `baseUrl` in the request, and the k6 script drops playlist entries that point to other hosts (S3 presigned URLs excepted). So the load generator cannot be aimed at a third-party site.

## Cost

Roughly $0.25/h while running (m6id.large + c6i.large + 20 GB gp3 + EFS + CloudFront), so about $20 for three days if left up, a few dollars if stopped overnight. `make destroy` removes everything including the bucket contents.

## Fairness notes for the comparison

- EBS, EFS and NVMe are measured locally on the instance; S3 is measured from the same instance over the VPC endpoint. Everything is in one AZ.
- `drop_caches` runs before every file-system test; without it, run two measures RAM. The `coldCache` flag in the result says whether it worked.
- The browser-side players and the load test go through CloudFront for the EC2 paths (caching disabled) so that every backend has the same TLS edge in front; the only difference is what sits behind it.
- gp3 at the baseline (125 MiB/s) caps the sequential test; that is the point. Raise it live.
- The instance store on `m6id.large` is *burstable* (true for all sizes below 4xlarge): the first pass after boot reads at ~2.4 GB/s, then it settles at ~150 MiB/s once the burst credit is gone. Expect the NVMe bar to change between runs and say why; or use `m6id.4xlarge` for sustained numbers.
- EFS Elastic throughput is high for sequential reads (~500+ MiB/s single client) but every file open costs a network round trip (~2 ms vs ~0.3 ms on EBS); the small-file test shows it.
