# ---------------------------------------------------------------------------
# IAM: origin instance
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "origin" {
  count = local.live

  name               = "${local.name}-origin"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "origin_ssm" {
  count = local.live

  role       = aws_iam_role.origin[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "origin" {
  statement {
    sid       = "BucketList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.main.arn]
  }

  statement {
    sid       = "BucketObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.main.arn}/*"]
  }

  dynamic "statement" {
    for_each = local.loadgen == 1 ? [1] : []
    content {
      sid     = "RunLoadTestOnLoadgen"
      actions = ["ssm:SendCommand"]
      resources = [
        aws_instance.loadgen[0].arn,
        "arn:aws:ssm:${var.region}::document/AWS-RunShellScript",
      ]
    }
  }

  dynamic "statement" {
    for_each = local.loadgen == 1 ? [1] : []
    content {
      sid       = "ReadLoadTestStatus"
      actions   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
      resources = ["*"]
    }
  }
}

resource "aws_iam_role_policy" "origin" {
  count = local.live

  name   = "${local.name}-origin"
  role   = aws_iam_role.origin[0].id
  policy = data.aws_iam_policy_document.origin.json
}

resource "aws_iam_instance_profile" "origin" {
  count = local.live

  name = "${local.name}-origin"
  role = aws_iam_role.origin[0].name
}

# ---------------------------------------------------------------------------
# Origin instance: nginx (EBS/EFS/NVMe paths) + benchmark API
# ---------------------------------------------------------------------------
resource "aws_instance" "origin" {
  count = local.live

  ami                         = data.aws_ssm_parameter.al2023.value
  instance_type               = var.origin_instance_type
  subnet_id                   = aws_subnet.public.id
  availability_zone           = local.az
  vpc_security_group_ids      = [aws_security_group.origin.id]
  iam_instance_profile        = aws_iam_instance_profile.origin[0].name
  associate_public_ip_address = true

  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/templates/user_data_origin.sh.tftpl", {
    region              = var.region
    bucket              = aws_s3_bucket.main.bucket
    ebs_volume_id       = aws_ebs_volume.data[0].id
    ebs_iops            = var.ebs_iops
    ebs_throughput      = var.ebs_throughput_mbps
    efs_id              = aws_efs_file_system.video[0].id
    efs_throughput_mode = var.efs_throughput_mode
    loadgen_instance_id = local.loadgen == 1 ? aws_instance.loadgen[0].id : ""
  })

  root_block_device {
    volume_type = "gp3"
    volume_size = 16
    encrypted   = true
  }

  metadata_options {
    http_tokens   = "required" # IMDSv2 only
    http_endpoint = "enabled"
  }

  tags = { Name = "${local.name}-origin" }

  # A newer AL2023 AMI is published every few weeks; do not replace a running
  # demo because of it. Taint the instance (or bump the type) to rebuild on purpose.
  lifecycle {
    ignore_changes = [ami]
  }

  # Boot script pulls the API from the bucket, so the objects must exist first.
  depends_on = [
    aws_s3_object.api,
    aws_efs_mount_target.video,
    aws_iam_role_policy.origin,
  ]
}

resource "aws_volume_attachment" "data" {
  count = local.live

  device_name                    = "/dev/sdf"
  volume_id                      = aws_ebs_volume.data[0].id
  instance_id                    = aws_instance.origin[0].id
  stop_instance_before_detaching = true
}

# Stable public address so the CloudFront origin domain survives instance replacement.
resource "aws_eip" "origin" {
  count = local.live

  domain = "vpc"
  tags   = { Name = "${local.name}-origin" }
}

resource "aws_eip_association" "origin" {
  count = local.live

  instance_id   = aws_instance.origin[0].id
  allocation_id = aws_eip.origin[0].id
}

# ---------------------------------------------------------------------------
# Load generator (optional): k6, driven over SSM by the API
# ---------------------------------------------------------------------------
resource "aws_iam_role" "loadgen" {
  count              = local.loadgen
  name               = "${local.name}-loadgen"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "loadgen_ssm" {
  count      = local.loadgen
  role       = aws_iam_role.loadgen[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "loadgen" {
  statement {
    sid       = "ReadScript"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.main.arn}/app/loadtest/*"]
  }

  statement {
    sid       = "WriteResults"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.main.arn}/results/loadtest/*"]
  }
}

resource "aws_iam_role_policy" "loadgen" {
  count  = local.loadgen
  name   = "${local.name}-loadgen"
  role   = aws_iam_role.loadgen[0].id
  policy = data.aws_iam_policy_document.loadgen.json
}

resource "aws_iam_instance_profile" "loadgen" {
  count = local.loadgen
  name  = "${local.name}-loadgen"
  role  = aws_iam_role.loadgen[0].name
}

resource "aws_instance" "loadgen" {
  count = local.loadgen

  ami                         = data.aws_ssm_parameter.al2023.value
  instance_type               = var.loadgen_instance_type
  subnet_id                   = aws_subnet.public.id
  availability_zone           = local.az
  vpc_security_group_ids      = [aws_security_group.loadgen[0].id]
  iam_instance_profile        = aws_iam_instance_profile.loadgen[0].name
  associate_public_ip_address = true

  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/templates/user_data_loadgen.sh.tftpl", {
    region = var.region
    bucket = aws_s3_bucket.main.bucket
  })

  root_block_device {
    volume_type = "gp3"
    volume_size = 8
    encrypted   = true
  }

  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  tags = { Name = "${local.name}-loadgen" }

  lifecycle {
    ignore_changes = [ami]
  }

  depends_on = [aws_s3_object.loadtest, aws_iam_role_policy.loadgen]
}
