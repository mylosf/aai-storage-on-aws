import Hls, { type ErrorData, type FragLoadedData, type LevelSwitchedData } from "hls.js";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { InfoIcon } from "lucide-react";
import { Dot } from "@/components/Dot";
import { PathDiagram } from "@/components/PathDiagram";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtMbps, fmtMs, median } from "@/format";
import { hint } from "@/metrics";
import { methodOf } from "@/paths";
import type { Backend } from "@/types";

export interface PlayerHandle {
  play: () => void;
  pause: () => void;
  restart: () => void;
  seek: (fraction: number) => void;
}

interface Segment {
  ttfbMs: number;
  downloadMs: number;
  totalMs: number;
  bytes: number;
  bitsPerSec: number;
}

interface TileStats {
  startupMs: number | null;
  seekMs: number | null;
  rendition: string;
  bandwidth: number | null;
  last: Segment | null;
  fetchMs: number[];
  rebuffers: number;
  segments: number;
  error: string | null;
  state: "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error";
}

const initialStats = (): TileStats => ({
  startupMs: null,
  seekMs: null,
  rendition: "—",
  bandwidth: null,
  last: null,
  fetchMs: [],
  rebuffers: 0,
  segments: 0,
  error: null,
  state: "idle",
});

interface Props {
  backend: Backend;
  autoplay: boolean;
}

