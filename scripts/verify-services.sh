#!/bin/bash
# BerthCare Service Verification Script
# Checks if all local development services are running and healthy

set -e

echo "🔍 Verifying BerthCare Local Development Services..."
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running${NC}"
    echo "Please start Docker Desktop and try again"
    exit 1
fi

echo -e "${GREEN}✅ Docker is running${NC}"
echo ""

# Check PostgreSQL
echo "Checking PostgreSQL..."
if docker-compose exec -T postgres pg_isready -U berthcare > /dev/null 2>&1; then
    echo -e "${GREEN}✅ PostgreSQL is healthy${NC}"
    
    # Check if databases exist
    DB_COUNT=$(docker-compose exec -T postgres psql -U berthcare -d berthcare_dev -t -c "SELECT COUNT(*) FROM pg_database WHERE datname IN ('berthcare_dev', 'berthcare_test');" 2>/dev/null | tr -d ' ')
    if [ "$DB_COUNT" = "2" ]; then
        echo -e "${GREEN}   ✅ Databases created (berthcare_dev, berthcare_test)${NC}"
    else
        echo -e "${YELLOW}   ⚠️  Databases may not be initialized${NC}"
    fi
else
    echo -e "${RED}❌ PostgreSQL is not healthy${NC}"
fi
echo ""

# Check Redis
echo "Checking Redis..."
if docker-compose exec -T redis redis-cli -a berthcare_redis_password ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Redis is healthy${NC}"
else
    echo -e "${RED}❌ Redis is not healthy${NC}"
fi
echo ""

# Check LocalStack
echo "Checking LocalStack..."
if curl -s http://localhost:4566/_localstack/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ LocalStack is healthy${NC}"
    
    # Check if S3 buckets exist
    if command -v aws > /dev/null 2>&1; then
        BUCKET_COUNT=$(aws --endpoint-url=http://localhost:4566 s3 ls 2>/dev/null | grep -c "berthcare-" || echo "0")
        if [ "$BUCKET_COUNT" = "3" ]; then
            echo -e "${GREEN}   ✅ S3 buckets created (photos, documents, signatures)${NC}"
        else
            echo -e "${YELLOW}   ⚠️  S3 buckets may not be initialized (found $BUCKET_COUNT/3)${NC}"
        fi
    else
        echo -e "${YELLOW}   ⚠️  AWS CLI not installed, cannot verify S3 buckets${NC}"
    fi
else
    echo -e "${RED}❌ LocalStack is not healthy${NC}"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Service Status Summary:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
docker-compose ps
echo ""

echo "Connection Details:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PostgreSQL: postgresql://berthcare:berthcare_dev_password@localhost:5432/berthcare_dev"
echo "Redis:      redis://:berthcare_redis_password@localhost:6379/0"
echo "LocalStack: http://localhost:4566"
echo ""

echo "Optional Tools:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PgAdmin:         http://localhost:5050 (start with: docker-compose --profile tools up -d)"
echo "Redis Commander: http://localhost:8081 (start with: docker-compose --profile tools up -d)"
echo ""

echo -e "${GREEN}✅ Verification complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Copy .env.example to .env if you haven't already"
echo "  2. Start backend: cd apps/backend && pnpm run dev"
echo "  3. Start mobile: cd apps/mobile && pnpm start"
