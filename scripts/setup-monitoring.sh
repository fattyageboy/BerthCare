#!/bin/bash

# BerthCare Monitoring & Observability Setup Script
# This script helps set up CloudWatch and Sentry monitoring

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
AWS_REGION="${AWS_REGION:-ca-central-1}"
ENVIRONMENT="${ENVIRONMENT:-staging}"
PROJECT_NAME="berthcare"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  BerthCare Monitoring & Observability Setup${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}✗ AWS CLI not found. Please install it first.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ AWS CLI installed${NC}"

# Check Terraform
if ! command -v terraform &> /dev/null; then
    echo -e "${RED}✗ Terraform not found. Please install it first.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Terraform installed${NC}"

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}✗ AWS credentials not configured${NC}"
    exit 1
fi
echo -e "${GREEN}✓ AWS credentials configured${NC}"

echo ""

# Step 1: Deploy CloudWatch Infrastructure
echo -e "${BLUE}Step 1: Deploy CloudWatch Infrastructure${NC}"
echo -e "${YELLOW}This will create:${NC}"
echo "  - CloudWatch log groups"
echo "  - CloudWatch dashboards"
echo "  - CloudWatch alarms"
echo "  - SNS topic for alerts"
echo ""

read -p "Deploy CloudWatch infrastructure? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd terraform/environments/staging
    
    echo -e "${YELLOW}Initializing Terraform...${NC}"
    terraform init
    
    echo -e "${YELLOW}Planning Terraform changes...${NC}"
    terraform plan -target=module.monitoring
    
    read -p "Apply these changes? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        terraform apply -target=module.monitoring
        echo -e "${GREEN}✓ CloudWatch infrastructure deployed${NC}"
    else
        echo -e "${YELLOW}Skipped CloudWatch deployment${NC}"
    fi
    
    cd ../../..
else
    echo -e "${YELLOW}Skipped CloudWatch deployment${NC}"
fi

echo ""

# Step 2: Configure Alert Email
echo -e "${BLUE}Step 2: Configure Alert Email${NC}"
read -p "Enter email address for alerts (or press Enter to skip): " ALERT_EMAIL

if [ ! -z "$ALERT_EMAIL" ]; then
    echo -e "${YELLOW}Subscribing $ALERT_EMAIL to SNS topic...${NC}"
    
    SNS_TOPIC_ARN=$(aws sns list-topics --region $AWS_REGION | \
        jq -r ".Topics[] | select(.TopicArn | contains(\"$PROJECT_NAME-alerts-$ENVIRONMENT\")) | .TopicArn")
    
    if [ ! -z "$SNS_TOPIC_ARN" ]; then
        aws sns subscribe \
            --topic-arn "$SNS_TOPIC_ARN" \
            --protocol email \
            --notification-endpoint "$ALERT_EMAIL" \
            --region $AWS_REGION
        
        echo -e "${GREEN}✓ Subscription request sent to $ALERT_EMAIL${NC}"
        echo -e "${YELLOW}⚠ Please check your email and confirm the subscription${NC}"
    else
        echo -e "${RED}✗ SNS topic not found. Deploy CloudWatch infrastructure first.${NC}"
    fi
else
    echo -e "${YELLOW}Skipped email configuration${NC}"
fi

echo ""

# Step 3: Sentry Setup
echo -e "${BLUE}Step 3: Sentry Setup${NC}"
echo -e "${YELLOW}Please follow these steps:${NC}"
echo "  1. Create a Sentry account at https://sentry.io"
echo "  2. Create organization: $PROJECT_NAME"
echo "  3. Create projects:"
echo "     - $PROJECT_NAME-backend-$ENVIRONMENT (Node.js)"
echo "     - $PROJECT_NAME-mobile-$ENVIRONMENT (React Native)"
echo "  4. Get DSN keys from each project"
echo ""

