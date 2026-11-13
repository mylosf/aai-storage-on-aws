import { Code, Q, Short } from "@/components/Code";
import { SubHeader, TabHeader } from "@/components/Layout";

export const CUSTOMER_POLICY = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "ProtectProdBuckets",
      Effect: "Deny",
      Action: ["s3:DeleteBucket", "s3:DeleteObjectVersion", "s3:PutBucketVersioning", "s3:PutLifecycleConfiguration"],
      Resource: [
        "arn:aws:s3:::test-123124",
        "arn:aws:s3:::test-123124/*",
        "arn:aws:s3:::test-123125",
        "arn:aws:s3:::test-123125/*",
      ],
    },
  ],
};

const BREAKGLASS = "arn:aws:iam::*:role/aws-reserved/sso.amazonaws.com/*/AWSReservedSSO_S3BreakGlass_*";

export const RECOMMENDED_ACTIONS = [
  "s3:DeleteBucket",
  "s3:DeleteObjectVersion",
  "s3:PutBucketVersioning",
  "s3:PutLifecycleConfiguration",
  "s3:BypassGovernanceRetention",
  "s3:PutBucketObjectLockConfiguration",
  "s3:PutObjectLegalHold",
  "s3:PutBucketPolicy",
  "s3:DeleteBucketPolicy",
];

export const RECOMMENDED_RCP = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "ProtectProdBuckets",
      Effect: "Deny",
      Principal: "*",
      Action: RECOMMENDED_ACTIONS,
      Resource: CUSTOMER_POLICY.Statement[0]!.Resource,
      Condition: { ArnNotLike: { "aws:PrincipalArn": [BREAKGLASS] } },
    },
  ],
};

export const RECOMMENDED_SCP = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "ProtectProdBuckets",
      Effect: "Deny",
      Action: RECOMMENDED_ACTIONS,
      Resource: CUSTOMER_POLICY.Statement[0]!.Resource,
      Condition: { ArnNotLike: { "aws:PrincipalArn": [BREAKGLASS] } },
    },
    {
      Sid: "ProtectBreakGlassRole",
      Effect: "Deny",
      Action: ["iam:UpdateAssumeRolePolicy", "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:PutRolePermissionsBoundary", "iam:DeleteRole"],
      Resource: BREAKGLASS,
    },
    {
      Sid: "ProtectKmsKey",
      Effect: "Deny",
      Action: ["kms:ScheduleKeyDeletion", "kms:DisableKey", "kms:PutKeyPolicy"],
      Resource: "arn:aws:kms:eu-central-1:<prod-account>:key/<vod-key-id>",
      Condition: { ArnNotLike: { "aws:PrincipalArn": [BREAKGLASS] } },
    },
  ],
};

