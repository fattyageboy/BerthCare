#!/bin/bash
# Deploy BerthCare staging infrastructure
# This script runs terraform plan and apply for staging environment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGING_DIR="${SCRIPT_DIR}/../environments/staging"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INFRA_VERIFICATION_DOC="docs/E5-aws-infrastructure-setup.md"

echo "🚀 Deploying BerthCare Staging Infrastructure"
echo "=============================================="

# Check if Terraform is installed
if ! command -v terraform &> /dev/null; then
    echo "❌ Terraform is not installed. Please install it first."
    exit 1
fi

echo "✅ Terraform installed: $(terraform version | head -n 1)"
 
# Navigate to staging directory
cd "${STAGING_DIR}"

# Check if terraform.tfvars exists
if [ ! -f "terraform.tfvars" ]; then
    echo "❌ terraform.tfvars not found. Please copy terraform.tfvars.example to terraform.tfvars and update values."
    exit 1
fi

echo "✅ Configuration file found"

# Initialize Terraform
echo ""
echo "📦 Initializing Terraform..."
terraform init

# Validate configuration
echo ""
echo "🔍 Validating Terraform configuration..."
terraform validate

# Format check
echo ""
echo "📝 Checking Terraform formatting..."
terraform fmt -check -recursive || {
    echo "⚠️  Formatting issues found. Running terraform fmt..."
    terraform fmt -recursive
}

# Plan
echo ""
echo "📋 Planning infrastructure changes..."
terraform plan -out=tfplan

# Ask for confirmation
echo ""
read -p "Do you want to apply these changes? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "❌ Deployment cancelled"
    rm -f tfplan
    exit 0
fi

# Apply
echo ""
echo "🚀 Applying infrastructure changes..."
terraform apply tfplan

# Clean up plan file
rm -f tfplan

# Show outputs
echo ""
echo "📊 Infrastructure Outputs:"
echo "=========================="
terraform output

# Persist outputs for verification checklist
VERIFICATION_DIR="${PROJECT_ROOT}/docs/infra-verification"
mkdir -p "${VERIFICATION_DIR}"
OUTPUT_FILE="${VERIFICATION_DIR}/staging-$(date +%Y%m%d-%H%M%S).json"
terraform output -json > "${OUTPUT_FILE}"

if [ ! -s "${OUTPUT_FILE}" ]; then
  echo "❌ terraform output failed: ${OUTPUT_FILE} is missing or empty." >&2
  exit 1
fi

echo ""
echo "📝 Saved raw outputs to ${OUTPUT_FILE}"
echo "   Update ${INFRA_VERIFICATION_DOC} verification table with these values."

echo ""
echo "✅ Deployment completed successfully!"
echo ""
echo "Next steps:"
echo "1. Note the database and Redis endpoints from outputs"
echo "2. Update backend application environment variables"
echo "3. Deploy backend application to ECS"
echo "4. Configure DNS records for CloudFront distribution"
