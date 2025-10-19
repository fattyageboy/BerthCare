variable "project_name" {
  description = "Project name"
  type        = string
  default     = "berthcare"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "staging"
}
 
variable "aws_region" {
  description = "AWS region for Canadian data residency"
  type        = string
  default     = "ca-central-1"
}

# Networking variables
variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones"
  type        = list(string)
  default     = ["ca-central-1a", "ca-central-1b"]
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets"
  type        = list(string)
  default     = ["10.0.11.0/24", "10.0.12.0/24"]
}

# Database variables
variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.medium"
}

variable "db_allocated_storage" {
  description = "Initial allocated storage in GB"
  type        = number
  default     = 100
}

variable "db_max_allocated_storage" {
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

# Cache variables
variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t4g.micro"
}

# Monitoring variables
variable "alert_email_addresses" {
  description = "List of email addresses for alert notifications"
  type        = list(string)
  default     = []
}
