# Networking Outputs
output "vpc_id" {
  description = "VPC ID"
  value       = module.networking.vpc_id
}
 
output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = module.networking.public_subnet_ids
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = module.networking.private_subnet_ids
}

# Database Outputs
output "db_endpoint" {
  description = "RDS instance endpoint"
  value       = module.database.db_instance_endpoint
}

output "db_address" {
  description = "RDS instance address"
  value       = module.database.db_instance_address
}

output "db_port" {
  description = "RDS instance port"
  value       = module.database.db_instance_port
}

output "db_name" {
  description = "Database name"
  value       = module.database.db_name
}

output "db_credentials_secret_arn" {
  description = "ARN of Secrets Manager secret containing database credentials"
  value       = module.database.db_credentials_secret_arn
}

# Cache Outputs
output "redis_endpoint" {
  description = "Redis primary endpoint"
  value       = module.cache.redis_primary_endpoint
}

output "redis_port" {
  description = "Redis port"
  value       = module.cache.redis_port
}

output "redis_credentials_secret_arn" {
  description = "ARN of Secrets Manager secret containing Redis credentials"
  value       = module.cache.redis_credentials_secret_arn
}

# Storage Outputs
output "photos_bucket_name" {
  description = "Photos S3 bucket name"
  value       = module.storage.photos_bucket_id
}

output "documents_bucket_name" {
  description = "Documents S3 bucket name"
  value       = module.storage.documents_bucket_id
}

output "signatures_bucket_name" {
  description = "Signatures S3 bucket name"
  value       = module.storage.signatures_bucket_id
}

# CDN Outputs
output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name"
  value       = module.cdn.cloudfront_domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = module.cdn.cloudfront_distribution_id
}

# Security Outputs
output "ecs_task_execution_role_arn" {
  description = "ECS task execution role ARN"
  value       = module.security.ecs_task_execution_role_arn
}

output "ecs_task_role_arn" {
  description = "ECS task role ARN"
  value       = module.security.ecs_task_role_arn
}

output "alb_security_group_id" {
  description = "Application Load Balancer security group ID"
  value       = module.security.alb_security_group_id
}

output "ecs_tasks_security_group_id" {
  description = "ECS tasks security group ID"
  value       = module.security.ecs_tasks_security_group_id
}

output "kms_key_id" {
  description = "KMS key ID for encryption"
  value       = module.security.kms_key_id
}

# Monitoring Outputs
output "cloudwatch_dashboard_name" {
  description = "CloudWatch dashboard name"
  value       = module.monitoring.dashboard_name
}

output "cloudwatch_dashboard_url" {
  description = "CloudWatch dashboard URL"
  value       = module.monitoring.dashboard_url
}

output "api_log_group_name" {
  description = "API CloudWatch log group name"
  value       = module.monitoring.api_log_group_name
}

output "application_log_group_name" {
  description = "Application CloudWatch log group name"
  value       = module.monitoring.application_log_group_name
}

output "sns_alerts_topic_arn" {
  description = "SNS topic ARN for alerts"
  value       = module.monitoring.sns_topic_arn
}

output "alarm_names" {
  description = "List of CloudWatch alarm names"
  value       = module.monitoring.alarm_names
}

# Connection Information (for backend configuration)
output "connection_info" {
  description = "Connection information for backend services"
  value = {
    region                      = var.aws_region
    vpc_id                      = module.networking.vpc_id
    db_endpoint                 = module.database.db_instance_endpoint
    redis_endpoint              = module.cache.redis_primary_endpoint
    cloudfront_domain           = module.cdn.cloudfront_domain_name
    db_credentials_secret_arn   = module.database.db_credentials_secret_arn
    redis_credentials_secret_arn = module.cache.redis_credentials_secret_arn
  }
  sensitive = false
}
