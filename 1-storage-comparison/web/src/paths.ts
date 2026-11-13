// The five ways the same video reaches the browser. Each entry drives a path
// diagram (Overview page and player tiles) plus the explanatory text.
import type { AwsIcon } from "./assets/aws";
import type { BackendId } from "./types";

export type NodeKind = "client" | "edge" | "server" | "storage";

export interface PathNode {
  label: string;
  sub?: string;
  kind: NodeKind;
  icon: AwsIcon;
}

export interface MethodDoc {
  id: BackendId;
  title: string;
  /** what it is, one sentence */
  what: string;
  /** how the bytes travel */
  how: string;
  /** the point the method makes in the workshop */
  teaches: string;
  path: PathNode[];
}

const browser: PathNode = { label: "Browser", sub: "hls.js player", kind: "client", icon: "client" };
const cfPass: PathNode = { label: "CloudFront", sub: "pass-through, no cache", kind: "edge", icon: "cloudfront" };
const nginx: PathNode = { label: "EC2 origin", sub: "nginx reads the file", kind: "server", icon: "ec2" };

export const METHODS: MethodDoc[] = [
  {
    id: "nvme",
    title: "Instance store (NVMe)",
    what: "An SSD physically inside the EC2 host, like a laptop's own disk.",
    how: "The browser asks CloudFront, which forwards every request to nginx on the EC2 instance; nginx reads the segment from the local SSD and streams it back. Nothing is cached along the way.",
    teaches:
      "The fastest thing you can buy, and the least durable: stop the instance and the data is gone. On sizes below 4xlarge it is also burstable, so the first benchmark run looks far faster than the steady state.",
    path: [browser, cfPass, nginx, { label: "Instance store", sub: "NVMe inside the host", kind: "storage", icon: "instance" }],
  },
  {
    id: "ebs",
    title: "EBS gp3",
    what: "A network-attached block volume that the operating system sees as a normal disk.",
    how: "Same route as NVMe: CloudFront passes the request to nginx, which reads from the mounted EBS volume. The volume lives in the same availability zone and is attached to this one instance.",
    teaches:
      "A good disk for one server. Performance is a dial you pay for (3,000 IOPS and 125 MiB/s included); it cannot be shared between instances and does not leave its AZ.",
    path: [browser, cfPass, nginx, { label: "EBS volume", sub: "gp3, same AZ", kind: "storage", icon: "ebs" }],
  },
  {
    id: "efs",
    title: "EFS",
    what: "A managed NFS file system that any number of instances can mount at once.",
    how: "CloudFront passes the request to nginx; nginx reads the file over NFS from EFS. Every open and every read is a network round trip inside the VPC, and the file system itself spans all availability zones.",
    teaches:
      "Shared files without running a file server. Throughput is high, but each file operation costs a round trip, so many small files are slower than on a local disk.",
    path: [browser, cfPass, nginx, { label: "EFS", sub: "NFS, regional", kind: "storage", icon: "efs" }],
  },
  {
    id: "s3",
    title: "S3 (direct)",
    what: "Object storage behind an HTTPS API; no disk and no server of ours in the path.",
    how: "The API rewrites the playlist so every segment is a short-lived presigned URL. The browser then fetches each segment straight from the S3 regional endpoint; the EC2 instance is not involved in moving video bytes.",
    teaches:
      "No server to run or scale, effectively unlimited capacity, but each request pays tens of milliseconds and a single connection tops out around 90 MiB/s. S3 gets fast when you parallelise or cache.",
    path: [browser, { label: "S3", sub: "regional endpoint, presigned URL", kind: "storage", icon: "s3" }],
  },
  {
    id: "cdn",
    title: "S3 + CloudFront",
    what: "The same bucket with a content delivery network caching the segments near the viewer.",
    how: "The browser asks the nearest CloudFront edge. The first viewer at that edge causes one fetch from the private bucket; every later viewer is served from the edge cache and S3 is not touched again.",
    teaches:
      "The production answer for video: the edge absorbs the audience, the origin sees one request per segment per edge, and the bucket stays private behind Origin Access Control.",
    path: [
      browser,
      { label: "CloudFront edge", sub: "cache hit after the first viewer", kind: "edge", icon: "cloudfront" },
      { label: "S3", sub: "private origin", kind: "storage", icon: "s3" },
    ],
  },
];

export const methodOf = (id: string): MethodDoc | undefined => METHODS.find((m) => m.id === id);
