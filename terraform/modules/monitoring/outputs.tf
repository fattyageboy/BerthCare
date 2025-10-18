# Monitoring Module Outputs

output "api_log_group_name" {
  description = "CloudWatch log group name for API logs"
  value       = aws_cloudwatch_log_group.api_logs.name
}

output "api_log_group_arn" {
  description = "CloudWatch log group ARN for API logs"
  value       = aws_cloudwatch_log_group.api_logs.arn
}

output "application_log_group_name" {
  description = "CloudWatch log group name for application logs"
  value       = aws_cloudwatch_log_group.application_logs.name
}

output "application_log_group_arn" {
  description = "CloudWatch log group ARN for application logs"
  value       = aws_cloudwatch_log_group.application_logs.arn
}
 
output "dashboard_name" {
  description = "CloudWatch dashboard name"
  value       = aws_cloudwatch_dashboard.api_performance.dashboard_name
}

output "dashboard_url" {
  description = "CloudWatch dashboard URL"
  value       = "https://console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${aws_cloudwatch_dashboard.api_performance.dashboard_name}"
}

output "sns_topic_arn" {
  description = "SNS topic ARN for alerts"
  value       = aws_sns_topic.alerts.arn
}

output "alarm_names" {
  description = "List of CloudWatch alarm names"
  value = [
    aws_cloudwatch_metric_alarm.api_error_rate.alarm_name,
    aws_cloudwatch_metric_alarm.api_response_time.alarm_name,
    aws_cloudwatch_metric_alarm.database_cpu.alarm_name,
    aws_cloudwatch_metric_alarm.database_connections.alarm_name,
    aws_cloudwatch_metric_alarm.redis_cpu.alarm_name,
    aws_cloudwatch_metric_alarm.application_errors.alarm_name
  ]
}
