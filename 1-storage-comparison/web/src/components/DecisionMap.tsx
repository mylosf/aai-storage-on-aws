import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import { Home, Maximize2, Minimize2, Scan, ZoomIn, ZoomOut } from "lucide-react";
import { AWS_ICON } from "@/assets/aws";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NODE_BY_ID, ROOT, type Node, type Option } from "@/decision";

// ----------------------------------------------------------------- layout
const Q_W = 184;
const Q_H = 54;
const R_W = 176;
const R_H = 50;
const REF_W = 176;
const REF_H = 40;
const GAP_X = 34;
const LEVEL_H = 150;
const CORNER = 10;

interface LNode {
  key: string;
  id: string;
  node: Node;
  /** reference to a question drawn elsewhere */
  ref?: boolean;
  children: { edge: Option; child: LNode }[];
  w: number;
  h: number;
  x: number;
  y: number;
  span: number;
}

function build(): LNode {
  const expanded = new Set<string>();
  const make = (id: string, key: string): LNode => {
    const node = NODE_BY_ID[id];
    if (!node) throw new Error(`decision map: unknown node ${id}`);
    if (node.kind === "result") return { key, id, node, children: [], w: R_W, h: R_H, x: 0, y: 0, span: R_W };
    if (expanded.has(id)) return { key, id, node, ref: true, children: [], w: REF_W, h: REF_H, x: 0, y: 0, span: REF_W };
    expanded.add(id);
    const children = node.options.map((edge, i) => ({ edge, child: make(edge.next, `${key}/${i}`) }));
    const span = Math.max(Q_W, children.reduce((a, c) => a + c.child.span, 0) + GAP_X * (children.length - 1));
    return { key, id, node, children, w: Q_W, h: Q_H, x: 0, y: 0, span };
  };
  const root = make(ROOT, "r");
  const place = (n: LNode, left: number, depth: number) => {
    n.y = depth * LEVEL_H;
    n.x = left + (n.span - n.w) / 2;
    let cursor = left;
    for (const c of n.children) {
      place(c.child, cursor, depth + 1);
      cursor += c.child.span + GAP_X;
    }
  };
  place(root, 0, 0);
  return root;
}

const flatten = (n: LNode, out: LNode[] = []): LNode[] => {
  out.push(n);
  n.children.forEach((c) => flatten(c.child, out));
  return out;
};

interface Edge {
  key: string;
  from: LNode;
  to: LNode;
  option: Option;
}
const edgesOf = (n: LNode, out: Edge[] = []): Edge[] => {
  for (const c of n.children) {
    out.push({ key: `${n.key}>${c.child.key}`, from: n, to: c.child, option: c.edge });
    edgesOf(c.child, out);
  }
  return out;
};

