# S3 cross-region replication demo (Frankfurt -> 15 regions)
#   export AWS_PROFILE=<your profile>   (account set in infra/terraform.tfvars)
#   make deploy   -> infra + web, then: make seed
SHELL := /bin/bash
.DEFAULT_GOAL := help
TF   := terraform -chdir=infra
URL   = $(shell $(TF) output -raw demo_url 2>/dev/null)
WEB   = $(shell $(TF) output -raw web_bucket 2>/dev/null)
DIST  = $(shell $(TF) output -raw distribution_id 2>/dev/null)

.PHONY: help regions init apply deploy web seed url destroy

help:
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

regions: ## regenerate infra/regions.generated.tf from regions.json
	python3 scripts/gen-regions.py

init: regions ## terraform init
	$(TF) init -input=false

apply: regions ## create/update everything (16 regions, ~10 min first time)
	$(TF) apply -parallelism=20

deploy: apply web ## infra + web app

web: ## build and publish the web app
	cd web && npm install --no-audit --no-fund && npm run build
	aws s3 sync web/dist "s3://$(WEB)" --delete --only-show-errors
	aws cloudfront create-invalidation --distribution-id "$(DIST)" --paths "/*" --query Invalidation.Id --output text

seed: ## probe objects, latency matrix, newsroom catalogue (proxies fan out to 15 regions)
	./scripts/job.sh "$(URL)" /api/setup
	./scripts/job.sh "$(URL)" /api/matrix
	./scripts/job.sh "$(URL)" /api/catalogue

url: ## print the demo URL
	@echo "$(URL)"

destroy: ## remove everything (all 16 regions)
	$(TF) destroy -parallelism=20
