# BerthCare Staging Environment
# AWS Infrastructure in ca-central-1 (Canadian data residency)

terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
 
  # Backend configuration for state management
  # Uncomment after creating S3 bucket and DynamoDB table for state locking
  # backend "s3" {
  #   bucket         = "berthcare-terraform-state"
  #   key            = "staging/terraform.tfstate"
  #   region         = "ca-central-1"
  #   encrypt        = true
  #   dynamodb_table = "berthcare-terraform-locks"
  # }
}

# AWS Provider - Canadian region
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
      Region      = var.aws_region
      Compliance  = "PIPEDA"
    }
  }
}

# Local variables
locals {
  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# Security Module (IAM roles, security groups, KMS)
module "security" {
  source = "../../modules/security"

  project_name = var.project_name
  environment  = var.environment
  vpc_id       = module.networking.vpc_id

  tags = local.common_tags
}

# Networking Module (VPC, subnets, NAT gateways)
module "networking" {
  source = "../../modules/networking"

  project_name       = var.project_name
  environment        = var.environment
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
  enable_flow_logs   = true

  tags = local.common_tags
}

# Database Module (RDS PostgreSQL 15)
module "database" {
  source = "../../modules/database"

  project_name            = var.project_name
  environment             = var.environment
  vpc_id                  = module.networking.vpc_id
  private_subnet_ids      = module.networking.private_subnet_ids
  allowed_security_groups = [module.security.ecs_tasks_security_group_id]

  engine_version              = "15.5"
  instance_class              = var.db_instance_class
  allocated_storage           = var.db_allocated_storage
  max_allocated_storage       = var.db_max_allocated_storage
  db_name                     = var.db_name
  db_username                 = var.db_username
  multi_az                    = true
  backup_retention_period     = 7
  deletion_protection         = true
  enable_performance_insights = true
  kms_key_id                  = module.security.kms_key_id

  tags = local.common_tags
}

# Cache Module (ElastiCache Redis)
module "cache" {
  source = "../../modules/cache"

  project_name            = var.project_name
  environment             = var.environment
  vpc_id                  = module.networking.vpc_id
  private_subnet_ids      = module.networking.private_subnet_ids
  allowed_security_groups = [module.security.ecs_tasks_security_group_id]

  engine_version              = "7.1"
  node_type                   = var.redis_node_type
  num_cache_nodes             = 2
  automatic_failover_enabled  = true
  multi_az_enabled            = true
  snapshot_retention_limit    = 5

  tags = local.common_tags
}

# Storage Module (S3 buckets)
module "storage" {
  source = "../../modules/storage"

  project_name = var.project_name
  environment  = var.environment
  kms_key_id   = module.security.kms_key_id

  # Will be updated after CDN module creates distribution
  cloudfront_distribution_arn = module.cdn.cloudfront_distribution_arn

  tags = local.common_tags
}

# CDN Module (CloudFront)
module "cdn" {
  source = "../../modules/cdn"

  project_name                  = var.project_name
  environment                   = var.environment
  photos_bucket_domain_name     = module.storage.photos_bucket_domain_name
  documents_bucket_domain_name  = module.storage.documents_bucket_domain_name
  signatures_bucket_domain_name = module.storage.signatures_bucket_domain_name
  logs_bucket_domain_name       = module.storage.logs_bucket_domain_name
  price_class                   = "PriceClass_100"

  tags = local.common_tags
}

# Monitoring Module (CloudWatch dashboards, alarms, log aggregation)
module "monitoring" {
  source = "../../modules/monitoring"

  project_name        = var.project_name
  environment         = var.environment
  aws_region          = var.aws_region
  log_retention_days  = 30

  # Alert thresholds
  error_rate_threshold        = 10
  response_time_threshold_ms  = 2000
  database_cpu_threshold      = 80
  database_max_connections    = 100

  # Resource identifiers
  database_instance_id = module.database.db_instance_id
  redis_cluster_id     = module.cache.redis_cluster_id

  # Alert email addresses
  alert_email_addresses = var.alert_email_addresses

  tags = local.common_tags
}
