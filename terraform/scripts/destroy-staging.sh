#!/bin/bash
# Destroy BerthCare staging infrastructure
# WARNING: This will delete all resources. Use with caution!

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGING_DIR="${SCRIPT_DIR}/../environments/staging"

echo "⚠️  WARNING: Destroying BerthCare Staging Infrastructure"
echo "========================================================"
echo ""
echo "This will DELETE all staging resources including:"
echo "  - RDS PostgreSQL database (with all data)"
echo "  - ElastiCache Redis cluster"
echo "  - S3 buckets (photos, documents, signatures)"
echo "  - VPC and networking resources"
echo "  - CloudFront distribution"
echo "  - IAM roles and security groups"
echo ""
 
# Ask for confirmation
read -p "Are you ABSOLUTELY SURE you want to destroy staging? Type 'destroy-staging' to confirm: " CONFIRM

if [ "$CONFIRM" != "destroy-staging" ]; then
    echo "❌ Destruction cancelled"
    exit 0
fi

# Navigate to staging directory
cd "${STAGING_DIR}"

# Plan destruction
echo ""
echo "📋 Planning infrastructure destruction..."
terraform plan -destroy -out=tfplan-destroy

# Final confirmation
echo ""
read -p "Last chance! Type 'yes' to proceed with destruction: " FINAL_CONFIRM

if [ "$FINAL_CONFIRM" != "yes" ]; then
    echo "❌ Destruction cancelled"
    rm -f tfplan-destroy
    exit 0
fi

# Destroy
echo ""
echo "💥 Destroying infrastructure..."
terraform apply tfplan-destroy

# Clean up plan file
rm -f tfplan-destroy

echo ""
echo "✅ Infrastructure destroyed"
