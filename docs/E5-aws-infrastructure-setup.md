# E5: AWS Infrastructure Setup (Staging)

**Task ID:** E5  
**Environment:** Staging  
**Region:** ca-central-1 (Canadian data residency - PIPEDA compliant)  
**IaC Tool:** Terraform 1.6+  
**Estimated Time:** 3 days

---

## Overview

This document provides step-by-step instructions for provisioning the complete AWS infrastructure for BerthCare staging environment using Terraform.

## Architecture Components

### Networking

- **VPC:** 10.0.0.0/16 CIDR block
- **Public Subnets:** 2 subnets across 2 AZs (ca-central-1a, ca-central-1b)
- **Private Subnets:** 2 subnets across 2 AZs
- **NAT Gateways:** 2 (one per AZ for high availability)
- **Internet Gateway:** 1
- **VPC Flow Logs:** Enabled for network monitoring

### Database

- **Engine:** PostgreSQL 15.5
- **Instance Class:** db.t4g.medium (ARM-based, cost-effective)
- **Storage:** 100 GB initial, auto-scaling up to 500 GB
- **Multi-AZ:** Enabled for high availability
- **Backup Retention:** 7 days
- **Encryption:** At rest with KMS
- **Performance Insights:** Enabled

### Cache

- **Engine:** Redis 7.1
- **Node Type:** cache.t4g.micro
- **Cluster Size:** 2 nodes
- **Multi-AZ:** Enabled
- **Automatic Failover:** Enabled
- **Encryption:** At rest and in transit
- **Auth Token:** Enabled

### Storage

- **S3 Buckets:**
  - `berthcare-photos-staging` - Visit photos
  - `berthcare-documents-staging` - Care plans and documents
  - `berthcare-signatures-staging` - Client signatures
  - `berthcare-logs-staging` - Access logs
- **Versioning:** Enabled on all buckets
- **Encryption:** AES256 or KMS
- **Lifecycle Policies:** Archive to Glacier after 1 year, Deep Archive after 7 years
- **Public Access:** Blocked

### CDN

- **CloudFront Distribution:** Global edge locations
- **Origins:** S3 buckets (photos, documents, signatures)
- **SSL/TLS:** TLS 1.2+ enforced
- **Geo Restriction:** Canada and US only
- **Caching:** Optimized for static assets
- **Compression:** Enabled

### Security

- **IAM Roles:**
  - ECS Task Execution Role (pull images, write logs)
  - ECS Task Role (application runtime permissions)
- **Security Groups:**
  - ALB Security Group (HTTPS/HTTP ingress)
  - ECS Tasks Security Group (HTTP from ALB)
  - RDS Security Group (PostgreSQL from ECS)
  - Redis Security Group (Redis from ECS)
- **KMS Key:** For encryption at rest
- **Secrets Manager:** Database and Redis credentials

### Monitoring

- **CloudWatch Dashboard:** Pre-configured metrics
- **CloudWatch Alarms:**
  - RDS CPU utilization > 80%
  - RDS freeable memory < 512 MB
  - RDS free storage < 10 GB
  - RDS connections > 80% of max
  - Redis CPU utilization > 75%
  - Redis memory utilization > 80%
  - Redis evictions > 1000
  - CloudFront 5xx error rate > 5%
- **SNS Topic:** Email notifications for alarms
- **CloudTrail:** (REQUIRED for compliance)
  - Multi-region trail for comprehensive API audit logging
  - S3 bucket for log storage with encryption
  - Log file validation enabled
  - CloudWatch Logs integration for real-time monitoring
  - 90-day retention in CloudWatch, indefinite in S3
  - Critical for PIPEDA compliance and security investigations

---

## Prerequisites

### 1. Install Required Tools

```bash
# Install Terraform (macOS)
brew tap hashicorp/tap
brew install hashicorp/tap/terraform

# Verify installation
terraform version  # Should be 1.6+

# Install AWS CLI (macOS)
brew install awscli

# Verify installation
aws --version
```

### 2. Configure AWS Credentials

```bash
# Configure AWS CLI with your credentials
aws configure

# Enter your AWS credentials:
# AWS Access Key ID: [your-access-key]
# AWS Secret Access Key: [your-secret-key]
# Default region name: ca-central-1
# Default output format: json

# Verify configuration
aws sts get-caller-identity
```

### 3. Required AWS Permissions

Your AWS user/role needs the following permissions:

