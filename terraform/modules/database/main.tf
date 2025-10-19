# RDS PostgreSQL Module
# Creates Multi-AZ PostgreSQL 15 database with automated backups and encryption

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
}

# Generate random password for database
resource "random_password" "db_password" {
  length  = 32
  special = true
  # Exclude characters that might cause issues in connection strings
  override_special = "!#$%&*()-_=+[]{}<>:?"
}
 
# Store database credentials in AWS Secrets Manager
resource "aws_secretsmanager_secret" "db_credentials" {
  name        = "${var.project_name}-${var.environment}-db-credentials"
  description = "RDS PostgreSQL credentials for ${var.project_name} ${var.environment}"

  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    username = var.db_username
    password = random_password.db_password.result
    engine   = "postgres"
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    dbname   = var.db_name
  })
}

locals {
  secret_access_role_effective_name = var.existing_secret_access_role_name != null ? var.existing_secret_access_role_name : coalesce(var.secret_access_role_name, "${var.project_name}-${var.environment}-db-secret-role")
  should_create_secret_access_role  = var.create_secret_access_role && var.existing_secret_access_role_name == null
}

data "aws_iam_policy_document" "secret_access_assume_role" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = var.secret_access_role_service_principals
    }
    actions = ["sts:AssumeRole"]
  }
}

data "aws_iam_policy_document" "db_credentials_access" {
  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret"
    ]
    resources = [
      aws_secretsmanager_secret.db_credentials.arn,
      "${aws_secretsmanager_secret.db_credentials.arn}:*"
    ]
  }
}

resource "aws_iam_policy" "db_credentials_access" {
  name        = "${var.project_name}-${var.environment}-db-secret-access"
  description = "Allows read access to the ${var.project_name} ${var.environment} database credentials secret"
  policy      = data.aws_iam_policy_document.db_credentials_access.json
  tags        = var.tags
}

resource "aws_iam_role" "secret_access" {
  count              = local.should_create_secret_access_role ? 1 : 0
  name               = local.secret_access_role_effective_name
  assume_role_policy = data.aws_iam_policy_document.secret_access_assume_role.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "secret_access_created_role" {
  count      = local.should_create_secret_access_role ? 1 : 0
  role       = aws_iam_role.secret_access[0].name
  policy_arn = aws_iam_policy.db_credentials_access.arn
}

resource "aws_iam_role_policy_attachment" "secret_access_existing_role" {
  count      = var.existing_secret_access_role_name != null ? 1 : 0
  role       = var.existing_secret_access_role_name
  policy_arn = aws_iam_policy.db_credentials_access.arn
}

data "aws_iam_role" "existing_secret_access" {
  count = var.existing_secret_access_role_name != null && var.existing_secret_access_role_arn == null ? 1 : 0
  name  = var.existing_secret_access_role_name
}

resource "aws_secretsmanager_secret_rotation" "db_credentials" {
  count              = var.enable_secret_rotation ? 1 : 0
  secret_id          = aws_secretsmanager_secret.db_credentials.id
  rotation_lambda_arn = var.secret_rotation_lambda_arn

  rotation_rules {
    automatically_after_days = var.secret_rotation_automatically_after_days
  }

  depends_on = [aws_secretsmanager_secret_version.db_credentials]
}

# DB Subnet Group
resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-${var.environment}-db-subnet-group"
  subnet_ids = var.private_subnet_ids

  tags = merge(
    var.tags,
    {
      Name = "${var.project_name}-${var.environment}-db-subnet-group"
    }
  )
}

# Security Group for RDS
resource "aws_security_group" "rds" {
  name        = "${var.project_name}-${var.environment}-rds-sg"
  description = "Security group for RDS PostgreSQL"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from application"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = var.allowed_security_groups
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(
    var.tags,
    {
      Name = "${var.project_name}-${var.environment}-rds-sg"
    }
  )
}

# RDS Parameter Group for PostgreSQL 15
resource "aws_db_parameter_group" "main" {
  name   = "${var.project_name}-${var.environment}-postgres15"
  family = "postgres15"

  # Performance and connection settings
  parameter {
    name  = "max_connections"
    value = var.max_connections
  }

  parameter {
    name  = "shared_buffers"
    value = "{DBInstanceClassMemory/32768}" # 25% of instance memory
  }

  parameter {
    name  = "effective_cache_size"
    value = "{DBInstanceClassMemory/16384}" # 50% of instance memory
  }

  parameter {
    name  = "maintenance_work_mem"
    value = "2097152" # 2GB in KB
  }

  parameter {
    name  = "work_mem"
    value = "16384" # 16MB in KB
  }

  # Logging for monitoring
  parameter {
    name  = "log_min_duration_statement"
    value = "1000" # Log queries taking > 1 second
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  tags = var.tags
}

# RDS Instance
resource "aws_db_instance" "main" {
  identifier     = "${var.project_name}-${var.environment}-postgres"
  engine         = "postgres"
  engine_version = var.engine_version

  # Instance configuration
  instance_class        = var.instance_class
  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = var.kms_key_id

  # Database configuration
  db_name  = var.db_name
  username = var.db_username
  password = random_password.db_password.result
  port     = 5432

  # Network configuration
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  # High availability
  multi_az = var.multi_az

  # Backup configuration
  backup_retention_period   = var.backup_retention_period
  backup_window             = var.backup_window
  maintenance_window        = var.maintenance_window
  delete_automated_backups  = false
  copy_tags_to_snapshot     = true
  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${var.project_name}-${var.environment}-final-snapshot-${formatdate("YYYY-MM-DD-hhmm", timestamp())}"

  # Performance Insights
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  performance_insights_enabled    = var.enable_performance_insights
  performance_insights_retention_period = var.enable_performance_insights ? 7 : null

  # Parameter group
  parameter_group_name = aws_db_parameter_group.main.name

  # Auto minor version upgrade
  auto_minor_version_upgrade = true

  # Deletion protection
  deletion_protection = var.deletion_protection

  tags = merge(
    var.tags,
    {
      Name = "${var.project_name}-${var.environment}-postgres"
    }
  )
}

# CloudWatch Alarms for RDS monitoring
resource "aws_cloudwatch_metric_alarm" "database_cpu" {
  alarm_name          = "${var.project_name}-${var.environment}-rds-cpu-utilization"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = "300"
  statistic           = "Average"
  threshold           = "80"
  alarm_description   = "This metric monitors RDS CPU utilization"
  alarm_actions       = var.alarm_actions

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "database_memory" {
  alarm_name          = "${var.project_name}-${var.environment}-rds-freeable-memory"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "FreeableMemory"
  namespace           = "AWS/RDS"
  period              = "300"
  statistic           = "Average"
  threshold           = "536870912" # 512MB in bytes
  alarm_description   = "This metric monitors RDS freeable memory"
  alarm_actions       = var.alarm_actions

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "database_storage" {
  alarm_name          = "${var.project_name}-${var.environment}-rds-free-storage"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = "300"
  statistic           = "Average"
  threshold           = "10737418240" # 10GB in bytes
  alarm_description   = "This metric monitors RDS free storage space"
  alarm_actions       = var.alarm_actions

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "database_connections" {
  alarm_name          = "${var.project_name}-${var.environment}-rds-database-connections"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = "300"
  statistic           = "Average"
  threshold           = var.max_connections * 0.8 # 80% of max connections
  alarm_description   = "This metric monitors RDS database connections"
  alarm_actions       = var.alarm_actions

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }

  tags = var.tags
}
