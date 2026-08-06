# Cloud infrastructure is intentionally deferred until AWS accounts
# and paid services (Payme/Click, SES) are ready.
#
# Planned stack (see product plan):
# - Region: me-central-1 (UAE)
# - ECS Fargate + ALB
# - RDS PostgreSQL Multi-AZ (prod)
# - ElastiCache Redis
# - S3 + CloudFront + WAF
# - Secrets Manager
# - Terraform modules under this folder
#
# Local development uses docker/docker-compose.yml instead.

README.md
