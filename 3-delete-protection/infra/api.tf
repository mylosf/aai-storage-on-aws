# State (jobs, attack results, deletion events) and the API Lambda.

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

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.project}-api"
  retention_in_days = 14
}

resource "aws_lambda_function" "api" {
  function_name    = "${local.project}-api"
  role             = aws_iam_role.api.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  memory_size      = 512
  timeout          = 900
  architectures    = ["arm64"]
  depends_on       = [aws_cloudwatch_log_group.api]
  environment {
    variables = {
      TABLE         = aws_dynamodb_table.state.name
      SELF_FUNCTION = "${local.project}-api"
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

# --- detection: S3 "Object Deleted" events -> API Lambda -> page ---------------
# The API turns on EventBridge notifications on every scenario bucket. Delete
# markers ("Delete Marker Created") and permanent deletes ("Permanently Deleted",
# also from lifecycle expiration) show up on the page within seconds.
resource "aws_cloudwatch_event_rule" "deletes" {
  name        = "${local.project}-object-deleted"
  description = "Deletes in the delete-protection demo buckets"
  event_pattern = jsonencode({
    source        = ["aws.s3"]
    "detail-type" = ["Object Deleted"]
    detail        = { bucket = { name = [{ prefix = local.bucket_prefix }] } }
  })
}

resource "aws_cloudwatch_event_target" "deletes" {
  rule = aws_cloudwatch_event_rule.deletes.name
  arn  = aws_lambda_function.api.arn
}

resource "aws_lambda_permission" "events" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.deletes.arn
}
