# ---------------------------------------------------------------------------
# Source of truth: the Frankfurt bucket and its replication configuration.
#
# Layout (type first, so prefix rules can select by type):
#   masters/<show>/<clip>.mxf      big camera masters   -> replicated on assignment (tags)
#   proxies/<show>/<clip>.mp4      low-res proxies      -> replicated to every region
#   sidecars/<show>/<clip>.xml|srt metadata, captions   -> replicated to every region
#   rundowns/<show>-<date>.json    the assignment trigger (never replicated)
#   lab/<run>/<size>.bin           replication-lab test objects (tags decide where)
#
# Rules per replica region R (priorities unique, 4 per region):
#   proxies-R         prefix proxies/             class ONEZONE_IA   metrics
#   sidecars-R        prefix sidecars/            class ONEZONE_IA   metrics
#   masters-R         tag dest-R=1                class STANDARD     RTC + metrics
#   masters-nortc-R   tag dest-nortc-R=1          class STANDARD     metrics only (for the lab comparison)
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "source" {
  bucket        = local.source_bucket
  force_destroy = true
  tags          = { Name = local.source_bucket, Role = "source" }
}

resource "aws_s3_bucket_versioning" "source" {
  bucket = aws_s3_bucket.source.id
  versioning_configuration { status = "Enabled" }
}

# Public read is allowed ONLY for proxies/uploads/* (the Upload tab), via the
# bucket policy below. ACLs stay blocked; everything else stays private.
resource "aws_s3_bucket_public_access_block" "source" {
  bucket                  = aws_s3_bucket.source.id
  block_public_acls       = true
  block_public_policy     = false
  ignore_public_acls      = true
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "source_public_uploads" {
  bucket     = aws_s3_bucket.source.id
  depends_on = [aws_s3_bucket_public_access_block.source]
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicReadUploadsOnly"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.source.arn}/proxies/uploads/*"
    }]
  })
}

# The browser uploads directly to Frankfurt with a presigned PUT.
resource "aws_s3_bucket_cors_configuration" "source" {
  bucket = aws_s3_bucket.source.id
  cors_rule {
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = ["https://${aws_cloudfront_distribution.main.domain_name}", "http://localhost:5173", "http://localhost:5174"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag", "x-amz-version-id"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "source" {
  bucket = aws_s3_bucket.source.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "source" {
  bucket     = aws_s3_bucket.source.id
  depends_on = [aws_s3_bucket_versioning.source]
  rule {
    id     = "housekeeping"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
    noncurrent_version_expiration { noncurrent_days = 3 }
  }
  rule {
    id     = "uploads-are-temporary"
    status = "Enabled"
    filter { prefix = "proxies/uploads/" }
    expiration { days = 1 }
  }
  rule {
    id     = "lab-objects-are-temporary"
    status = "Enabled"
    filter { prefix = "lab/" }
    expiration { days = 2 }
  }
}

# --- replication role --------------------------------------------------------
data "aws_iam_policy_document" "replication_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "replication" {
  name               = "${local.project}-replication"
  assume_role_policy = data.aws_iam_policy_document.replication_assume.json
}

data "aws_iam_policy_document" "replication" {
  statement {
    actions   = ["s3:GetReplicationConfiguration", "s3:ListBucket"]
    resources = [aws_s3_bucket.source.arn]
  }
  statement {
    actions = [
      "s3:GetObjectVersionForReplication",
      "s3:GetObjectVersionAcl",
      "s3:GetObjectVersionTagging",
      "s3:GetObjectRetention",
      "s3:GetObjectLegalHold",
    ]
    resources = ["${aws_s3_bucket.source.arn}/*"]
  }
  statement {
    actions   = ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags", "s3:ObjectOwnerOverrideToBucketOwner"]
    resources = [for arn in values(local.replica_bucket_arns) : "${arn}/*"]
  }
}

resource "aws_iam_role_policy" "replication" {
  name   = "${local.project}-replication"
  role   = aws_iam_role.replication.id
  policy = data.aws_iam_policy_document.replication.json
}

# --- replication rules -------------------------------------------------------
locals {
  # index per region for unique priorities
  replica_index = { for i, id in local.replica_ids : id => i }
}

resource "aws_s3_bucket_replication_configuration" "source" {
  bucket     = aws_s3_bucket.source.id
  role       = aws_iam_role.replication.arn
  depends_on = [aws_s3_bucket_versioning.source, aws_iam_role_policy.replication]

  # proxies -> everywhere
  dynamic "rule" {
    for_each = local.replica_ids
    content {
      id       = "proxies-${rule.value}"
      priority = local.replica_index[rule.value] * 4
      status   = "Enabled"
      filter { prefix = "proxies/" }
      delete_marker_replication { status = "Enabled" }
      source_selection_criteria {
        replica_modifications { status = "Enabled" }
      }
      destination {
        bucket        = local.replica_bucket_arns[rule.value]
        storage_class = var.proxies_storage_class
        metrics { status = "Enabled" }
      }
    }
  }

  # sidecars -> everywhere
  dynamic "rule" {
    for_each = local.replica_ids
    content {
      id       = "sidecars-${rule.value}"
      priority = local.replica_index[rule.value] * 4 + 1
      status   = "Enabled"
      filter { prefix = "sidecars/" }
      delete_marker_replication { status = "Enabled" }
      source_selection_criteria {
        replica_modifications { status = "Enabled" }
      }
      destination {
        bucket        = local.replica_bucket_arns[rule.value]
        storage_class = var.proxies_storage_class
        metrics { status = "Enabled" }
      }
    }
  }

  # masters -> only where the tag says, with Replication Time Control.
  # Regions in var.late_regions start Disabled: the Batch Replication demo enables
  # the rule from the page and backfills what was assigned in the meantime.
  dynamic "rule" {
    for_each = local.replica_ids
    content {
      id       = "masters-${rule.value}"
      priority = local.replica_index[rule.value] * 4 + 2
      status   = contains(var.late_regions, rule.value) ? "Disabled" : "Enabled"
      filter {
        tag {
          key   = "dest-${rule.value}"
          value = "1"
        }
      }
      delete_marker_replication { status = "Disabled" } # not allowed with tag filters
      source_selection_criteria {
        replica_modifications { status = "Enabled" }
      }
      destination {
        bucket        = local.replica_bucket_arns[rule.value]
        storage_class = var.masters_storage_class
        replication_time {
          status = "Enabled"
          time { minutes = var.rtc_minutes }
        }
        metrics {
          status = "Enabled"
          event_threshold { minutes = var.rtc_minutes }
        }
      }
    }
  }

  # the same, without RTC, so the lab can compare
  dynamic "rule" {
    for_each = local.replica_ids
    content {
      id       = "masters-nortc-${rule.value}"
      priority = local.replica_index[rule.value] * 4 + 3
      status   = "Enabled"
      filter {
        tag {
          key   = "dest-nortc-${rule.value}"
          value = "1"
        }
      }
      delete_marker_replication { status = "Disabled" } # not allowed with tag filters
      source_selection_criteria {
        replica_modifications { status = "Enabled" }
      }
      destination {
        bucket        = local.replica_bucket_arns[rule.value]
        storage_class = var.masters_storage_class
        metrics { status = "Enabled" }
      }
    }
  }
}
