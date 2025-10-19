# Monitoring Module Variables

variable "environment" {
  description = "Environment name (staging, production)"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ca-central-1"
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30
}

variable "error_rate_threshold" {
  description = "Threshold for 5XX error count alarm"
  type        = number
  default     = 10
}
 
variable "response_time_threshold_ms" {
  description = "Threshold for API response time alarm in milliseconds"
  type        = number
  default     = 2000
}

variable "database_cpu_threshold" {
  description = "Threshold for database CPU utilization alarm (%)"
  type        = number
  default     = 80
}

variable "database_instance_id" {
  description = "RDS database instance identifier"
  type        = string
}

variable "database_max_connections" {
  description = "Maximum database connections"
  type        = number
  default     = 100
}

variable "redis_cluster_id" {
  description = "ElastiCache Redis cluster identifier"
  type        = string
}

variable "alert_email_addresses" {
  description = "List of email addresses to receive alerts"
  type        = list(string)
  default     = []
}
