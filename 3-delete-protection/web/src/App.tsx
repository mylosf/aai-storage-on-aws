import { useEffect, useState } from "react";
import { api } from "@/api";
import { AnswersTab } from "@/components/AnswersTab";
import { DecommissionTab } from "@/components/DecommissionTab";
import { LiveTab } from "@/components/LiveTab";
import { OptionsTab } from "@/components/OptionsTab";
import { ReferenceTab } from "@/components/ReferenceTab";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useData } from "@/hooks";

const TABS = [
  { id: "answers", label: "Antworten" },
  { id: "options", label: "Alle Optionen" },
  { id: "live", label: "Live-Test" },
  { id: "decommission", label: "Abbau (Break-Glass)" },
  { id: "reference", label: "Referenz" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function App() {
  const [tab, setTab] = useState<Tab>(() => {
    const h = window.location.hash.replace("#", "");
    return (TABS.some((t) => t.id === h) ? h : "answers") as Tab;
  });
  useEffect(() => {
    window.location.hash = tab;
  }, [tab]);

  const config = useData(() => api.config(), { quiet: true });
  const cfg = config.data;

  return (
    <div className="mx-auto max-w-[1440px] px-6 pb-16 pt-8 sm:px-8">
      <header className="flex flex-wrap items-baseline justify-between gap-x-10 gap-y-2 pb-6">
        <h1 className="text-xl font-semibold tracking-tight">Löschschutz für S3 · SCP, RCP, Bucket Policy, Object Lock</h1>
        <p className="tabular text-xs text-muted-foreground">
          {cfg ? `Demo-Account ${cfg.account} · ${cfg.region} · ${cfg.scenarios.length} Szenarien · ${cfg.attacks.length} Angriffe` : "verbinde…"}
        </p>
      </header>

      {config.error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>API nicht erreichbar ({config.error}).</span>
            <Button size="sm" variant="outline" onClick={() => void config.reload()}>
              Erneut
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
        <TabsContent value="answers">
          <AnswersTab />
        </TabsContent>
        <TabsContent value="options">
          <OptionsTab />
        </TabsContent>
        <TabsContent value="live">
          <LiveTab config={cfg} />
        </TabsContent>
        <TabsContent value="decommission">
          <DecommissionTab />
        </TabsContent>
        <TabsContent value="reference">
          <ReferenceTab config={cfg} />
        </TabsContent>
      </Tabs>

      <footer className="mt-16 flex flex-wrap justify-between gap-x-6 gap-y-1 border-t pt-4 font-mono text-[11px] text-muted-foreground">
        <span>S3 delete-protection demo · storage on AWS workshop</span>
        <span>alle Angriffe laufen echt, nur gegen die Demo-Buckets</span>
      </footer>
    </div>
  );
}
