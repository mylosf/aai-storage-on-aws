import { useEffect, useState } from "react";
import { api } from "@/api";
import { BackfillTab } from "@/components/BackfillTab";
import { CostTab } from "@/components/CostTab";
import { LabTab } from "@/components/LabTab";
import { MapTab } from "@/components/MapTab";
import { PlacementTab, pendingAssignments } from "@/components/PlacementTab";
import { ReferenceTab } from "@/components/ReferenceTab";
import { RegionsTab } from "@/components/RegionsTab";
import { UploadTab } from "@/components/UploadTab";
import { WhyTab } from "@/components/WhyTab";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useData } from "@/hooks";

const TABS = [
  { id: "map", label: "Map" },
  { id: "upload", label: "Upload" },
  { id: "why", label: "Why replicate" },
  { id: "regions", label: "How many regions" },
  { id: "placement", label: "Placement" },
  { id: "lab", label: "Replication lab" },
  { id: "backfill", label: "Backfill" },
  { id: "cost", label: "Tiers & cost" },
  { id: "reference", label: "Reference" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function App() {
  const [tab, setTab] = useState<Tab>(() => {
    const h = window.location.hash.replace("#", "");
    return (TABS.some((t) => t.id === h) ? h : "map") as Tab;
  });
  useEffect(() => {
    window.location.hash = tab;
  }, [tab]);

  const config = useData(() => api.config(), { quiet: true });
  const matrix = useData(() => api.matrix(), { quiet: true });
  const catalogue = useData(() => api.catalogue(), { quiet: true });
  const timeline = useData(() => api.timeline(), { pollMs: 3000, pollWhile: pendingAssignments, quiet: true });

  const cfg = config.data;

  return (
    <div className="mx-auto max-w-[1440px] px-6 pb-16 pt-8 sm:px-8">
      <header className="flex flex-wrap items-baseline justify-between gap-x-10 gap-y-2 pb-6">
        <h1 className="text-xl font-semibold tracking-tight">Newsroom replication · Frankfurt → 15 regions</h1>
        <p className="tabular text-xs text-muted-foreground">
          {cfg ? `source s3://${cfg.source.bucket} · ${cfg.source.id} · ${cfg.replicas.length} replica regions · ${cfg.bureaus.length} bureaus` : "connecting…"}
        </p>
      </header>

      {config.error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>Cannot reach the API ({config.error}).</span>
            <Button size="sm" variant="outline" onClick={() => void config.reload()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-8">
        <div className="border-b pb-3">
          <TabsList variant="line" className="h-auto flex-wrap gap-1 bg-transparent p-0">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="px-3 text-sm">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="map">
          <MapTab config={cfg} matrix={matrix.data} timeline={timeline.data} />
        </TabsContent>
        <TabsContent value="upload">
          <UploadTab config={cfg} />
        </TabsContent>
        <TabsContent value="why">
          <WhyTab config={cfg} matrix={matrix.data} onMatrix={() => void matrix.reload()} />
        </TabsContent>
        <TabsContent value="regions">
          <RegionsTab config={cfg} matrix={matrix.data} onMatrix={() => void matrix.reload()} />
        </TabsContent>
        <TabsContent value="placement">
          <PlacementTab
            config={cfg}
            catalogue={catalogue.data}
            timeline={timeline.data}
            onCatalogue={() => void catalogue.reload()}
            onTimeline={() => {
              void timeline.reload();
              void catalogue.reload();
            }}
          />
        </TabsContent>
        <TabsContent value="lab">
          <LabTab config={cfg} />
        </TabsContent>
        <TabsContent value="backfill">
          <BackfillTab config={cfg} catalogue={catalogue.data} timeline={timeline.data} onTimeline={() => void timeline.reload()} />
        </TabsContent>
        <TabsContent value="cost">
          <CostTab config={cfg} />
        </TabsContent>
        <TabsContent value="reference">
          <ReferenceTab config={cfg} />
        </TabsContent>
      </Tabs>

      <footer className="mt-16 flex flex-wrap justify-between gap-x-6 gap-y-1 border-t pt-4 font-mono text-[11px] text-muted-foreground">
        <span>S3 cross-region replication demo · storage on AWS workshop</span>
        <span>AWS Architecture Icons © Amazon Web Services · Meridian © Netflix, CC BY 4.0</span>
      </footer>
    </div>
  );
}