- VPC management (create VPC, subnets, route tables, NAT gateways)
- RDS management (create databases, parameter groups, subnet groups)
- ElastiCache management (create Redis clusters)
- S3 management (create buckets, configure policies)
- CloudFront management (create distributions)
- IAM management (create roles, policies)
- KMS management (create keys)
- CloudWatch management (create dashboards, alarms, log groups)
- Secrets Manager management (create secrets)
- SNS management (create topics)
- **CloudTrail management (create trails, configure logging) - REQUIRED**

---

## Deployment Steps

### Step 1: Configure Staging Environment

**Important:** Complete this step BEFORE initializing the backend to avoid re-initialization issues.

```bash
# Navigate to staging environment
cd terraform/environments/staging

# Copy example configuration
cp terraform.tfvars.example terraform.tfvars

# Edit configuration (use your preferred editor)
nano terraform.tfvars
```

Update the following values in `terraform.tfvars`:

```hcl
# Project Configuration
project_name = "berthcare"
environment  = "staging"
aws_region   = "ca-central-1"

# Monitoring Configuration
alarm_email = "your-email@example.com"  # Update this!

# Other values can remain as defaults for staging
```

### Step 2: Uncomment Backend Configuration

**Critical:** Do this BEFORE running any Terraform commands to ensure remote state from the start.

Edit `main.tf` and uncomment the backend configuration block:

```hcl
backend "s3" {
  bucket         = "berthcare-terraform-state"
  key            = "staging/terraform.tfstate"
  region         = "ca-central-1"
  encrypt        = true
  dynamodb_table = "berthcare-terraform-locks"
}
```

**Note:** The backend configuration must be uncommented before `terraform init` to avoid initializing with a local backend first, which would require migration later.

### Step 3: Initialize Terraform Backend

The backend initialization script creates the S3 bucket and DynamoDB table required for remote state storage.

```bash
# Run the backend initialization script
cd ../../scripts
./init-backend.sh

# This script creates:
# - S3 bucket: berthcare-terraform-state (with versioning and encryption)
# - DynamoDB table: berthcare-terraform-locks (for state locking)
```

**What the script does:**

- Creates S3 bucket with versioning enabled
- Enables server-side encryption (AES256)
- Blocks public access
- Creates DynamoDB table with on-demand billing
- Configures proper tags

### Step 4: Initialize Terraform with Remote Backend

Now that the backend resources exist and the configuration is uncommented, initialize Terraform:

```bash
# Return to staging environment
cd ../environments/staging

# Initialize Terraform with remote backend
terraform init

# You should see:
# ✅ Initializing the backend...
# ✅ Successfully configured the backend "s3"!
# ✅ Terraform has been successfully initialized!
```

**Troubleshooting:**

- If you see "Backend configuration changed", you may have run `terraform init` before uncommenting the backend config. Run `terraform init -migrate-state` to migrate from local to remote backend.
- If the script fails with "bucket already exists", the backend was already initialized. Proceed to the next step.

### Step 5: Validate Configuration

```bash
# Validate Terraform configuration
terraform validate

# Format Terraform files
terraform fmt -recursive

# You should see:
# ✅ Success! The configuration is valid.
```

### Step 6: Plan Infrastructure

**Critical:** Carefully review the plan output before applying. This is your opportunity to catch configuration errors before they affect your infrastructure.

```bash
# Generate and review execution plan
terraform plan -out=tfplan
```

**What to Review:**

1. **Resource Count:** Typical staging deployments create 40-60+ resources including:
   - VPC, subnets, route tables, NAT gateways, internet gateway
   - Security groups (ALB, ECS, RDS, Redis)
   - RDS database instance, subnet group, parameter group
   - ElastiCache Redis cluster, subnet group, parameter group
   - S3 buckets (photos, documents, signatures, logs)
   - CloudFront distribution
   - IAM roles and policies
   - CloudWatch alarms, log groups, dashboard
   - Secrets Manager secrets
   - KMS keys

2. **Verify Actions:**
   - ✅ All resources should show `+ create` (green plus sign)
   - ⚠️ **STOP if you see:** `-/+ destroy and then create` (replacement)
   - ❌ **DO NOT PROCEED if you see:** `- destroy` (deletion)

3. **Check Critical Resources:**
   - RDS instance: Verify Multi-AZ is enabled
   - ElastiCache: Verify cluster mode and node count
   - S3 buckets: Verify encryption and versioning enabled
   - Security groups: Verify ingress/egress rules are correct

