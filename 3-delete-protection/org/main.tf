# ---------------------------------------------------------------------------
# Organization level (runs in the MANAGEMENT account of your organization, with
# a profile for that account): one SCP and one RCP, attached to the demo member
# account only.
# The policy documents come from ../infra (same JSON the page shows).
#
# Prerequisite (once, org-wide, see `make org-enable`): the SCP and RCP policy
# types must be enabled on the root. Enabling attaches the AWS managed
# FullAWSAccess / RCPFullAWSAccess policies everywhere, which changes nothing.
#
# SCPs and RCPs never apply to the management account itself: protected
# buckets must live in a member account.
# ---------------------------------------------------------------------------
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.70, < 7.0" }
  }
}

variable "management_account_id" {
  description = "Account ID of the organization's management account. Set it in terraform.tfvars."
  type        = string
}

provider "aws" {
  region              = "eu-central-1"
  allowed_account_ids = [var.management_account_id]
  default_tags { tags = { Project = "protect-demo", Owner = "instructor" } }
}

data "terraform_remote_state" "demo" {
  backend = "local"
  config  = { path = "${path.module}/../infra/terraform.tfstate" }
}

locals {
  demo = data.terraform_remote_state.demo.outputs
}

resource "aws_organizations_policy" "scp" {
  name        = "protect-demo-buckets"
  description = "Delete-protection demo: deny destructive S3 actions on the org-scp bucket except break-glass"
  type        = "SERVICE_CONTROL_POLICY"
  content     = local.demo.scp_json
}

resource "aws_organizations_policy_attachment" "scp" {
  policy_id = aws_organizations_policy.scp.id
  target_id = local.demo.account_id
}

resource "aws_organizations_policy" "rcp" {
  name        = "protect-demo-buckets"
  description = "Delete-protection demo: deny destructive S3 actions on org-rcp/recommended buckets for every principal except break-glass"
  type        = "RESOURCE_CONTROL_POLICY"
  content     = local.demo.rcp_json
}

resource "aws_organizations_policy_attachment" "rcp" {
  policy_id = aws_organizations_policy.rcp.id
  target_id = local.demo.account_id
}

output "scp_id" { value = aws_organizations_policy.scp.id }
output "rcp_id" { value = aws_organizations_policy.rcp.id }
