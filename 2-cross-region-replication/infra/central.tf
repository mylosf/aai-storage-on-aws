# ---------------------------------------------------------------------------
# Central plumbing in the source region: timeline store, event bus, the ingest
# Lambda (arrivals, rundowns, replication notifications), the API Lambda, and
# the roles. No EC2 anywhere: idle cost is effectively zero.
# ---------------------------------------------------------------------------

# --- timeline store ------------------------------------------------------------
# PK = record type (assign | arrival | job | lab | probe | repl), SK = unique key.
resource "aws_dynamodb_table" "state" {
  name         = "${local.project}-state"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"
  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

# --- event bus: every replica region forwards "Object Created" here ----------
resource "aws_cloudwatch_event_bus" "central" {
  name = "${local.project}-central"
}

data "aws_iam_policy_document" "events_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "event_forward" {
  name               = "${local.project}-event-forward"
  assume_role_policy = data.aws_iam_policy_document.events_assume.json
}

resource "aws_iam_role_policy" "event_forward" {
  name = "${local.project}-event-forward"
  role = aws_iam_role.event_forward.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "events:PutEvents", Resource = aws_cloudwatch_event_bus.central.arn }]
  })
}

# --- lambda roles ---------------------------------------------------------------
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

locals {
  all_bucket_arns = concat([aws_s3_bucket.source.arn], values(local.replica_bucket_arns))
  all_object_arns = [for a in local.all_bucket_arns : "${a}/*"]
  logs_statement = {
    Effect   = "Allow"
    Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    Resource = "arn:aws:logs:*:${data.aws_caller_identity.current.account_id}:*"
  }
}

# probe: read every bucket (deployed in all regions, so IAM is shared)
resource "aws_iam_role" "probe" {
  name               = "${local.project}-probe"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy" "probe" {
  name = "${local.project}-probe"
  role = aws_iam_role.probe.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      local.logs_statement,
      { Effect = "Allow", Action = ["s3:GetObject", "s3:GetObjectVersion", "s3:ListBucket"], Resource = concat(local.all_bucket_arns, local.all_object_arns) },
    ]
  })
}

# ingest: writes the timeline, reads rundowns, re-tags masters (copy in place)
resource "aws_iam_role" "ingest" {
  name               = "${local.project}-ingest"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy" "ingest" {
  name = "${local.project}-ingest"
  role = aws_iam_role.ingest.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      local.logs_statement,
      { Effect = "Allow", Action = ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:GetItem", "dynamodb:Query"], Resource = aws_dynamodb_table.state.arn },
      { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.source.arn },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectTagging", "s3:PutObject", "s3:PutObjectTagging", "s3:GetObjectVersion", "s3:GetObjectVersionTagging"]
        Resource = "${aws_s3_bucket.source.arn}/*"
      },
    ]
  })
}

# api: everything the page can trigger
resource "aws_iam_role" "api" {
  name               = "${local.project}-api"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy" "api" {
  name = "${local.project}-api"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      local.logs_statement,
      { Effect = "Allow", Action = ["s3:*"], Resource = concat(local.all_bucket_arns, local.all_object_arns) },
      { Effect = "Allow", Action = ["s3:GetObject"], Resource = "arn:aws:s3:::download.opencontent.netflix.com/*" },
      { Effect = "Allow", Action = ["dynamodb:*"], Resource = aws_dynamodb_table.state.arn },
      { Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = concat(values(local.probe_function_arns), ["arn:aws:lambda:${var.source_region}:${data.aws_caller_identity.current.account_id}:function:${local.project}-api"]) },
      { Effect = "Allow", Action = ["cloudwatch:GetMetricData", "cloudwatch:ListMetrics"], Resource = "*" },
      { Effect = "Allow", Action = ["s3:CreateJob", "s3:DescribeJob", "s3:ListJobs", "s3:UpdateJobStatus"], Resource = "*" },
      { Effect = "Allow", Action = ["iam:PassRole"], Resource = [aws_iam_role.batch.arn, aws_iam_role.replication.arn] },
    ]
  })
}

# batch operations: Batch Replication for existing objects
data "aws_iam_policy_document" "batch_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["batchoperations.s3.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "batch" {
  name               = "${local.project}-batch-replication"
  assume_role_policy = data.aws_iam_policy_document.batch_assume.json
}

