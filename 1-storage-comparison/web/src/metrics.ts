// Every number the page shows, explained once. Used by the Reference page and as
// hover text next to the values.

export interface Metric {
  id: string;
  name: string;
  unit: string;
  /** what the number means, plainly */
  what: string;
  /** how it is measured here */
  how: string;
  /** how to read it: what good looks like, what moves it */
  read: string;
}

export interface MetricGroup {
  id: "players" | "bench" | "load" | "stats";
  title: string;
  intro: string;
  metrics: Metric[];
}

export const METRIC_GROUPS: MetricGroup[] = [
  {
    id: "players",
    title: "Player tiles",
    intro:
      "Measured in your browser by the player itself, so they include your network. Useful for feel and for comparing tiles against each other, not as absolute storage numbers.",
    metrics: [
      {
        id: "startup",
        name: "Startup",
        unit: "ms",
        what: "How long a viewer waits between pressing play and seeing the first frame.",
        how: "From the moment the player is told to load until the video element fires its first playing event. Includes fetching the master playlist, one rendition playlist and the first segments.",
        read: "Dominated by round trips, not bandwidth: every hop between the browser and the bytes adds its latency. Lower is better; a few hundred milliseconds is good.",
      },
      {
        id: "seek",
        name: "Seek",
        unit: "ms",
        what: "How long the video takes to resume after jumping to a new position.",
        how: "Seek all moves every tile to the same random position; the timer runs until the player is playing again. The playlists are already known, so this isolates fetching an unseen segment.",
        read: "Like startup without the playlist cost. A storage system with slow first byte shows it here.",
      },
      {
        id: "rendition",
        name: "Rendition",
        unit: "quality",
        what: "Which of the three encodings (360p, 720p, 1080p) the player is currently showing.",
        how: "Chosen automatically by hls.js from its bandwidth estimate (adaptive bitrate).",
        read: "A slow backend does not always stall; often it quietly drops to 360p. A quality drop is a performance problem in disguise.",
      },
      {
        id: "seg-ttfb",
        name: "Segment first byte",
        unit: "ms",
        what: "How long after asking for a 4-second segment the first byte arrives.",
        how: "hls.js timing for the most recent segment: request sent to first byte received.",
        read: "Pure latency; how far away the storage is in round trips. Edge cache hits are the lowest, S3 direct the highest.",
      },
      {
        id: "seg-download",
        name: "Segment download",
        unit: "ms",
        what: "How long the rest of the segment takes to arrive after the first byte.",
        how: "First byte to last byte of the most recent segment.",
        read: "Bandwidth, not latency. Mostly limited by your connection, so tiles should look similar here.",
      },
      {
        id: "seg-throughput",
        name: "Segment throughput",
        unit: "Mbit/s",
        what: "The effective speed at which the last segment arrived.",
        how: "Segment size divided by total fetch time.",
        read: "Must stay above the rendition's bitrate (about 0.8, 2.8 and 5 Mbit/s) or the buffer drains and playback stalls.",
      },
      {
        id: "median-fetch",
        name: "Median fetch",
        unit: "ms",
        what: "The typical total time to fetch a segment on this tile.",
        how: "Median of request-to-last-byte over the last 30 segments.",
        read: "A smoothed view of first byte plus download, less jumpy than the per-segment numbers.",
      },
      {
        id: "bandwidth",
        name: "Bandwidth estimate",
        unit: "Mbit/s",
        what: "What the player believes the connection can sustain.",
        how: "hls.js's exponentially weighted estimate from recent segment downloads.",
        read: "This number drives the rendition choice. If it sits below 5 Mbit/s, the tile will not reach 1080p.",
      },
      {
        id: "rebuffers",
        name: "Rebuffers",
        unit: "count",
        what: "How many times playback froze because the next segment was not there in time.",
        how: "Count of buffer-stalled events reported by hls.js while playing.",
        read: "The one metric a viewer actually notices. It should be zero.",
      },
    ],
  },
  {
    id: "bench",
    title: "Storage benchmark",
    intro:
      "Runs on the EC2 instance itself, reading the same files from each backend with the Linux page cache dropped first, so it measures the storage and not RAM or the room's wifi. S3 is read from the instance over the VPC endpoint. S3 + CloudFront is not a storage system but the path a viewer takes, so it is fetched over HTTPS through the distribution after an untimed warm-up: its numbers are edge cache hits from inside the region (the first viewer in each city pays the origin fetch instead).",
    metrics: [
      {
        id: "ttfb",
        name: "First byte",
        unit: "ms",
        what: "How long the storage takes to start answering at all.",
        how: "Open a 300 KB segment file and read the first 64 KiB with a cold cache; time until those bytes are in memory. For S3, a GET and the time to the first chunk of the body.",
        read: "Local and block storage: around a millisecond. EFS: a few milliseconds of NFS round trips. S3: tens of milliseconds for an HTTP request to a web service.",
      },
      {
        id: "seq",
        name: "Sequential read",
        unit: "MiB/s",
        what: "How fast one stream can pull a large file.",
        how: "Read the first 256 MiB of the 700 MB MP4 in 4 MiB chunks; bytes divided by time. S3: a single ranged GET of the same bytes.",
        read: "Hits the storage's throughput ceiling: gp3 is capped at 125 MiB/s unless you pay for more, a single S3 connection at roughly 90 to 100 MiB/s, EFS Elastic several hundred.",
      },
      {
        id: "parallel",
        name: "Parallel read (S3)",
        unit: "MiB/s",
        what: "The same bytes fetched as eight simultaneous range requests.",
        how: "The 256 MiB split into eight ranged GETs issued at once; total bytes divided by wall time.",
        read: "S3 throughput scales with connections, not per connection. Every fast S3 client (the CLI, Mountpoint, SDK transfer managers) does exactly this.",
      },
      {
        id: "random",
        name: "Random 1 MiB read",
        unit: "ms (p50, p95)",
        what: "How long it takes to grab one megabyte from an arbitrary place in a big file.",
        how: "40 reads of 1 MiB at random offsets in the MP4, cold cache; median and 95th percentile. S3: ranged GETs.",
        read: "A viewer skipping ahead, or a database reading a page. It is latency plus the time to move 1 MiB, so on EBS at 125 MiB/s about 8 of the 11 ms is simply transfer.",
      },
      {
        id: "smallfile",
        name: "Small file",
        unit: "ms per file",
        what: "The cost of touching one more file.",
        how: "Open 50 segment files in turn and read 4 KiB from each, cold cache; time per file. S3: a 4 KiB ranged GET per object.",
        read: "One storage round trip per file: sub-millisecond on a disk, about 2 ms on NFS, about 25 ms on S3. This is why many small files are the classic storage killer and why big-file formats exist.",
      },
      {
        id: "cold",
        name: "Cold cache",
        unit: "flag",
        what: "Whether the operating system's file cache was emptied before each test.",
        how: "sync and echo 3 to /proc/sys/vm/drop_caches before every file-system test. Not applicable to S3.",
        read: "Linux keeps recently read files in RAM; without dropping it the second run would measure memory and every backend would look identical. If this is false, distrust the file-system numbers.",
      },
    ],
  },
  {
    id: "load",
    title: "Concurrent viewers",
    intro:
      "k6 on a second instance plays the film as N simultaneous viewers per backend, one backend after another. Each viewer fetches a segment, then waits out the remainder of its 4 seconds before the next, like a real player. Requests travel the same path a browser's would, through CloudFront.",
    metrics: [
      {
        id: "vus",
        name: "Viewers",
        unit: "count",
        what: "How many players are watching at the same time.",
        how: "k6 virtual users, each running the fetch-then-wait loop for the chosen duration. 200 viewers really means 200 concurrent streams, not 200 download loops.",
        read: "Raise it until something bends. The load generator sits in the same region as the origin, so its latencies are optimistic; compare backends against each other, not against your home connection.",
      },
      {
        id: "load-ttfb",
        name: "Segment first byte under load",
        unit: "ms (p50, p95)",
        what: "How quickly segments start arriving while many viewers are pulling at once.",
        how: "k6's time-to-first-byte per request, median and 95th percentile over the run.",
        read: "If p95 climbs as viewers are added, the backend is queueing. Note that the first run after a deploy sees CloudFront cache misses; run it twice.",
      },
      {
        id: "fetch",
        name: "Segment fetch time",
        unit: "ms (p95)",
        what: "How long a whole segment takes to arrive at the slow end of the distribution.",
        how: "Request to last byte per segment; the 95th percentile, drawn against the 4-second segment length.",
        read: "A fetch longer than the segment itself means the player ran out of buffer. The reference line is the cliff.",
      },
      {
        id: "stall",
        name: "Stall rate",
        unit: "%",
        what: "What share of segment fetches would have frozen the picture.",
        how: "Fraction of fetches that took longer than the segment duration.",
        read: "Zero is the goal. Anything above a percent is visible to the audience.",
      },
      {
        id: "errors",
        name: "Error rate",
        unit: "%",
        what: "How often the request failed outright.",
        how: "Fraction of responses that were not HTTP 200 or 206.",
        read: "Non-zero means the server or storage refused or timed out, the hard failure mode behind the soft one above.",
      },
      {
        id: "volume",
        name: "Requests and bytes",
        unit: "count, bytes",
        what: "How much was actually served per backend during the run.",
        how: "Totals from k6 for each backend's scenario.",
        read: "A sanity check that every backend did comparable work; with paced viewers the totals should be close.",
      },
    ],
  },
  {
    id: "stats",
    title: "Reading percentiles",
    intro: "Most charts show two numbers per backend.",
    metrics: [
      {
        id: "p50",
        name: "p50 (median)",
        unit: "",
        what: "The typical experience: half of all requests were faster, half slower.",
        how: "Middle value of the sorted samples.",
        read: "Use it to compare backends under normal conditions.",
      },
      {
        id: "p95",
        name: "p95",
        unit: "",
        what: "The slow tail: one request in twenty was at least this slow.",
        how: "95th percentile of the sorted samples.",
        read: "Video cares about the tail more than the median: a single slow segment is a stall. S3 has a notably fatter tail than block storage.",
      },
    ],
  },
];

export const metricByName: Record<string, Metric> = Object.fromEntries(
  METRIC_GROUPS.flatMap((g) => g.metrics.map((m) => [m.id, m])),
);

/** Short hover text for a value label. */
export const hint = (id: string): string | undefined => {
  const m = metricByName[id];
  return m ? `${m.what} ${m.read}` : undefined;
};
