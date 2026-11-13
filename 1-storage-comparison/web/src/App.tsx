import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Admin } from "@/components/Admin";
import { Analysis } from "@/components/Analysis";
import { Bench } from "@/components/Bench";
import { Decide } from "@/components/Decide";
import { Dot } from "@/components/Dot";
import { LoadTest } from "@/components/LoadTest";
import { Overview } from "@/components/Overview";
import { Players } from "@/components/Players";
import { Reference } from "@/components/Reference";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BACKEND_ORDER, type Info } from "@/types";

type Tab = "overview" | "players" | "bench" | "load" | "analysis" | "decide" | "reference";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "players", label: "Players" },
  { id: "bench", label: "Benchmark" },
  { id: "load", label: "Viewers" },
  { id: "analysis", label: "Analysis" },
  { id: "decide", label: "Choosing" },
  { id: "reference", label: "Reference" },
];

export default function App() {
  const [info, setInfo] = useState<Info | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    const h = window.location.hash.replace("#", "") as Tab;
    return TABS.some((t) => t.id === h) ? h : "overview";
  });

  const refresh = useCallback(async () => {
    try {
      const i = await api.info();
      setInfo(i);
      setInfoError(null);
    } catch (err) {
      const msg = (err as Error).message;
      setInfoError(msg);
      toast.error(`GET /api/info failed: ${msg}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    window.location.hash = tab;
  }, [tab]);

  const backends = info?.backends ?? [];
  const frozen = Boolean(info?.frozen);
  const tabs = TABS.filter((t) => t.id !== "load" || info?.loadgen.enabled !== false);

  return (
    <div className="mx-auto max-w-[1440px] px-6 pb-16 pt-8 sm:px-8">
      <header className="flex flex-wrap items-baseline justify-between gap-x-10 gap-y-2 pb-6">
        <h1 className="text-xl font-semibold tracking-tight">One video, five ways to store it</h1>
        <p className="tabular text-xs text-muted-foreground">
          {info
            ? [
                info.instance.type,
                info.instance.az,
                `EBS gp3 · ${info.ebs.iops || "?"} IOPS · ${info.ebs.throughputMiBps || "?"} MiB/s`,
                `EFS ${info.efs.throughputMode || "?"}`,
              ].join("  ·  ")
            : "connecting…"}
        </p>
      </header>

      {frozen && (
        <Alert className="mb-6">
          <AlertDescription className="block text-sm">
            <span className="font-medium text-foreground">Archive.</span> The AWS resources behind this demo were
            removed on {info?.frozenAt ? new Date(info.frozenAt).toLocaleDateString() : "…"}; the instances, the EBS
            volume, the EFS file system and the video are gone. The benchmark, viewer and analysis results below are
            the last recorded runs. Players and experiments need the live stack: redeploy with{" "}
            <code className="font-mono text-xs">make thaw</code>.
          </AlertDescription>
        </Alert>
      )}

      {infoError && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>Cannot reach the API ({infoError}).</span>
            <Button size="sm" variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-8">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-3">
          <TabsList variant="line" className="h-auto gap-1 bg-transparent p-0">
            {tabs.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="px-3 text-sm">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex items-center gap-5">
            <ul className="hidden flex-wrap items-center gap-x-4 text-xs text-muted-foreground md:flex" aria-label="backend colours">
              {BACKEND_ORDER.map((id) => {
                const b = backends.find((x) => x.id === id);
                if (!b) return null;
                return (
                  <li key={id} className={`flex items-center gap-1.5 ${b.available ? "" : "line-through opacity-60"}`} title={b.path}>
                    <Dot id={id} />
                    {b.label}
                    {!b.available ? " · n/a" : !b.ready ? " · no content" : ""}
                  </li>
                );
              })}
            </ul>
            {!frozen && <Admin onSynced={() => void refresh()} />}
          </div>
        </div>

        <TabsContent value="overview">
          <Overview info={info} backends={backends} />
        </TabsContent>
        <TabsContent value="players">
          <Players backends={backends} onRefresh={() => void refresh()} frozen={frozen} />
        </TabsContent>
        <TabsContent value="bench">
          <Bench info={info} frozen={frozen} />
        </TabsContent>
        <TabsContent value="load">
          <LoadTest backends={backends} frozen={frozen} />
        </TabsContent>
        <TabsContent value="analysis">
          <Analysis loadgen={info?.loadgen.enabled !== false} frozen={frozen} />
        </TabsContent>
        <TabsContent value="decide">
          <Decide />
        </TabsContent>
        <TabsContent value="reference">
          <Reference backends={backends} />
        </TabsContent>
      </Tabs>

      <footer className="mt-16 flex flex-wrap justify-between gap-x-6 gap-y-1 border-t pt-4 font-mono text-[11px] text-muted-foreground">
        <span>
          {info?.region ?? "…"} · bucket {info?.bucket ?? "…"}
        </span>
        <span>
          EFS {info?.efs.id || "…"} · EBS {info?.ebs.volumeId || "…"}
        </span>
      </footer>
    </div>
  );
}