resource "aws_iam_role_policy" "batch" {
  name = "${local.project}-batch-replication"
  role = aws_iam_role.batch.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:InitiateReplication"], Resource = "${aws_s3_bucket.source.arn}/*" },
      { Effect = "Allow", Action = ["s3:GetReplicationConfiguration", "s3:PutInventoryConfiguration", "s3:ListBucket"], Resource = aws_s3_bucket.source.arn },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"], Resource = "${aws_s3_bucket.source.arn}/*" },
    ]
  })
}

# --- ingest lambda ------------------------------------------------------------------
resource "aws_lambda_function" "ingest" {
  function_name    = "${local.project}-ingest"
  role             = aws_iam_role.ingest.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.ingest.output_path
  source_code_hash = data.archive_file.ingest.output_base64sha256
  memory_size      = 512
  timeout          = 120
  architectures    = ["arm64"]
  environment {
    variables = {
      TABLE         = aws_dynamodb_table.state.name
      SOURCE_BUCKET = aws_s3_bucket.source.bucket
    }
  }
}

# replica arrivals (forwarded from every region) -> ingest
resource "aws_cloudwatch_event_rule" "arrivals" {
  name           = "${local.project}-arrivals"
  event_bus_name = aws_cloudwatch_event_bus.central.name
  event_pattern = jsonencode({
    source      = ["aws.s3"]
    detail-type = ["Object Created"]
  })
}

resource "aws_cloudwatch_event_target" "arrivals" {
  rule           = aws_cloudwatch_event_rule.arrivals.name
  event_bus_name = aws_cloudwatch_event_bus.central.name
  arn            = aws_lambda_function.ingest.arn
}

resource "aws_lambda_permission" "arrivals" {
  statement_id  = "AllowCentralBus"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ingest.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.arrivals.arn
}

# rundown uploads in the source bucket (default bus, Frankfurt) -> ingest
resource "aws_cloudwatch_event_rule" "rundowns" {
  name = "${local.project}-rundowns"
  event_pattern = jsonencode({
    source      = ["aws.s3"]
    detail-type = ["Object Created"]
    detail = {
      bucket = { name = [aws_s3_bucket.source.bucket] }
      object = { key = [{ prefix = "rundowns/" }] }
    }
  })
}

resource "aws_cloudwatch_event_target" "rundowns" {
  rule = aws_cloudwatch_event_rule.rundowns.name
  arn  = aws_lambda_function.ingest.arn
}

resource "aws_lambda_permission" "rundowns" {
  statement_id  = "AllowRundownRule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ingest.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.rundowns.arn
}

# S3 -> EventBridge for the source bucket, plus replication notifications
# (missed threshold, failed, replicated after threshold) straight to ingest.
resource "aws_lambda_permission" "s3_replication_events" {
  statement_id  = "AllowSourceBucket"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ingest.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.source.arn
}

resource "aws_s3_bucket_notification" "source" {
  bucket      = aws_s3_bucket.source.id
  eventbridge = true

  lambda_function {
    lambda_function_arn = aws_lambda_function.ingest.arn
    events = [
      "s3:Replication:OperationFailedReplication",
      "s3:Replication:OperationMissedThreshold",
      "s3:Replication:OperationReplicatedAfterThreshold",
      "s3:Replication:OperationNotTracked",
    ]
  }

  depends_on = [aws_lambda_permission.s3_replication_events, aws_s3_bucket_replication_configuration.source]
}

# --- api lambda ---------------------------------------------------------------------
resource "aws_lambda_function" "api" {
  function_name    = "${local.project}-api"
  role             = aws_iam_role.api.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  memory_size      = 1769 # one full vCPU: random-byte generation for the catalogue
  timeout          = 900
  architectures    = ["arm64"]
  environment {
    variables = {
      TABLE          = aws_dynamodb_table.state.name
      SOURCE_BUCKET  = aws_s3_bucket.source.bucket
      SOURCE_REGION  = var.source_region
      BATCH_ROLE_ARN = aws_iam_role.batch.arn
      ACCOUNT_ID     = data.aws_caller_identity.current.account_id
      SELF_FUNCTION  = "${local.project}-api"
      RTC_MINUTES    = tostring(var.rtc_minutes)
    }
  }
}

resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "api_url" {
  statement_id           = "AllowPublicFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.api.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}
