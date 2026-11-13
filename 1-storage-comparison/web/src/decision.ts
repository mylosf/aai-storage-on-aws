// Decision tree: choosing between S3, EFS and EBS (with the branches that fork
// off them: instance store, S3 storage classes, FSx, CloudFront). Rendered as a
// guided walk and as a full outline on the "Choosing" tab.
//
// Prices are us-east-1 list prices at the time of writing; verify before use.
import type { AwsIcon } from "./assets/aws";
import type { BackendId } from "./types";

export interface Option {
  label: string;
  /** examples / clarification shown under the label */
  detail?: string;
  /** edge label on the map */
  short: string;
  next: string;
}

export interface Question {
  kind: "question";
  id: string;
  title: string;
  /** box label on the map */
  short: string;
  /** why this question matters */
  help?: string;
  options: Option[];
}

export interface Result {
  kind: "result";
  id: string;
  service: string;
  /** box label on the map */
  short: string;
  icon: AwsIcon;
  /** link to a backend shown in the demo, if any */
  backend?: BackendId;
  summary: string;
  why: string[];
  watch: string[];
  alternatives?: { label: string; next: string }[];
}

export type Node = Question | Result;

const q = (
  id: string,
  short: string,
  title: string,
  options: Option[],
  help?: string,
): Question => ({
  kind: "question",
  id,
  short,
  title,
  help,
  options,
});

const r = (node: Omit<Result, "kind">): Result => ({ kind: "result", ...node });

export const ROOT = "share";

