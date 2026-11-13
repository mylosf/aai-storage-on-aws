# Storage on AWS: workshop demos

Three self-contained demos from a three-day "storage on AWS" workshop. Each one is deployed on its own
and has its own URL (a CloudFront distribution). Each folder holds everything for its URL: the
Terraform, the backend code and the web page.

| Folder | The URL shows | Main AWS services | Idle cost |
|---|---|---|---|
| [`1-storage-comparison/`](1-storage-comparison/) | One video stored five ways (instance store, EBS, EFS, S3, S3 + CloudFront), played side by side, benchmarked and load-tested | EC2, EBS, EFS, S3, CloudFront, SSM, k6 | ≈ $0.25/h while running (`make freeze` keeps the URL for ≈ $0) |
| [`2-cross-region-replication/`](2-cross-region-replication/) | A newsroom archive in Frankfurt replicated to 15 regions: latency, placement rules, RTC, Batch Replication, costs | S3 replication (60 rules), Lambda, EventBridge, DynamoDB, S3 Batch Operations, CloudFront | storage only (≈ 13 GB + replicas) |
| [`3-delete-protection/`](3-delete-protection/) | How to stop bucket and version deletes: SCP vs. RCP vs. bucket policy, Object Lock, AWS Config, break-glass. Real attacks against seven guarded buckets | S3, Organizations (SCP, RCP), IAM, AWS Config, EventBridge, Lambda, CloudFront | ≈ $0 |

## Layout of every demo

```
<demo>/
  README.md     what the demo shows, how to run it, gotchas
  Makefile      the workflow: make init / deploy / url / destroy (make help lists all)
  infra/        Terraform for this URL only (own state, own variables)
  web/          the page (Vite + React), published to S3 behind CloudFront
  api/ or functions/   the backend behind /api/* (EC2 Node service, or Lambda)
```

Demo-specific extras: `1-storage-comparison/loadtest/` (k6 script), `1-storage-comparison/content/`
(video packaging), `2-cross-region-replication/regions.json` (regions and bureaus, generates Terraform),
`3-delete-protection/org/` (SCP + RCP, applied in the organization's management account).

## Prerequisites

- An AWS account and a CLI profile for it: `export AWS_PROFILE=<your profile>`
- Terraform ≥ 1.6, AWS CLI v2, Node ≥ 20, `make`, `jq`
- In each demo: `cp infra/terraform.tfvars.example infra/terraform.tfvars` and set `account_id`.
  The provider refuses any other account, so a wrong profile fails before anything is created.

Then follow the README in the demo's folder (`make init && make deploy`, roughly).

## Before you deploy

- The demo APIs have **no authentication**: anyone who knows a URL can start benchmarks, load tests,
  uploads or the delete-protection attacks. Abuse is limited (load tests only target the demo itself,
  uploads accept media types only and are capped per hour, attacks only reach the demo's own buckets),
  but deploy for the session and `make destroy` (or `make freeze`) afterwards.
- Terraform state is local (`infra/terraform.tfstate`, git-ignored). Keep it until you have destroyed.
- `3-delete-protection/org/` changes your AWS Organization (enables SCP/RCP policy types on the root).
  It only attaches policies to the demo account, but run it only in an organization you own.

Video content in demo 1: Big Buck Bunny, © Blender Foundation, CC BY 3.0. Masters in demo 2: Netflix
Open Content (Meridian), CC BY 4.0. AWS Architecture Icons © Amazon Web Services.
