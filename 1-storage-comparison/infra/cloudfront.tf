# One distribution is the single HTTPS front door for everything:
#
#   /            -> S3 (web app, prefix web/)              cached
#   /video/*     -> S3 (HLS video, prefix video/)          cached   <- "S3 + CloudFront" backend
#   /ebs/*       -> EC2 nginx -> EBS volume                NOT cached
#   /efs/*       -> EC2 nginx -> EFS mount                 NOT cached
#   /nvme/*      -> EC2 nginx -> instance store            NOT cached
#   /api/*       -> EC2 benchmark API                      NOT cached
#   /cached/*    -> EC2 nginx (same files)                 cached   <- "CloudFront in front of EBS/EFS/NVMe"
#   /video-miss/*-> S3 (rewritten to /video/*)             NOT cached <- forces an edge miss to S3
#
# Routing the EC2 paths through CloudFront with caching disabled keeps one
# origin for the browser (no CORS, no mixed content, one URL for attendees)
# while every request still travels to the instance.

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

# Rewrites /video-miss/x to /video/x so the same objects can be fetched through
# CloudFront with caching disabled: a guaranteed edge miss, for the Analysis tab.
resource "aws_cloudfront_function" "video_miss" {
  name    = "${local.name}-video-miss"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      request.uri = request.uri.replace(/^\/video-miss\//, "/video/");
      return request;
    }
  EOT
}

resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "${local.name}-s3"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

locals {
  s3_web_origin   = "s3-web"
  s3_video_origin = "s3-video"
  ec2_origin      = "ec2-origin"
  ec2_paths       = ["/ebs/*", "/efs/*", "/nvme/*", "/api/*"]
}

resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  comment             = "${local.name}: storage comparison demo"
  default_root_object = "index.html"
  price_class         = var.cloudfront_price_class
  http_version        = "http2and3"
  is_ipv6_enabled     = true

  # --- origins -------------------------------------------------------------
  origin {
    origin_id                = local.s3_web_origin
    domain_name              = aws_s3_bucket.main.bucket_regional_domain_name
    origin_path              = "/web"
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  origin {
    origin_id                = local.s3_video_origin
    domain_name              = aws_s3_bucket.main.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  dynamic "origin" {
    for_each = local.live == 1 ? [1] : []
    content {
      origin_id   = local.ec2_origin
      domain_name = aws_eip.origin[0].public_dns

      custom_origin_config {
        http_port                = 80
        https_port               = 443
        origin_protocol_policy   = "http-only"
        origin_ssl_protocols     = ["TLSv1.2"]
        origin_read_timeout      = 60
        origin_keepalive_timeout = 60
      }
    }
  }

  # --- behaviours ----------------------------------------------------------
  default_cache_behavior {
    target_origin_id       = local.s3_web_origin
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
  }

  ordered_cache_behavior {
    path_pattern           = "/video/*"
    target_origin_id       = local.s3_video_origin
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = false
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
  }

  # Same S3 objects, never cached: every request travels edge -> S3.
  ordered_cache_behavior {
    path_pattern           = "/video-miss/*"
    target_origin_id       = local.s3_video_origin
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = false
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_disabled.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.video_miss.arn
    }
  }

  # The EC2-backed files with the edge cache ON (nginx serves /cached/<backend>/... with s-maxage).
  dynamic "ordered_cache_behavior" {
    for_each = local.live == 1 ? [1] : []
    content {
      path_pattern           = "/cached/*"
      target_origin_id       = local.ec2_origin
      viewer_protocol_policy = "https-only"
      allowed_methods        = ["GET", "HEAD", "OPTIONS"]
      cached_methods         = ["GET", "HEAD"]
      compress               = false
      cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = local.live == 1 ? local.ec2_paths : []
    content {
      path_pattern             = ordered_cache_behavior.value
      target_origin_id         = local.ec2_origin
      viewer_protocol_policy   = "https-only"
      allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods           = ["GET", "HEAD"]
      compress                 = false
      cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
      origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = { Name = local.name }
}