export const PlayerTile = forwardRef<PlayerHandle, Props>(function PlayerTile({ backend, autoplay }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [stats, setStats] = useState<TileStats>(initialStats);
  const [generation, setGeneration] = useState(0);
  const startAt = useRef<number | null>(null);
  const seekAt = useRef<number | null>(null);
  const seekWasPlaying = useRef(false);
  const started = useRef(false);

  const patch = useCallback((p: Partial<TileStats> | ((s: TileStats) => Partial<TileStats>)) => {
    setStats((s) => ({ ...s, ...(typeof p === "function" ? p(s) : p) }));
  }, []);

  // (Re)create the player whenever `generation` changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !backend.ready) return;

    setStats(initialStats());
    started.current = false;
    startAt.current = performance.now();
    patch({ state: "loading" });

    // Cache-bust the master playlist so a restart really re-fetches it (the
    // CloudFront edge ignores the query string, the browser cache does not).
    const src = `${backend.master}${backend.master.includes("?") ? "&" : "?"}r=${Date.now()}`;

    const onPlaying = () => {
      if (!started.current) {
        started.current = true;
        patch({ startupMs: performance.now() - (startAt.current ?? performance.now()), state: "playing" });
      } else {
        patch({ state: "playing" });
      }
      if (seekAt.current != null && seekWasPlaying.current) {
        patch({ seekMs: performance.now() - seekAt.current });
        seekAt.current = null;
      }
    };
    const onSeeked = () => {
      if (seekAt.current != null && !seekWasPlaying.current) {
        patch({ seekMs: performance.now() - seekAt.current });
        seekAt.current = null;
      }
    };
    const onPause = () => patch((s) => (s.state === "playing" ? { state: "paused" } : {}));
    const onEnded = () => patch({ state: "ended" });

    video.addEventListener("playing", onPlaying);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);

    let hls: Hls | null = null;
    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 20,
        startLevel: -1,
        abrEwmaDefaultEstimate: 5_000_000,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.FRAG_LOADED, (_e, data: FragLoadedData) => {
        const st = data.frag.stats;
        const ttfbMs = st.loading.first - st.loading.start;
        const downloadMs = st.loading.end - st.loading.first;
        const totalMs = st.loading.end - st.loading.start;
        const bytes = st.loaded;
        const seg: Segment = {
          ttfbMs,
          downloadMs,
          totalMs,
          bytes,
          bitsPerSec: totalMs > 0 ? (bytes * 8) / (totalMs / 1000) : 0,
        };
        patch((s) => ({
          last: seg,
          segments: s.segments + 1,
          fetchMs: [...s.fetchMs.slice(-29), totalMs],
          bandwidth: hls?.bandwidthEstimate ?? s.bandwidth,
        }));
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data: LevelSwitchedData) => {
        const lvl = hls?.levels[data.level];
        if (lvl) patch({ rendition: `${lvl.height ? `${lvl.height}p · ` : ""}${(lvl.bitrate / 1e6).toFixed(1)} Mbit/s` });
      });

      hls.on(Hls.Events.ERROR, (_e, data: ErrorData) => {
        if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
          patch((s) => ({ rebuffers: s.rebuffers + 1 }));
          return;
        }
        if (data.fatal) {
          patch({ state: "error", error: `${data.type}: ${data.details}${data.response?.code ? ` (HTTP ${data.response.code})` : ""}` });
        }
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!autoplay) patch((s) => (s.state === "loading" ? { state: "ready" } : {}));
      });

      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls?.loadSource(src));
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari: native HLS, no per-segment stats.
      video.src = src;
      patch({ rendition: "native HLS (no segment stats)" });
    } else {
      patch({ state: "error", error: "HLS not supported in this browser" });
    }

    if (autoplay) {
      video.play().catch(() => {
        /* autoplay blocked: the Play button handles it */
      });
    }

    return () => {
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      hls?.destroy();
      hlsRef.current = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [generation, backend.master, backend.ready, autoplay, patch]);

  useImperativeHandle(
    ref,
    () => ({
      play: () => {
        const v = videoRef.current;
        if (!v) return;
        if (!started.current) startAt.current = performance.now();
        v.play().catch((err: Error) => patch({ error: err.message }));
      },
      pause: () => videoRef.current?.pause(),
      restart: () => setGeneration((g) => g + 1),
      seek: (fraction: number) => {
        const v = videoRef.current;
        if (!v || !Number.isFinite(v.duration)) return;
        seekWasPlaying.current = !v.paused;
        seekAt.current = performance.now();
        patch({ seekMs: null });
        v.currentTime = Math.max(0, Math.min(v.duration - 1, v.duration * fraction));
      },
    }),
    [patch],
  );

  const med = median(stats.fetchMs);

  const method = methodOf(backend.id);

  const Stat = ({ id, label, value, bad }: { id: string; label: string; value: string; bad?: boolean }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="min-w-0 cursor-default">
          <div className="truncate text-xs text-muted-foreground">{label}</div>
          <div className={`tabular truncate text-sm ${bad ? "text-destructive" : ""}`}>{value}</div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72 text-xs">
        {hint(id)}
      </TooltipContent>
    </Tooltip>
  );

  const details: [string, string, string][] = [
    ["seek", "seek", fmtMs(stats.seekMs)],
    ["rendition", "rendition", stats.rendition],
    ["seg-download", "segment download", fmtMs(stats.last?.downloadMs)],
    ["median-fetch", "median fetch", fmtMs(med)],
    ["bandwidth", "bandwidth estimate", fmtMbps(stats.bandwidth)],
    ["segments", "segments loaded", String(stats.segments)],
  ];

  const stateTone =
    stats.state === "playing"
      ? "text-emerald-600"
      : stats.state === "error"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <article className="flex min-w-0 flex-col gap-3">
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <Dot id={backend.id} />
          <span className="truncate">{backend.label}</span>
        </h3>
        <Badge variant="outline" className={`h-5 border-transparent px-1 font-normal ${stateTone}`}>
          {stats.state}
        </Badge>
      </header>

      {method ? (
        <PathDiagram id={backend.id} nodes={method.path} compact className="min-h-[52px] content-start" />
      ) : (
        <p className="truncate text-xs text-muted-foreground" title={backend.path}>
          {backend.path}
        </p>
      )}

      {backend.ready ? (
        <div className="aspect-video overflow-hidden rounded-md bg-black">
          <video ref={videoRef} muted playsInline preload="auto" controls={false} className="block h-full w-full object-contain" />
        </div>
      ) : (
        <div className="flex aspect-video flex-col items-center justify-center rounded-md bg-muted text-center text-xs text-muted-foreground">
          <span className="font-medium text-foreground">content not synced</span>
          <span>Admin → Sync content</span>
        </div>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex cursor-default items-baseline justify-between border-b pb-2">
            <span className="text-xs text-muted-foreground">startup</span>
            <span className={`tabular text-2xl font-semibold tracking-tight ${stats.startupMs == null ? "text-muted-foreground" : ""}`}>
              {stats.startupMs == null ? "…" : fmtMs(stats.startupMs)}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-72 text-xs">
          {hint("startup")}
        </TooltipContent>
      </Tooltip>

      <div className="grid grid-cols-3 gap-x-3">
        <Stat id="seg-ttfb" label="first byte" value={fmtMs(stats.last?.ttfbMs)} />
        <Stat id="seg-throughput" label="throughput" value={fmtMbps(stats.last?.bitsPerSec)} />
        <Stat id="rebuffers" label="rebuffers" value={String(stats.rebuffers)} bad={stats.rebuffers > 0} />
      </div>

      <HoverCard openDelay={100}>
        <HoverCardTrigger asChild>
          <button type="button" className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <InfoIcon className="size-3.5" />
            details
          </button>
        </HoverCardTrigger>
        <HoverCardContent align="start" className="w-64 p-3">
          <dl className="space-y-1.5 text-xs">
            {details.map(([id, label, value]) => (
              <div key={id} className="flex justify-between gap-3" title={hint(id)}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular truncate">{value}</dd>
              </div>
            ))}
          </dl>
        </HoverCardContent>
      </HoverCard>

      {stats.error && <p className="break-words font-mono text-xs text-destructive">{stats.error}</p>}
    </article>
  );
});
