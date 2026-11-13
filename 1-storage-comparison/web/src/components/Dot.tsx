import { cn } from "cn";
import { colorVar } from "@/palette";

/** The only place a backend colour appears outside bars and storage nodes. */
export function Dot({ id, className }: { id: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ background: colorVar(id) }}
    />
  );
}
