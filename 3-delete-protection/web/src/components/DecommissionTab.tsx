import { Code } from "@/components/Code";
import { SubHeader, TabHeader } from "@/components/Layout";

const STEPS: { t: string; d: string }[] = [
  { t: "Change mit Vier-Augen-Freigabe", d: "Begründung, betroffene Buckets, Datensicherung geklärt (Export, Kopie oder bewusster Verzicht)." },
  {
    t: "Break-Glass anfordern",
    d: "Zeitlich begrenzte Zuweisung des Permission Sets S3BreakGlass in IAM Identity Center (z. B. über einen Freigabe-Workflow). Login mit MFA. Die Anmeldung löst einen Alarm aus: gewollt.",
  },
  {
    t: "Object Lock auflösen",
    d: "GOVERNANCE: Break-Glass darf mit x-amz-bypass-governance-retention löschen. Legal Holds entfernen (PutObjectLegalHold OFF, bei vielen Objekten per Batch Operations). COMPLIANCE: bis retain-until warten, es gibt keinen Weg daran vorbei.",
  },
  {
    t: "Bucket leeren: Lifecycle statt Millionen DeleteObjects",
    d: "Mit Break-Glass eine Lifecycle-Regel setzen: Expiration 1 Tag, NoncurrentVersionExpiration 1 Tag, ExpiredObjectDeleteMarker. S3 leert den Bucket in ein bis zwei Tagen, ohne Request-Kosten. Für kleine Buckets geht force_destroy.",
  },
  {
    t: "Terraform",
    d: "prevent_destroy entfernen, ggf. force_destroy = true, apply. Dann terraform destroy mit Break-Glass-Credentials. Oder die Ressource per removed-Block aus dem State nehmen und den leeren Bucket per CLI löschen.",
  },
  {
    t: "Policy aufräumen",
    d: "Bucket-ARNs aus SCP/RCP entfernen. Alternativ stehen lassen: der Deny auf einen nicht mehr existierenden Namen schadet nicht und verhindert, dass jemand im Account den Namen neu belegt und versehentlich weiterbenutzt.",
  },
];

export function DecommissionTab() {
  return (
    <section className="space-y-10">
      <TabHeader title="Regulärer Abbau mit Break-Glass">
        <p>
          Die Ausnahme in der Policy ist kein Schlupfloch, wenn drei Dinge stimmen: nur wenige dürfen die Rolle bekommen,
          niemand im Account kann die Rolle verändern, und jede Nutzung fällt auf.
        </p>
      </TabHeader>

      <ol className="space-y-0 divide-y border-y">
        {STEPS.map((s, i) => (
          <li key={s.t} className="grid gap-2 py-4 md:grid-cols-[48px_260px_minmax(0,1fr)] md:gap-6">
            <span className="tabular font-mono text-sm text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
            <span className="text-sm font-medium">{s.t}</span>
            <span className="max-w-3xl text-sm text-muted-foreground">{s.d}</span>
          </li>
        ))}
      </ol>

      <div className="space-y-4">
        <SubHeader title="Variante ohne Ausnahme in der Policy">
          Kein Break-Glass-ARN in der SCP/RCP. Für den Abbau hängt ein Org-Admin die Policy im Management-Account vom
          Prod-Account ab (oder entfernt die Bucket-ARNs), danach wieder an. Stärkste Trennung: im Prod-Account kann niemand
          den Riegel lösen, auch nicht mit einer kompromittierten Admin-Rolle. Nachteil: zentrales Team im kritischen Pfad,
          und während des Fensters ist die Policy für alle Principals weg.
        </SubHeader>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Code title="Terraform: was prevent_destroy kann und was nicht">{`resource "aws_s3_bucket" "store" {
  bucket        = "test-123125"
  force_destroy = false          # Default: Terraform leert keinen Bucket

  lifecycle {
    prevent_destroy = true       # wirkt nur, solange dieser Block im Code steht.
  }                              # Ressource aus dem Code löschen = destroy ohne Schutz
}

# Object Lock auf dem bestehenden Bucket nachrüsten (Versioning muss an sein)
resource "aws_s3_bucket_object_lock_configuration" "store" {
  bucket = aws_s3_bucket.store.id
  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = 30                  # gilt nur für neue Versionen
    }
  }
}

# Aus Terraform herausnehmen, ohne zu löschen (Terraform >= 1.7)
removed {
  from = aws_s3_bucket.legacy
  lifecycle { destroy = false }
}`}</Code>
        <Code title="CI: Plan-Prüfung mit Conftest/OPA (terraform show -json tfplan > plan.json)">{`package main

import rego.v1

# delete und replace (["delete","create"]) von Prod-Buckets abweisen
deny contains msg if {
  some rc in input.resource_changes
  rc.type == "aws_s3_bucket"
  "delete" in rc.change.actions
  startswith(rc.change.before.bucket, "test-")
  msg := sprintf("%s: Prod-Bucket löschen nur per Break-Glass-Change", [rc.address])
}`}</Code>
      </div>
    </section>
  );
}
