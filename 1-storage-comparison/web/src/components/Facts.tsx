import { Badge } from "@/components/ui/badge";
import { Dot } from "@/components/Dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FACTS, PRICE_DISCLAIMER } from "@/facts";
import type { Backend } from "@/types";

const ROWS: { key: keyof (typeof FACTS)[number]; label: string }[] = [
  { key: "what", label: "What it is" },
  { key: "scope", label: "Scope" },
  { key: "durability", label: "Durability" },
  { key: "scaling", label: "Scaling model" },
  { key: "latencyClass", label: "Typical first byte" },
  { key: "price", label: "Price" },
  { key: "goodFor", label: "Good for" },
  { key: "notFor", label: "Not for" },
];

export function Facts({ backends }: { backends: Backend[] }) {
  const deployed = new Set(backends.filter((b) => b.available).map((b) => b.id));
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-base font-medium">What you are actually choosing between</h3>
        <p className="max-w-3xl text-sm text-muted-foreground">
          The measurements say how fast; this says what each one is for. Prices are {PRICE_DISCLAIMER}.
        </p>
      </div>
      <div className="overflow-x-auto">
        <Table className="min-w-[1080px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-36" />
              {FACTS.map((f) => (
                <TableHead key={f.id} className="align-bottom text-foreground">
                  <span className="flex items-center gap-2 whitespace-normal">
                    <Dot id={f.id} />
                    {f.name}
                    {!deployed.has(f.id) && (
                      <Badge variant="outline" className="font-normal text-muted-foreground">
                        not deployed
                      </Badge>
                    )}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROWS.map((r) => (
              <TableRow key={r.key} className="hover:bg-transparent">
                <TableHead className="h-auto whitespace-normal py-3 align-top text-xs text-muted-foreground">
                  {r.label}
                </TableHead>
                {FACTS.map((f) => (
                  <TableCell key={f.id} className="whitespace-normal py-3 align-top text-sm leading-relaxed text-muted-foreground">
                    {f[r.key]}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
