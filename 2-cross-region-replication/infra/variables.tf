variable "account_id" {
  description = "Your AWS account ID: the provider refuses any other account (guards against the wrong profile). Set it in terraform.tfvars."
  type        = string
}

variable "source_region" {
  description = "Region of the source-of-truth bucket. Must match regions.json."
  type        = string
  default     = "eu-central-1"
}

variable "project" {
  type    = string
  default = "media-rep"
}

variable "masters_storage_class" {
  description = "Storage class for replicated masters (actively cut material)."
  type        = string
  default     = "STANDARD"
}

variable "proxies_storage_class" {
  description = "Storage class for replicated proxies and sidecars (caches of small files; the truth is in Frankfurt)."
  type        = string
  default     = "ONEZONE_IA"
}

variable "replica_expiry_days" {
  description = "Replica buckets expire objects after this many days (a replica is a cache). 0 = never."
  type        = number
  default     = 30
}

variable "rtc_minutes" {
  description = "Replication Time Control threshold in minutes (15 is the only supported value today)."
  type        = number
  default     = 15
}

variable "late_regions" {
  description = "Regions whose masters rule starts Disabled (the 'bureau opens late' Batch Replication scenario). The page enables it; terraform apply resets it."
  type        = list(string)
  default     = ["ap-east-1"]
}
