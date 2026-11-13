# S3 delete-protection demo: SCP, RCP, bucket policy, Object Lock, Config

Answers a customer question (German UI): "Can we deny bucket and version deletes for two prod buckets
at account level, how do we decommission them later via a break-glass role, and does the SCP apply
to existing buckets?", and shows every alternative with real API calls.

## Tabs

1. **Antworten**: the three questions answered, the customer's draft vs. the recommended RCP.
2. **Alle Optionen**: prevent_destroy, plan policies, versioning/lifecycle, bucket policy, SCP, RCP, MFA delete,
   Object Lock governance/compliance, legal hold, Config remediation, alarms, bunker replication, AWS Backup;
   who each policy type stops; when to use what.
3. **Live-Test**: 8 attacks × 7 scenario buckets, as `admin` (s3:* on the demo buckets) or `breakglass`
   (same rights, named in every exception). Each cell is a real call; the log shows AWS's denial message
   ("explicit deny in a service control policy / resource control policy / resource-based policy").
   Bucket state, a live AWS Config remediation demo and S3 "Object Deleted" events via EventBridge.
4. **Abbau (Break-Glass)**: decommission runbook, Terraform and Conftest snippets.
5. **Referenz**: policy templates, deployed policies, gotchas, sources.

## Scenarios

| id | guard |
|---|---|
| baseline | versioning + lifecycle (noncurrent 7 d) + Config rule with auto-remediation |
| bucket-policy | + deny in the bucket policy (extended action list, break-glass exception) |
| org-scp | + the customer's 4 actions as **SCP** |
| org-rcp | + the customer's 4 actions as **RCP** |
| governance | + Object Lock GOVERNANCE 7 d |
| recommended | RCP with extended actions (incl. BypassGovernanceRetention) + GOVERNANCE 7 d |
| compliance | Object Lock COMPLIANCE 1 d |

Scenario buckets are `test-<base><nn>` (random 6-digit base, nn = scenario number, e.g. `test-48213901`),
created and reset by the API with the break-glass role (not Terraform: the attacks really delete them).
After a successful delete the scenario gets a new generation `test-<base><nn>-<gen>`, because a
just-deleted name is unusable for minutes; the SCP/RCP therefore name a pattern (`test-<base><nn>*`), as
`test-*` would.

## Run

```bash
export AWS_PROFILE=<your profile>
cp infra/terraform.tfvars.example infra/terraform.tfvars   # set account_id
make init
make deploy                 # infra + web + scenario buckets
make url

# organization level: runs in your MANAGEMENT account, the demo account must be a member
cp org/terraform.tfvars.example org/terraform.tfvars        # set management_account_id
export ORG_PROFILE=<management-account profile> ORG_ROOT=<r-xxxx>
make org-enable             # once, org-wide: enable SCP + RCP policy types on the root
make org-apply              # SCP + RCP attached to the demo account only
```

Without the org step the SCP/RCP/"Empfehlung" columns behave like their unguarded counterparts; the page
says so ("nicht angehängt").

`make destroy` = teardown (break-glass deletes all scenario buckets) + org destroy + infra destroy. The
compliance bucket cannot be deleted until its retention (≤ 1 day after the last reset) ends: run
`make teardown` again the next day, or delete it by hand.

Idle cost: a few KB in S3, Config items for S3 buckets only, no EC2. The API is unauthenticated, like the
other demos: anyone with the URL can run attacks against the demo buckets (and only those).
