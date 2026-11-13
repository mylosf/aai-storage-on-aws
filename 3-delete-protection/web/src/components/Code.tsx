import type { ReactNode } from "react";

export function Code({ title, children, value }: { title?: ReactNode; children?: string; value?: unknown }) {
  const text = value !== undefined ? JSON.stringify(value, null, 2) : (children ?? "");
  return (
    <figure className="min-w-0 space-y-2">
      {title && <figcaption className="text-xs text-muted-foreground">{title}</figcaption>}
      <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed">{text}</pre>
    </figure>
  );
}

export function Q({ n, q, children }: { n: number; q: string; children: ReactNode }) {
  return (
    <div className="grid gap-4 border-t pt-8 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:gap-12">
      <div className="space-y-1">
        <div className="font-mono text-xs text-muted-foreground">Frage {n}</div>
        <h3 className="text-lg font-medium leading-snug">{q}</h3>
      </div>
      <div className="max-w-3xl space-y-4 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

export function Short({ children }: { children: ReactNode }) {
  return <p className="text-base font-medium">{children}</p>;
}
