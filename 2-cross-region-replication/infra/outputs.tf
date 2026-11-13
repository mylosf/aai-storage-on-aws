output "demo_url" { value = "https://${aws_cloudfront_distribution.main.domain_name}" }
output "distribution_id" { value = aws_cloudfront_distribution.main.id }
output "web_bucket" { value = aws_s3_bucket.web.bucket }
output "source_bucket" { value = aws_s3_bucket.source.bucket }
output "source_region" { value = var.source_region }
output "api_function" { value = aws_lambda_function.api.function_name }
output "replica_buckets" { value = local.replica_buckets }
