# S3 delete-protection demo (SCP, RCP, bucket policy, Object Lock, Config)
#   export AWS_PROFILE=<your profile>   (account set in infra/terraform.tfvars)
#   make deploy        -> infra + web + scenario buckets
#   ORG_PROFILE=<mgmt profile> ORG_ROOT=<r-xxxx> make org-enable org-apply
#                      -> SCP + RCP in the management account
SHELL := /bin/bash
.DEFAULT_GOAL := help
TF    := terraform -chdir=infra
# org targets need ORG_PROFILE (a profile for the management account) and, for
# org-enable, ORG_ROOT (the root id: aws organizations list-roots)
ORGTF := AWS_PROFILE=$(ORG_PROFILE) terraform -chdir=org
NEED_ORG = @test -n "$(ORG_PROFILE)" || { echo "set ORG_PROFILE to an AWS profile for the management account"; exit 1; }
URL   = $(shell $(TF) output -raw demo_url 2>/dev/null)
WEB   = $(shell $(TF) output -raw web_bucket 2>/dev/null)
DIST  = $(shell $(TF) output -raw distribution_id 2>/dev/null)

.PHONY: help init org-init apply deploy web setup url org-enable org-apply org-destroy teardown destroy

help:
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

init: ## terraform init (demo account)
	$(TF) init -input=false

org-init: ## terraform init (management account)
	$(NEED_ORG)
	$(ORGTF) init -input=false

apply: ## demo account: roles, API, Config, CloudFront
	$(TF) apply

deploy: apply web setup ## apply + web + scenario buckets

web: ## build and publish the web app
	cd web && npm install --no-audit --no-fund && npm run build
	aws s3 sync web/dist "s3://$(WEB)" --delete --only-show-errors
	aws cloudfront create-invalidation --distribution-id "$(DIST)" --paths "/*" --query Invalidation.Id --output text

setup: ## create/repair the seven scenario buckets
	./scripts/job.sh "$(URL)" /api/setup

url: ## print the demo URL
	@echo "$(URL)"

org-enable: ## ONCE, org-wide: enable SCP + RCP policy types on the root (attaches FullAWSAccess/RCPFullAWSAccess everywhere)
	$(NEED_ORG)
	@test -n "$(ORG_ROOT)" || { echo "set ORG_ROOT (aws organizations list-roots)"; exit 1; }
	AWS_PROFILE=$(ORG_PROFILE) aws organizations enable-policy-type --root-id $(ORG_ROOT) --policy-type SERVICE_CONTROL_POLICY || true
	AWS_PROFILE=$(ORG_PROFILE) aws organizations enable-policy-type --root-id $(ORG_ROOT) --policy-type RESOURCE_CONTROL_POLICY || true
	AWS_PROFILE=$(ORG_PROFILE) aws organizations list-roots --query 'Roots[].PolicyTypes' --output table

org-apply: org-init ## management account: create the SCP + RCP and attach them to the demo account only
	$(ORGTF) apply

org-destroy: ## detach and delete the SCP + RCP
	$(NEED_ORG)
	$(ORGTF) destroy

teardown: ## delete every scenario bucket with the break-glass role (compliance bucket stays until retention ends)
	./scripts/job.sh "$(URL)" /api/teardown

destroy: ## everything: scenario buckets, org policies (if ORG_PROFILE is set), demo stack
	-$(MAKE) teardown
	-test -z "$(ORG_PROFILE)" || $(ORGTF) destroy -auto-approve
	$(TF) destroy
