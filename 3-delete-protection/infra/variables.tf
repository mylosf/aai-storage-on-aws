variable "account_id" {
  description = "Your AWS account ID: the provider refuses any other account (guards against the wrong profile). Set it in terraform.tfvars."
  type        = string
}

variable "region" {
  type    = string
  default = "eu-central-1"
}

variable "project" {
  type    = string
  default = "protect-demo"
}

variable "noncurrent_days" {
  description = "Lifecycle: noncurrent versions are permanently deleted after this many days (the customer's 7-day rule)."
  type        = number
  default     = 7
}

variable "governance_days" {
  description = "Object Lock GOVERNANCE default retention for the governance and recommended scenarios."
  type        = number
  default     = 7
}

variable "compliance_days" {
  description = "Object Lock COMPLIANCE retention for the compliance scenario. Keep it at 1: nobody (not even root) can delete those versions earlier, so the bucket outlives `make destroy` by up to this many days."
  type        = number
  default     = 1
}

variable "enable_config" {
  description = "AWS Config recorder (S3 buckets only) + s3-bucket-versioning-enabled rule with automatic remediation on the baseline bucket."
  type        = bool
  default     = true
}
