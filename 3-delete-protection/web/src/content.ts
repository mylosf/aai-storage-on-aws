import type { Outcome } from "./types";

export const SCENARIO_META: Record<string, { title: string; sub: string }> = {
  baseline: { title: "Ist-Zustand", sub: "Versioning + Lifecycle 7 Tage, Config-Remediation" },
  "bucket-policy": { title: "Bucket Policy", sub: "+ Deny in der Bucket Policy (Account-lokal)" },
  "org-scp": { title: "SCP (Entwurf)", sub: "+ Ihre 4 Actions als SCP" },
  "org-rcp": { title: "RCP (Entwurf)", sub: "+ Ihre 4 Actions als RCP" },
  governance: { title: "Object Lock Governance", sub: "+ Default Retention 7 Tage, kein Deny" },
  recommended: { title: "Empfehlung", sub: "RCP erweitert + Object Lock Governance" },
  compliance: { title: "Object Lock Compliance", sub: "Retention 1 Tag, ohne Ausnahme" },
};

export const ATTACK_META: Record<string, { title: string; what: string }> = {
  "rb-force": { title: "aws s3 rb --force", what: "Löscht alle aktuellen Objekte (ohne VersionId → Delete-Marker), dann DeleteBucket." },
  "tf-destroy": { title: "terraform destroy", what: "force_destroy = true, prevent_destroy entfernt: alle Versionen mit Governance-Bypass löschen, dann DeleteBucket." },
  "delete-version": { title: "Version gezielt löschen", what: "DeleteObject mit VersionId: die Version ist unwiderruflich weg." },
  "suspend-versioning": { title: "Versioning aussetzen", what: "Danach überschreibt bzw. löscht jedes PUT/DELETE endgültig." },
  "lifecycle-expire": { title: "Lifecycle: alles nach 1 Tag", what: "S3 löscht dann selbst. Das ist kein API-Call eines Principals: keine SCP/RCP greift mehr." },
  "delete-policy": { title: "Bucket Policy löschen", what: "Entfernt den Account-lokalen Riegel." },
  "bypass-governance": { title: "Governance-Bypass", what: "DeleteObject mit x-amz-bypass-governance-retention. s3:* enthält s3:BypassGovernanceRetention." },
  restore: { title: "Wiederherstellen: Marker entfernen", what: "Delete-Marker setzen und wieder entfernen. Entfernen ist s3:DeleteObjectVersion." },
  "restore-copy": { title: "Wiederherstellen: Vorversion kopieren", what: "Delete-Marker setzen, dann die Vorversion per CopyObject als neue aktuelle Version schreiben. Braucht nur GetObjectVersion + PutObject." },
};

export const OUTCOME_META: Record<Outcome, { label: string; cls: string; help: string }> = {
  blocked: { label: "verweigert", cls: "bg-emerald-50 text-emerald-800 border-emerald-200", help: "Nichts verändert." },
  outage: { label: "Ausfall", cls: "bg-amber-50 text-amber-800 border-amber-300", help: "Delete-Marker: Objekte unsichtbar, Versionen noch da. Lifecycle löscht sie nach N Tagen endgültig." },
  weakened: { label: "Riegel weg", cls: "bg-orange-50 text-orange-800 border-orange-300", help: "Schutz entfernt oder Löschung durch S3 selbst eingeplant." },
  destroyed: { label: "gelöscht", cls: "bg-red-50 text-red-800 border-red-300", help: "Daten endgültig weg." },
  noop: { label: "ohne Wirkung", cls: "bg-muted text-muted-foreground border-border", help: "Erlaubt, aber hier nichts zu entfernen." },
  na: { label: "n/a", cls: "bg-transparent text-muted-foreground border-dashed", help: "Nicht anwendbar." },
  restorable: { label: "möglich", cls: "bg-sky-50 text-sky-800 border-sky-200", help: "Wiederherstellen mit normalen Rechten möglich." },
  "needs-breakglass": { label: "nur Break-Glass", cls: "bg-violet-50 text-violet-800 border-violet-200", help: "Der Riegel blockiert auch die Wiederherstellung." },
  error: { label: "Fehler", cls: "bg-muted text-foreground border-border", help: "Unerwarteter Fehler, siehe Log." },
};

export interface OptionRow {
  name: string;
  layer: string;
  protects: string;
  bypass: string;
  existing: string;
  cost: string;
  when: string;
  kind: "preventive" | "detective" | "copy" | "iac";
}

