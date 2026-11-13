data "aws_caller_identity" "current" {}

resource "random_id" "suffix" {
  byte_length = 3
}

resource "random_integer" "bucket_base" {
  min = 100000
  max = 999999
}

locals {
  project = var.project
  account = data.aws_caller_identity.current.account_id
  tags    = { Project = var.project, Owner = "instructor" }
  prefix  = "${var.project}-${random_id.suffix.hex}"

  # Scenario buckets are created and reset by the API (with the break-glass role),
  # not by Terraform: the attacks really delete them, and Terraform state would drift.
  #   lock         Object Lock mode + default retention (null = no Object Lock)
  #   bucketPolicy deny statement in the bucket policy (account-local guard)
  #   org          which organization policy names the bucket (scp | rcp | null)
  #   config       AWS Config versioning rule + auto-remediation (tag-scoped)
  scenarios = [
    { id = "baseline", lock = null, bucketPolicy = false, org = null, config = true },
    { id = "bucket-policy", lock = null, bucketPolicy = true, org = null, config = false },
    { id = "org-scp", lock = null, bucketPolicy = false, org = "scp", config = false },
    { id = "org-rcp", lock = null, bucketPolicy = false, org = "rcp", config = false },
    { id = "governance", lock = { mode = "GOVERNANCE", days = var.governance_days }, bucketPolicy = false, org = null, config = false },
    { id = "recommended", lock = { mode = "GOVERNANCE", days = var.governance_days }, bucketPolicy = false, org = "rcp-extended", config = false },
    { id = "compliance", lock = { mode = "COMPLIANCE", days = var.compliance_days }, bucketPolicy = false, org = null, config = false },
  ]
  # Scenario buckets are named test-<base><nn>: a random 6-digit base (bucket
  # names are global) plus the scenario number, e.g. test-48213901. A successful
  # delete makes the API create the next generation test-<base><nn>-<gen> (a
  # just-deleted name stays in limbo for minutes), so the guards name a pattern,
  # like test-* would.
  bucket_prefix  = "test-${random_integer.bucket_base.result}"
  bucket_base    = { for i, s in local.scenarios : s.id => format("%s%02d", local.bucket_prefix, i + 1) }
  bucket_pattern = { for id, b in local.bucket_base : id => "${b}*" }
  arns           = { for id, b in local.bucket_pattern : id => ["arn:aws:s3:::${b}", "arn:aws:s3:::${b}/*"] }

  breakglass_role = "${local.project}-breakglass"
  admin_role      = "${local.project}-admin"
  breakglass_arn  = "arn:aws:iam::${local.account}:role/${local.breakglass_role}"

  # The customer's proposal, verbatim.
  customer_actions = ["s3:DeleteBucket", "s3:DeleteObjectVersion", "s3:PutBucketVersioning", "s3:PutLifecycleConfiguration"]
  # What the recommended guard adds: no bypass of Object Lock GOVERNANCE, no removal
  # or rewrite of the bucket policy, no change of the Object Lock default retention.
  extended_actions = concat(local.customer_actions, [
    "s3:BypassGovernanceRetention",
    "s3:PutBucketPolicy",
    "s3:DeleteBucketPolicy",
    "s3:PutBucketObjectLockConfiguration",
  ])

  breakglass_condition = { ArnNotLike = { "aws:PrincipalArn" = [local.breakglass_arn] } }

  # --- account level: bucket policy (applied by the API to the bucket-policy scenario)
  bucket_policy = {
    Version = "2012-10-17"
    Statement = [{
      Sid       = "ProtectFromDeletion"
      Effect    = "Deny"
      Principal = "*"
      Action    = local.extended_actions
      Resource  = ["arn:aws:s3:::__BUCKET__", "arn:aws:s3:::__BUCKET__/*"] # filled in by the API
      Condition = local.breakglass_condition
    }]
  }

  # --- organization level: SCP (principals of the member account)
  scp = {
    Version = "2012-10-17"
    Statement = [{
      Sid       = "ProtectProdBuckets"
      Effect    = "Deny"
      Action    = local.customer_actions
      Resource  = local.arns["org-scp"]
      Condition = local.breakglass_condition
    }]
  }

  # --- organization level: RCP (every principal, any account, calling these resources)
  rcp = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "ProtectProdBuckets"
        Effect    = "Deny"
        Principal = "*"
        Action    = local.customer_actions
        Resource  = local.arns["org-rcp"]
        Condition = local.breakglass_condition
      },
      {
        Sid       = "ProtectProdBucketsExtended"
        Effect    = "Deny"
        Principal = "*"
        Action    = local.extended_actions
        Resource  = local.arns["recommended"]
        Condition = local.breakglass_condition
      },
    ]
  }

  fn_config = jsonencode({
    region         = var.region
    account        = local.account
    prefix         = local.bucket_prefix
    noncurrentDays = var.noncurrent_days
    scenarios      = [for s in local.scenarios : merge(s, { base = local.bucket_base[s.id], pattern = local.bucket_pattern[s.id] })]
    roles = {
      admin      = aws_iam_role.admin.arn
      breakglass = aws_iam_role.breakglass.arn
    }
    configRule = var.enable_config ? aws_config_config_rule.versioning[0].name : null
    policies = {
      customerActions = local.customer_actions
      extendedActions = local.extended_actions
      bucketPolicy    = local.bucket_policy
      scp             = local.scp
      rcp             = local.rcp
    }
  })
}

data "archive_file" "api" {
  type        = "zip"
  output_path = "${path.module}/.build/api.zip"
  source {
    content  = file("${path.module}/../functions/api/index.mjs")
    filename = "index.mjs"
  }
  source {
    content  = local.fn_config
    filename = "config.json"
  }
}
