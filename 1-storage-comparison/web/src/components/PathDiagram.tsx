import { cn } from "cn";
import { AWS_ICON, AWS_ICON_TITLE } from "@/assets/aws";
import { Dot } from "@/components/Dot";
import type { PathNode } from "@/paths";

interface Props {
  id: string;
  nodes: PathNode[];
  /** compact: icons only (hover for the name), for player tiles */
  compact?: boolean;
  className?: string;
}

function Arrow({ compact }: { compact?: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 28 10"
      className={cn("shrink-0 fill-none stroke-muted-foreground/60", compact ? "mx-1 w-4" : "mx-3 mt-[17px] w-7")}
      style={{ strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" }}
    >
      <line x1="0" y1="5" x2="22" y2="5" />
      <polyline points="18,1 23,5 18,9" />
    </svg>
  );
}

/** Browser → … → storage, drawn with the official AWS Architecture Icons. */
export function PathDiagram({ id, nodes, compact, className }: Props) {
  if (compact) {
    return (
      <ol className={cn("flex items-center", className)}>
        {nodes.map((n, i) => (
          <li key={i} className="flex items-center">
            <img
              src={AWS_ICON[n.icon]}
              alt={n.label}
              title={`${n.label}${n.sub ? ` — ${n.sub}` : ""} (${AWS_ICON_TITLE[n.icon]})`}
              className="size-6"
              draggable={false}
            />
            {i < nodes.length - 1 && <Arrow compact />}
          </li>
        ))}
      </ol>
    );
  }

  return (
    <ol className={cn("flex flex-wrap items-start", className)}>
      {nodes.map((n, i) => (
        <li key={i} className="flex items-start">
          <figure className="flex w-28 flex-col items-center text-center">
            <img src={AWS_ICON[n.icon]} alt="" title={AWS_ICON_TITLE[n.icon]} className="size-11" draggable={false} />
            <figcaption className="mt-1.5 leading-tight">
              <span className={cn("flex items-center justify-center gap-1.5 text-sm", n.kind === "storage" && "font-medium")}>
                {n.kind === "storage" && <Dot id={id} />}
                {n.label}
              </span>
              {n.sub && <span className="mt-0.5 block text-xs text-muted-foreground">{n.sub}</span>}
            </figcaption>
          </figure>
          {i < nodes.length - 1 && <Arrow />}
        </li>
      ))}
    </ol>
  );
}
