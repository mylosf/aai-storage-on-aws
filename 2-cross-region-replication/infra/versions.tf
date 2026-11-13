terraform {
  required_version = ">= 1.6"

  required_providers {
    aws     = { source = "hashicorp/aws", version = ">= 5.70, < 7.0" }
    archive = { source = "hashicorp/archive", version = ">= 2.4" }
    random  = { source = "hashicorp/random", version = ">= 3.5" }
  }
}

# Source region (Frankfurt). Replica regions get one alias each in regions.generated.tf.
provider "aws" {
  region              = var.source_region
  allowed_account_ids = [var.account_id]
  default_tags { tags = local.tags }
}