4. **Review Sensitive Values:**
   - Database passwords should show `(sensitive value)`
   - No hardcoded credentials should be visible

**Red Flags:**

- Unexpected resource deletions or replacements
- Missing encryption settings
- Public access enabled on resources
- Incorrect CIDR blocks or security group rules
- Wrong instance types or sizes

**If the plan looks correct, proceed to apply. If anything looks unexpected, investigate before continuing.**

### Step 7: Apply Infrastructure

**Warning:** This step will create real AWS resources and incur costs. Ensure you've reviewed the plan output above.

```bash
# Apply the plan (only after careful review)
terraform apply tfplan

# This will take approximately 15-20 minutes
# Resources are created in the following order:
# 1. VPC and networking (2-3 min)
# 2. Security groups and IAM roles (1 min)
# 3. CloudTrail and audit logging (2-3 min)
# 4. RDS database (10-12 min) - Multi-AZ takes longer
# 5. ElastiCache Redis (5-7 min)
# 6. S3 buckets (1 min)
# 7. CloudFront distribution (5-10 min)
```

### Step 8: Configure CloudTrail (REQUIRED)

**Important:** CloudTrail is required for PIPEDA compliance and security audit trails.

The Terraform configuration includes a CloudTrail setup. If not already included, add this to your `main.tf`:

```hcl
# CloudTrail for API audit logging
resource "aws_cloudtrail" "main" {
  name                          = "${var.project_name}-${var.environment}-trail"
  s3_bucket_name                = aws_s3_bucket.cloudtrail_logs.id
  include_global_service_events = true
  is_multi_region_trail         = true
  enable_log_file_validation    = true

  event_selector {
    read_write_type           = "All"
    include_management_events = true

    data_resource {
      type   = "AWS::S3::Object"
      values = ["arn:aws:s3:::${var.project_name}-*/*"]
    }
  }

  cloud_watch_logs_group_arn = "${aws_cloudwatch_log_group.cloudtrail.arn}:*"
  cloud_watch_logs_role_arn  = aws_iam_role.cloudtrail_cloudwatch.arn

  kms_key_id = aws_kms_key.main.arn

  tags = {
    Name        = "${var.project_name}-${var.environment}-trail"
    Environment = var.environment
    Compliance  = "PIPEDA"
  }
}

# S3 bucket for CloudTrail logs
resource "aws_s3_bucket" "cloudtrail_logs" {
  bucket = "${var.project_name}-${var.environment}-cloudtrail-logs"

  tags = {
    Name        = "${var.project_name}-${var.environment}-cloudtrail-logs"
    Environment = var.environment
  }
}

# CloudWatch Log Group for CloudTrail
resource "aws_cloudwatch_log_group" "cloudtrail" {
  name              = "/aws/cloudtrail/${var.project_name}-${var.environment}"
  retention_in_days = 90

  tags = {
    Name        = "${var.project_name}-${var.environment}-cloudtrail-logs"
    Environment = var.environment
  }
}
```

**Verify CloudTrail is enabled:**

```bash
# Check CloudTrail status
aws cloudtrail get-trail-status \
  --name berthcare-staging-trail \
  --region ca-central-1

# View recent events
aws cloudtrail lookup-events \
  --max-results 10 \
  --region ca-central-1
```

### Step 9: Verify Deployment

```bash
# View all outputs
terraform output

# View specific outputs
terraform output db_endpoint
terraform output redis_endpoint
terraform output cloudfront_domain_name

# Test database connectivity (from within VPC)
# Note: RDS is in private subnet, not accessible from internet
```

---

## Post-Deployment Configuration

### 1. Retrieve Database Credentials

```bash
# Get the Secrets Manager ARN
DB_SECRET_ARN=$(terraform output -raw db_credentials_secret_arn)

# Retrieve credentials
aws secretsmanager get-secret-value \
  --secret-id "$DB_SECRET_ARN" \
  --region ca-central-1 \
  --query SecretString \
  --output text | jq .

# Output:
# {
#   "username": "berthcare_admin",
#   "password": "randomly-generated-password",
#   "engine": "postgres",
#   "host": "berthcare-staging-postgres.xxxxx.ca-central-1.rds.amazonaws.com",
#   "port": 5432,
#   "dbname": "berthcare"
# }
```

### 2. Retrieve Redis Credentials

