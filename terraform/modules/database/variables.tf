variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment name (staging, production)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where RDS will be deployed"
  type        = string
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs for RDS"
  type        = list(string)
}
 
variable "allowed_security_groups" {
  description = "List of security group IDs allowed to access RDS"
  type        = list(string)
  default     = []
}

variable "engine_version" {
  description = "PostgreSQL engine version"
  type        = string
  default     = "15.5"
}

variable "instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.medium"
}

variable "allocated_storage" {
  description = "Initial allocated storage in GB"
  type        = number
  default     = 100
}

variable "max_allocated_storage" {
  description = "Maximum allocated storage for autoscaling in GB"
  type        = number
  default     = 500
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "berthcare"
}

variable "db_username" {
  description = "Database master username"
  type        = string
  default     = "berthcare_admin"
}

variable "multi_az" {
  description = "Enable Multi-AZ deployment for high availability"
  type        = bool
  default     = true
}

variable "backup_retention_period" {
  description = "Number of days to retain automated backups"
  type        = number
  default     = 7
}

variable "backup_window" {
  description = "Preferred backup window (UTC)"
  type        = string
  default     = "03:00-04:00"
}

variable "maintenance_window" {
  description = "Preferred maintenance window (UTC)"
  type        = string
  default     = "sun:04:00-sun:05:00"
}

variable "skip_final_snapshot" {
  description = "Skip final snapshot when destroying (set to false for production)"
  type        = bool
  default     = false
}

variable "deletion_protection" {
  description = "Enable deletion protection"
  type        = bool
  default     = true
}

variable "enable_performance_insights" {
  description = "Enable Performance Insights"
  type        = bool
  default     = true
}

variable "enable_secret_rotation" {
  description = "Enable automatic rotation for the database credentials secret"
  type        = bool
  default     = false
}

variable "secret_rotation_lambda_arn" {
  description = "ARN of the Lambda function that performs Secrets Manager rotation (required if rotation enabled)"
  type        = string
  default     = null
  validation {
    condition     = var.enable_secret_rotation ? var.secret_rotation_lambda_arn != null && length(var.secret_rotation_lambda_arn) > 0 : true
    error_message = "secret_rotation_lambda_arn must be provided when enable_secret_rotation is true."
  }
}

variable "secret_rotation_automatically_after_days" {
  description = "Number of days after which the secret is automatically rotated"
  type        = number
  default     = 30
  validation {
    condition     = var.secret_rotation_automatically_after_days >= 1 && var.secret_rotation_automatically_after_days <= 365
    error_message = "secret_rotation_automatically_after_days must be between 1 and 365 days."
  }
}

variable "max_connections" {
  description = "Maximum number of database connections"
  type        = number
  default     = 100
}

variable "kms_key_id" {
  description = "KMS key ID for encryption (optional)"
  type        = string
  default     = null
}

variable "alarm_actions" {
  description = "List of ARNs to notify when alarms trigger"
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Common tags for all resources"
  type        = map(string)
  default     = {}
}

variable "create_secret_access_role" {
  description = "Create an IAM role with permissions to read the database credentials secret"
  type        = bool
  default     = true
}

variable "secret_access_role_name" {
  description = "Name of the IAM role to create for accessing the database secret (only used when creating the role)"
  type        = string
  default     = null
}

variable "secret_access_role_service_principals" {
  description = "Service principals allowed to assume the generated secret access role"
  type        = list(string)
  default     = ["ecs-tasks.amazonaws.com"]
}

variable "existing_secret_access_role_name" {
  description = "Name of an existing IAM role that should be granted read access to the database secret"
  type        = string
  default     = null
}

variable "existing_secret_access_role_arn" {
  description = "ARN of an existing IAM role that should be granted read access to the database secret (optional if name is provided)"
  type        = string
  default     = null
}
