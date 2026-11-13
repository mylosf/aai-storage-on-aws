import { useMemo, useState } from "react";
import { AWS_ICON } from "@/assets/aws";
import { Dot } from "@/components/Dot";
import { DecisionMap } from "@/components/DecisionMap";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CONSIDERATIONS, NODE_BY_ID, ROOT, type Node, type Question, type Result } from "@/decision";
import { BACKEND_SHORT } from "@/palette";

const node = (id: string): Node => {
  const n = NODE_BY_ID[id];
  if (!n) throw new Error(`decision tree: unknown node ${id}`);
  return n;
};

// ------------------------------------------------------------ guided walk
function QuestionCard({ q, onChoose }: { q: Question; onChoose: (next: string) => void }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <h4 className="text-lg font-medium leading-snug">{q.title}</h4>
        {q.help && <p className="text-sm text-muted-foreground">{q.help}</p>}
      </div>
      <ul className="space-y-2">
        {q.options.map((o) => (
          <li key={o.label}>
            <Button
              variant="outline"
              className="h-auto w-full flex-col items-start gap-0.5 whitespace-normal px-4 py-3 text-left"
              onClick={() => onChoose(o.next)}
            >
              <span className="text-sm font-medium">{o.label}</span>
              {o.detail && <span className="text-xs font-normal text-muted-foreground">{o.detail}</span>}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultCard({ r, onJump }: { r: Result; onJump: (id: string) => void }) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        <img src={AWS_ICON[r.icon]} alt="" className="size-12 shrink-0" draggable={false} />
        <div className="space-y-1">
          <h4 className="text-lg font-medium leading-snug">{r.service}</h4>
          <p className="text-sm text-muted-foreground">{r.summary}</p>
          {r.backend && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Dot id={r.backend} /> measured in this demo as {BACKEND_SHORT[r.backend]}
            </p>
          )}
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <List title="Why it fits" items={r.why} />
        <List title="Watch out for" items={r.watch} />
      </div>
      {r.alternatives?.length ? (
        <div className="space-y-2">
          <h5 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Also consider</h5>
          <div className="flex flex-wrap gap-2">
            {r.alternatives.map((a) => (
              <Button key={a.label} size="sm" variant="secondary" onClick={() => onJump(a.next)}>
                {a.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="space-y-2">
      <h5 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h5>
      <ul className="space-y-1.5 text-sm">
        {items.map((it) => (
          <li key={it} className="flex gap-2">
            <span className="mt-[9px] size-1 shrink-0 rounded-full bg-foreground/50" aria-hidden />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ page
export function Decide() {
  const [history, setHistory] = useState<string[]>([ROOT]);
  const currentId = history[history.length - 1] ?? ROOT;
  const current = node(currentId);
  const pathSet = useMemo(() => new Set(history), [history]);

  const choose = (next: string) => setHistory((h) => [...h, next]);
  const jump = (id: string) => setHistory((h) => (h[h.length - 1] === id ? h : [...h, id]));
  const back = (index: number) => setHistory((h) => h.slice(0, index + 1));
  const restart = () => setHistory([ROOT]);

  // breadcrumb: question → chosen answer, for every step that led somewhere
  const trail = history.slice(0, -1).map((id, i) => {
    const n = node(id);
    const nextId = history[i + 1];
    const answer = n.kind === "question" ? n.options.find((o) => o.next === nextId)?.label : undefined;
    return { id, index: i, title: n.kind === "question" ? n.title : n.service, answer };
  });

  return (
    <section className="space-y-12">
      <header className="max-w-3xl space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Choosing between S3, EFS and EBS</h2>
        <p className="text-sm text-muted-foreground">
          The map starts from what you know about the workload: who shares the data, what kind of files, how they are
          written, how fast the first byte must be, how often they are read back. Blue boxes are questions, amber
          boxes are answers; the answer to each question is written on the arrow. Click any box to jump there, or
          walk it question by question below. Prices are us-east-1 list prices; verify before quoting them.
        </p>
      </header>

      <DecisionMap current={currentId} path={pathSet} onJump={jump} className="h-[620px]" />

      <div className="grid gap-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-base font-medium">Walk the tree</h3>
            <Button size="sm" variant="ghost" onClick={restart} disabled={history.length === 1}>
              Start over
            </Button>
          </div>

          {trail.length > 0 && (
            <ol className="space-y-1 border-l pl-4 text-sm">
              {trail.map((t) => (
                <li key={`${t.id}-${t.index}`} className="flex flex-wrap items-baseline gap-x-2">
                  <button type="button" onClick={() => back(t.index)} className="text-muted-foreground underline-offset-2 hover:underline">
                    {t.title}
                  </button>
                  {t.answer && (
                    <>
                      <span className="text-muted-foreground/60">→</span>
                      <span>{t.answer}</span>
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}

          {current.kind === "question" ? <QuestionCard q={current} onChoose={choose} /> : <ResultCard r={current} onJump={jump} />}
        </div>

        <aside className="space-y-3 text-sm text-muted-foreground lg:pt-9">
          <p>
            Two of these dimensions do most of the work. <span className="text-foreground">Who shares the data</span>{" "}
            separates block (one machine), file (a fleet) and object storage (anyone with HTTPS).{" "}
            <span className="text-foreground">How the files are written</span> separates in-place updates, which need a
            disk or a file system, from write-once files, which are objects even on a single machine.
          </p>
          <p>
            After that it is latency and frequency: first byte in microseconds (instance store), milliseconds (EBS,
            EFS, S3 Express) or tens of milliseconds (S3); read constantly, monthly, quarterly or almost never (the S3
            classes). The map asks these in the order that eliminates the most options earliest.
          </p>
        </aside>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-base font-medium">What to ask about any option</h3>
          <p className="max-w-3xl text-sm text-muted-foreground">
            The considerations behind the tree, side by side. Most wrong choices come from skipping one of these rows.
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table className="min-w-[1000px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Consideration</TableHead>
                <TableHead className="w-64">Ask</TableHead>
                <TableHead>
                  <span className="flex items-center gap-2">
                    <img src={AWS_ICON.s3} alt="" className="size-5" /> S3
                  </span>
                </TableHead>
                <TableHead>
                  <span className="flex items-center gap-2">
                    <img src={AWS_ICON.efs} alt="" className="size-5" /> EFS
                  </span>
                </TableHead>
                <TableHead>
                  <span className="flex items-center gap-2">
                    <img src={AWS_ICON.ebs} alt="" className="size-5" /> EBS
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CONSIDERATIONS.map((c) => (
                <TableRow key={c.topic} className="hover:bg-transparent">
                  <TableCell className="whitespace-normal py-3 align-top text-sm font-medium">{c.topic}</TableCell>
                  <TableCell className="whitespace-normal py-3 align-top text-sm text-muted-foreground">{c.ask}</TableCell>
                  <TableCell className="whitespace-normal py-3 align-top text-sm">{c.s3}</TableCell>
                  <TableCell className="whitespace-normal py-3 align-top text-sm">{c.efs}</TableCell>
                  <TableCell className="whitespace-normal py-3 align-top text-sm">{c.ebs}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  );
}
