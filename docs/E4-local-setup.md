# E4: Local Development Environment Setup

**Status:** ✅ Complete  
**Epic:** Development Environment  
**Dependencies:** E3 (Monorepo Structure Setup)  
**Deliverables:** `docker-compose.yml`, `.env.example`, setup documentation

---

## Overview

This document describes the local development environment for BerthCare, including PostgreSQL 15, Redis 7, and LocalStack (S3 emulation). The setup is designed for immediate productivity with a single command: `docker-compose up`.

## Quick Start

**Using Makefile (Recommended):**

```bash
# One-time setup
make setup

# Start all services
make start

# Verify everything is healthy
make verify
```

**Or manually:**

```bash
# 1. Copy environment variables
cp .env.example .env

# 2. Start all services
docker-compose up -d

# 3. Verify services are running
docker-compose ps

# 4. View logs (optional)
docker-compose logs -f
```

That's it! Your local development environment is ready.

**Helpful Makefile Commands:**

```bash
make help          # Show all available commands
make start-tools   # Start with PgAdmin and Redis Commander
make logs-f        # Follow logs in real-time
make db-shell      # Open PostgreSQL shell
make redis-cli     # Open Redis CLI
make clean         # Stop and remove all data (⚠️ destructive)
```

## Services Overview

### Core Services (Always Running)

| Service       | Port | Purpose          | Health Check                                    |
| ------------- | ---- | ---------------- | ----------------------------------------------- |
| PostgreSQL 15 | 5432 | Primary database | `docker-compose exec postgres pg_isready`       |
| Redis 7       | 6379 | Cache & sessions | `docker-compose exec redis redis-cli ping`      |
| LocalStack    | 4566 | S3 emulation     | `curl http://localhost:4566/_localstack/health` |

### Optional Development Tools

These services are in the `tools` profile and start only when explicitly requested:

```bash
# Start with development tools
docker-compose --profile tools up -d
```

| Service         | Port | Purpose           | Access                |
| --------------- | ---- | ----------------- | --------------------- |
| PgAdmin         | 5050 | PostgreSQL web UI | http://localhost:5050 |
| Redis Commander | 8081 | Redis web UI      | http://localhost:8081 |

## Service Details

### PostgreSQL 15

**Connection Details:**

- Host: `localhost`
- Port: `5432`
- Database: `berthcare_dev`
- Username: `berthcare`
- Password: `berthcare_dev_password`
- Connection String: `postgresql://berthcare:berthcare_dev_password@localhost:5432/berthcare_dev`

**Features:**

- Automatic database initialization via `scripts/init-db.sql`
- Test database (`berthcare_test`) created automatically
- UUID extension enabled
- Health checks configured
- Data persisted in Docker volume `postgres_data`

**Connecting from Backend:**

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

**Manual Database Access:**

```bash
# Connect to database
docker-compose exec postgres psql -U berthcare -d berthcare_dev

# Run SQL file
docker-compose exec -T postgres psql -U berthcare -d berthcare_dev < schema.sql

# Create database backup
docker-compose exec postgres pg_dump -U berthcare berthcare_dev > backup.sql
```

### Redis 7

**Connection Details:**

- Host: `localhost`
- Port: `6379`
- Password: `berthcare_redis_password`
- Database: `0` (default)
- Connection String: `redis://:berthcare_redis_password@localhost:6379/0`

**Features:**

- Password authentication enabled
- AOF (Append Only File) persistence enabled
- Health checks configured
- Data persisted in Docker volume `redis_data`

**Connecting from Backend:**

```typescript
import { createClient } from 'redis';

const redis = createClient({
  url: process.env.REDIS_URL,
});

await redis.connect();
```

**Manual Redis Access:**

```bash
# Connect to Redis CLI
docker-compose exec redis redis-cli -a berthcare_redis_password

# Common commands
> PING                    # Test connection
> SET key value          # Set a key
> GET key                # Get a key
> KEYS *                 # List all keys (dev only!)
> FLUSHDB                # Clear current database
```

### LocalStack (S3 Emulation)

**Connection Details:**

