# One replica region: a versioned bucket that receives replicas, an EventBridge
# rule that forwards "Object Created" events to the central bus in Frankfurt
# (so arrivals can be timestamped), and a probe Lambda that measures latency
# and throughput from this region to every bucket.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

variable "project" { type = string }
variable "region" { type = string }
variable "bucket_name" { type = string }
variable "central_bus_arn" { type = string }
variable "forward_role_arn" { type = string }
variable "probe_role_arn" { type = string }
variable "probe_zip" { type = string }
variable "probe_zip_hash" { type = string }
variable "replica_expiry_days" { type = number }

# ---------------------------------------------------------------- bucket
resource "aws_s3_bucket" "replica" {
  bucket        = var.bucket_name
  force_destroy = true
  tags          = { Name = var.bucket_name, Role = "replica" }
}

# Replication requires versioning on both ends.
resource "aws_s3_bucket_versioning" "replica" {
  bucket = aws_s3_bucket.replica.id
  versioning_configuration { status = "Enabled" }
}

# Public read only for proxies/uploads/* so the Upload tab's links work.
resource "aws_s3_bucket_public_access_block" "replica" {
  bucket                  = aws_s3_bucket.replica.id
  block_public_acls       = true
  block_public_policy     = false
  ignore_public_acls      = true
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "replica_public_uploads" {
  bucket     = aws_s3_bucket.replica.id
  depends_on = [aws_s3_bucket_public_access_block.replica]
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicReadUploadsOnly"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.replica.arn}/proxies/uploads/*"
    }]
  })
}

resource "aws_s3_bucket_server_side_encryption_configuration" "replica" {
  bucket = aws_s3_bucket.replica.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

# A replica is a cache: old versions go quickly, and (optionally) everything
# expires after N days unless it is replicated again.
resource "aws_s3_bucket_lifecycle_configuration" "replica" {
  bucket     = aws_s3_bucket.replica.id
  depends_on = [aws_s3_bucket_versioning.replica]

  rule {
    id     = "housekeeping"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
    noncurrent_version_expiration { noncurrent_days = 1 }
    expiration { expired_object_delete_marker = true }
  }

  rule {
    id     = "uploads-are-temporary"
    status = "Enabled"
    filter { prefix = "proxies/uploads/" }
    expiration { days = 1 }
  }

  dynamic "rule" {
    for_each = var.replica_expiry_days > 0 ? [1] : []
    content {
      id     = "replica-expiry"
      status = "Enabled"
      filter {}
      expiration { days = var.replica_expiry_days }
    }
  }
}

# ---------------------------------------------------------------- events
resource "aws_s3_bucket_notification" "replica" {
  bucket      = aws_s3_bucket.replica.id
  eventbridge = true
}

resource "aws_cloudwatch_event_rule" "forward" {
  name        = "${var.project}-forward-object-created"
  description = "Forward replica arrivals to the central bus"
  event_pattern = jsonencode({
    source      = ["aws.s3"]
    detail-type = ["Object Created"]
    detail      = { bucket = { name = [aws_s3_bucket.replica.bucket] } }
  })
}

resource "aws_cloudwatch_event_target" "forward" {
  rule     = aws_cloudwatch_event_rule.forward.name
  arn      = var.central_bus_arn
  role_arn = var.forward_role_arn
}

# ---------------------------------------------------------------- probe
resource "aws_lambda_function" "probe" {
  function_name    = "${var.project}-probe"
  role             = var.probe_role_arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = var.probe_zip
  source_code_hash = var.probe_zip_hash
  memory_size      = 3008
  timeout          = 300
  architectures    = ["arm64"]
  environment {
    variables = { PROBE_REGION = var.region }
  }
}

output "bucket_name" {
  value      = aws_s3_bucket.replica.bucket
  depends_on = [aws_s3_bucket_versioning.replica]
}
output "bucket_arn" {
  value      = aws_s3_bucket.replica.arn
  depends_on = [aws_s3_bucket_versioning.replica] # replication config needs versioning on the destination
}
output "probe_arn" { value = aws_lambda_function.probe.arn }
