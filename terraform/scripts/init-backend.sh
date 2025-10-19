#!/bin/bash
# Initialize Terraform backend (S3 + DynamoDB for state locking)
# Run this script once before using Terraform

set -e

PROJECT_NAME="berthcare"
REGION="ca-central-1"
BUCKET_NAME="${PROJECT_NAME}-terraform-state"
DYNAMODB_TABLE="${PROJECT_NAME}-terraform-locks"

echo "🚀 Initializing Terraform backend for ${PROJECT_NAME}"
echo "================================================"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is not installed. Please install it first."
    exit 1
fi
 
# Check if AWS credentials are configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials are not configured. Please run 'aws configure' first."
    exit 1
fi

echo "✅ AWS CLI configured"

# Create S3 bucket for Terraform state
echo ""
echo "📦 Creating S3 bucket: ${BUCKET_NAME}"
if aws s3 ls "s3://${BUCKET_NAME}" 2>&1 | grep -q 'NoSuchBucket'; then
    aws s3api create-bucket \
        --bucket "${BUCKET_NAME}" \
        --region "${REGION}" \
        --create-bucket-configuration LocationConstraint="${REGION}"
    
    # Enable versioning
    aws s3api put-bucket-versioning \
        --bucket "${BUCKET_NAME}" \
        --versioning-configuration Status=Enabled
    
    # Enable encryption
    aws s3api put-bucket-encryption \
        --bucket "${BUCKET_NAME}" \
        --server-side-encryption-configuration '{
            "Rules": [{
                "ApplyServerSideEncryptionByDefault": {
                    "SSEAlgorithm": "AES256"
                }
            }]
        }'
    
    # Block public access
    aws s3api put-public-access-block \
        --bucket "${BUCKET_NAME}" \
        --public-access-block-configuration \
            "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
    
    echo "✅ S3 bucket created and configured"
else
    echo "✅ S3 bucket already exists"
fi

# Create DynamoDB table for state locking
echo ""
echo "🔒 Creating DynamoDB table: ${DYNAMODB_TABLE}"
if ! aws dynamodb describe-table --table-name "${DYNAMODB_TABLE}" --region "${REGION}" &> /dev/null; then
    aws dynamodb create-table \
        --table-name "${DYNAMODB_TABLE}" \
        --attribute-definitions AttributeName=LockID,AttributeType=S \
        --key-schema AttributeName=LockID,KeyType=HASH \
        --billing-mode PAY_PER_REQUEST \
        --region "${REGION}" \
        --tags Key=Project,Value="${PROJECT_NAME}" Key=ManagedBy,Value=Terraform
    
    echo "⏳ Waiting for table to be active..."
    aws dynamodb wait table-exists --table-name "${DYNAMODB_TABLE}" --region "${REGION}"
    
    echo "✅ DynamoDB table created"
else
    echo "✅ DynamoDB table already exists"
fi

echo ""
echo "================================================"
echo "✅ Terraform backend initialized successfully!"
echo ""
echo "Next steps:"
echo "1. Uncomment the backend configuration in terraform/environments/staging/main.tf"
echo "2. Run: cd terraform/environments/staging"
echo "3. Run: terraform init"
echo "4. Run: terraform plan"
echo "5. Run: terraform apply"
