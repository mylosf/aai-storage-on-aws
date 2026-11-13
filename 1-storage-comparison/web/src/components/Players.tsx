import { useMemo, useRef, useState } from "react";
import { PlayerTile, type PlayerHandle } from "@/components/PlayerTile";
import { Button } from "@/components/ui/button";
import { BACKEND_ORDER, type Backend } from "@/types";

interface Props {
  backends: Backend[];
  onRefresh: () => void;
  frozen?: boolean;
}

export function Players({ backends, onRefresh, frozen }: Props) {
  const handles = useRef(new Map<string, PlayerHandle>());
  const [autoplay, setAutoplay] = useState(false);
  const [lastSeek, setLastSeek] = useState<number | null>(null);

  const visible = useMemo(
    () =>
      [...backends]
        .filter((b) => b.available)
        .sort((a, b) => BACKEND_ORDER.indexOf(a.id) - BACKEND_ORDER.indexOf(b.id)),
    [backends],
  );

  const each = (fn: (h: PlayerHandle) => void) => handles.current.forEach((h) => fn(h));

  return (
    <section className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-3xl space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">Side by side</h2>
          <p className="text-sm text-muted-foreground">
            Every tile plays the identical file set from a different storage service. Watch startup time, the
            per-segment first byte and the rebuffer count; hover any number for what it means. Expect one viewer to look
            fine everywhere: a single stream barely troubles any of these. The differences are in the benchmark and
            under load.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setAutoplay(true);
              each((h) => h.play());
            }}
          >
            Play all
          </Button>
          <Button variant="outline" onClick={() => each((h) => h.pause())}>
            Pause
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setAutoplay(true);
              setLastSeek(null);
              each((h) => h.restart());
            }}
          >
            Restart
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const f = 0.1 + Math.random() * 0.8;
              setLastSeek(f);
              each((h) => h.seek(f));
            }}
          >
            Seek all{lastSeek != null ? ` · ${Math.round(lastSeek * 100)} %` : ""}
          </Button>
          <Button variant="ghost" onClick={onRefresh} title="re-read /api/info">
            Refresh
          </Button>
        </div>
      </header>

      {frozen ? (
        <p className="max-w-2xl py-10 text-sm text-muted-foreground">
          The players stream from the live instance and bucket, which have been removed. During the workshop five
          tiles played the same film from the instance store, EBS, EFS, S3 and S3 + CloudFront side by side; the
          measured differences are preserved on the Benchmark, Viewers and Analysis tabs.
        </p>
      ) : visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No backends reported by the API.</p>
      ) : (
        <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {visible.map((b) => (
            <PlayerTile
              key={`${b.id}:${b.ready}`}
              backend={b}
              autoplay={autoplay}
              ref={(h) => {
                if (h) handles.current.set(b.id, h);
                else handles.current.delete(b.id);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
