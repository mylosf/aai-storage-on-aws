import { ChevronRightIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { METRIC_GROUPS, type MetricGroup } from "@/metrics";

/** Compact "how these are measured" block for a results section. */
export function Explainer({ group, only }: { group: MetricGroup["id"]; only?: string[] }) {
  const g = METRIC_GROUPS.find((x) => x.id === group);
  if (!g) return null;
  const items = only ? g.metrics.filter((m) => only.includes(m.id)) : g.metrics;
  return (
    <Collapsible className="group border-y py-3">
      <CollapsibleTrigger className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ChevronRightIcon className="size-4 transition-transform group-data-[state=open]:rotate-90" />
        How these are measured
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pt-4">
        <p className="max-w-3xl text-sm text-muted-foreground">{g.intro}</p>
        <dl className="grid gap-x-10 gap-y-3 text-sm md:grid-cols-2">
          {items.map((m) => (
            <div key={m.id}>
              <dt className="font-medium">{m.name}</dt>
              <dd className="text-muted-foreground">
                {m.what} <span className="opacity-80">{m.how}</span>
              </dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}
