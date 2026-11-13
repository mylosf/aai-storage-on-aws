data "aws_caller_identity" "current" {}

resource "random_id" "suffix" {
  byte_length = 3
}

locals {
  cfg     = jsondecode(file("${path.module}/../regions.json"))
  project = var.project
  tags    = { Project = var.project, Owner = "instructor" }

  replicas    = local.cfg.replicas
  replica_ids = [for r in local.cfg.replicas : r.id]

  bucket_prefix = "${var.project}-${data.aws_caller_identity.current.account_id}-${random_id.suffix.hex}"
  source_bucket = "${local.bucket_prefix}-source"
  web_bucket    = "${local.bucket_prefix}-web"

  # Lambda code (no dependencies: the Node 22 runtime ships AWS SDK v3)
  fn_dir = "${path.module}/../functions"
}

data "archive_file" "probe" {
  type        = "zip"
  source_dir  = "${local.fn_dir}/probe"
  output_path = "${path.module}/.build/probe.zip"
}

# Lambda environment variables are capped at 4 KB, so the shared config ships
# as config.json inside the function bundle.
locals {
  fn_config = jsonencode({
    source            = local.cfg.source
    replicas          = local.cfg.replicas
    bureaus           = local.cfg.bureaus
    replicaBuckets    = local.replica_buckets
    probeFunctions    = local.probe_function_arns
    lateRegions       = var.late_regions
    replicaExpiryDays = var.replica_expiry_days
    storageClasses    = { masters = var.masters_storage_class, proxies = var.proxies_storage_class }
  })
}

data "archive_file" "api" {
  type        = "zip"
  output_path = "${path.module}/.build/api.zip"
  source {
    content  = file("${local.fn_dir}/api/index.mjs")
    filename = "index.mjs"
  }
  source {
    content  = local.fn_config
    filename = "config.json"
  }
}

data "archive_file" "ingest" {
  type        = "zip"
  output_path = "${path.module}/.build/ingest.zip"
  source {
    content  = file("${local.fn_dir}/ingest/index.mjs")
    filename = "index.mjs"
  }
  source {
    content  = local.fn_config
    filename = "config.json"
  }
}
