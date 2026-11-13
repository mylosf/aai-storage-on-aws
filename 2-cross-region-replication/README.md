# S3 cross-region replication demo: a newsroom in Frankfurt, cutters everywhere

A German broadcaster keeps its master archive in Frankfurt (eu-central-1). Correspondents' bureaus
cut their pieces locally in 19 cities, served by 15 AWS regions. The demo answers, with
measurements: why copy at all, how many regions, which files go where, how to trigger it,
which storage class, and how to backfill.

## What it shows (tabs)

1. **Map**: source, 15 replica regions, 19 bureaus; measured RTT and last replication lag per arc; architecture diagram.
2. **Why replicate**: a probe Lambda in every region reads the same objects from Frankfurt and from its local replica (RTT, first byte, 64 MiB throughput).
3. **How many regions**: the full 15 × 16 matrix as a heatmap and a planner (service level → fewest regions, cost).
4. **Placement**: the catalogue (masters / proxies / sidecars), three strategies with cost, and the live mechanism: a **rundown** written to `rundowns/` → Lambda tags the masters `dest-<region>=1` and copies them in place → the matching rules replicate → arrival events per region in a timeline.
5. **Replication lab**: 10 MiB / 100 MiB / 1 GiB to chosen regions, with or without RTC; lag per region; CloudWatch replication metrics.
6. **Backfill**: the Hong Kong rule starts disabled; enabling a rule does not move existing objects; S3 Batch Replication does.
7. **Tiers & cost** and 8. **Reference** (every metric, the generated rules, limits and gotchas).

## How replication is set up

60 rules on the Frankfurt bucket, 4 per region: `proxies/` and `sidecars/` by prefix (One Zone-IA, everywhere),
masters by tag `dest-<region>=1` (Standard, RTC 15 min), and `dest-nortc-<region>=1` (no RTC, for comparison).
Key facts the demo makes visible: replication is evaluated per **new version** (a tag change alone does not start it,
hence copy-in-place); the new version only carries the **new** destinations' tags (otherwise every earlier region gets
the file again; the full history is in `x-amz-meta-assigned-regions`); delete-marker replication is not allowed on
tag-filtered rules; 10 tags per object; CopyObject is limited to 5 GB (multipart copy above).

## Layout

```
regions.json          source, replica regions, bureaus (single source of truth)
scripts/gen-regions.py  -> infra/regions.generated.tf (a provider alias + module per region)
infra/                Terraform: source bucket + rules, 15 replica modules, EventBridge, DynamoDB, Lambdas, CloudFront
functions/api         API + jobs (probes, catalogue, lab, rules, Batch Replication)
functions/ingest      arrivals, rundowns -> tag + copy, replication events
functions/probe       deployed in every replica region
web/                  Vite + React + shadcn/ui
```

## Run

```bash
export AWS_PROFILE=<your profile>
cp infra/terraform.tfvars.example infra/terraform.tfvars   # set account_id
make init && make deploy && make seed
make url
```

af-south-1, me-central-1 and ap-east-1 are opt-in regions and must be enabled in the account first
(`aws account enable-region --region-name …`). No EC2: idle cost is S3 storage (~13 GB in Frankfurt,
~0.7 GB proxies × 15) plus pennies. `make destroy` removes all 16 regions.

The API is unauthenticated (anyone with the URL can start jobs): fine for a workshop, destroy afterwards.
Uploads end up as public URLs in 16 buckets, so they are restricted: only media types (mp4, mov, webm,
mkv, mxf, mp3, m4a, wav, jpeg, png) are stored as-is and served inline; anything else is stored as
`application/octet-stream` with `Content-Disposition: attachment` and a `.bin` extension; at most
`UPLOADS_PER_HOUR` (default 60) uploads per hour; 50 MiB each; deleted after a day.
Meridian masters: Netflix Open Content, CC BY 4.0.