/** Orthogonal connector with rounded corners: down from the parent, across, down into the child. */
function elbow(x1: number, y1: number, x2: number, y2: number): string {
  const busY = y1 + (y2 - y1) * 0.5;
  const dx = x2 - x1;
  if (Math.abs(dx) < CORNER * 2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const s = Math.sign(dx);
  const r = CORNER;
  return [
    `M ${x1} ${y1}`,
    `L ${x1} ${busY - r}`,
    `Q ${x1} ${busY} ${x1 + s * r} ${busY}`,
    `L ${x2 - s * r} ${busY}`,
    `Q ${x2} ${busY} ${x2} ${busY + r}`,
    `L ${x2} ${y2}`,
  ].join(" ");
}

// ----------------------------------------------------------------- colours
const C = {
  question: "#2f6fe4",
  questionEdge: "#1f55b8",
  answer: "#f7b531",
  answerEdge: "#d99a14",
  refFill: "#ffffff",
  refEdge: "#cbd5e1",
  line: "#b6c2d1",
  ink: "#111827",
  grid: "#e6e9ef",
  text: "#111827",
};

interface Props {
  current: string;
  path: Set<string>;
  onJump: (id: string) => void;
  className?: string;
}

export function DecisionMap({ current, path, onJump, className }: Props) {
  const root = useMemo(build, []);
  const nodes = useMemo(() => flatten(root), [root]);
  const links = useMemo(() => edgesOf(root), [root]);
  const bounds = useMemo(() => {
    const maxX = Math.max(...nodes.map((n) => n.x + n.w));
    const maxY = Math.max(...nodes.map((n) => n.y + n.h));
    return { w: maxX, h: maxY };
  }, [nodes]);

  const outer = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ k: 1, tx: 24, ty: 24 });
  const [dragging, setDragging] = useState(false);
  const [full, setFull] = useState(false);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const PAD = 48;

  const fit = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const k = Math.min(1.2, Math.max(0.15, Math.min((W - PAD * 2) / bounds.w, (H - PAD * 2) / bounds.h)));
    setView({ k, tx: (W - bounds.w * k) / 2, ty: (H - bounds.h * k) / 2 });
  }, [bounds]);

  // Readable start: fit the height, centre on the root, pan sideways for the rest.
  const home = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const k = Math.min(1.1, Math.max(0.3, (H - PAD * 2) / bounds.h));
    setView({ k, tx: W / 2 - (root.x + root.w / 2) * k, ty: PAD / 2 });
  }, [bounds, root]);

  useEffect(() => {
    home();
  }, [home]);

  // fullscreen: track state and re-fit on size changes
  useEffect(() => {
    const onChange = () => {
      const isFull = document.fullscreenElement === outer.current;
      setFull(isFull);
      window.setTimeout(() => (isFull ? fit() : home()), 50);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [fit, home]);

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void outer.current?.requestFullscreen?.();
  };

  // keep the walk's current node in view
  useEffect(() => {
    const el = wrap.current;
    const n = nodes.find((x) => x.id === current && !x.ref);
    if (!el || !n) return;
    setView((v) => {
      const cx = (n.x + n.w / 2) * v.k + v.tx;
      const cy = (n.y + n.h / 2) * v.k + v.ty;
      const m = 60;
      if (cx > m && cx < el.clientWidth - m && cy > m && cy < el.clientHeight - m) return v;
      return { ...v, tx: el.clientWidth / 2 - (n.x + n.w / 2) * v.k, ty: Math.min(PAD / 2, el.clientHeight / 2 - (n.y + n.h / 2) * v.k) };
    });
  }, [current, nodes]);

  const zoomAt = (factor: number, px: number, py: number) =>
    setView((v) => {
      const k = Math.min(2.5, Math.max(0.12, v.k * factor));
      const r = k / v.k;
      return { k, tx: px - (px - v.tx) * r, ty: py - (py - v.ty) * r };
    });
  const zoomCenter = (factor: number) => {
    const el = wrap.current;
    if (el) zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2);
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = wrap.current!.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setView((v) => ({ ...v, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) }));
  };
  const onPointerUp = () => {
    drag.current = null;
    setDragging(false);
  };

  const onPath = (n: LNode) => path.has(n.id) && !n.ref;
  const edgeOnPath = (e: Edge) => path.has(e.from.id) && path.has(e.to.id) && !e.to.ref;

  return (
    <div ref={outer} className={cn("relative overflow-hidden rounded-xl border bg-white", full && "rounded-none border-0", className)}>
      <div
        ref={wrap}
        className={cn("h-full w-full touch-none select-none", dragging ? "cursor-grabbing" : "cursor-grab")}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg className="h-full w-full" role="img" aria-label="Decision tree map">
          <defs>
            <pattern id="dm-grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="1.2" cy="1.2" r="1.2" fill={C.grid} />
            </pattern>
            <marker id="dm-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M 1 1 L 8 5 L 1 9" fill="none" stroke={C.line} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
            <marker id="dm-arrow-on" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M 1 1 L 8 5 L 1 9" fill="none" stroke={C.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
            <filter id="dm-shadow" x="-10%" y="-10%" width="120%" height="140%">
              <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodColor="#0f172a" floodOpacity="0.12" />
            </filter>
          </defs>

          <g
            transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}
            style={{ transition: dragging ? "none" : "transform 220ms ease-out" }}
          >
            <rect x={-20000} y={-20000} width={40000} height={40000} fill="url(#dm-grid)" />

            {/* connectors (inactive first, active on top) */}
            {[false, true].map((activeLayer) =>
              links
                .filter((e) => edgeOnPath(e) === activeLayer)
                .map((e) => {
                  const x1 = e.from.x + e.from.w / 2;
                  const y1 = e.from.y + e.from.h;
                  const x2 = e.to.x + e.to.w / 2;
                  const y2 = e.to.y - 3;
                  const on = activeLayer;
                  return (
                    <g key={e.key}>
                      <path
                        d={elbow(x1, y1, x2, y2)}
                        fill="none"
                        stroke={on ? C.ink : C.line}
                        strokeWidth={on ? 2 : 1.4}
                        strokeLinecap="round"
                        markerEnd={on ? "url(#dm-arrow-on)" : "url(#dm-arrow)"}
                      />
                      <text
                        x={x2}
                        y={e.to.y - 17}
                        textAnchor="middle"
                        fontSize={11.5}
                        fontWeight={on ? 600 : 500}
                        fill={on ? C.ink : "#475569"}
                        style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 5, strokeLinejoin: "round" }}
                      >
                        {e.option.short}
                      </text>
                    </g>
                  );
                }),
            )}

            {/* nodes */}
            {nodes.map((n) => {
              const isQ = n.node.kind === "question" && !n.ref;
              const isR = n.node.kind === "result";
              const active = n.id === current && !n.ref;
              const on = onPath(n);
              const fill = n.ref ? C.refFill : isQ ? C.question : C.answer;
              const edge = n.ref ? C.refEdge : isQ ? C.questionEdge : C.answerEdge;
              const label = n.ref ? `see “${n.node.kind === "question" ? n.node.short : ""}”` : n.node.short;
              return (
                <g
                  key={n.key}
                  transform={`translate(${n.x} ${n.y})`}
                  className="cursor-pointer"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onJump(n.id);
                  }}
                  onPointerDown={(ev) => ev.stopPropagation()}
                >
                  <title>{n.node.kind === "question" ? n.node.title : `${n.node.service}: ${n.node.summary}`}</title>
                  {(active || on) && <rect x={-4} y={-4} width={n.w + 8} height={n.h + 8} rx={12} fill="none" stroke={C.ink} strokeWidth={active ? 2.5 : 1.5} />}
                  <rect
                    width={n.w}
                    height={n.h}
                    rx={8}
                    fill={fill}
                    stroke={edge}
                    strokeWidth={1}
                    strokeDasharray={n.ref ? "4 3" : undefined}
                    filter={n.ref ? undefined : "url(#dm-shadow)"}
                  />
                  {n.node.kind === "result" && <image href={AWS_ICON[n.node.icon]} x={10} y={(n.h - 24) / 2} width={24} height={24} />}
                  <foreignObject x={isR ? 38 : 10} y={0} width={n.w - (isR ? 46 : 20)} height={n.h}>
                    <div
                      className={cn("flex h-full items-center text-left leading-[1.2]", isQ ? "justify-center text-center" : "justify-start")}
                      style={{
                        color: isQ ? "#fff" : n.ref ? "#64748b" : C.text,
                        fontSize: n.ref ? 11.5 : isQ ? 13.5 : 12.5,
                        fontWeight: isQ ? 600 : n.ref ? 400 : 600,
                        fontStyle: n.ref ? "italic" : undefined,
                        letterSpacing: isQ ? "-0.005em" : undefined,
                      }}
                    >
                      {label}
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* toolbar */}
      <div className="absolute right-3 top-3 flex items-center gap-0.5 rounded-lg border bg-white/95 p-1 shadow-sm">
        <Tool label="Zoom in" onClick={() => zoomCenter(1.25)}>
          <ZoomIn className="size-4" />
        </Tool>
        <Tool label="Zoom out" onClick={() => zoomCenter(0.8)}>
          <ZoomOut className="size-4" />
        </Tool>
        <Tool label="Back to the first question" onClick={home}>
          <Home className="size-4" />
        </Tool>
        <Tool label="Fit the whole tree" onClick={fit}>
          <Scan className="size-4" />
        </Tool>
        <span className="mx-1 h-5 w-px bg-border" />
        <Tool label={full ? "Exit full screen (Esc)" : "Full screen"} onClick={toggleFull}>
          {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </Tool>
      </div>

      {/* legend */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-4 rounded-lg border bg-white/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded-[3px]" style={{ background: C.question }} /> question
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded-[3px]" style={{ background: C.answer }} /> answer
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded-[3px] border border-dashed" style={{ borderColor: C.refEdge }} /> drawn elsewhere
        </span>
        <span className="hidden sm:inline">scroll to zoom · drag to pan · click a box to go there</span>
      </div>
    </div>
  );
}

function Tool({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
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