```bash
# Get the Secrets Manager ARN
REDIS_SECRET_ARN=$(terraform output -raw redis_credentials_secret_arn)

# Retrieve credentials
aws secretsmanager get-secret-value \
  --secret-id "$REDIS_SECRET_ARN" \
  --region ca-central-1 \
  --query SecretString \
  --output text | jq .

# Output:
# {
#   "auth_token": "randomly-generated-token",
#   "host": "berthcare-staging-redis.xxxxx.cache.amazonaws.com",
#   "port": 6379,
#   "engine": "redis"
# }
```

### 3. Update Backend Environment Variables

Update your backend application's `.env` file with the infrastructure outputs:

```bash
# Database Configuration
POSTGRES_HOST=<db_address from terraform output>
POSTGRES_PORT=5432
POSTGRES_DB=berthcare
POSTGRES_USER=berthcare_admin
POSTGRES_PASSWORD=<from Secrets Manager>
DATABASE_URL=postgresql://berthcare_admin:<password>@<host>:5432/berthcare

# Redis Configuration
REDIS_HOST=<redis_endpoint from terraform output>
REDIS_PORT=6379
REDIS_PASSWORD=<from Secrets Manager>
REDIS_URL=redis://:<password>@<host>:6379/0

# AWS Configuration
AWS_REGION=ca-central-1
S3_BUCKET_PHOTOS=berthcare-photos-staging
S3_BUCKET_DOCUMENTS=berthcare-documents-staging
S3_BUCKET_SIGNATURES=berthcare-signatures-staging

# CloudFront Configuration
CLOUDFRONT_DOMAIN=<cloudfront_domain_name from terraform output>
```

### 4. Configure SNS Email Subscription

```bash
# Check your email for SNS subscription confirmation
# Click the confirmation link to start receiving alarm notifications
```

### 5. Access CloudWatch Dashboard

```bash
# Get dashboard URL
echo "https://ca-central-1.console.aws.amazon.com/cloudwatch/home?region=ca-central-1#dashboards:name=$(terraform output -raw cloudwatch_dashboard_name)"

# Open in browser to view metrics
```

---

## Verification Checklist

- [ ] VPC created with 2 public and 2 private subnets
- [ ] NAT Gateways operational in both AZs
- [ ] RDS PostgreSQL instance running (Multi-AZ)
- [ ] ElastiCache Redis cluster running (2 nodes)
- [ ] S3 buckets created with encryption and versioning
- [ ] CloudFront distribution deployed and active
- [ ] IAM roles created with appropriate permissions
- [ ] Security groups configured with least privilege
- [ ] KMS key created for encryption
- [ ] Secrets Manager secrets created for credentials
- [ ] CloudWatch dashboard accessible
- [ ] CloudWatch alarms configured
- [ ] SNS topic created and email subscribed
- [ ] VPC Flow Logs enabled
- [ ] All resources tagged correctly

---

## Cost Estimation (Staging)

### Monthly Costs (Approximate)

**Important:** These estimates are based on low-traffic staging environment assumptions. Production costs will be significantly higher.

| Service           | Configuration                   | Breakdown                                  | Monthly Cost (USD) |
| ----------------- | ------------------------------- | ------------------------------------------ | ------------------ |
| RDS PostgreSQL    | db.t4g.medium, Multi-AZ, 100 GB | Instance: $85, Storage: $23, Backup: $12   | $120               |
| ElastiCache Redis | cache.t4g.micro x2, Multi-AZ    | 2 nodes × $15                              | $30                |
| NAT Gateways      | 2 NAT Gateways                  | Instance: $64 (2×$32), Data processing: $1 | $65                |
| S3 Storage        | 100 GB + requests               | Storage: $2.30, Requests: $2.70            | $5                 |
| CloudFront        | 100 GB data transfer            | First 10TB: $0.085/GB                      | $10                |
| Data Transfer     | Inter-AZ, outbound              | Inter-AZ: $5, Internet egress: $5          | $10                |
| CloudWatch        | Logs, metrics, alarms           | Logs: $3, Metrics: $1, Alarms: $1          | $5                 |
| **Total**         |                                 |                                            | **~$245/month**    |

### Cost Assumptions & Limitations

**Traffic Assumptions (Low Staging Load):**

- CloudFront: ~100 GB/month data transfer, ~1M requests
- S3: ~10K PUT requests, ~100K GET requests per month
- NAT Gateway: ~10 GB data processing per month
- Inter-AZ traffic: ~50 GB/month (database replication, cache sync)
- Internet egress: ~50 GB/month (API responses, webhooks)

**What's NOT Included:**

