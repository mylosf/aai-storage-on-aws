import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "cn";
import { Maximize2, Minimize2, Scan, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  /** content size in SVG units; the view fits it on mount and on "fit" */
  width: number;
  height: number;
  children: ReactNode;
  className?: string;
  legend?: ReactNode;
  grid?: boolean;
}

/** Pan / zoom / fullscreen SVG canvas, same interaction as the decision map in the storage demo. */
export function Canvas({ width, height, children, className, legend, grid = true }: Props) {
  const outer = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const [dragging, setDragging] = useState(false);
  const [full, setFull] = useState(false);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const PAD = 24;

  const fit = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const k = Math.max(0.1, Math.min((W - PAD * 2) / width, (H - PAD * 2) / height));
    setView({ k, tx: (W - width * k) / 2, ty: (H - height * k) / 2 });
  }, [width, height]);

  useEffect(() => {
    fit();
    const ro = new ResizeObserver(() => fit());
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [fit]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === outer.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const zoomAt = (f: number, px: number, py: number) =>
    setView((v) => {
      const k = Math.min(12, Math.max(0.1, v.k * f));
      const r = k / v.k;
      return { k, tx: px - (px - v.tx) * r, ty: py - (py - v.ty) * r };
    });
  const zoomCenter = (f: number) => {
    const el = wrap.current;
    if (el) zoomAt(f, el.clientWidth / 2, el.clientHeight / 2);
  };

  return (
    <div ref={outer} className={cn("relative overflow-hidden rounded-xl border bg-white", full && "rounded-none border-0", className)}>
      <div
        ref={wrap}
        className={cn("h-full w-full touch-none select-none", dragging ? "cursor-grabbing" : "cursor-grab")}
        onWheel={(e) => {
          e.preventDefault();
          const r = wrap.current!.getBoundingClientRect();
          zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setView((v) => ({ ...v, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) }));
        }}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
      >
        <svg className="h-full w-full">
          <defs>
            <pattern id="cv-grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="1.2" cy="1.2" r="1.2" fill="#e6e9ef" />
            </pattern>
          </defs>
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`} style={{ transition: dragging ? "none" : "transform 200ms ease-out" }}>
            {grid && <rect x={-20000} y={-20000} width={40000} height={40000} fill="url(#cv-grid)" />}
            {children}
          </g>
        </svg>
      </div>

      <div className="absolute right-3 top-3 flex items-center gap-0.5 rounded-lg border bg-white/95 p-1 shadow-sm">
        <Tool label="Zoom in" onClick={() => zoomCenter(1.3)}>
          <ZoomIn className="size-4" />
        </Tool>
        <Tool label="Zoom out" onClick={() => zoomCenter(0.77)}>
          <ZoomOut className="size-4" />
        </Tool>
        <Tool label="Fit" onClick={fit}>
          <Scan className="size-4" />
        </Tool>
        <span className="mx-1 h-5 w-px bg-border" />
        <Tool
          label={full ? "Exit full screen (Esc)" : "Full screen"}
          onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void outer.current?.requestFullscreen?.())}
        >
          {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </Tool>
      </div>
      {legend && (
        <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-white/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
          {legend}
        </div>
      )}
    </div>
  );
}

function Tool({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