export const OPTIONS: OptionRow[] = [
  {
    name: "Terraform prevent_destroy",
    layer: "IaC",
    protects: "terraform destroy und Replace dieser Ressource, solange der Block im Code steht.",
    bypass: "Block entfernen (oder ganze Ressource aus dem Code löschen), CLI, Konsole, anderes Tool.",
    existing: "sofort",
    cost: "0",
    when: "Immer. Erste Leitplanke, aber nur gegen Terraform selbst.",
    kind: "iac",
  },
  {
    name: "force_destroy = false + Plan-Policy (OPA/Conftest, Sentinel)",
    layer: "IaC / CI",
    protects: "Pipeline bricht ab, wenn der Plan einen test-* Bucket löschen oder ersetzen will.",
    bypass: "Wer an der Pipeline vorbei arbeitet.",
    existing: "sofort",
    cost: "0",
    when: "Wenn Terraform in CI läuft. Fängt den ‚fehlgeleiteten destroy‘ vor jedem API-Call ab.",
    kind: "iac",
  },
  {
    name: "Versioning + Lifecycle (Ist-Zustand)",
    layer: "Bucket",
    protects: "Überschreiben und einfaches DELETE: es entsteht nur ein Delete-Marker.",
    bypass: "DeleteObjectVersion, Versioning aussetzen, Lifecycle ändern: alles mit s3:*.",
    existing: "sofort (nur neue Versionen)",
    cost: "Speicher der Versionen (hier ≤ 7 Tage)",
    when: "Grundvoraussetzung für alles Weitere (Object Lock, Replikation, AWS Backup).",
    kind: "preventive",
  },
  {
    name: "Bucket Policy mit Deny",
    layer: "Account / Ressource",
    protects: "Jeder Principal, auch aus fremden Accounts, ohne AWS Organizations.",
    bypass: "Wer s3:PutBucketPolicy/DeleteBucketPolicy hat (muss die Policy selbst verbieten). Der Root-User des Accounts kann eine Bucket Policy immer löschen.",
    existing: "sofort",
    cost: "0",
    when: "Kein Organizations-Zugriff, oder als zusätzliche Schicht. Allein der schwächste Riegel.",
    kind: "preventive",
  },
  {
    name: "SCP (Service Control Policy)",
    layer: "Organization → Account/OU",
    protects: "Alle IAM-Principals im Member-Account, inkl. dessen Root-User, für jede Ressource.",
    bypass: "Management-Account, Service-Linked Roles, Principals aus anderen Accounts (z. B. Pipeline im Tooling-Account), S3 Lifecycle.",
    existing: "sofort (Auswertung pro Request)",
    cost: "0",
    when: "Wenn alle relevanten Principals im Prod-Account leben. Ihr Entwurf ist als SCP gültig.",
    kind: "preventive",
  },
  {
    name: "RCP (Resource Control Policy)",
    layer: "Organization → Account/OU",
    protects: "Jeder Request auf die Buckets im Member-Account, egal aus welchem Account der Principal kommt.",
    bypass: "Management-Account, Service-Linked Roles, S3 Lifecycle.",
    existing: "sofort (Auswertung pro Request)",
    cost: "0",
    when: "Ziel ist ‚diese Ressource darf niemand löschen‘. Passt besser als SCP, sobald Pipelines oder Tools aus anderen Accounts zugreifen.",
    kind: "preventive",
  },
  {
    name: "MFA Delete",
    layer: "Bucket",
    protects: "DeleteObjectVersion und Versioning-Änderung nur mit MFA-Code.",
    bypass: "Root-User mit MFA.",
    existing: "sofort",
    cost: "0",
    when: "Selten. Nur der Root-User kann es aktivieren (CLI), nicht automatisierbar, und nicht mit Lifecycle-Regeln kombinierbar: hier ausgeschlossen.",
    kind: "preventive",
  },
  {
    name: "Object Lock GOVERNANCE",
    layer: "Objektversion",
    protects: "Löschen/Überschreiben jeder gesperrten Version bis retain-until, auch durch Lifecycle. Bucket ist nicht löschbar, solange gesperrte Versionen existieren.",
    bypass: "s3:BypassGovernanceRetention + Header. Steckt in s3:*, und Terraform force_destroy nutzt den Bypass.",
    existing: "nachträglich aktivierbar (seit 11/2023); Bestand per S3 Batch Operations sperren",
    cost: "0 extra; gesperrte Versionen bleiben bis retain-until",
    when: "Zusammen mit SCP/RCP, die den Bypass verbietet. Für langlebige Daten: rollierende Retention oder Legal Hold.",
    kind: "preventive",
  },
  {
    name: "Object Lock COMPLIANCE",
    layer: "Objektversion",
    protects: "Niemand löscht vor retain-until: auch nicht Root, auch nicht der AWS Support.",
    bypass: "Keiner (nur Account schließen). Retention lässt sich nur verlängern.",
    existing: "wie Governance",
    cost: "Speicher bis retain-until, nicht verkürzbar",
    when: "Regulatorische WORM-Pflichten, Backup-Kopien gegen Ransomware. Für Prod-Arbeitsdaten meist zu starr.",
    kind: "preventive",
  },
  {
    name: "Legal Hold",
    layer: "Objektversion",
    protects: "Wie Object Lock, aber ohne Ablaufdatum.",
    bypass: "s3:PutObjectLegalHold (per SCP/RCP verbieten).",
    existing: "Bestand per S3 Batch Operations",
    cost: "0",
    when: "‚Behalten bis jemand bewusst freigibt‘: passt zu einem VOD-Archiv besser als feste Tage.",
    kind: "preventive",
  },
  {
    name: "AWS Config + Auto-Remediation",
    layer: "Detektiv",
    protects: "Drift: Versioning aus, Lifecycle fehlt, Object Lock fehlt. Remediation (SSM) stellt zurück.",
    bypass: "Alles, was in den Minuten bis zur Auswertung passiert. Verhindert keine Löschung.",
    existing: "ja, bewertet den Bestand",
    cost: "Config-Items + Evaluations (Cent-Bereich für S3)",
    when: "Viele Buckets/Accounts, Compliance-Nachweis. Ergänzung, kein Löschschutz.",
    kind: "detective",
  },
  {
    name: "Delete-Marker prüfen (7-Tage-Fenster)",
    layer: "Detektiv",
    protects: "Delete-Marker bleiben erlaubt (die Anwendung darf löschen), aber jeder ist sichtbar: Event pro Marker, Massen-Alarm (z. B. > 100/h), tägliche Liste mit Frist. Wiederherstellen per Copy der Vorversion, ohne DeleteObjectVersion.",
    bypass: "Wer nicht hinschaut: nach Marker-Zeit + 7 Tagen (aufgerundet auf 00:00 UTC) löscht Lifecycle endgültig.",
    existing: "sofort (EventBridge); Bestand per S3 Inventory mit Versionen",
    cost: "≈ 0 (EventBridge, Lambda); Inventory ab Cent-Bereich",
    when: "Immer, wenn DeleteObject erlaubt bleibt. Das ist der Kern Ihres Ansatzes: Löschen dürfen, aber 7 Tage lang prüfen und zurückholen können.",
    kind: "detective",
  },
  {
    name: "Alarm: DeleteBucket-Versuche, Break-Glass-Nutzung",
    layer: "Detektiv",
    protects: "Verweigerte DeleteBucket/DeleteObjectVersion-Versuche (CloudTrail, errorCode AccessDenied) und jede Break-Glass-Anmeldung fallen auf.",
    bypass: "–",
    existing: "sofort",
    cost: "≈ 0 (EventBridge)",
    when: "Immer: ein verweigerter Versuch ist ein Hinweis auf einen fehlgeleiteten Lauf.",
    kind: "detective",
  },
  {
    name: "Replikation in einen Bunker-Account",
    layer: "Kopie",
    protects: "Fehler oder Kompromittierung im Prod-Account. DeleteObjectVersion wird nie repliziert, Delete-Marker nur auf Wunsch.",
    bypass: "Zugriff im Bunker-Account (dort Object Lock + eigene RCP).",
    existing: "S3 Batch Replication für den Bestand",
    cost: "zweiter Speicher + Replikation",
    when: "Daten unersetzlich, Ransomware-Szenario, getrennte Verantwortung.",
    kind: "copy",
  },
  {
    name: "AWS Backup für S3 (Vault Lock, logically air-gapped vault)",
    layer: "Kopie",
    protects: "Point-in-time-Restore, zentrale Backup-Richtlinien, Vault Lock gegen Löschen der Backups.",
    bypass: "Vault Lock Compliance: niemand.",
    existing: "ja (Versioning nötig)",
    cost: "Backup-Speicher, teurer als S3 Standard",
    when: "Wenn ohnehin zentral über AWS Backup gesichert und reportet wird.",
    kind: "copy",
  },
];

export const KIND_LABEL: Record<OptionRow["kind"], string> = {
  iac: "IaC",
  preventive: "präventiv",
  detective: "detektiv",
  copy: "Kopie",
};