export const NODES: Node[] = [
  // ------------------------------------------------------- who shares it?
  q(
    "share",
    "Who needs the same data?",
    "Who needs the same data at the same time?",
    [
      {
        label: "One machine only",
        detail:
          "A database server, a build box, an application with its own disk",
        short: "one machine",
        next: "one-write",
      },
      {
        label: "A fleet of machines inside AWS",
        detail:
          "Web and application servers, containers, batch jobs, Lambda functions",
        short: "a fleet in AWS",
        next: "fleet-files",
      },
      {
        label: "An audience on the internet",
        detail: "Browsers, mobile apps, partners, downloads",
        short: "the internet",
        next: "audience",
      },
    ],
    "Sharing decides more than anything else: a block volume belongs to one machine, a file system serves a fleet, and only object storage behind HTTPS reaches the public at scale.",
  ),

  // ------------------------------------------------------------ one machine
  q(
    "one-write",
    "How is it changed?",
    "How does that machine change the data?",
    [
      {
        label:
          "In place, constantly: database pages, indexes, journals, random writes",
        short: "in place, constantly",
        next: "one-persist",
      },
      {
        label:
          "Whole files written once and read back later: exports, media, backups, shipped logs",
        short: "whole files, write once",
        next: "s3-access",
      },
    ],
    "Random in-place writes need a disk. Files that are written once and read later are objects, even when only one machine produces them.",
  ),
  q(
    "one-persist",
    "May it vanish with the machine?",
    "May the data vanish with the machine, and how fast must it be?",
    [
      {
        label:
          "It may vanish: cache, scratch, temporary files, or the application replicates it itself; wants microseconds",
        detail:
          "Kafka, Cassandra, Elasticsearch replicas, build agents, transcoding temp",
        short: "may vanish, µs",
        next: "instance-store",
      },
      {
        label: "It must survive stop, failure and replacement",
        detail:
          "Databases, boot volumes, anything you would restore from backup",
        short: "must survive",
        next: "block-perf",
      },
    ],
  ),
  q(
    "block-perf",
    "Performance profile?",
    "What is the performance profile?",
    [
      {
        label:
          "General purpose: boot volumes, most databases, application servers",
        detail: "Up to tens of thousands of IOPS and about 1 GB/s per volume",
        short: "general purpose",
        next: "ebs-gp3",
      },
      {
        label:
          "Latency-critical with very high sustained IOPS, 99.999 % durability or Multi-Attach",
        detail: "SAP HANA, large Oracle or SQL Server, transactional systems",
        short: "extreme IOPS, 5 nines",
        next: "ebs-io2",
      },
      {
        label:
          "Large sequential throughput where cost per GB matters more than IOPS",
        detail: "Log processing, streaming, data warehouses, Kafka brokers",
        short: "big sequential, cheap",
        next: "ebs-st1",
      },
      {
        label: "Cold, rarely read, sequential, lowest cost per GB",
        detail: "Infrequently accessed file data on a single instance",
        short: "cold, cheapest",
        next: "ebs-sc1",
      },
    ],
    "EBS performance is provisioned per volume. Pay for the IOPS and throughput you need; the instance type caps the total EBS bandwidth too.",
  ),

  // ------------------------------------------------------------- the fleet
  q(
    "fleet-files",
    "What kind of files?",
    "What kind of files does the fleet share, and how are they written?",
    [
      {
        label:
          "Many small files updated in place; needs locks, renames, POSIX permissions",
        detail:
          "CMS uploads, home directories, shared config, lift-and-shift apps",
        short: "small files, POSIX",
        next: "fs-protocol",
      },
      {
        label: "Large files written once, read many times",
        detail: "Datasets, media libraries, log archives, model checkpoints",
        short: "large files, write once",
        next: "fleet-latency",
      },
      {
        label: "One block volume attached to several machines in one AZ",
        detail:
          "Clustered databases with a cluster-aware file system (Oracle RAC, GFS2)",
        short: "shared block volume",
        next: "ebs-multiattach",
      },
    ],
    "File type and write pattern separate the file-system world from the object world: in-place updates and POSIX semantics need NFS or SMB; write-once files are happiest as objects.",
  ),
  q(
    "fs-protocol",
    "Which protocol?",
    "Which protocol and ecosystem does the workload expect?",
    [
      {
        label: "Linux, NFS, standard POSIX",
        detail: "Most web stacks, containers, Lambda, batch jobs",
        short: "Linux NFS",
        next: "efs-latency",
      },
      {
        label: "Windows SMB with Active Directory and NTFS permissions",
        detail: "Windows file shares, .NET apps, user home drives",
        short: "Windows SMB",
        next: "fsx-windows",
      },
      {
        label:
          "HPC or ML training: hundreds of GB/s, millions of IOPS, data staged from S3",
        detail: "Simulation, genomics, large-scale model training",
        short: "HPC / ML",
        next: "fsx-lustre",
      },
      {
        label: "NetApp ONTAP features",
        detail:
          "SnapMirror, multi-protocol NFS + SMB + iSCSI, dedupe, existing ONTAP estates",
        short: "ONTAP features",
        next: "fsx-ontap",
      },
    ],
  ),
  q(
    "efs-latency",
    "Per-file traffic?",
    "What does the workload look like per file operation?",
    [
      {
        label: "Large files, mostly sequential reads and writes",
        detail: "Media, shared uploads, backups, content management",
        short: "large, sequential",
        next: "efs-availability",
      },
      {
        label: "Millions of small files and heavy metadata traffic",
        detail: "Builds, package caches, git checkouts, PHP includes",
        short: "millions of small files",
        next: "efs-smallfiles",
      },
    ],
    "EFS throughput scales very well; per-operation latency (around a millisecond per open or stat) is the thing it cannot hide. The small-file test in the benchmark shows exactly this.",
  ),
  q(
    "efs-availability",
    "Survive an AZ loss?",
    "Must the data survive the loss of an availability zone?",
    [
      {
        label: "Yes, this is production data",
        short: "yes, production",
        next: "efs-throughput",
      },
      {
        label: "No: dev/test, caches, or re-creatable from elsewhere",
        short: "no, re-creatable",
        next: "efs-onezone",
      },
    ],
  ),
  q(
    "efs-throughput",
    "Throughput shape?",
    "How steady is the throughput demand?",
    [
      {
        label: "Spiky or unpredictable (most workloads)",
        short: "spiky",
        next: "efs-elastic",
      },
      {
        label: "Steady and high, known in advance",
        detail: "Continuous media processing, always-busy shared storage",
        short: "steady and high",
        next: "efs-provisioned",
      },
    ],
  ),
  q(
    "fleet-latency",
    "First byte needed?",
    "How fast must the first byte of those large files arrive?",
    [
      {
        label: "Tens of milliseconds is fine",
        detail: "Pipelines, batch jobs, most services",
        short: "tens of ms",
        next: "fleet-interface",
      },
      {
        label: "Single-digit milliseconds",
        detail: "Interactive analytics, latency-sensitive services",
        short: "single-digit ms",
        next: "s3-express",
      },
      {
        label: "Sub-millisecond at hundreds of GB/s",
        detail: "HPC, large-scale model training",
        short: "sub-ms, HPC",
        next: "fsx-lustre",
      },
    ],
  ),
  q(
    "fleet-interface",
    "Mount or API?",
    "Do the applications need a mounted directory, or can they call the S3 API?",
    [
      {
        label: "They expect a mounted directory",
        detail: "Existing tools that open paths",
        short: "a mount",
        next: "s3-mountpoint",
      },
      {
        label: "They can use the S3 API or an SDK",
        short: "the API",
        next: "s3-standard",
      },
    ],
  ),

  // ------------------------------------------------------------ the public
  q(
    "audience",
    "Same objects or their own?",
    "What do the people on the internet read?",
    [
      {
        label: "Many of them read the same objects",
        detail: "Video, downloads, websites, app assets",
        short: "same objects, many viewers",
        next: "s3-cf",
      },
      {
        label: "Each reads their own files",
        detail: "Uploads, reports, per-user data, presigned links",
        short: "their own files",
        next: "audience-latency",
      },
      {
        label: "Rarely: it is kept for retention or compliance",
        detail: "Records, evidence, archives",
        short: "rarely, retention",
        next: "s3-access",
      },
    ],
    "Repeated reads of the same objects are what a CDN is for; unique per-user reads go to S3 directly; data kept for the record belongs in a cheaper class.",
  ),
  q(
    "audience-latency",
    "First byte needed?",
    "How fast must the first byte arrive?",
    [
      {
        label: "Tens of milliseconds is fine",
        short: "tens of ms",
        next: "s3-standard",
      },
      {
        label: "Single-digit milliseconds",
        short: "single-digit ms",
        next: "s3-express",
      },
    ],
  ),

  // ------------------------------------------------------------ S3 classes
  q(
    "s3-access",
    "How often read back?",
    "How often will the objects be read back, and how quickly must they arrive?",
    [
      {
        label: "Often, and tens of milliseconds to first byte is fine",
        detail: "Active content, application data",
        short: "often",
        next: "s3-standard",
      },
      {
        label: "The pattern is unknown or changes over the object's life",
        detail: "User uploads, data lakes with hot and cold partitions",
        short: "unknown / changing",
        next: "s3-it",
      },
      {
        label: "Rarely (about monthly), but instantly when needed",
        detail: "Backups, disaster-recovery copies, older logs",
        short: "monthly, instant",
        next: "s3-ia",
      },
      {
        label: "Very rarely (quarterly or less), still instant",
        detail:
          "Medical images, media archives, compliance data you occasionally open",
        short: "quarterly, instant",
        next: "s3-gir",
      },
      {
        label:
          "Archive: waiting minutes to hours (or half a day) to retrieve is acceptable",
        detail: "Long-term retention, legal hold, raw footage",
        short: "archive, can wait",
        next: "s3-archive",
      },
      {
        label: "Single-digit milliseconds and very high request rates",
        detail:
          "ML training data, interactive analytics co-located with compute",
        short: "single-digit ms",
        next: "s3-express",
      },
    ],
    "Storage class is mostly a trade between price per GB and the cost or delay of getting the data back. Lifecycle rules move objects between classes automatically.",
  ),

  r({
    id: "s3-standard",
    short: "S3 Standard",
    service: "Amazon S3 Standard",
    icon: "s3",
    backend: "s3",
    summary:
      "Durable, unlimited object storage read directly by applications in the region.",
    why: [
      "99.999999999 % durability across at least three AZs; 99.99 % availability design.",
      "No capacity planning: unlimited objects and request rate, strong read-after-write consistency.",
      "About $0.023/GB-month plus requests; no servers to run.",
      "Rich integrations: events, Athena, replication, lifecycle, Object Lock.",
    ],
    watch: [
      "First byte is tens of milliseconds and one connection tops out near 100 MB/s; parallelise range requests for throughput.",
      "Request pricing adds up with millions of tiny objects; batch or pack them.",
      "Objects are immutable: no partial in-place writes, renames copy the object.",
      "Keep Block Public Access on; grant access with IAM, bucket policies or presigned URLs; use a VPC gateway endpoint from EC2.",
    ],
    alternatives: [
      { label: "Audience on the internet: add CloudFront", next: "s3-cf" },
      {
        label: "Need single-digit ms: S3 Express One Zone",
        next: "s3-express",
      },
      {
        label: "Linux apps that need a file interface: Mountpoint for S3",
        next: "s3-mountpoint",
      },
    ],
  }),
  r({
    id: "s3-cf",
    short: "S3 + CloudFront",
    service: "Amazon S3 + Amazon CloudFront",
    icon: "cloudfront",
    backend: "cdn",
    summary:
      "The bucket stays private; CloudFront caches objects at the edge closest to each viewer.",
    why: [
      "The edge absorbs the audience: the origin sees one fetch per object per edge, latency drops to a cache hit near the user.",
      "S3 → CloudFront transfer is free; CloudFront egress is cheaper than S3 egress and the first 1 TB/month is free.",
      "Origin Access Control keeps the bucket private; signed URLs or cookies gate paid content.",
      "HTTPS, HTTP/3, compression and WAF come with the distribution.",
    ],
    watch: [
      "Content unique per request never hits the cache; you pay for the extra hop.",
      "Cache-Control on the objects decides browser versus edge caching; plan invalidations for updates.",
      "Cold edges still fetch from the region; the first viewer in each city sees origin latency.",
    ],
    alternatives: [
      { label: "Internal consumers only: plain S3", next: "s3-standard" },
    ],
  }),
  r({
    id: "s3-it",
    short: "Intelligent-Tiering",
    service: "Amazon S3 Intelligent-Tiering",
    icon: "s3",
    summary:
      "S3 moves each object between frequent, infrequent and archive-instant tiers based on actual access, with no retrieval fees.",
    why: [
      "Same durability and latency as Standard; tiering is automatic after 30 / 90 days without access.",
      "No retrieval charges and no surprise bills when a cold object becomes hot again.",
      "Optional asynchronous Archive and Deep Archive tiers for data that can wait.",
    ],
    watch: [
      "A monitoring fee of about $0.0025 per 1,000 objects; objects under 128 KB are never tiered, so it does not pay for tiny objects.",
      "Minimum 30-day storage charge per object.",
    ],
    alternatives: [
      {
        label: "Pattern is well known: pick the class directly",
        next: "s3-access",
      },
    ],
  }),
  r({
    id: "s3-ia",
    short: "Standard-IA",
    service: "Amazon S3 Standard-IA (or One Zone-IA)",
    icon: "s3",
    summary:
      "Instant access at about half the storage price, in exchange for a per-GB retrieval fee and a 30-day minimum.",
    why: [
      "About $0.0125/GB-month (One Zone-IA about $0.01) with millisecond access and the same API.",
      "Ideal for backups, DR copies and data read a few times a year.",
    ],
    watch: [
      "Retrieval costs about $0.01/GB; read it monthly and Standard would have been cheaper.",
      "Minimum billable object size 128 KB and minimum 30-day duration.",
      "One Zone-IA lives in a single AZ: fine for re-creatable secondary copies, not for the only copy.",
    ],
    alternatives: [
      {
        label: "Unsure how often it will be read: Intelligent-Tiering",
        next: "s3-it",
      },
      { label: "Even rarer access: Glacier Instant Retrieval", next: "s3-gir" },
    ],
  }),
  r({
    id: "s3-gir",
    short: "Glacier Instant",
    service: "Amazon S3 Glacier Instant Retrieval",
    icon: "glacier",
    summary:
      "Archive pricing with millisecond retrieval, for data touched about once a quarter.",
    why: [
      "About $0.004/GB-month with the same synchronous GET as Standard.",
      "Fits imaging, media archives and compliance data that must open on demand.",
    ],
    watch: [
      "Retrieval about $0.03/GB and a 90-day minimum; frequent reads make it expensive quickly.",
      "Higher per-request prices than Standard.",
    ],
    alternatives: [
      {
        label: "Can wait for retrieval: Flexible Retrieval or Deep Archive",
        next: "s3-archive",
      },
    ],
  }),
  r({
    id: "s3-archive",
    short: "Glacier / Deep Archive",
    service: "S3 Glacier Flexible Retrieval / Deep Archive",
    icon: "glacier",
    summary:
      "The cheapest storage on AWS; objects must be restored before they can be read.",
    why: [
      "Flexible Retrieval about $0.0036/GB-month, retrieval in minutes (expedited) to hours (bulk, free).",
      "Deep Archive about $0.00099/GB-month, retrieval within 12 hours (48 for bulk).",
      "Lifecycle rules move data here automatically; Object Lock gives WORM retention.",
    ],
    watch: [
      "A GET on an archived object fails with InvalidObjectState until you restore it: applications must handle the restore step.",
      "Minimum durations of 90 and 180 days; early deletion is billed.",
      "Restored copies are temporary and billed as Standard while they exist.",
    ],
    alternatives: [
      { label: "Must be instant: Glacier Instant Retrieval", next: "s3-gir" },
    ],
  }),
  r({
    id: "s3-express",
    short: "S3 Express One Zone",
    service: "Amazon S3 Express One Zone",
    icon: "s3",
    summary:
      "Directory buckets in a single AZ with single-digit-millisecond first byte and far cheaper requests.",
    why: [
      "Up to 10× lower latency than Standard and hundreds of thousands of requests per second per bucket.",
      "Request prices roughly halved; put the bucket in the AZ where the compute runs.",
      "Same SDKs; Mountpoint and many analytics engines support it.",
    ],
    watch: [
      "Single AZ: keep a durable copy in a regional class and treat Express as a fast working set.",
      "Storage about $0.11/GB-month, several times Standard.",
      "Directory buckets have their own namespace rules and fewer features (no lifecycle to other classes, no replication).",
    ],
    alternatives: [
      { label: "Latency not critical: S3 Standard", next: "s3-standard" },
    ],
  }),
  r({
    id: "s3-mountpoint",
    short: "Mountpoint for S3",
    service: "Mountpoint for Amazon S3",
    icon: "s3",
    summary:
      "A file interface on top of a bucket for Linux applications that mostly read large files sequentially.",
    why: [
      "No file server: S3 durability, scale and price with POSIX-style open/read for existing tools.",
      "High aggregate throughput for reading datasets, media and logs; supports S3 Express One Zone.",
      "Writes create new objects; good for pipelines that produce files once.",
    ],
    watch: [
      "Not a general file system: no partial in-place writes, no renames of existing objects, no file locking, no hard links.",
      "Small random reads and metadata-heavy workloads pay S3 request latency per operation.",
      "If the application needs real POSIX semantics or concurrent writers, use EFS.",
    ],
    alternatives: [
      { label: "Real POSIX semantics needed: EFS", next: "fs-protocol" },
      { label: "Plain object access: S3 Standard", next: "s3-standard" },
    ],
  }),

  r({
    id: "efs-elastic",
    short: "EFS Elastic",
    service: "Amazon EFS Regional, Elastic throughput",
    icon: "efs",
    backend: "efs",
    summary:
      "A managed NFS file system that any number of instances, containers or Lambda functions mount at once, scaling throughput automatically.",
    why: [
      "99.999999999 % durability, stored across AZs, with a mount target in each AZ.",
      "Elastic throughput follows the workload up to several GB/s and you pay only for data moved (about $0.03/GB read, $0.06/GB written).",
      "Grows and shrinks with the data; lifecycle moves cold files to Infrequent Access (about $0.016/GB) and Archive (about $0.008/GB).",
      "POSIX permissions plus IAM; access points map identities for containers and Lambda.",
    ],
    watch: [
      "Standard storage costs about $0.30/GB-month, roughly ten times S3 and four times gp3; lifecycle policies matter.",
      "Every file operation is a network round trip: metadata-heavy workloads feel it.",
      "Throughput per client is limited; parallel clients get the aggregate.",
      "Not reachable from the internet; it serves compute inside the VPC (or peered networks).",
    ],
    alternatives: [
      { label: "Single AZ is acceptable: EFS One Zone", next: "efs-onezone" },
      {
        label: "Steady high throughput: Provisioned mode",
        next: "efs-provisioned",
      },
      { label: "Small-file heavy: see the caveats", next: "efs-smallfiles" },
    ],
  }),
  r({
    id: "efs-provisioned",
    short: "EFS Provisioned",
    service: "Amazon EFS, Provisioned throughput",
    icon: "efs",
    backend: "efs",
    summary:
      "The same file system with a fixed throughput you pay for monthly, independent of how much data is stored or moved.",
    why: [
      "Predictable performance and bill for continuously busy workloads.",
      "Cheaper than Elastic when the file system is consistently near the provisioned rate.",
    ],
    watch: [
      "About $6 per MiB/s-month; idle capacity is still billed.",
      "Changing the provisioned value is limited to once per 24 hours.",
    ],
    alternatives: [
      { label: "Demand varies: Elastic throughput", next: "efs-elastic" },
    ],
  }),
  r({
    id: "efs-onezone",
    short: "EFS One Zone",
    service: "Amazon EFS One Zone",
    icon: "efs",
    backend: "efs",
    summary:
      "The same NFS file system kept in a single availability zone at roughly half the price.",
    why: [
      "About $0.16/GB-month (Infrequent Access about $0.013).",
      "Same API, same mount, AWS Backup enabled by default.",
    ],
    watch: [
      "An AZ outage takes the file system with it; mount from the same AZ to avoid cross-AZ data charges.",
      "Use for dev/test, caches and data that can be re-created or restored from backup.",
    ],
    alternatives: [
      { label: "Production data: Regional", next: "efs-throughput" },
    ],
  }),
  r({
    id: "efs-smallfiles",
    short: "EFS (small-file caveats)",
    service: "Amazon EFS, with caveats for small files",
    icon: "efs",
    backend: "efs",
    summary:
      "EFS works, but each of the millions of opens and stats costs a network round trip; design around it or pick a lower-latency file system.",
    why: [
      "Sharing and durability requirements often still point at EFS.",
      "Mitigations are well known: cache locally (OPcache, local build caches), fewer and larger files, parallel clients.",
    ],
    watch: [
      "Expect around 1–3 ms per metadata operation versus well under a millisecond on EBS; a build that stats 100,000 files feels the difference.",
      "FSx for OpenZFS or FSx for ONTAP offer lower per-operation latency with NFS if sharing is required.",
      "If only one machine needs the files, EBS with periodic sync to S3 is simpler and faster.",
    ],
    alternatives: [
      { label: "Large files instead: EFS proper", next: "efs-availability" },
      { label: "Only one machine: EBS", next: "block-perf" },
    ],
  }),
  r({
    id: "fsx-windows",
    short: "FSx for Windows",
    service: "Amazon FSx for Windows File Server",
    icon: "fsxWindows",
    summary:
      "Fully managed SMB file shares with Active Directory integration, NTFS ACLs, shadow copies and DFS.",
    why: [
      "Drop-in replacement for Windows file servers; Multi-AZ option.",
      "SSD or HDD storage with provisioned throughput; data deduplication and user quotas.",
    ],
    watch: [
      "Windows semantics only; Linux clients can mount SMB but POSIX apps prefer NFS.",
      "Capacity and throughput are provisioned, not elastic.",
    ],
    alternatives: [{ label: "Linux NFS instead: EFS", next: "efs-latency" }],
  }),
  r({
    id: "fsx-lustre",
    short: "FSx for Lustre",
    service: "Amazon FSx for Lustre",
    icon: "fsxLustre",
    summary:
      "A parallel file system for HPC and ML that presents an S3 bucket as a POSIX file system at hundreds of GB/s.",
    why: [
      "Sub-millisecond latency, millions of IOPS, throughput scales with capacity.",
      "Lazy-loads from S3 and writes results back; scratch and persistent deployments.",
    ],
    watch: [
      "Lustre client required; not a general-purpose share.",
      "Persistent deployments are priced for performance, not for idle data; keep the durable copy in S3.",
    ],
    alternatives: [
      { label: "General shared storage: EFS", next: "efs-latency" },
    ],
  }),
  r({
    id: "fsx-ontap",
    short: "FSx for ONTAP",
    service: "Amazon FSx for NetApp ONTAP",
    icon: "fsxOntap",
    summary:
      "Managed ONTAP: NFS, SMB and iSCSI from one file system with snapshots, SnapMirror replication and tiering to a capacity pool.",
    why: [
      "Multi-protocol access to the same data; familiar tooling for ONTAP estates.",
      "Instant snapshots and clones, deduplication and compression, Multi-AZ.",
    ],
    watch: [
      "More knobs and a higher baseline price than EFS; worth it when the features are used.",
      "Provisioned SSD tier plus pay-per-use capacity pool: understand the tiering policy.",
    ],
    alternatives: [{ label: "Plain NFS: EFS", next: "efs-latency" }],
  }),

  r({
    id: "instance-store",
    short: "Instance store",
    service: "EC2 instance store (local NVMe)",
    icon: "instance",
    backend: "nvme",
    summary:
      "SSDs physically inside the host: the lowest latency and highest IOPS available, included in the instance price, gone when the instance stops.",
    why: [
      "Microsecond-class latency and up to millions of IOPS on storage-optimised (i-family) and *d* instance types.",
      "No separate charge; ideal for caches, scratch, shuffle data and databases that replicate across nodes.",
    ],
    watch: [
      "Data is lost on stop, terminate, hibernate or hardware failure; the application or a job must be able to rebuild it.",
      "On sizes below 4xlarge the SSD is burstable: the first run looks much faster than steady state.",
      "Capacity is fixed per instance type; want more, change instance.",
      "Pair with EBS or S3 for anything that must survive.",
    ],
    alternatives: [{ label: "Data must persist: EBS", next: "block-perf" }],
  }),
  r({
    id: "ebs-gp3",
    short: "EBS gp3",
    service: "Amazon EBS gp3",
    icon: "ebs",
    backend: "ebs",
    summary:
      "The default SSD volume: 3,000 IOPS and 125 MiB/s included, more provisioned independently of size.",
    why: [
      "About $0.08/GB-month; extra IOPS and throughput are priced separately, so you size each dial for the workload.",
      "Single-digit-millisecond latency, boot-capable, encrypted at rest, resizable online.",
      "Incremental snapshots to S3 for backup, cloning and cross-region copies.",
    ],
    watch: [
      "One AZ and one instance at a time; an AZ failure means restoring from a snapshot elsewhere.",
      "Annual failure rate 0.1–0.2 %: snapshot on a schedule (AWS Backup or Data Lifecycle Manager).",
      "The 125 MiB/s baseline caps sequential reads unless you raise it; volume modifications are limited to one per 6 hours.",
      "Sharing between servers needs a file system on top (EFS) or application-level replication.",
    ],
    alternatives: [
      {
        label: "Need extreme IOPS or 99.999 % durability: io2",
        next: "ebs-io2",
      },
      { label: "Many servers need it: EFS", next: "fs-protocol" },
    ],
  }),
  r({
    id: "ebs-io2",
    short: "EBS io2",
    service: "Amazon EBS io2 Block Express",
    icon: "ebs",
    summary:
      "Provisioned IOPS SSD with 99.999 % durability, sub-millisecond latency and up to 256,000 IOPS per volume.",
    why: [
      "Durability two orders of magnitude better than gp3; consistent latency under heavy load.",
      "Multi-Attach to up to 16 instances in one AZ for clustered databases.",
      "Up to 64 TiB and 4,000 MiB/s per volume.",
    ],
    watch: [
      "About $0.125/GB-month plus about $0.065 per provisioned IOPS-month (tiered); it is easy to pay many times gp3.",
      "Still a single AZ; durability is not availability.",
      "Multi-Attach needs a cluster-aware file system or the application coordinating writes.",
    ],
    alternatives: [
      { label: "gp3 is enough for most databases", next: "ebs-gp3" },
    ],
  }),
  r({
    id: "ebs-st1",
    short: "EBS st1",
    service: "Amazon EBS st1 (Throughput Optimized HDD)",
    icon: "ebs",
    summary:
      "Spinning disks tuned for large sequential I/O at about half the price of gp3.",
    why: [
      "About $0.045/GB-month; baseline 40 MiB/s per TiB bursting to 250 MiB/s per TiB, up to 500 MiB/s.",
      "Good for log processing, ETL staging, Kafka and data-warehouse scratch.",
    ],
    watch: [
      "Poor at random I/O and small files; cannot be a boot volume.",
      "Throughput scales with volume size, so small st1 volumes are slow.",
      "Minimum size 125 GiB.",
    ],
    alternatives: [{ label: "Random I/O too: gp3", next: "ebs-gp3" }],
  }),
  r({
    id: "ebs-sc1",
    short: "EBS sc1",
    service: "Amazon EBS sc1 (Cold HDD)",
    icon: "ebs",
    summary:
      "The cheapest block storage, for data that is read a few times a day sequentially.",
    why: [
      "About $0.015/GB-month; 12 MiB/s per TiB baseline, bursting to 80 MiB/s per TiB.",
    ],
    watch: [
      "Very slow for anything random or latency-sensitive; not bootable.",
      "If the data is rarely read, S3 (Standard-IA or Glacier classes) is usually cheaper and more durable.",
    ],
    alternatives: [
      { label: "Object access is acceptable: S3 classes", next: "s3-access" },
      { label: "More throughput: st1", next: "ebs-st1" },
    ],
  }),
  r({
    id: "ebs-multiattach",
    short: "EBS Multi-Attach",
    service: "Amazon EBS io1/io2 with Multi-Attach",
    icon: "ebs",
    summary:
      "One Provisioned IOPS volume attached to up to 16 Nitro instances in the same AZ.",
    why: [
      "Shared block access without a file server, for clustered databases and cluster-aware file systems (GFS2, OCFS2).",
      "io2 Block Express durability and latency.",
    ],
    watch: [
      "Standard file systems (ext4, xfs) will corrupt if mounted read-write by two instances; the cluster software must coordinate.",
      "Same AZ only; it does not replace replication or backups.",
      "For general file sharing this is the wrong tool: use EFS or FSx.",
    ],
    alternatives: [{ label: "General sharing: EFS", next: "fs-protocol" }],
  }),
];

