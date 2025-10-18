# BerthCare Monitoring & Observability Module
# CloudWatch dashboards, alarms, and log aggregation

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# CloudWatch Log Groups
resource "aws_cloudwatch_log_group" "api_logs" {
  name              = "/aws/ecs/${var.environment}/berthcare-api"
  retention_in_days = var.log_retention_days
 
  tags = {
    Name        = "berthcare-api-logs-${var.environment}"
    Environment = var.environment
    Project     = "BerthCare"
  }
}

resource "aws_cloudwatch_log_group" "application_logs" {
  name              = "/berthcare/${var.environment}/application"
  retention_in_days = var.log_retention_days

  tags = {
    Name        = "berthcare-application-logs-${var.environment}"
    Environment = var.environment
    Project     = "BerthCare"
  }
}

# CloudWatch Dashboard - API Performance
resource "aws_cloudwatch_dashboard" "api_performance" {
  dashboard_name = "BerthCare-API-Performance-${var.environment}"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", { stat = "Average", label = "Avg Response Time" }],
            ["...", { stat = "p99", label = "P99 Response Time" }]
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "API Response Time (ms)"
          yAxis = {
            left = {
              min = 0
            }
          }
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", { stat = "Sum", label = "Total Requests" }],
            [".", "HTTPCode_Target_2XX_Count", { stat = "Sum", label = "2XX Success" }],
            [".", "HTTPCode_Target_4XX_Count", { stat = "Sum", label = "4XX Client Errors" }],
            [".", "HTTPCode_Target_5XX_Count", { stat = "Sum", label = "5XX Server Errors" }]
          ]
          period = 300
          stat   = "Sum"
          region = var.aws_region
          title  = "API Request Count & Status Codes"
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "TargetConnectionErrorCount", { stat = "Sum" }]
          ]
          period = 300
          stat   = "Sum"
          region = var.aws_region
          title  = "Connection Errors"
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/RDS", "CPUUtilization", { stat = "Average", label = "Database CPU" }],
            [".", "DatabaseConnections", { stat = "Average", label = "DB Connections" }]
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "Database Performance"
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/ElastiCache", "CPUUtilization", { stat = "Average", label = "Redis CPU" }],
            [".", "CurrConnections", { stat = "Average", label = "Redis Connections" }]
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "Cache Performance"
        }
      },
      {
        type = "log"
        properties = {
          query   = "SOURCE '${aws_cloudwatch_log_group.api_logs.name}' | fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 20"
          region  = var.aws_region
          title   = "Recent API Errors"
        }
      }
    ]
  })
}

# CloudWatch Alarm - API Error Rate
resource "aws_cloudwatch_metric_alarm" "api_error_rate" {
  alarm_name          = "berthcare-api-error-rate-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = var.error_rate_threshold
  alarm_description   = "API 5XX error rate exceeds ${var.error_rate_threshold}% over 10 minutes"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name        = "api-error-rate-${var.environment}"
    Environment = var.environment
    Severity    = "high"
  }
}

# CloudWatch Alarm - API Response Time
resource "aws_cloudwatch_metric_alarm" "api_response_time" {
  alarm_name          = "berthcare-api-response-time-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Average"
  threshold           = var.response_time_threshold_ms / 1000 # Convert to seconds
  alarm_description   = "API response time exceeds ${var.response_time_threshold_ms}ms"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name        = "api-response-time-${var.environment}"
    Environment = var.environment
    Severity    = "medium"
  }
}

# CloudWatch Alarm - Database CPU
resource "aws_cloudwatch_metric_alarm" "database_cpu" {
  alarm_name          = "berthcare-database-cpu-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = var.database_cpu_threshold
  alarm_description   = "Database CPU utilization exceeds ${var.database_cpu_threshold}%"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.database_instance_id
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Name        = "database-cpu-${var.environment}"
    Environment = var.environment
    Severity    = "high"
  }
}

# CloudWatch Alarm - Database Connections
resource "aws_cloudwatch_metric_alarm" "database_connections" {
  alarm_name          = "berthcare-database-connections-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = var.database_max_connections * 0.8 # 80% of max
  alarm_description   = "Database connections exceed 80% of maximum"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.database_instance_id
  }

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = {
    Name        = "database-connections-${var.environment}"
    Environment = var.environment
    Severity    = "medium"
  }
}

# CloudWatch Alarm - Redis CPU
resource "aws_cloudwatch_metric_alarm" "redis_cpu" {
  alarm_name          = "berthcare-redis-cpu-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 75
  alarm_description   = "Redis CPU utilization exceeds 75%"
  treat_missing_data  = "notBreaching"

  dimensions = {
    CacheClusterId = var.redis_cluster_id
  }

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = {
    Name        = "redis-cpu-${var.environment}"
    Environment = var.environment
    Severity    = "medium"
  }
}

# SNS Topic for Alerts
resource "aws_sns_topic" "alerts" {
  name = "berthcare-alerts-${var.environment}"

  tags = {
    Name        = "berthcare-alerts-${var.environment}"
    Environment = var.environment
    Project     = "BerthCare"
  }
}

# SNS Topic Subscription - Email
resource "aws_sns_topic_subscription" "alerts_email" {
  count     = length(var.alert_email_addresses)
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email_addresses[count.index]
}

# CloudWatch Metric Filter - Application Errors
resource "aws_cloudwatch_log_metric_filter" "application_errors" {
  name           = "application-errors-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.application_logs.name
  pattern        = "[ERROR]"

  metric_transformation {
    name      = "ApplicationErrors"
    namespace = "BerthCare/${var.environment}"
    value     = "1"
  }
}

# CloudWatch Alarm - Application Error Count
resource "aws_cloudwatch_metric_alarm" "application_errors" {
  alarm_name          = "berthcare-application-errors-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApplicationErrors"
  namespace           = "BerthCare/${var.environment}"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "Application error count exceeds 10 in 5 minutes"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = {
    Name        = "application-errors-${var.environment}"
    Environment = var.environment
    Severity    = "high"
  }
}
