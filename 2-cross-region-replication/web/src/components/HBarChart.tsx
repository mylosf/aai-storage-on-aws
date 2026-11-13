import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";

export interface HBarRow {
  key: string;
  label: string;
  value: number | null | undefined;
  color: string;
  /** dimmer fill: a second measurement of the same entity */
  muted?: boolean;
  note?: string;
}

interface Props {
  title: string;
  subtitle?: string;
  rows: HBarRow[];
  format: (v: number) => string;
  /** axis tick formatter; defaults to `format` */
  tickFormat?: (v: number) => string;
  /** vertical reference line at this x value, with a label */
  reference?: { value: number; label: string };
}

interface Datum extends HBarRow {
  plot: number;
  has: boolean;
}

const ROW_H = 34;
const NBSP = " ";
// SVG <text> wraps on spaces when the slot is narrow; keep each value on one line.
const oneLine = (s: string) => s.replace(/ /g, NBSP);

export function HBarChart({ title, subtitle, rows, format, tickFormat = format, reference }: Props) {
  const data: Datum[] = rows.map((r) => {
    const has = r.value != null && Number.isFinite(r.value);
    return { ...r, has, plot: has ? Math.max(0, r.value as number) : 0 };
  });
  const hasData = data.some((d) => d.has);
  const height = Math.max(96, data.length * ROW_H + 28);
  const config: ChartConfig = Object.fromEntries(rows.map((r) => [r.key, { label: r.label, color: r.color }]));

  return (
    <figure className="min-w-0">
      <figcaption className="mb-1">
        <div className="text-sm font-medium">{title}</div>
        {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
      </figcaption>
      {hasData ? (
        <ChartContainer config={config} className="aspect-auto w-full tabular" style={{ height }}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 96, bottom: 0, left: 0 }} barCategoryGap={8}>
            <CartesianGrid horizontal={false} />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tickCount={4}
              fontSize={11}
              tickFormatter={(v: number) => (v === 0 ? "0" : oneLine(tickFormat(v)))}
            />
            <YAxis type="category" dataKey="label" width={118} tickLine={false} axisLine={false} fontSize={12} />
            <ChartTooltip
              cursor={{ fill: "var(--muted)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]?.payload as Datum | undefined;
                if (!p) return null;
                return (
                  <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-sm">
                    <div className="flex items-center gap-2 font-medium">
                      <span className="size-2 rounded-full" style={{ background: p.color }} />
                      {p.label}
                    </div>
                    <div className="mt-0.5 text-muted-foreground">{p.has ? format(p.value as number) : "no data"}</div>
                    {p.note && <div className="text-muted-foreground">{p.note}</div>}
                  </div>
                );
              }}
            />
            {reference && (
              <ReferenceLine
                x={reference.value}
                stroke="var(--foreground)"
                strokeDasharray="3 3"
                label={{ value: reference.label, position: "insideTopRight", fontSize: 11, fill: "var(--muted-foreground)" }}
              />
            )}
            <Bar dataKey="plot" barSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.key} fill={d.color} fillOpacity={d.muted ? 0.4 : 1} />
              ))}
              <LabelList
                dataKey="plot"
                content={(props) => {
                  const { x, y, width, height: h, index } = props as {
                    x?: number | string;
                    y?: number | string;
                    width?: number | string;
                    height?: number | string;
                    index?: number;
                  };
                  const d = index != null ? data[index] : undefined;
                  if (!d || x == null || y == null) return null;
                  const tx = Number(x) + Number(width ?? 0) + 8;
                  const ty = Number(y) + Number(h ?? 18) / 2;
                  return (
                    <text
                      x={tx}
                      y={ty}
                      dy="0.35em"
                      fontSize={12}
                      fill={d.has ? "var(--foreground)" : "var(--muted-foreground)"}
                      fontStyle={d.has ? undefined : "italic"}
                    >
                      {d.has ? oneLine(format(d.value as number)) : oneLine(d.note ?? "no data")}
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      ) : (
        <p className="py-6 text-sm text-muted-foreground">No data.</p>
      )}
    </figure>
  );
}
