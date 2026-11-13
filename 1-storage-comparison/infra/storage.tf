# ---------------------------------------------------------------------------
# Backend 1: EBS gp3 data volume (block storage, one instance, one AZ)
# ---------------------------------------------------------------------------
resource "aws_ebs_volume" "data" {
  count             = local.live
  availability_zone = local.az
  size              = var.ebs_size_gb
  type              = "gp3"
  iops              = var.ebs_iops
  throughput        = var.ebs_throughput_mbps
  encrypted         = true

  tags = { Name = "${local.name}-video" }
}

# ---------------------------------------------------------------------------
# Backend 2: EFS (shared file storage, regional, NFS)
# ---------------------------------------------------------------------------
resource "aws_efs_file_system" "video" {
  count            = local.live
  creation_token   = "${local.name}-video"
  performance_mode = "generalPurpose"
  throughput_mode  = var.efs_throughput_mode
  encrypted        = true

  tags = { Name = "${local.name}-video" }
}

resource "aws_efs_mount_target" "video" {
  count           = local.live
  file_system_id  = aws_efs_file_system.video[0].id
  subnet_id       = aws_subnet.public.id
  security_groups = [aws_security_group.efs.id]
}

# ---------------------------------------------------------------------------
# Backend 3 + 4: S3 (object storage) - served directly and through CloudFront.
# The same bucket also hosts the web app (prefix web/) and the app code the
# instances pull at boot (prefix app/).
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "main" {
  bucket        = local.bucket_name
  force_destroy = true # demo bucket: let terraform destroy remove the content

  tags = { Name = local.bucket_name }
}

resource "aws_s3_bucket_public_access_block" "main" {
  bucket                  = aws_s3_bucket.main.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# The "S3 direct" player fetches presigned URLs straight from the regional S3
# endpoint, so the bucket must answer CORS preflights from the CloudFront domain.
resource "aws_s3_bucket_cors_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  cors_rule {
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["https://${aws_cloudfront_distribution.main.domain_name}", "http://localhost:5173"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag", "Content-Length", "Content-Range", "x-amz-request-id"]
    max_age_seconds = 3600
  }
}

# CloudFront (via Origin Access Control) may read the web app and the video.
data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "CloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.main.arn}/web/*", "${aws_s3_bucket.main.arn}/video/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.main.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "main" {
  bucket = aws_s3_bucket.main.id
  policy = data.aws_iam_policy_document.bucket.json

  depends_on = [aws_s3_bucket_public_access_block.main]
}

# ---------------------------------------------------------------------------
# App code the instances pull at boot. Changing a file re-uploads it; run
# `make update-api` afterwards to push it to the running instance.
# ---------------------------------------------------------------------------
resource "aws_s3_object" "api" {
  for_each = var.frozen ? toset([]) : fileset(local.api_src_dir, "*")

  bucket = aws_s3_bucket.main.id
  key    = "app/api/${each.value}"
  source = "${local.api_src_dir}/${each.value}"
  etag   = filemd5("${local.api_src_dir}/${each.value}")
}

# The demo's own URL. The API reads it at runtime and uses it as the only target
# for benchmarks, load tests and simulations: the request body cannot choose a
# host (otherwise anyone with the URL could aim k6 at a third-party site).
# Not in /etc/demo.env because CloudFront depends on the instance (cycle).
resource "aws_s3_object" "demo_origin" {
  count        = local.live
  bucket       = aws_s3_bucket.main.id
  key          = "app/demo-origin.txt"
  content      = "https://${aws_cloudfront_distribution.main.domain_name}"
  content_type = "text/plain"
}

resource "aws_s3_object" "loadtest" {
  count  = local.live
  bucket = aws_s3_bucket.main.id
  key    = "app/loadtest/viewers.js"
  source = local.loadtest_file
  etag   = filemd5(local.loadtest_file)
}