export const NODE_BY_ID: Record<string, Node> = Object.fromEntries(
  NODES.map((n) => [n.id, n]),
);

/** The questions worth asking about any option, independent of the branch taken. */
export const CONSIDERATIONS: {
  topic: string;
  ask: string;
  s3: string;
  efs: string;
  ebs: string;
}[] = [
  {
    topic: "Semantics",
    ask: "Objects or files or blocks? In-place writes, locks, renames?",
    s3: "Immutable objects over HTTP; strong consistency; no partial writes.",
    efs: "Full POSIX over NFS 4.1; locks, permissions, in-place writes.",
    ebs: "Raw block device; whatever file system you format it with.",
  },
  {
    topic: "Sharing",
    ask: "How many readers and writers, from where?",
    s3: "Anything with credentials, anywhere; thousands of clients.",
    efs: "Thousands of instances, containers and Lambda functions in the VPC.",
    ebs: "One instance (Multi-Attach: up to 16 in one AZ with cluster software).",
  },
  {
    topic: "Durability and scope",
    ask: "What happens when a disk, an AZ or a region fails?",
    s3: "11 nines across ≥3 AZs; cross-region replication available.",
    efs: "11 nines across AZs (Regional); One Zone is single-AZ.",
    ebs: "99.8–99.9 % (gp3) or 99.999 % (io2) in one AZ; snapshots for everything else.",
  },
  {
    topic: "Latency",
    ask: "First byte and per-operation cost, not just bandwidth.",
    s3: "Tens of ms (single-digit with Express One Zone).",
    efs: "Sub-ms to low ms per operation; adds up on small files.",
    ebs: "Sub-ms to single-digit ms; local NVMe in microseconds.",
  },
  {
    topic: "Throughput and scaling",
    ask: "Per client or aggregate? Elastic or provisioned?",
    s3: "Unlimited aggregate; ~100 MB/s per connection, so parallelise.",
    efs: "Elastic to several GB/s, or provisioned; per-client limits.",
    ebs: "Provisioned per volume (125 MiB/s baseline on gp3) and capped by the instance.",
  },
  {
    topic: "Cost model",
    ask: "GB-month, plus what? Requests, retrieval, throughput, egress, minimums.",
    s3: "$0.023/GB (Standard) down to $0.001 (Deep Archive) + requests + retrieval + egress.",
    efs: "$0.30/GB Standard, $0.16 One Zone, $0.016 IA + per-GB throughput (Elastic).",
    ebs: "$0.08/GB gp3 + provisioned IOPS/throughput; st1 $0.045, sc1 $0.015; snapshots $0.05/GB.",
  },
  {
    topic: "Lifecycle and tiering",
    ask: "Does the data cool down? Who moves it?",
    s3: "Lifecycle rules and Intelligent-Tiering across eight classes.",
    efs: "Lifecycle to Infrequent Access and Archive after N days without access.",
    ebs: "None; you move data or change volume type (once per 6 h).",
  },
  {
    topic: "Backup and recovery",
    ask: "RPO, RTO, cross-region, immutability.",
    s3: "Versioning, replication, Object Lock; it is the backup target for the others.",
    efs: "AWS Backup (on by default for One Zone), replication to another region.",
    ebs: "Incremental snapshots to S3, Data Lifecycle Manager, Fast Snapshot Restore.",
  },
  {
    topic: "Security and access",
    ask: "Who authorises, where does traffic flow, encryption.",
    s3: "IAM + bucket policies + presigned URLs; Block Public Access; VPC endpoints; SSE by default.",
    efs: "POSIX permissions + IAM + access points; security groups on mount targets; TLS optional.",
    ebs: "Instance-level; encryption with KMS; no network exposure.",
  },
  {
    topic: "Limits worth knowing",
    ask: "Object, file and volume sizes; counts.",
    s3: "5 TB per object; unlimited objects; 3,500 PUT / 5,500 GET per second per prefix.",
    efs: "Petabyte-scale; tens of thousands of concurrent connections.",
    ebs: "Up to 64 TiB per volume; attachments limited by instance type.",
  },
];
