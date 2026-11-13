import { SubHeader, TabHeader } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { KIND_LABEL, OPTIONS } from "@/content";

const KIND_CLS = {
  iac: "border-sky-200 bg-sky-50 text-sky-800",
  preventive: "border-emerald-200 bg-emerald-50 text-emerald-800",
  detective: "border-amber-300 bg-amber-50 text-amber-800",
  copy: "border-violet-200 bg-violet-50 text-violet-800",
} as const;

// who is stopped by which policy type
const WHO = [
  { who: "IAM-Rolle/User im Prod-Account (auch AdministratorAccess)", scp: "ja", rcp: "ja", bp: "ja" },
  { who: "Root-User des Prod-Accounts", scp: "ja", rcp: "ja", bp: "nein: darf die Bucket Policy immer löschen" },
  { who: "Pipeline-Rolle aus einem anderen Account (Tooling/CI)", scp: "nein (es gilt die SCP des anderen Accounts)", rcp: "ja", bp: "ja" },
  { who: "Principal im Management-Account / Ressource im Management-Account", scp: "nein", rcp: "nein", bp: "ja" },
  { who: "Service-Linked Roles", scp: "nein", rcp: "nein", bp: "ja" },
  { who: "S3 Lifecycle (Expiration durch S3 selbst)", scp: "nein", rcp: "nein", bp: "nein: nur Object Lock/Legal Hold hält Lifecycle auf" },
  { who: "Wer die Policy entfernen kann", scp: "Org-Admins im Management-Account", rcp: "Org-Admins im Management-Account", bp: "jeder mit s3:PutBucketPolicy, sofern nicht verboten; Root immer" },
];

const WHEN = [
  {
    title: "Nur Terraform-Unfälle abfangen",
    body: "prevent_destroy + force_destroy = false + Plan-Prüfung in CI. Reicht nicht gegen CLI und Konsole.",
  },
  {
    title: "Jeden Principal am Löschen hindern, Aufwand gering",
    body: "RCP (bzw. SCP, wenn alles im Prod-Account läuft) mit Break-Glass-Ausnahme. Kostet nichts, wirkt sofort auf den Bestand. Ohne Organizations: Bucket Policy, die sich selbst schützt.",
  },
  {
    title: "Auch rb --force / Delete-Marker + Lifecycle abfangen",
    body: "Object Lock GOVERNANCE (Bypass per RCP verbieten) mit rollierender Retention oder Legal Hold, plus Alarm auf Delete-Marker. Alternativ s3:DeleteObject per RCP verbieten, wenn die Anwendung nie löscht.",
  },
  {
    title: "Regulatorik / WORM / Ransomware",
    body: "Object Lock COMPLIANCE, typischerweise auf der Kopie im Bunker-Account oder in einem AWS-Backup-Vault mit Vault Lock, nicht auf den Arbeitsdaten.",
  },
  {
    title: "Viele Buckets und Accounts sauber halten",
    body: "AWS Config (Conformance Pack, Security Hub) mit Auto-Remediation für Versioning, Lifecycle und Object Lock. Zeigt Abweichungen, verhindert keine Löschung.",
  },
];

export function OptionsTab() {
  return (
    <section className="space-y-10">
      <TabHeader title="Alle Optionen, und wann sie Sinn ergeben">
        <p>
          Präventiv verhindert den Request, detektiv meldet und repariert danach, eine Kopie macht ihn verschmerzbar. Ein
          einzelner Riegel reicht selten: die Kombination entscheidet.
        </p>
      </TabHeader>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Option</th>
              <th className="px-3 py-2 font-medium">schützt gegen</th>
              <th className="px-3 py-2 font-medium">umgehbar durch</th>
              <th className="px-3 py-2 font-medium">Bestand</th>
              <th className="px-3 py-2 font-medium">Kosten</th>
              <th className="px-3 py-2 font-medium">sinnvoll, wenn</th>
            </tr>
          </thead>
          <tbody>
            {OPTIONS.map((o) => (
              <tr key={o.name} className="border-t align-top">
                <td className="w-56 px-3 py-3">
                  <div className="font-medium">{o.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={KIND_CLS[o.kind]}>
                      {KIND_LABEL[o.kind]}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">{o.layer}</span>
                  </div>
                </td>
                <td className="px-3 py-3">{o.protects}</td>
                <td className="px-3 py-3 text-muted-foreground">{o.bypass}</td>
                <td className="w-36 px-3 py-3 text-muted-foreground">{o.existing}</td>
                <td className="w-36 px-3 py-3 text-muted-foreground">{o.cost}</td>
                <td className="px-3 py-3">{o.when}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-4">
        <SubHeader title="SCP vs. RCP vs. Bucket Policy: wen hält was auf?">
          Die SCP fragt „was darf dieser Principal?“, die RCP und die Bucket Policy fragen „was darf mit dieser Ressource
          passieren?“. Ein explizites Deny gewinnt in jeder dieser Ebenen.
        </SubHeader>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Wer / was</th>
                <th className="px-3 py-2 font-medium">SCP am Prod-Account</th>
                <th className="px-3 py-2 font-medium">RCP am Prod-Account</th>
                <th className="px-3 py-2 font-medium">Bucket Policy</th>
              </tr>
            </thead>
            <tbody>
              {WHO.map((w) => (
                <tr key={w.who} className="border-t align-top">
                  <td className="px-3 py-2">{w.who}</td>
                  {[w.scp, w.rcp, w.bp].map((v, i) => (
                    <td key={i} className={`px-3 py-2 ${v.startsWith("ja") ? "text-emerald-800" : v.startsWith("nein") ? "text-red-800" : "text-muted-foreground"}`}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-4">
        <SubHeader title="Wann was" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {WHEN.map((w) => (
            <div key={w.title} className="space-y-1.5 rounded-lg border p-4">
              <div className="text-sm font-medium">{w.title}</div>
              <p className="text-sm text-muted-foreground">{w.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