- Endpoint: `http://localhost:4566`
- Region: `ca-central-1`
- Access Key: `test`
- Secret Key: `test`

**S3 Buckets (Auto-Created):**

- `berthcare-photos-dev` - Visit photos
- `berthcare-documents-dev` - Care plans, reports
- `berthcare-signatures-dev` - Client signatures

**Features:**

- Full S3 API compatibility
- CORS configured for local development
- Bucket versioning enabled
- Data persisted in Docker volume `localstack_data`

**Connecting from Backend:**

```typescript
import { S3Client } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  endpoint: process.env.AWS_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true, // Required for LocalStack
});
```

**Manual S3 Access:**

```bash
# Install AWS CLI (if not already installed)
brew install awscli

# Configure AWS CLI for LocalStack
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=ca-central-1

# List buckets
aws --endpoint-url=http://localhost:4566 s3 ls

# Upload file
aws --endpoint-url=http://localhost:4566 s3 cp test.jpg s3://berthcare-photos-dev/

# Download file
aws --endpoint-url=http://localhost:4566 s3 cp s3://berthcare-photos-dev/test.jpg ./downloaded.jpg

# List bucket contents
aws --endpoint-url=http://localhost:4566 s3 ls s3://berthcare-photos-dev/
```

## Environment Variables

All environment variables are defined in `.env.example`. Copy it to `.env` and customize as needed:

```bash
cp .env.example .env
```

**Key Variables for Local Development:**

```bash
# Application
NODE_ENV=development
PORT=3000

# PostgreSQL
DATABASE_URL=postgresql://berthcare:berthcare_dev_password@localhost:5432/berthcare_dev

# Redis
REDIS_URL=redis://:berthcare_redis_password@localhost:6379/0

# LocalStack S3
AWS_ENDPOINT=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
S3_FORCE_PATH_STYLE=true
```

## Common Commands

### Starting Services

```bash
# Start all core services in background
docker-compose up -d

# Start with development tools (PgAdmin, Redis Commander)
docker-compose --profile tools up -d

# Start and view logs
docker-compose up

# Start specific service
docker-compose up -d postgres
```

### Stopping Services

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (⚠️ deletes all data)
docker-compose down -v

# Stop specific service
docker-compose stop postgres
```

### Viewing Logs

```bash
# View all logs
docker-compose logs

# Follow logs in real-time
docker-compose logs -f

# View logs for specific service
docker-compose logs -f postgres

# View last 100 lines
docker-compose logs --tail=100
```

### Service Health Checks

```bash
# Check all services status
docker-compose ps

# PostgreSQL health check
docker-compose exec postgres pg_isready -U berthcare

# Redis health check
docker-compose exec redis redis-cli -a berthcare_redis_password ping

# LocalStack health check
curl http://localhost:4566/_localstack/health
```

### Data Management

```bash
# Backup PostgreSQL database
docker-compose exec postgres pg_dump -U berthcare berthcare_dev > backup.sql

# Restore PostgreSQL database
docker-compose exec -T postgres psql -U berthcare -d berthcare_dev < backup.sql

# Clear Redis cache
docker-compose exec redis redis-cli -a berthcare_redis_password FLUSHDB

# Reset all data (⚠️ destructive)
docker-compose down -v
docker-compose up -d
```

## Development Workflow

### Backend Development

1. **Start services:**

   ```bash
   docker-compose up -d
   ```

2. **Run backend in development mode:**

   ```bash
   cd apps/backend
   pnpm run dev
   ```

3. **Backend connects to:**
   - PostgreSQL at `localhost:5432`
   - Redis at `localhost:6379`
   - LocalStack S3 at `localhost:4566`

### Mobile Development

1. **Start services:**

   ```bash
   docker-compose up -d
   ```

2. **Ensure backend is running:**

   ```bash
   cd apps/backend
   pnpm run dev
   ```

3. **Start mobile app:**

   ```bash
   cd apps/mobile
   pnpm start
   ```

4. **Mobile app connects to:**
   - Backend API at `http://localhost:3000`
   - (Backend handles database and cache connections)

## Troubleshooting

### Services Won't Start

**Problem:** Port already in use

