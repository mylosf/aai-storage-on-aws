import { useMemo, useState } from "react";
import { Num } from "@/components/RegionsTab";
import { Stat, SubHeader, TabHeader } from "@/components/Layout";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Config } from "@/types";

// approximate us-east-1 list prices, $/GB-month unless noted — verify before quoting
const P = { STANDARD: 0.023, STANDARD_IA: 0.0125, ONEZONE_IA: 0.01, GLACIER_IR: 0.004, iaRetrieval: 0.01, girRetrieval: 0.03, transfer: 0.02, rtc: 0.015 };
type Cls = "STANDARD" | "STANDARD_IA" | "ONEZONE_IA";
const CLS_LABEL: Record<Cls, string> = { STANDARD: "Standard", STANDARD_IA: "Standard-IA", ONEZONE_IA: "One Zone-IA" };
const usd = (v: number) => `$${Math.round(v).toLocaleString()}`;

export function CostTab({ config }: { config: Config | null }) {
  const regions = config?.replicas.length ?? 15;
  const [libraryTB, setLibraryTB] = useState(200);
  const [coldPct, setColdPct] = useState(70);
  const [coldDays, setColdDays] = useState(90);
  const [assignGB, setAssignGB] = useState(3000);
  const [expiry, setExpiry] = useState(30);
  const [mastersCls, setMastersCls] = useState<Cls>("STANDARD");
  const [masterReads, setMasterReads] = useState(3);
  const [proxyGB, setProxyGB] = useState(2000);
  const [newProxyGB, setNewProxyGB] = useState(150);
  const [proxyCls, setProxyCls] = useState<Cls>("ONEZONE_IA");
  const [rtc, setRtc] = useState(true);

  const rows = useMemo(() => {
    const libGB = libraryTB * 1024;
    const replicaMastersGB = assignGB * (expiry / 30);
    const proxiesGB = proxyGB * regions;
    const ia = (c: Cls) => c !== "STANDARD";
    return [
      { item: "Source, hot", detail: `${100 - coldPct} % of ${libraryTB} TB in S3 Standard`, cost: libGB * (1 - coldPct / 100) * P.STANDARD },
      { item: "Source, cold", detail: `${coldPct} % moved to Glacier Instant Retrieval after ${coldDays} days`, cost: libGB * (coldPct / 100) * P.GLACIER_IR },
      { item: "Replica masters", detail: `${Math.round(replicaMastersGB).toLocaleString()} GB resident (${assignGB.toLocaleString()} GB/month kept ${expiry} days) in ${CLS_LABEL[mastersCls]}`, cost: replicaMastersGB * P[mastersCls] },
      { item: "Replica proxies + sidecars", detail: `${proxyGB.toLocaleString()} GB × ${regions} regions in ${CLS_LABEL[proxyCls]}`, cost: proxiesGB * P[proxyCls] },
      {
        item: "IA retrieval",
        detail: `${masterReads}× full reads of each replica master${ia(proxyCls) ? ", proxies read once" : ""}`,
        cost: (ia(mastersCls) ? replicaMastersGB * masterReads * P.iaRetrieval : 0) + (ia(proxyCls) ? proxiesGB * P.iaRetrieval : 0),
      },
      { item: "Inter-region transfer", detail: `${assignGB.toLocaleString()} GB masters + ${newProxyGB} GB new proxies × ${regions}`, cost: (assignGB + newProxyGB * regions) * P.transfer },
      { item: "Replication Time Control", detail: rtc ? `${assignGB.toLocaleString()} GB of masters with the 15-min SLA` : "off", cost: rtc ? assignGB * P.rtc : 0 },
    ];
  }, [libraryTB, coldPct, coldDays, assignGB, expiry, mastersCls, masterReads, proxyGB, newProxyGB, proxyCls, rtc, regions]);
  const total = rows.reduce((a, r) => a + r.cost, 0);
  const replicaShare = rows.slice(2).reduce((a, r) => a + r.cost, 0) / (total || 1);

  return (
    <section className="space-y-10">
      <TabHeader title="Storage tiers and what it costs">
        <p>
          A replica is a cache: the truth stays in Frankfurt. That decides the tiers. Masters being cut need Standard
          (they are read many times, and IA retrieval fees would add up); proxies and sidecars are small and
          re-creatable, so One Zone-IA is fine; replica buckets expire objects when the project ends; and the source
          ages finished material into Glacier Instant Retrieval, which still opens in milliseconds.
        </p>
      </TabHeader>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-6">
          <SubHeader title="Source in Frankfurt" />
          <div className="grid grid-cols-3 gap-4">
            <Num label="archive" value={libraryTB} set={setLibraryTB} unit="TB" step={10} />
            <Num label="cold share" value={coldPct} set={(v) => setColdPct(Math.min(100, v))} unit="%" step={5} />
            <Num label="cold after" value={coldDays} set={setColdDays} unit="days" step={10} />
          </div>
          <SubHeader title="Masters in the bureaus" />
          <div className="grid grid-cols-3 gap-4">
            <Num label="assigned per month" value={assignGB} set={setAssignGB} unit="GB" />
            <Num label="replica expiry" value={expiry} set={setExpiry} unit="days" step={5} />
            <Num label="full reads each" value={masterReads} set={setMasterReads} unit="×" step={1} />
          </div>
          <ClassPick value={mastersCls} set={setMastersCls} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={rtc} onChange={(e) => setRtc(e.target.checked)} className="accent-[#2f6fe4]" /> Replication Time Control on masters
          </label>
          <SubHeader title="Proxies and sidecars everywhere" />
          <div className="grid grid-cols-2 gap-4">
            <Num label="library" value={proxyGB} set={setProxyGB} unit="GB" />
            <Num label="new per month" value={newProxyGB} set={setNewProxyGB} unit="GB" step={10} />
          </div>
          <ClassPick value={proxyCls} set={setProxyCls} />
        </div>

        <div className="space-y-6">
          <div className="flex flex-wrap gap-10">
            <Stat label="per month" value={usd(total)} />
            <Stat label="replication share" value={`${Math.round(replicaShare * 100)} %`} note="everything outside the source bucket" />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>item</TableHead>
                <TableHead>basis</TableHead>
                <TableHead className="text-right">per month</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.item}>
                  <TableCell className="font-medium">{r.item}</TableCell>
                  <TableCell className="whitespace-normal text-xs text-muted-foreground">{r.detail}</TableCell>
                  <TableCell className="tabular text-right">{usd(r.cost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>total</TableCell>
                <TableCell className="tabular text-right">{usd(total)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <p className="text-xs text-muted-foreground">
            Approximate list prices, verify before quoting: Standard ${P.STANDARD}, Standard-IA ${P.STANDARD_IA}, One Zone-IA ${P.ONEZONE_IA}, Glacier
            Instant Retrieval ${P.GLACIER_IR} per GB-month; IA retrieval ${P.iaRetrieval}/GB; inter-region transfer ~${P.transfer}/GB (higher out of
            sa-east-1, af-south-1, me-central-1 and ap-east-1); RTC ${P.rtc}/GB. Requests and minimum-duration charges are left out.
          </p>
        </div>
      </div>
    </section>
  );
}

function ClassPick({ value, set }: { value: Cls; set: (c: Cls) => void }) {
  return (
    <ToggleGroup type="single" value={value} onValueChange={(v) => v && set(v as Cls)} variant="outline" size="sm">
      {(Object.keys(CLS_LABEL) as Cls[]).map((c) => (
        <ToggleGroupItem key={c} value={c} className="px-3">
          {CLS_LABEL[c]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
