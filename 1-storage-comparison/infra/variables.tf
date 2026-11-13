variable "account_id" {
  description = "Your AWS account ID: the provider refuses any other account (guards against the wrong profile). Set it in terraform.tfvars."
  type        = string
}

variable "region" {
  description = "AWS region for everything except CloudFront (which is global)."
  type        = string
  default     = "eu-central-1"
}

variable "project" {
  description = "Name prefix for all resources."
  type        = string
  default     = "storage-demo"
}

variable "origin_instance_type" {
  description = <<-EOT
    Instance that hosts nginx + the benchmark API and mounts EBS/EFS.
    A *d* type (m6id/c6id/...) adds a local NVMe instance-store volume, which
    becomes a fifth backend in the demo. Without one that tile is hidden.
  EOT
  type        = string
  default     = "m6id.large"
}

variable "ebs_size_gb" {
  description = "Size of the dedicated gp3 data volume holding the video."
  type        = number
  default     = 20
}

variable "ebs_iops" {
  description = "gp3 IOPS. 3000 is the free baseline; raise it live to show the effect."
  type        = number
  default     = 3000
}

variable "ebs_throughput_mbps" {
  description = "gp3 throughput in MiB/s. 125 is the free baseline."
  type        = number
  default     = 125
}

variable "efs_throughput_mode" {
  description = "EFS throughput mode: elastic (default) or bursting."
  type        = string
  default     = "elastic"
}

variable "enable_loadgen" {
  description = "Create a second instance running k6 for the concurrent-viewer load test."
  type        = bool
  default     = true
}

variable "loadgen_instance_type" {
  description = "Instance type for the k6 load generator."
  type        = string
  default     = "c6i.large"
}

variable "cloudfront_price_class" {
  description = "PriceClass_All keeps the edge close to wherever the workshop is held."
  type        = string
  default     = "PriceClass_All"
}

variable "frozen" {
  description = <<-EOT
    Archive mode after the workshop: keep CloudFront and the bucket (web app +
    results snapshot) and remove everything that costs money: both instances,
    the EBS volume, EFS, the Elastic IP and the app code in the bucket.
    `make freeze` / `make thaw` toggle this via infra/frozen.auto.tfvars.
  EOT
  type        = bool
  default     = false
}
