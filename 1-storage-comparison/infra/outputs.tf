output "demo_url" {
  description = "Open this in the browser (and hand it to attendees)."
  value       = "https://${aws_cloudfront_distribution.main.domain_name}"
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.main.id
}

output "bucket" {
  description = "Bucket holding web/ (app), video/ (content), app/ (code) and results/."
  value       = aws_s3_bucket.main.bucket
}

output "region" {
  value = var.region
}

output "origin_instance_id" {
  value = one(aws_instance.origin[*].id)
}

output "loadgen_instance_id" {
  value = one(aws_instance.loadgen[*].id)
}

output "ebs_volume_id" {
  value = one(aws_ebs_volume.data[*].id)
}

output "efs_id" {
  value = one(aws_efs_file_system.video[*].id)
}

output "frozen" {
  description = "true = archive mode: only CloudFront + bucket remain."
  value       = var.frozen
}

output "ssm_shell" {
  description = "Shell on the origin instance without SSH or open ports."
  value       = var.frozen ? "frozen: no instance (make thaw)" : "aws ssm start-session --region ${var.region} --target ${one(aws_instance.origin[*].id)}"
}
