#!/bin/bash

# Test Runner Script for BerthCare Backend
# Ensures test environment is ready before running tests

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 BerthCare Backend Test Runner"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if PostgreSQL is running
echo "🔍 Checking PostgreSQL connection..."
if pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
  echo "✅ PostgreSQL is running"
else
  echo "❌ PostgreSQL is not running"
  echo "   Start PostgreSQL with: docker-compose up -d postgres"
  exit 1
fi

# Check if Redis is running
echo "🔍 Checking Redis connection..."
if redis-cli -h localhost -p 6379 -a berthcare_redis_password ping > /dev/null 2>&1; then
  echo "✅ Redis is running"
else
  echo "❌ Redis is not running"
  echo "   Start Redis with: docker-compose up -d redis"
  exit 1
fi

# Check if test database exists
echo "🔍 Checking test database..."
if psql -h localhost -U berthcare -lqt | cut -d \| -f 1 | grep -qw berthcare_test; then
  echo "✅ Test database exists"
else
  echo "⚠️  Test database does not exist, creating..."
  psql -h localhost -U berthcare -d postgres -c "CREATE DATABASE berthcare_test;" || true
  echo "✅ Test database created"
fi

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL environment variable is not set"
  echo "   Set DATABASE_URL or source your .env file before running tests"
  exit 1
fi

# Run migrations on test database
echo "🔄 Running migrations on test database..."
pnpm run migrate:up > /dev/null
echo "✅ Migrations complete"

# Clear test Redis database
echo "🧹 Clearing test Redis database..."
redis-cli -h localhost -p 6379 -a berthcare_redis_password -n 1 FLUSHDB > /dev/null 2>&1
echo "✅ Redis cleared"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Running tests from /tests directory..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Run tests with provided arguments
# Tests are located in apps/backend/tests/*.test.ts
pnpm run test "$@"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Tests complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
