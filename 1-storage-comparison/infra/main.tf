data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

# Latest Amazon Linux 2023 (x86_64) via the public SSM parameter.
data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

# CloudFront origin-facing IP ranges, so the EC2 origin only accepts traffic from CloudFront.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "random_id" "suffix" {
  byte_length = 3
}

locals {
  live    = var.frozen ? 0 : 1
  loadgen = var.enable_loadgen && !var.frozen ? 1 : 0
  name    = var.project
  # Single AZ on purpose: the EC2 origin and the EFS mount target sit in the same
  # AZ so cross-AZ latency does not pollute the comparison.
  az            = data.aws_availability_zones.available.names[0]
  bucket_name   = "${var.project}-${data.aws_caller_identity.current.account_id}-${random_id.suffix.hex}"
  api_src_dir   = "${path.module}/../api"
  loadtest_file = "${path.module}/../loadtest/viewers.js"
}
