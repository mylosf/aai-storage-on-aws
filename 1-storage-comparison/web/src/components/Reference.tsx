import { Facts } from "@/components/Facts";
import { Separator } from "@/components/ui/separator";
import { METRIC_GROUPS } from "@/metrics";
import type { Backend } from "@/types";

/** Every metric on the page, explained, followed by the static comparison table. */
export function Reference({ backends }: { backends: Backend[] }) {
  return (
    <section className="space-y-10">
      <header className="max-w-3xl space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">What the numbers mean</h2>
        <p className="text-sm text-muted-foreground">
          Each metric: what it tells you, how this page measures it, and how to read it. The same text appears when you
          hover a value elsewhere.
        </p>
      </header>

      {METRIC_GROUPS.map((g) => (
        <div key={g.id} className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-base font-medium">{g.title}</h3>
            <p className="max-w-3xl text-sm text-muted-foreground">{g.intro}</p>
          </div>
          <dl className="divide-y border-t">
            {g.metrics.map((m) => (
              <div key={m.id} className="grid gap-2 py-4 md:grid-cols-[200px_minmax(0,1fr)] md:gap-10">
                <dt>
                  <div className="text-sm font-medium">{m.name}</div>
                  {m.unit && <div className="font-mono text-xs text-muted-foreground">{m.unit}</div>}
                </dt>
                <dd className="max-w-3xl space-y-1 text-sm">
                  <p>{m.what}</p>
                  <p className="text-muted-foreground">
                    <span className="mr-2 inline-block w-20 text-xs">Measured</span>
                    {m.how}
                  </p>
                  <p className="text-muted-foreground">
                    <span className="mr-2 inline-block w-20 text-xs">Reading it</span>
                    {m.read}
                  </p>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}

      <Separator />
      <Facts backends={backends} />
    </section>
  );
}