- ❌ ECS Fargate costs (depends on container size and count)
- ❌ Application Load Balancer (~$20/month + LCU charges)
- ❌ Route 53 hosted zone ($0.50/month + query charges)
- ❌ ACM certificates (free, but validation costs may apply)
- ❌ Secrets Manager (~$0.40/secret/month)
- ❌ KMS key usage ($1/month + API calls)
- ❌ CloudTrail (first trail free, additional trails $2/month)
- ❌ VPC Flow Logs storage (varies by traffic volume)

**Production Cost Multipliers:**

- **High traffic:** Data transfer costs can easily 5-10x
- **Heavy API usage:** S3 request costs scale linearly with traffic
- **Large datasets:** Storage costs grow with user base
- **Compliance:** Additional services (GuardDuty, Security Hub) add $50-100/month

**Realistic Production Estimate:** $500-1000/month depending on scale

### AWS Cost Calculator

For detailed cost estimation with your specific usage patterns:

- [AWS Pricing Calculator](https://calculator.aws/)
- Pre-configured estimate: [BerthCare Infrastructure Template](https://calculator.aws/#/estimate?id=placeholder)

### Cost Optimization Tips

1. **Stop non-production resources during off-hours:**
   - RDS: Create snapshot, stop instance (saves ~50%)
   - ElastiCache: Cannot be stopped, consider smaller instance

2. **Use Reserved Instances for production:**
   - 1-year reserved: ~30% savings
   - 3-year reserved: ~50% savings

3. **Optimize S3 storage:**
   - Lifecycle policies automatically archive old data
   - Glacier: $0.004/GB vs S3 Standard: $0.023/GB

4. **Monitor and right-size:**
   - Use CloudWatch metrics to identify underutilized resources
   - Adjust instance sizes based on actual usage

---

## Troubleshooting

### Issue: Terraform state lock error

**Symptom:** `Error acquiring the state lock`

**Solution:**

```bash
# Check DynamoDB for stale locks
aws dynamodb scan \
  --table-name berthcare-terraform-locks \
  --region ca-central-1

# If lock is stale (> 15 minutes old), force unlock
terraform force-unlock <LOCK_ID>
```

### Issue: RDS creation timeout

**Symptom:** `Error creating DB Instance: timeout while waiting for state to become 'available'`

**Solution:**

- Multi-AZ RDS takes 10-15 minutes to create
- Check AWS Console for actual status
- If stuck, check VPC subnet configuration

### Issue: S3 bucket already exists

**Symptom:** `Error creating S3 bucket: BucketAlreadyExists`

**Solution:**

```bash
# S3 bucket names are globally unique
# Update bucket names in terraform.tfvars:
# Add a unique suffix like your AWS account ID
```

### Issue: CloudFront distribution not accessible

**Symptom:** `403 Forbidden` when accessing CloudFront URL

**Solution:**

- CloudFront takes 15-20 minutes to fully deploy
- Check Origin Access Control configuration
- Verify S3 bucket policy allows CloudFront access

### Issue: Cannot connect to RDS from local machine

**Symptom:** Connection timeout

**Solution:**

- RDS is in private subnet (by design for security)
- To connect, use one of these methods:
  1. SSH tunnel through bastion host
  2. VPN connection to VPC
  3. AWS Systems Manager Session Manager
  4. Deploy application in same VPC

---

## Maintenance

### Regular Tasks

**Weekly:**

- Review CloudWatch alarms and metrics
- Check RDS and Redis performance
- Monitor S3 storage growth

**Monthly:**

- Review AWS costs and optimize
- Update Terraform modules to latest versions
- Review security group rules

**Quarterly:**

- Review and update IAM policies
- Test disaster recovery procedures
- Update RDS and Redis to latest minor versions

### Backup and Recovery

**RDS Backups:**

- Automated daily backups (7-day retention)
- Manual snapshots before major changes
- Point-in-time recovery available

**Redis Backups:**

- Automated daily snapshots (5-day retention)
- Manual snapshots before major changes

**S3 Versioning:**

- Enabled on all buckets
- Recover deleted objects within 90 days

**Terraform State:**

- Stored in S3 with versioning
- DynamoDB state locking prevents corruption

---

## Disaster Recovery

### RDS Failover

Multi-AZ RDS automatically fails over to standby in case of:

- Primary AZ failure
- Primary instance failure
- Maintenance operations

**RTO (Recovery Time Objective):** 1-2 minutes  
**RPO (Recovery Point Objective):** 0 (synchronous replication)

### Redis Failover

Multi-AZ Redis automatically fails over to replica in case of:

- Primary node failure
- Primary AZ failure

**RTO:** 1-2 minutes  
**RPO:** < 1 minute (asynchronous replication)

### Complete Region Failure

In case of complete ca-central-1 region failure:

1. **Restore from backups:**

   ```bash
   # Restore RDS from snapshot in another region
   aws rds restore-db-instance-from-db-snapshot \
     --db-instance-identifier berthcare-staging-postgres-dr \
     --db-snapshot-identifier <snapshot-id> \
     --region us-east-1
   ```

2. **Replicate S3 data:**
   - Enable cross-region replication for critical buckets
   - Restore from versioned objects

3. **Redeploy infrastructure:**

   ```bash
   # Update region in terraform.tfvars
   aws_region = "us-east-1"

   # Generate and save the plan for review
   terraform plan -out=dr.plan

   # Archive the plan artifact (in CI, store as build artifact)
   # Review the plan output carefully before proceeding

   # IMPORTANT: Manual approval gate required here
   # In CI: Add manual approval step to review plan changes
   # Locally: Review plan output above before continuing

   # Apply the reviewed and approved plan
   terraform apply dr.plan
   ```

   **Note:** Never use `-auto-approve` for disaster recovery deployments. Always generate a plan, review the changes, and require explicit approval before applying infrastructure changes in a new region.

---

## Security Best Practices

### Network Security

- ✅ RDS and Redis in private subnets (no internet access)
- ✅ Security groups with least privilege
- ✅ VPC Flow Logs enabled for monitoring
- ✅ NAT Gateways for outbound traffic only

### Data Security

- ✅ Encryption at rest (RDS, Redis, S3) with KMS
- ✅ Encryption in transit (TLS 1.2+)
- ✅ S3 bucket public access blocked
- ✅ Versioning enabled for data recovery

### Access Security

- ✅ IAM roles with least privilege
- ✅ Credentials stored in Secrets Manager
- ✅ No hardcoded credentials in code
- ✅ MFA required for AWS Console access (recommended)

### Monitoring Security

- ✅ CloudWatch alarms for anomalies
- ✅ VPC Flow Logs for network analysis
- ✅ S3 access logging enabled
- ✅ **CloudTrail for API audit logs (REQUIRED - included in deployment)**
  - **Critical for PIPEDA compliance:** Complete audit trail of all AWS API calls
  - **Required for security investigations:** Track who accessed what and when
  - **Regulatory requirement:** Healthcare data handling mandates comprehensive audit logs
  - **Deployed by default:** Multi-region trail with log file validation and encryption
  - **Retention:** 90 days in CloudWatch Logs, indefinite in S3

---

## Next Steps

After infrastructure is deployed:

1. **Deploy Backend Application:**
   - Build Docker image
   - Push to ECR
   - Deploy to ECS Fargate
   - Configure Application Load Balancer

2. **Configure DNS:**
   - Point custom domain to CloudFront
   - Configure SSL/TLS certificate in ACM
   - Update CloudFront distribution with custom domain

3. **Run Database Migrations:**
   - Connect to RDS from ECS task
   - Run migration scripts
   - Seed initial data

4. **Configure Monitoring:**
   - Set up Sentry for error tracking
   - Configure custom CloudWatch metrics
   - Set up log aggregation

5. **Security Hardening:**
   - Enable AWS GuardDuty
   - Configure AWS WAF for CloudFront
   - Set up AWS Config for compliance

---

## Support

For issues or questions:

- Check troubleshooting section above
- Review Terraform documentation: https://www.terraform.io/docs
- Review AWS documentation: https://docs.aws.amazon.com
- Contact DevOps team

---

## Acceptance Criteria

- [x] All resources created in ca-central-1 region
- [x] VPC with public/private subnets across 2 AZs
- [x] RDS PostgreSQL 15 Multi-AZ operational
- [x] ElastiCache Redis cluster operational
- [x] S3 buckets created with encryption and lifecycle policies
- [x] CloudFront distribution deployed
- [x] IAM roles with least privilege
- [x] Security groups configured
- [x] KMS encryption enabled
- [x] Secrets Manager storing credentials
- [x] CloudWatch monitoring configured
- [x] SNS alarms configured
- [x] Connectivity verified between components
- [x] Documentation complete
- [x] Terraform state stored in S3 with locking

**Status:** ✅ Complete
