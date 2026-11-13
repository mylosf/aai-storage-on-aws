# ---------------------------------------------------------------------------
# Two "actors" the API assumes to run the attacks:
#   admin       s3:* on the demo buckets: a misdirected terraform destroy, a CI
#               role or a person with AdministratorAccess.
#   breakglass  the same permissions, but named in every guard's exception.
#               Production: an IAM Identity Center permission set only a few
#               people can request, short session, MFA, alarm on every use.
# Both are scoped to the demo buckets so the demo cannot touch anything else.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "actor_assume" {
  statement {
    actions = ["sts:AssumeRole", "sts:TagSession"]
    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.api.arn]
    }
  }
}

locals {
  demo_bucket_arns = ["arn:aws:s3:::${local.bucket_prefix}*", "arn:aws:s3:::${local.bucket_prefix}*/*"]
  actor_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "s3:*", Resource = local.demo_bucket_arns },
      { Effect = "Allow", Action = "s3:ListAllMyBuckets", Resource = "*" },
    ]
  })
}

resource "aws_iam_role" "admin" {
  name                 = local.admin_role
  assume_role_policy   = data.aws_iam_policy_document.actor_assume.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "admin" {
  name   = "s3-full-on-demo-buckets"
  role   = aws_iam_role.admin.id
  policy = local.actor_policy
}

resource "aws_iam_role" "breakglass" {
  name                 = local.breakglass_role
  assume_role_policy   = data.aws_iam_policy_document.actor_assume.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "breakglass" {
  name   = "s3-full-on-demo-buckets"
  role   = aws_iam_role.breakglass.id
  policy = local.actor_policy
}

# --- API execution role: reads state, assumes the actors ----------------------
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
      { Effect = "Allow", Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], Resource = "arn:aws:logs:*:${local.account}:*" },
      { Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:DeleteItem"], Resource = aws_dynamodb_table.state.arn },
      { Effect = "Allow", Action = "lambda:InvokeFunction", Resource = "arn:aws:lambda:${var.region}:${local.account}:function:${local.project}-api" },
      { Effect = "Allow", Action = ["sts:AssumeRole", "sts:TagSession"], Resource = [aws_iam_role.admin.arn, aws_iam_role.breakglass.arn] },
      # read-only status of the scenario buckets (guards only deny writes)
      { Effect = "Allow", Action = ["s3:Get*", "s3:List*"], Resource = local.demo_bucket_arns },
      { Effect = "Allow", Action = "s3:ListAllMyBuckets", Resource = "*" },
      { Effect = "Allow", Action = ["config:GetComplianceDetailsByConfigRule", "config:DescribeRemediationExecutionStatus", "config:StartConfigRulesEvaluation"], Resource = "*" },
    ]
  })
}
