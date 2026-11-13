// Static comparison shown on the Facts tab. Prices are us-east-1 list prices as
// of writing — verify against the pricing pages before the workshop.
import type { BackendId } from "./types";

export interface Fact {
  id: BackendId;
  name: string;
  what: string;
  scope: string;
  durability: string;
  scaling: string;
  latencyClass: string;
  price: string;
  goodFor: string;
  notFor: string;
}

export const PRICE_DISCLAIMER = "us-east-1 list prices, verify before the workshop";

export const FACTS: Fact[] = [
  {
    id: "nvme",
    name: "Instance store (NVMe)",
    what: "SSD physically inside the host, exposed as a block device.",
    scope: "This one instance only. Contents vanish on stop, terminate or hardware failure.",
    durability: "None — ephemeral. Treat as cache or scratch.",
    scaling: "Fixed per instance type; want more → bigger instance.",
    latencyClass: "~0.1 ms, GB/s throughput",
    price: "Included in the instance price (only on *d types, e.g. m6id)",
    goodFor: "Caches, scratch space, transcoding temp, databases that replicate themselves.",
    notFor: "Anything you cannot rebuild from elsewhere.",
  },
  {
    id: "ebs",
    name: "EBS gp3",
    what: "Network-attached block volume; looks like a local disk to the OS.",
    scope: "One AZ, attached to one instance at a time (Multi-Attach only on io1/io2).",
    durability: "99.8–99.9 % annual (AFR 0.1–0.2 %). Snapshots to S3 for backup.",
    scaling: "Resize/retune live; performance provisioned per volume.",
    latencyClass: "~1 ms single-digit, 125 MiB/s baseline",
    price: "$0.08 / GB-month, with 3,000 IOPS + 125 MiB/s included; more is extra",
    goodFor: "Boot disks, databases, anything POSIX on one server.",
    notFor: "Sharing between servers, serving the internet directly, multi-AZ.",
  },
  {
    id: "efs",
    name: "EFS",
    what: "Managed NFS file system, mounted by any number of instances or containers.",
    scope: "Regional (multi-AZ by default) — one mount target per AZ.",
    durability: "99.999999999 % (11 nines), stored across AZs.",
    scaling: "Elastic: grows and shrinks with the data, throughput scales with mode.",
    latencyClass: "low single-digit ms per operation; metadata ops add up",
    price: "$0.30 / GB-month (Standard) + Elastic throughput $0.03 / GB read",
    goodFor: "Shared content, home directories, lift-and-shift apps that expect a file system.",
    notFor: "Metadata-heavy workloads, latency-critical databases, cost-sensitive bulk storage.",
  },
  {
    id: "s3",
    name: "S3 (direct)",
    what: "Object storage behind an HTTPS API; the browser fetches presigned URLs.",
    scope: "Regional, reachable from anywhere on the internet or via VPC endpoints.",
    durability: "99.999999999 % (11 nines), 99.99 % availability design (Standard).",
    scaling: "Effectively unlimited objects and requests; parallelism gives throughput.",
    latencyClass: "tens of ms to first byte, 100+ MB/s per stream",
    price: "$0.023 / GB-month Standard + requests + $0.09 / GB internet egress",
    goodFor: "Media, backups, data lakes, static sites — anything that is a file you serve or keep.",
    notFor: "POSIX semantics, partial in-place writes, sub-ms latency (that is S3 Express One Zone).",
  },
  {
    id: "cdn",
    name: "S3 + CloudFront",
    what: "The same bucket, with a CDN caching objects at ~600 edge locations.",
    scope: "Global edge; origin stays private via Origin Access Control.",
    durability: "Same as S3 (the edge is a cache, not storage).",
    scaling: "Edge absorbs the viewers; origin sees one fetch per object per edge.",
    latencyClass: "single-digit to tens of ms on a cache hit, near the viewer",
    price: "~$0.085 / GB out after 1 TB / month free; S3 → CloudFront transfer is free",
    goodFor: "Streaming video, downloads, websites — anything with many viewers of the same bytes.",
    notFor: "Content unique per request (cache miss every time), tiny internal audiences.",
  },
];
