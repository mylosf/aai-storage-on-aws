import { Badge } from "@/components/ui/badge";
import { Dot } from "@/components/Dot";
import { PathDiagram } from "@/components/PathDiagram";
import { SystemDiagram } from "@/components/SystemDiagram";
import { METHODS } from "@/paths";
import type { Backend, Info } from "@/types";

interface Props {
  info: Info | null;
  backends: Backend[];
}

export function Overview({ info, backends }: Props) {
  const state = new Map(backends.map((b) => [b.id, b]));

  return (
    <section className="space-y-10">
      <header className="max-w-3xl space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">One film, five places to keep it</h2>
        <p className="text-sm text-muted-foreground">
          Big Buck Bunny, cut into 4-second HLS segments, copied byte-for-byte onto five AWS storage services. The same
          player plays all five; the only variable is where the bytes live and how they travel. One CloudFront URL is the
          front door for everything, so the browser never sees a difference in protocol or certificate.
        </p>
      </header>

      <figure className="space-y-2">
        <SystemDiagram />
        <figcaption className="text-xs text-muted-foreground">
          Everything runs in {info?.region ?? "one region"}
          {info?.instance.az ? `, the origin in ${info.instance.az}` : ""}. The EC2 paths are routed through CloudFront
          with caching disabled, so every backend has the same TLS edge in front of it.
        </figcaption>
      </figure>

      <div>
        <h3 className="mb-2 text-base font-medium">The five methods</h3>
        <ol className="divide-y border-t">
          {METHODS.map((m) => {
            const b = state.get(m.id);
            const off = b && !b.available;
            return (
              <li key={m.id} className={off ? "py-6 opacity-50" : "py-6"}>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-12">
                  <div className="space-y-2">
                    <h4 className="flex items-center gap-2.5 text-base font-medium">
                      <Dot id={m.id} />
                      {m.title}
                      {off && (
                        <Badge variant="outline" className="font-normal text-muted-foreground">
                          not on this instance
                        </Badge>
                      )}
                    </h4>
                    <p className="text-sm">{m.what}</p>
                    <p className="text-sm text-muted-foreground">{m.teaches}</p>
                  </div>
                  <div className="flex items-start lg:items-center">
                    <PathDiagram id={m.id} nodes={m.path} />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