read -p "Have you created Sentry projects? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -p "Enter backend Sentry DSN: " BACKEND_DSN
    read -p "Enter mobile Sentry DSN: " MOBILE_DSN
    
    if [ ! -z "$BACKEND_DSN" ]; then
        echo -e "${YELLOW}Storing backend DSN in AWS Secrets Manager...${NC}"
        aws secretsmanager create-secret \
            --name "$PROJECT_NAME/$ENVIRONMENT/sentry-backend-dsn" \
            --description "Sentry DSN for backend error tracking ($ENVIRONMENT)" \
            --secret-string "$BACKEND_DSN" \
            --region $AWS_REGION 2>/dev/null || \
        aws secretsmanager update-secret \
            --secret-id "$PROJECT_NAME/$ENVIRONMENT/sentry-backend-dsn" \
            --secret-string "$BACKEND_DSN" \
            --region $AWS_REGION
        
        echo -e "${GREEN}✓ Backend DSN stored in Secrets Manager${NC}"
    fi
    
    if [ ! -z "$MOBILE_DSN" ]; then
        echo -e "${YELLOW}Storing mobile DSN in AWS Secrets Manager...${NC}"
        aws secretsmanager create-secret \
            --name "$PROJECT_NAME/$ENVIRONMENT/sentry-mobile-dsn" \
            --description "Sentry DSN for mobile error tracking ($ENVIRONMENT)" \
            --secret-string "$MOBILE_DSN" \
            --region $AWS_REGION 2>/dev/null || \
        aws secretsmanager update-secret \
            --secret-id "$PROJECT_NAME/$ENVIRONMENT/sentry-mobile-dsn" \
            --secret-string "$MOBILE_DSN" \
            --region $AWS_REGION
        
        echo -e "${GREEN}✓ Mobile DSN stored in Secrets Manager${NC}"
    fi
else
    echo -e "${YELLOW}Skipped Sentry setup${NC}"
    echo -e "${YELLOW}See docs/SENTRY_SETUP.md for detailed instructions${NC}"
fi

echo ""

# Step 4: Test Monitoring
echo -e "${BLUE}Step 4: Test Monitoring${NC}"
read -p "Test CloudWatch alarms? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Triggering test alarm...${NC}"
    
    ALARM_NAME="$PROJECT_NAME-api-error-rate-$ENVIRONMENT"
    aws cloudwatch set-alarm-state \
        --alarm-name "$ALARM_NAME" \
        --state-value ALARM \
        --state-reason "Testing alert system" \
        --region $AWS_REGION
    
    echo -e "${GREEN}✓ Test alarm triggered${NC}"
    echo -e "${YELLOW}⚠ Check your email for alert notification${NC}"
    
    sleep 5
    
    echo -e "${YELLOW}Resetting alarm to OK state...${NC}"
    aws cloudwatch set-alarm-state \
        --alarm-name "$ALARM_NAME" \
        --state-value OK \
        --state-reason "Test complete" \
        --region $AWS_REGION
    
    echo -e "${GREEN}✓ Alarm reset${NC}"
else
    echo -e "${YELLOW}Skipped alarm testing${NC}"
fi

echo ""

# Step 5: Summary
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Setup Complete!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "  1. Confirm SNS email subscription"
echo "  2. Configure Sentry alert rules"
echo "  3. Install backend dependencies: cd apps/backend && pnpm install"
echo "  4. Update .env with Sentry DSN"
echo "  5. Test error tracking: curl http://localhost:3000/test/sentry"
echo ""
echo -e "${YELLOW}Resources:${NC}"
echo "  - CloudWatch Dashboard: https://console.aws.amazon.com/cloudwatch/home?region=$AWS_REGION#dashboards"
echo "  - Sentry Dashboard: https://sentry.io/organizations/$PROJECT_NAME/"
echo "  - Documentation: docs/E6-monitoring-observability-setup.md"
echo "  - Quick Reference: docs/MONITORING_QUICK_REFERENCE.md"
echo ""
echo -e "${GREEN}Happy monitoring! 🎉${NC}"
