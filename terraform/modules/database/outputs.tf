output "db_instance_id" {
  description = "RDS instance ID"
  value       = aws_db_instance.main.id
}

output "db_instance_arn" {
  description = "RDS instance ARN"
  value       = aws_db_instance.main.arn
}

output "db_instance_endpoint" {
  description = "RDS instance endpoint"
  value       = aws_db_instance.main.endpoint
}

output "db_instance_address" {
  description = "RDS instance address"
  value       = aws_db_instance.main.address
}
 
output "db_instance_port" {
  description = "RDS instance port"
  value       = aws_db_instance.main.port
}

output "db_name" {
  description = "Database name"
  value       = aws_db_instance.main.db_name
}

output "db_username" {
  description = "Database master username"
  value       = aws_db_instance.main.username
  sensitive   = true
}

output "db_security_group_id" {
  description = "Security group ID for RDS"
  value       = aws_security_group.rds.id
}

output "db_credentials_secret_arn" {
  description = "ARN of the Secrets Manager secret containing database credentials"
  value       = aws_secretsmanager_secret.db_credentials.arn
}

output "db_credentials_secret_access_policy_arn" {
  description = "IAM policy ARN granting read access to the database credentials secret"
  value       = aws_iam_policy.db_credentials_access.arn
}

output "db_credentials_secret_access_role_arn" {
  description = "IAM role ARN with permissions to read the database credentials secret (if created or supplied)"
  value = var.existing_secret_access_role_name != null ? coalesce(
    var.existing_secret_access_role_arn,
    try(data.aws_iam_role.existing_secret_access[0].arn, null)
  ) : (
    local.should_create_secret_access_role ? aws_iam_role.secret_access[0].arn : null
  )
}

output "db_connection_string" {
  description = "PostgreSQL connection string"
  value       = "postgresql://${aws_db_instance.main.username}:${random_password.db_password.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${aws_db_instance.main.db_name}"
  sensitive   = true
}