```bash
Error: bind: address already in use
```

**Solution:** Check what's using the port and stop it

```bash
# Check what's using port 5432 (PostgreSQL)
lsof -i :5432

# Kill the process
kill -9 <PID>

# Or change the port in .env
POSTGRES_PORT=5433
```

### PostgreSQL Connection Refused

**Problem:** Backend can't connect to PostgreSQL

```bash
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Solution:** Verify PostgreSQL is running and healthy

```bash
# Check service status
docker-compose ps postgres

# Check logs
docker-compose logs postgres

# Restart service
docker-compose restart postgres
```

### Redis Authentication Failed

**Problem:** Redis connection fails with auth error

```bash
Error: NOAUTH Authentication required
```

**Solution:** Verify Redis password in `.env` matches `docker-compose.yml`

```bash
# Check Redis is running
docker-compose ps redis

# Test connection with password
docker-compose exec redis redis-cli -a berthcare_redis_password ping
```

### LocalStack S3 Buckets Not Created

**Problem:** S3 operations fail with "NoSuchBucket"

```bash
Error: The specified bucket does not exist
```

**Solution:** Manually run initialization script

```bash
# Check LocalStack is running
docker-compose ps localstack

# Check logs
docker-compose logs localstack

# Manually create buckets
docker-compose exec localstack sh /etc/localstack/init/ready.d/init-localstack.sh
```

### Data Persistence Issues

**Problem:** Data disappears after restart

**Solution:** Verify volumes are created and mounted

```bash
# List volumes
docker volume ls | grep berthcare

# Inspect volume
docker volume inspect berthcare_postgres_data

# If volumes are missing, recreate them
docker-compose down
docker-compose up -d
```

### Performance Issues

**Problem:** Services are slow or unresponsive

**Solution:** Check Docker resource allocation

```bash
# Check Docker stats
docker stats

# Increase Docker resources in Docker Desktop:
# Settings → Resources → Advanced
# - CPUs: 4+
# - Memory: 8GB+
# - Swap: 2GB+
```

## Development Tools

### PgAdmin (PostgreSQL Web UI)

**Access:** http://localhost:5050

**First-time Setup:**

1. Start with tools profile: `docker-compose --profile tools up -d`
2. Open http://localhost:5050
3. Login with credentials from `.env`:
   - Email: `admin@berthcare.local`
   - Password: `admin`
4. Add server:
   - Name: `BerthCare Local`
   - Host: `postgres` (Docker network name)
   - Port: `5432`
   - Username: `berthcare`
   - Password: `berthcare_dev_password`

### Redis Commander (Redis Web UI)

**Access:** http://localhost:8081

**Features:**

- Browse all keys
- View key values
- Execute Redis commands
- Monitor real-time stats

**Usage:**

1. Start with tools profile: `docker-compose --profile tools up -d`
2. Open http://localhost:8081
3. Automatically connected to local Redis

## Testing

### Backend Tests

```bash
# Run tests against test database
cd apps/backend
pnpm run test

# Test database is automatically created: berthcare_test
# Connection string: postgresql://berthcare:berthcare_dev_password@localhost:5432/berthcare_test
```

### Integration Tests

```bash
# Ensure all services are running
docker-compose up -d

# Run integration tests
pnpm run test:integration
```

## Cleanup

### Remove All Data (Fresh Start)

```bash
# Stop services and remove volumes
docker-compose down -v

# Remove all BerthCare Docker resources
docker volume prune -f
docker network prune -f

# Start fresh
docker-compose up -d
```

### Remove Docker Images

```bash
# Remove unused images
docker image prune -a

# Remove specific images
docker rmi postgres:15-alpine redis:7-alpine localstack/localstack:latest
```

## Next Steps

- **E5:** Backend API implementation
- **E6:** Mobile app development
- **E7:** Authentication & authorization

## Reference

- Architecture Blueprint: `project-documentation/architecture-output.md`
- Task Plan: `project-documentation/task-plan.md`
- Environment Variables: `.env.example`
- Docker Compose: `docker-compose.yml`

---

**Last Updated:** October 10, 2025  
**Maintained By:** DevOps Team
