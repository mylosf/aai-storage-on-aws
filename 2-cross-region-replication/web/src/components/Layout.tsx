import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export const ROLE = { source: "#111827", replica: "#2f6fe4", bureau: "#f7b531", frankfurt: "#94a3b8" } as const;

export function TabHeader({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-3xl space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {children && <div className="space-y-2 text-sm text-muted-foreground">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

export function SubHeader({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-t pt-8">
      <div className="max-w-3xl space-y-1">
        <h3 className="text-base font-medium">{title}</h3>
        {children && <div className="text-sm text-muted-foreground">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

export function Empty({ title, children, action, onAction, busy }: { title: string; children?: ReactNode; action?: string; onAction?: () => void; busy?: boolean }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed px-6 py-8">
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="max-w-2xl text-sm text-muted-foreground">{children}</div>}
      {action && onAction && (
        <Button onClick={onAction} disabled={busy}>
          {busy ? "Running…" : action}
        </Button>
      )}
    </div>
  );
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="min-w-40 space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tabular text-3xl font-semibold tracking-tight">{value}</div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

export function Chip({ children, tone = "replica", title }: { children: ReactNode; tone?: "replica" | "bureau" | "muted"; title?: string }) {
  const cls =
    tone === "replica"
      ? "border-[#2f6fe4]/30 bg-[#2f6fe4]/10 text-[#1f55b8]"
      : tone === "bureau"
        ? "border-[#f7b531]/50 bg-[#f7b531]/15 text-[#8a5a00]"
        : "border-border bg-muted text-muted-foreground";
  return (
    <span title={title} className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] leading-none ${cls}`}>
      {children}
    </span>
  );
}
