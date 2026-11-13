# AWS storage comparison demo - instructor workflow.
#
#   export AWS_PROFILE=<your profile>   (account set in infra/terraform.tfvars)
#   make deploy          # infra + web app + content (first time, ~25 min incl. transcoding)
#   make url             # the CloudFront URL to open / hand out
#   make destroy         # tear everything down after the workshop
#
# Individual steps: make apply | web | content | sync | update-api | status | bench | shell

SHELL := /bin/bash
.DEFAULT_GOAL := help

TF      := terraform -chdir=infra
REGION   = $(shell $(TF) output -raw region 2>/dev/null)
BUCKET   = $(shell $(TF) output -raw bucket 2>/dev/null)
URL      = $(shell $(TF) output -raw demo_url 2>/dev/null)
DIST_ID  = $(shell $(TF) output -raw cloudfront_distribution_id 2>/dev/null)
ORIGIN   = $(shell $(TF) output -raw origin_instance_id 2>/dev/null)

.PHONY: help init plan apply deploy web content upload sync wait update-api status bench url shell freeze thaw destroy

help:
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[1m%-12s\033[0m %s\n", $$1, $$2}'

init: ## terraform init
	$(TF) init -input=false

plan: ## terraform plan
	$(TF) plan

apply: ## create / update the AWS resources
	$(TF) apply

deploy: apply web content ## everything: infra, web app, video content
	@echo; echo "Demo ready: $(URL)"

web: ## build the web app and publish it to S3 + invalidate CloudFront
	cd web && npm install --no-audit --no-fund && npm run build
	aws s3 sync web/dist "s3://$(BUCKET)/web" --delete --only-show-errors --region "$(REGION)"
	aws cloudfront create-invalidation --distribution-id "$(DIST_ID)" --paths "/*" --query 'Invalidation.Id' --output text
	@echo "web app published: $(URL)"

content: upload sync ## download + transcode the film, upload to S3, copy to EBS/EFS/NVMe

upload: ## (re)package the video locally and upload to s3://bucket/video
	./content/prepare.sh
	# max-age=0: the browser revalidates every segment (keeps the S3+CloudFront tile honest
	# across restarts); s-maxage: the CloudFront edge still caches for a day.
	aws s3 sync content/out "s3://$(BUCKET)/video" --delete --only-show-errors --region "$(REGION)" \
	  --cache-control "public, max-age=0, s-maxage=86400"
	@echo "uploaded to s3://$(BUCKET)/video"

wait: ## wait until the API answers through CloudFront
	@printf "waiting for $(URL)/api/healthz "
	until curl -sf -o /dev/null "$(URL)/api/healthz"; do printf .; sleep 10; done
	@echo " up"

sync: wait ## copy the video from S3 onto the EBS / EFS / NVMe backends
	./scripts/job.sh "$(URL)" /api/admin/sync

update-api: ## push changed api/*.mjs to the running instance
	$(TF) apply -auto-approve -target=aws_s3_object.api -target=aws_s3_object.loadtest
	./scripts/update-api.sh "$(REGION)" "$(ORIGIN)"

status: ## what the API sees: instance, backends, readiness
	@curl -sf "$(URL)/api/info" | jq '{instance, backends: [.backends[] | {id, available, ready}]}'

bench: wait ## run one quick benchmark from the CLI
	./scripts/job.sh "$(URL)" /api/bench/run '{"runs":1}'

url: ## print the demo URL
	@echo "$(URL)"

shell: ## interactive shell on the origin instance (SSM, no SSH)
	aws ssm start-session --region "$(REGION)" --target "$(ORIGIN)"

freeze: ## archive: snapshot results, keep CloudFront + bucket, remove instances/EBS/EFS/EIP/video
	./scripts/freeze.sh "$(URL)"
	$(MAKE) web
	printf 'frozen = true\n' > infra/frozen.auto.tfvars
	$(TF) apply
	aws s3 rm "s3://$(BUCKET)/video" --recursive --only-show-errors --region "$(REGION)"
	aws s3 rm "s3://$(BUCKET)/results" --recursive --only-show-errors --region "$(REGION)"
	aws s3 rm "s3://$(BUCKET)/app" --recursive --only-show-errors --region "$(REGION)"
	aws cloudfront create-invalidation --distribution-id "$(DIST_ID)" --paths "/*" --query 'Invalidation.Id' --output text
	@echo "frozen: $(URL) serves the archived results"

thaw: ## bring the live stack back after a freeze (then: make content)
	rm -f infra/frozen.auto.tfvars
	$(TF) apply
	$(MAKE) web
	@echo "thawed: now run 'make content' to restore the video"

destroy: ## tear everything down
	rm -f infra/frozen.auto.tfvars
	$(TF) destroy