export function AnswersTab() {
  return (
    <section className="space-y-10">
      <TabHeader title="Löschschutz für Prod-Buckets: die drei Rückfragen">
        <p>
          Ziel: ein zusätzlicher Riegel gegen das versehentliche Löschen der Buckets und ihrer Inhalte, etwa durch einen
          fehlgeleiteten <code className="font-mono">terraform destroy</code> oder ein{" "}
          <code className="font-mono">aws s3 rb --force</code>. Terraform-seitig gibt es prevent_destroy, Versioning und
          Lifecycle (endgültige Löschung nach 7 Tagen). Beides schützt nicht gegen einen Principal, der Objektversionen
          gezielt entfernt.
        </p>
        <p>Der Tab „Live-Test“ führt alles hier Gesagte gegen echte Buckets aus.</p>
      </TabHeader>

      <div className="grid gap-6 lg:grid-cols-2">
        <Code title="Ihr Entwurf" value={CUSTOMER_POLICY} />
        <Code title="Empfehlung als RCP (Ressourcen-seitig, gilt für jeden Principal)" value={RECOMMENDED_RCP} />
      </div>

      <Q n={1} q="Ist ein solcher Deny auf Account-Ebene grundsätzlich möglich?">
        <Short>Ja. Ihr Dokument ist so wie es ist als SCP gültig, und es greift auch gegen Administratoren und den Root-User des Accounts.</Short>
        <p>Es gibt drei Stellen, an denen ein Deny für die Buckets stehen kann:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <b>SCP</b> (AWS Organizations, an Account oder OU gehängt): begrenzt alle IAM-Principals <i>im</i> Account. Ein
            explizites Deny schlägt jede Allow-Policy, auch AdministratorAccess. Ein SCP-Dokument hat kein
            Principal-Element; Ihr Entwurf passt also.
          </li>
          <li>
            <b>RCP</b> (Resource Control Policy, seit November 2024, S3 unterstützt): dieselbe Org-Ebene, aber von der
            Ressource her gedacht. Sie gilt für <i>jeden</i> Request auf die Buckets, auch aus anderen Accounts. Erfordert{" "}
            <code className="font-mono">"Principal": "*"</code>.
          </li>
          <li>
            <b>Bucket Policy</b> (ohne Organizations): Deny mit <code className="font-mono">"Principal": "*"</code>. Schwächer,
            weil sie im selben Account geändert werden kann: Sie muss PutBucketPolicy/DeleteBucketPolicy selbst verbieten,
            und der Root-User des Accounts kann eine Bucket Policy immer löschen.
          </li>
        </ul>
        <p>
          <b>SCP oder RCP?</b> Läuft Ihre Terraform-Pipeline in einem anderen Account (Tooling/CI) und greift per Rolle oder
          Bucket Policy zu, dann gilt dort die SCP <i>jenes</i> Accounts, nicht die des Prod-Accounts. Die RCP am
          Prod-Account greift trotzdem. Für „diese Buckets darf niemand löschen“ ist die RCP deshalb das passendere
          Werkzeug; beide zusammen schaden nicht.
        </p>
        <p className="font-medium">Was beide nicht leisten, und was im Entwurf fehlt:</p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            <b>Delete-Marker bleiben erlaubt, also müssen sie geprüft werden.</b>{" "}
            <code className="font-mono">DeleteObject</code> ohne VersionId ist gewollt erlaubt (die Anwendung darf
            löschen). Auch ein <code className="font-mono">rb --force</code> setzt deshalb auf jedes Objekt einen
            Delete-Marker; die App sieht nichts mehr, nur DeleteBucket scheitert. Die Vorversionen sind dann nicht-aktuell,
            und Ihre Lifecycle-Regel löscht sie nach Marker-Zeit + 7 Tagen (aufgerundet auf 00:00 UTC) endgültig. Lifecycle
            ist kein API-Call eines Principals: <b>keine SCP oder RCP hält das auf</b>. Die 7 Tage sind also Ihr
            Prüffenster: Event pro Marker, Alarm bei Massenlöschung, tägliche Liste mit Frist (siehe Live-Test,
            „Delete-Marker prüfen“). Wer das Fenster nicht zuverlässig prüfen kann, braucht Object Lock oder Legal Hold.
          </li>
          <li>
            <b>Zurückholen geht auch ohne Break-Glass, per Copy.</b> Den Delete-Marker zu entfernen ist technisch das
            Löschen einer Version (<code className="font-mono">s3:DeleteObjectVersion</code>) und damit verweigert. Die
            Vorversion per <code className="font-mono">CopyObject</code> als neue aktuelle Version zu schreiben braucht nur
            GetObjectVersion + PutObject und funktioniert unter dem Deny (im Live-Test geprüft). Über 5 GB: Multipart-Copy.
            Der alte Marker wird nicht-aktuell und läuft per Lifecycle ab.
          </li>
          <li>
            <b>Fehlende Actions</b>, sobald Sie Object Lock oder eine Bucket Policy nutzen:{" "}
            <code className="font-mono">s3:BypassGovernanceRetention</code>,{" "}
            <code className="font-mono">s3:PutBucketObjectLockConfiguration</code>,{" "}
            <code className="font-mono">s3:PutObjectLegalHold</code>, <code className="font-mono">s3:PutBucketPolicy</code>,{" "}
            <code className="font-mono">s3:DeleteBucketPolicy</code>. Bei SSE-KMS mit eigenem Key zusätzlich{" "}
            <code className="font-mono">kms:ScheduleKeyDeletion</code>/<code className="font-mono">DisableKey</code>: ohne Key
            sind die Daten ebenfalls weg.
          </li>
          <li>
            <b>Terraform-Nebenwirkung:</b> Jede künftige Änderung an <code className="font-mono">aws_s3_bucket_versioning</code>{" "}
            oder <code className="font-mono">aws_s3_bucket_lifecycle_configuration</code> scheitert für die Pipeline-Rolle
            (auch DeleteBucketLifecycle hängt an <code className="font-mono">s3:PutLifecycleConfiguration</code>). Solche
            Änderungen laufen dann über Break-Glass. Das ist gewollt, sollte aber bekannt sein.
          </li>
          <li>
            <b>Grenzen:</b> SCPs und RCPs wirken nicht im Management-Account und nicht auf Service-Linked Roles. Die Buckets
            müssen in einem Member-Account liegen.
          </li>
        </ol>
      </Q>

      <Q n={2} q="Wie bauen wir die Buckets regulär ab? Ist eine Ausnahme per Condition auf eine Break-Glass-Rolle machbar?">
        <Short>Ja, mit ArnNotLike auf aws:PrincipalArn. Die Rolle muss dann selbst geschützt sein.</Short>
        <Code>{`"Condition": {
  "ArnNotLike": {
    "aws:PrincipalArn": [
      "${BREAKGLASS}"
    ]
  }
}`}</Code>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <code className="font-mono">aws:PrincipalArn</code> ist bei Rollen die <i>Rollen</i>-ARN (nicht die Session-ARN).
            IAM-Identity-Center-Rollen tragen einen Pfad und ein zufälliges Suffix: daher Wildcard und{" "}
            <code className="font-mono">ArnNotLike</code>.
          </li>
          <li>
            Als Permission Set in IAM Identity Center: zuweisen kann nur, wer im Management-/Delegated-Admin-Account
            Identity Center verwaltet. Die Rolle im Account verwaltet der Dienst über eine Service-Linked Role, die SCPs
            nicht betreffen. Ein zweites SCP-Statement verbietet allen anderen, die Rolle zu ändern (siehe Referenz).
          </li>
          <li>Kurze Session, MFA beim Identity-Center-Login, Alarm auf jede Nutzung (CloudTrail: AssumeRoleWithSAML / Federation).</li>
          <li>
            Ohne Ausnahme geht es auch: Für den Abbau hängt ein Org-Admin die Policy im Management-Account kurz ab. Das ist
            die stärkere Trennung, weil niemand im Prod-Account den Riegel selbst lösen kann.
          </li>
        </ul>
        <p>Der Ablauf Schritt für Schritt steht im Tab „Abbau“.</p>
      </Q>

      <Q n={3} q="Kann die SCP auf schon bestehende Ressourcen angewendet werden?">
        <Short>Ja. SCPs und RCPs werden bei jedem Request ausgewertet, nicht an Ressourcen gebunden. Sie gelten Sekunden nach dem Anhängen für die bestehenden Buckets.</Short>
        <p>
          Keine Migration, kein Neuanlegen. Es reicht, die Bucket-ARNs (oder ein Muster wie{" "}
          <code className="font-mono">arn:aws:s3:::test-*</code>) zu nennen. Vorher die SCP-/RCP-Policy-Typen am
          Root aktivieren; das hängt automatisch FullAWSAccess bzw. RCPFullAWSAccess an und ändert nichts.
        </p>
        <p>
          Anders bei <b>Object Lock</b>: Es lässt sich seit November 2023 auf bestehenden Buckets einschalten, aber die
          Default Retention gilt nur für <i>neue</i> Versionen. Bestehende Objekte sperrt ein S3-Batch-Operations-Job
          (Retention oder Legal Hold). Object Lock lässt sich nie wieder ausschalten, und Versioning ist danach nicht mehr
          aussetzbar.
        </p>
      </Q>

      <div className="space-y-4">
        <SubHeader title="Kurzfassung der Empfehlung" />
        <ol className="max-w-4xl list-decimal space-y-2 pl-5 text-sm">
          <li>RCP (gern zusätzlich SCP) mit der erweiterten Action-Liste und der Break-Glass-Ausnahme auf beide Buckets. Kostet nichts, wirkt sofort.</li>
          <li>
            Delete-Marker erlaubt lassen und im 7-Tage-Fenster prüfen: EventBridge „Delete Marker Created“ → Benachrichtigung,
            Schwellwert-Alarm für Massenlöschungen, tägliche Liste versteckter Objekte mit Frist. Wiederherstellen per Copy der
            Vorversion (Runbook, kein Break-Glass nötig).
          </li>
          <li>Alarm auf verweigerte DeleteBucket/DeleteObjectVersion-Versuche und auf jede Break-Glass-Anmeldung.</li>
          <li>
            Optional, wenn das Prüffenster nicht reicht: Object Lock GOVERNANCE nachrüsten, Bestand per Batch Operations mit
            Legal Hold oder rollierender Retention sperren. Damit ist auch der Weg „Delete-Marker + Lifecycle“ zu.
          </li>
          <li>Terraform: prevent_destroy bleibt, dazu eine Plan-Prüfung in CI und eine Pipeline-Rolle ohne Lösch-Rechte.</li>
          <li>Sind die Daten unersetzlich: zusätzlich Replikation in einen Bunker-Account mit Object Lock (oder AWS Backup mit Vault Lock).</li>
        </ol>
      </div>
    </section>
  );
}
