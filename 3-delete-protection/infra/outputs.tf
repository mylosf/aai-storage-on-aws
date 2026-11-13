output "demo_url" { value = "https://${aws_cloudfront_distribution.main.domain_name}" }
output "distribution_id" { value = aws_cloudfront_distribution.main.id }
output "web_bucket" { value = aws_s3_bucket.web.bucket }
output "api_function" { value = aws_lambda_function.api.function_name }
output "scenario_buckets" { value = local.bucket_base }

# consumed by ../org (management account) via terraform_remote_state
output "account_id" { value = local.account }
output "breakglass_role_arn" { value = aws_iam_role.breakglass.arn }
output "scp_json" { value = jsonencode(local.scp) }
output "rcp_json" { value = jsonencode(local.rcp) }
