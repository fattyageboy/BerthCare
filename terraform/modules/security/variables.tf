variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment name (staging, production)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "s3_bucket_arns" {
  description = "List of S3 bucket ARNs for IAM policy"
  type        = list(string)
  default     = []
}
 
variable "logs_bucket_arn" {
  description = "Logs S3 bucket ARN"
  type        = string
  default     = ""
}

variable "secrets_arns" {
  description = "List of Secrets Manager secret ARNs"
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Common tags for all resources"
  type        = map(string)
  default     = {}
}
