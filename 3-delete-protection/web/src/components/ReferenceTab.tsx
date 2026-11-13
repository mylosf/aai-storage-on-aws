import { CUSTOMER_POLICY, RECOMMENDED_RCP, RECOMMENDED_SCP } from "@/components/AnswersTab";
import { Code } from "@/components/Code";
import { SubHeader, TabHeader } from "@/components/Layout";
import type { Config } from "@/types";

const GOTCHAS = [
  "SCPs und RCPs gelten nie im Management-Account und nie für Service-Linked Roles.",
  "Eine SCP am Prod-Account begrenzt nur Principals dieses Accounts. Zugriffe aus anderen Accounts deckt nur die RCP (oder die Bucket Policy) ab.",
  "S3 Lifecycle löscht als Dienst, nicht als Principal: kein Deny hält eine bestehende oder neu gesetzte Expiration-Regel auf. Nur Object Lock und Legal Hold.",
  "DeleteObject ohne VersionId erzeugt einen Delete-Marker und ist im Entwurf erlaubt: aws s3 rb --force macht so den Bucket für die App leer.",
  "Einen Delete-Marker entfernen ist s3:DeleteObjectVersion und damit verweigert. Wiederherstellen per CopyObject der Vorversion braucht nur GetObjectVersion + PutObject (bis 5 GB, darüber UploadPartCopy).",
  "Lifecycle-Frist für nicht-aktuelle Versionen: Zeitpunkt des Nachfolgers (hier: des Delete-Markers) + N Tage, aufgerundet auf 00:00 UTC. Die Ausführung kann danach noch etwas dauern, aber nicht früher passieren.",
  "S3 Inventory mit Versionen liefert IsLatest, IsDeleteMarker und LastModifiedDate: daraus lässt sich die tägliche Prüfliste per Athena bauen.",
  "s3:* enthält s3:BypassGovernanceRetention. GOVERNANCE ohne Deny auf den Bypass hält einen Admin nicht auf (siehe Live-Test).",
  "Terraform force_destroy löscht bei Object-Lock-Buckets mit Governance-Bypass. Der Header ist auf Buckets ohne Object Lock ungültig (InvalidArgument).",
  "Object Lock: nachträglich aktivierbar, aber nie wieder abschaltbar; Versioning ist danach nicht mehr aussetzbar. Default Retention gilt nur für neue Versionen.",
  "COMPLIANCE-Retention lässt sich nur verlängern. Ein Tippfehler bei den Tagen ist für die Laufzeit nicht korrigierbar.",
  "MFA Delete ist nicht mit Lifecycle-Regeln kombinierbar und nur vom Root-User per CLI zu aktivieren.",
  "s3:PutLifecycleConfiguration deckt auch DeleteBucketLifecycle ab. Terraform-Änderungen an Versioning/Lifecycle brauchen nach dem Deny Break-Glass.",
  "aws:PrincipalArn ist bei Rollen die Rollen-ARN mit Pfad. IAM-Identity-Center-Rollen: arn:aws:iam::*:role/aws-reserved/sso.amazonaws.com/*/AWSReservedSSO_<Name>_* mit ArnNotLike.",
  "Bucket-Namen sind global. Ein gerade gelöschter Name ist minutenlang nicht wieder anlegbar (die Demo legt daher eine neue Generation an).",
  "SSE-KMS mit eigenem Key: kms:ScheduleKeyDeletion macht die Daten ebenso unlesbar wie ein Löschen. Key in die Policy aufnehmen.",
];

const SOURCES = [
  ["Resource control policies (RCPs)", "https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_rcps.html"],
  ["Service control policies (SCPs)", "https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html"],
  ["Introducing RCPs (AWS News Blog, 11/2024)", "https://aws.amazon.com/blogs/aws/introducing-resource-control-policies-rcps-a-new-authorization-policy/"],
  ["S3 Object Lock auf bestehenden Buckets (11/2023)", "https://aws.amazon.com/about-aws/whats-new/2023/11/amazon-s3-enabling-object-lock-buckets/"],
  ["Object Lock Retention per Batch Operations", "https://docs.aws.amazon.com/AmazonS3/latest/userguide/batch-ops-retention-date.html"],
  ["MFA Delete", "https://docs.aws.amazon.com/AmazonS3/latest/userguide/MultiFactorAuthenticationDelete.html"],
] as const;

export function ReferenceTab({ config }: { config: Config | null }) {
  return (
    <section className="space-y-10">
      <TabHeader title="Referenz: Policies, Fallstricke, Quellen" />

      <div className="space-y-4">
        <SubHeader title="Vorlagen für die Prod-Buckets">
          Zum Übernehmen. Die SCP schützt zusätzlich die Break-Glass-Rolle und den KMS-Key; die RCP ist die Ressourcen-Seite.
          Beide zusammen sind die Empfehlung.
        </SubHeader>
        <div className="grid gap-6 lg:grid-cols-2">
          <Code title="RCP (Resource Control Policy)" value={RECOMMENDED_RCP} />
          <Code title="SCP mit Schutz der Break-Glass-Rolle und des KMS-Keys" value={RECOMMENDED_SCP} />
        </div>
        <Code title="Ihr Entwurf zum Vergleich" value={CUSTOMER_POLICY} />
      </div>

      <div className="space-y-4">
        <SubHeader title="Was in dieser Demo deployt ist">
          Generiert von Terraform (<code className="font-mono">protection/infra</code>), angehängt im Management-Account
          über <code className="font-mono">protection/org</code>. Die Szenario-Buckets heißen{" "}
          <code className="font-mono">{config?.prefix ?? "test-…"}&lt;nn&gt;</code> (nn = Szenario), nach einem erfolgreichen Löschen mit
          Generations-Suffix.
        </SubHeader>
        <div className="grid gap-6 lg:grid-cols-2">
          <Code title="SCP: Ihr Entwurf + Break-Glass (Szenario „SCP“)" value={config?.policies.scp} />
          <Code title="RCP: Entwurf (Szenario „RCP“) und erweitert (Szenario „Empfehlung“)" value={config?.policies.rcp} />
          <Code title="Bucket Policy (Szenario „Bucket Policy“)" value={config?.policies.bucketPolicy} />
          <Code title="Akteure" value={config?.roles} />
        </div>
      </div>

      <div className="space-y-4">
        <SubHeader title="Fallstricke" />
        <ul className="max-w-4xl list-disc space-y-2 pl-5 text-sm">
          {GOTCHAS.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </div>

      <div className="space-y-4">
        <SubHeader title="Quellen" />
        <ul className="space-y-1 text-sm">
          {SOURCES.map(([t, u]) => (
            <li key={u}>
              <a className="underline underline-offset-2" href={u} target="_blank" rel="noreferrer">
                {t}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
