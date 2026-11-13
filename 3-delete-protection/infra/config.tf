# ---------------------------------------------------------------------------
# Detective control: AWS Config + automatic remediation.
# Recorder limited to S3 buckets (cheap); rule s3-bucket-versioning-enabled,
# scoped by tag to the baseline bucket; remediation runs the AWS-owned SSM
# document AWS-ConfigureS3BucketVersioning. It repairs a suspended versioning
# minutes later: it does not prevent anything.
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "config" {
  count         = var.enable_config ? 1 : 0
  bucket        = "${local.project}-cfglog-${random_id.suffix.hex}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "config" {
  count                   = var.enable_config ? 1 : 0
  bucket                  = aws_s3_bucket.config[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "config" {
  count  = var.enable_config ? 1 : 0
  bucket = aws_s3_bucket.config[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "config.amazonaws.com" }
        Action    = ["s3:GetBucketAcl", "s3:ListBucket"]
        Resource  = aws_s3_bucket.config[0].arn
        Condition = { StringEquals = { "AWS:SourceAccount" = local.account } }
      },
      {
        Effect    = "Allow"
        Principal = { Service = "config.amazonaws.com" }
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.config[0].arn}/AWSLogs/${local.account}/Config/*"
        Condition = { StringEquals = { "AWS:SourceAccount" = local.account, "s3:x-amz-acl" = "bucket-owner-full-control" } }
      },
    ]
  })
}

data "aws_iam_policy_document" "config_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["config.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "config" {
  count              = var.enable_config ? 1 : 0
  name               = "${local.project}-config"
  assume_role_policy = data.aws_iam_policy_document.config_assume.json
}

resource "aws_iam_role_policy_attachment" "config" {
  count      = var.enable_config ? 1 : 0
  role       = aws_iam_role.config[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWS_ConfigRole"
}

resource "aws_config_configuration_recorder" "main" {
  count    = var.enable_config ? 1 : 0
  name     = "${local.project}-recorder"
  role_arn = aws_iam_role.config[0].arn
  recording_group {
    all_supported  = false
    resource_types = ["AWS::S3::Bucket"]
  }
  recording_mode {
    recording_frequency = "CONTINUOUS"
  }
}

resource "aws_config_delivery_channel" "main" {
  count          = var.enable_config ? 1 : 0
  name           = "${local.project}-channel"
  s3_bucket_name = aws_s3_bucket.config[0].bucket
  depends_on     = [aws_config_configuration_recorder.main, aws_s3_bucket_policy.config]
}

resource "aws_config_configuration_recorder_status" "main" {
  count      = var.enable_config ? 1 : 0
  name       = aws_config_configuration_recorder.main[0].name
  is_enabled = true
  depends_on = [aws_config_delivery_channel.main]
}

resource "aws_config_config_rule" "versioning" {
  count = var.enable_config ? 1 : 0
  name  = "${local.project}-s3-versioning-enabled"
  source {
    owner             = "AWS"
    source_identifier = "S3_BUCKET_VERSIONING_ENABLED"
  }
  scope {
    tag_key   = "ConfigRemediation"
    tag_value = "versioning"
  }
  depends_on = [aws_config_configuration_recorder_status.main]
}

data "aws_iam_policy_document" "ssm_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ssm.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "remediation" {
  count              = var.enable_config ? 1 : 0
  name               = "${local.project}-remediation"
  assume_role_policy = data.aws_iam_policy_document.ssm_assume.json
}

resource "aws_iam_role_policy" "remediation" {
  count = var.enable_config ? 1 : 0
  name  = "versioning"
  role  = aws_iam_role.remediation[0].id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["s3:GetBucketVersioning", "s3:PutBucketVersioning"], Resource = "arn:aws:s3:::${local.bucket_prefix}*" }]
  })
}

resource "aws_config_remediation_configuration" "versioning" {
  count                      = var.enable_config ? 1 : 0
  config_rule_name           = aws_config_config_rule.versioning[0].name
  target_type                = "SSM_DOCUMENT"
  target_id                  = "AWS-ConfigureS3BucketVersioning"
  automatic                  = true
  maximum_automatic_attempts = 5
  retry_attempt_seconds      = 60

  parameter {
    name           = "AutomationAssumeRole"
    static_value   = aws_iam_role.remediation[0].arn
  }
  parameter {
    name           = "BucketName"
    resource_value = "RESOURCE_ID"
  }
  parameter {
    name         = "VersioningState"
    static_value = "Enabled"
  }
}
