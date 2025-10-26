# BerthCare System Architecture

**Version:** 1.0.0  
**Last Updated:** October 10, 2025  
**Status:** Staging Environment Deployed  
**Philosophy:** Simplicity is the ultimate sophistication

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Principles](#architecture-principles)
3. [System Components](#system-components)
4. [Local Development Environment](#local-development-environment)
5. [AWS Infrastructure (Staging)](#aws-infrastructure-staging)
6. [Communication Services (Twilio)](#communication-services-twilio)
7. [Monitoring & Observability](#monitoring--observability)
8. [Security & Compliance](#security--compliance)
9. [Deployment Architecture](#deployment-architecture)
10. [Resource Inventory](#resource-inventory)

---

## Overview

BerthCare is a mobile-first home care management platform designed with an offline-first architecture. The system enables caregivers to document visits, coordinate care, and communicate with families—all while working seamlessly offline.

### Design Philosophy

> "Start with the user experience, then work backwards to the technology."

**Core Principles:**

- **Simplicity is the ultimate sophistication**: One app, one database pattern, one communication method
- **The best interface is no interface**: Auto-save, auto-sync, auto-everything
- **Obsess over every detail**: Sub-100ms response times, <2 second app launch
- **Say no to 1,000 things**: Focus on core workflows, eliminate feature bloat

### Technology Stack Summary

| Layer              | Technology                           | Purpose                         |
| ------------------ | ------------------------------------ | ------------------------------- |
| **Mobile**         | React Native 0.73+ with Expo SDK 50+ | Cross-platform mobile app       |
| **Local DB**       | WatermelonDB (SQLite)                | Offline-first data storage      |
| **Backend**        | Node.js 20 LTS + Express.js 4.x      | REST API server                 |
| **Database**       | PostgreSQL 15+                       | Server-side data persistence    |
| **Cache**          | Redis 7+                             | Session management, API caching |
| **Storage**        | AWS S3                               | Photos, documents, signatures   |
| **CDN**            | CloudFront                           | Fast asset delivery             |
| **Communication**  | Twilio Voice + SMS                   | Voice alerts, family portal     |
| **Infrastructure** | AWS (ca-central-1)                   | Canadian data residency         |
| **IaC**            | Terraform 1.6+                       | Infrastructure as Code          |
| **Monitoring**     | CloudWatch + Sentry                  | Metrics, logs, error tracking   |

---

## Architecture Principles

### 1. Offline-First Everything

The mobile app must work flawlessly without connectivity. Online is the enhancement, not the requirement.

**Implementation:**

- Local SQLite database is source of truth
- All operations complete instantly against local storage
- Background sync when connectivity available
- Conflict resolution favors most recent edit
- User never waits for network

### 2. Zero Friction

If a caregiver needs to think about how to use it, we've failed. Every interaction must be obvious.

**Implementation:**

- Auto-save after 1 second of inactivity
- Smart data reuse from previous visits
- Intelligent keyboard switching
- Voice input for speed
- GPS auto-check-in/out

### 3. Invisible Technology

The best interface is no interface. Automate everything that can be automated.

**Implementation:**

- No "save" buttons (auto-save)
- No "sync" buttons (automatic)
- No loading spinners (instant local operations)
- No configuration (intelligent defaults)
- No manual data entry (smart reuse)

### 4. Obsessive Performance

Sub-second responses. No loading spinners. No waiting.

**Performance Targets:**

- <100ms UI response time
- <2 second app launch
- <1 second auto-save
- <30 second background sync
- <15 second alert delivery

### 5. Uncompromising Security

Privacy and security built into every layer, not bolted on.

**Implementation:**

- End-to-end encryption for all data
- Canadian data residency (PIPEDA compliant)
- Role-based access control
- Comprehensive audit trails
- Zero-knowledge architecture where possible

---

## System Components

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Mobile App (React Native)                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  UI Layer: Invisible Technology                          │   │
│  │  - Auto-save (no save buttons)                           │   │
│  │  - Smart data reuse (pre-fill from last visit)           │   │
│  │  - Voice input (3× faster than typing)                   │   │
│  │  - GPS auto-check-in/out (no manual entry)               │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Local-First Data Layer (WatermelonDB/SQLite)            │   │
│  │  - Source of truth for all operations                    │   │
│  │  - Instant reads/writes (<10ms)                          │   │
│  │  - 30 days of offline data storage                       │   │
│  │  - Automatic conflict resolution                         │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                  ↕
                    HTTPS/WSS (Encrypted, Compressed)
                                  ↕
┌─────────────────────────────────────────────────────────────────┐
│                Backend Services (Node.js + Express)             │
│  - REST API (Simple, Cacheable, Well-Understood)                │
│  - Voice Alert Service (Twilio Integration)                     │
│  - Family SMS Service (Twilio Integration)                      │
│  - Sync Conflict Resolution Engine                              │
└─────────────────────────────────────────────────────────────────┘
                                  ↕
┌─────────────────────────────────────────────────────────────────┐
│                        Data Layer                               │
│  - PostgreSQL 15+ (Server Source of Truth)                      │
│  - Redis 7+ (Performance Layer)                                 │
│  - AWS S3 (File Storage)                                        │
└─────────────────────────────────────────────────────────────────┘
                                  ↕
┌─────────────────────────────────────────────────────────────────┐
│              External Services                                  │
│  - Twilio Voice + SMS (Communication Layer)                     │
│  - Expo Push Notifications (Care Coordination)                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Local Development Environment

### Overview

The local development environment uses Docker Compose to orchestrate PostgreSQL, Redis, and LocalStack (S3 emulation). This provides a production-like environment on your local machine.

### Services

| Service                    | Port | Purpose          | Connection String                                                            |
| -------------------------- | ---- | ---------------- | ---------------------------------------------------------------------------- |
| PostgreSQL 15              | 5432 | Primary database | `postgresql://berthcare:berthcare_dev_password@localhost:5432/berthcare_dev` |
| Redis 7                    | 6379 | Cache & sessions | `redis://:berthcare_redis_password@localhost:6379/0`                         |
| LocalStack                 | 4566 | S3 emulation     | `http://localhost:4566`                                                      |
| PgAdmin (optional)         | 5050 | PostgreSQL UI    | `http://localhost:5050`                                                      |
| Redis Commander (optional) | 8081 | Redis UI         | `http://localhost:8081`                                                      |

### Quick Start

```bash
# One-time setup
make setup

# Start all services
make start

# Verify everything is running
make verify
```

### Database Configuration

**Databases Created:**

- `berthcare_dev` - Main development database
- `berthcare_test` - Test database

**Features:**

- UUID extension enabled
- Automatic initialization via `scripts/init-db.sql`
- Health checks configured
- Data persisted in Docker volume

### S3 Buckets (LocalStack)

**Buckets Created:**

- `berthcare-photos-dev` - Visit photos
- `berthcare-documents-dev` - Care plans, reports
- `berthcare-signatures-dev` - Client signatures

**Features:**

- Full S3 API compatibility
- CORS configured for local development
- Bucket versioning enabled

### Development Workflow

1. Start services: `docker-compose up -d`
2. Run backend: `cd apps/backend && pnpm run dev`
3. Run mobile app: `cd apps/mobile && pnpm start`
4. Backend connects to local PostgreSQL, Redis, and LocalStack
5. Mobile app connects to backend at `http://localhost:3000`

**Reference:** [E4: Local Development Setup](./E4-local-setup.md)

---

## AWS Infrastructure (Staging)

### Overview

The staging environment is deployed in AWS region `ca-central-1` (Canada Central) for PIPEDA compliance and Canadian data residency.

### Network Architecture

**VPC Configuration:**

- **CIDR Block:** 10.0.0.0/16
- **Availability Zones:** ca-central-1a, ca-central-1b (Multi-AZ for high availability)

**Subnets:**

- **Public Subnets:** 2 subnets (10.0.1.0/24, 10.0.2.0/24)
  - NAT Gateways (one per AZ)
  - Application Load Balancer
  - Internet Gateway
- **Private Subnets:** 2 subnets (10.0.11.0/24, 10.0.12.0/24)
  - ECS Fargate Tasks (Backend API)
  - RDS PostgreSQL
  - ElastiCache Redis

**Network Features:**

- VPC Flow Logs enabled for monitoring
- NAT Gateways for outbound internet access from private subnets
- Security groups with least privilege access
- Network ACLs for additional security layer

### Database (RDS PostgreSQL)

**Configuration:**

- **Engine:** PostgreSQL 15.5
- **Instance Class:** db.t4g.medium (ARM-based, 2 vCPU, 4 GB RAM)
- **Storage:** 100 GB GP3 SSD (auto-scaling up to 500 GB)
- **Multi-AZ:** Enabled for high availability
- **Backup Retention:** 7 days
- **Encryption:** At rest with AWS KMS
- **Performance Insights:** Enabled

**Connection Details:**

- **Endpoint:** `berthcare-staging-postgres.xxxxx.ca-central-1.rds.amazonaws.com`
- **Port:** 5432
- **Database:** `berthcare`
- **Username:** `berthcare_admin`
- **Password:** Stored in AWS Secrets Manager (`berthcare/staging/database`)

**Features:**

- Automated daily backups
- Point-in-time recovery
- Automatic failover to standby (RTO: 1-2 minutes, RPO: 0)
- Monitoring via CloudWatch and Performance Insights

### Cache (ElastiCache Redis)

**Configuration:**

- **Engine:** Redis 7.1
- **Node Type:** cache.t4g.micro (ARM-based, 2 vCPU, 0.5 GB RAM)
- **Cluster Size:** 2 nodes (primary + replica)
- **Multi-AZ:** Enabled with automatic failover
- **Encryption:** At rest and in transit
- **Auth Token:** Enabled

**Connection Details:**

- **Endpoint:** `berthcare-staging-redis.xxxxx.cache.amazonaws.com`
- **Port:** 6379
- **Auth Token:** Stored in AWS Secrets Manager (`berthcare/staging/redis`)

**Features:**

- Automatic failover (RTO: 1-2 minutes)
- Automated daily snapshots (5-day retention)
- AOF (Append Only File) persistence

### Storage (S3)

**Buckets:**

| Bucket Name                    | Purpose             | Versioning | Lifecycle Policy                      |
| ------------------------------ | ------------------- | ---------- | ------------------------------------- |
| `berthcare-photos-staging`     | Visit photos        | Enabled    | Archive to Glacier after 1 year       |
| `berthcare-documents-staging`  | Care plans, reports | Enabled    | Archive to Glacier after 1 year       |
| `berthcare-signatures-staging` | Client signatures   | Enabled    | Archive to Deep Archive after 7 years |
| `berthcare-logs-staging`       | Access logs         | Enabled    | Delete after 90 days                  |

**Features:**

- Server-side encryption (AES256 or KMS)
- Public access blocked
- CORS configured for web/mobile access
- Lifecycle policies for cost optimization
- Access logging enabled

### CDN (CloudFront)

**Configuration:**

- **Distribution ID:** `E1234567890ABC` (example)
- **Domain:** `d1234567890abc.cloudfront.net`
- **Origins:** S3 buckets (photos, documents, signatures)
- **SSL/TLS:** TLS 1.2+ enforced
- **Geo Restriction:** Canada and US only
- **Caching:** Optimized for static assets (TTL: 1 hour)
- **Compression:** Enabled (gzip, brotli)

**Features:**

- Global edge locations for fast delivery
- Origin Access Control for secure S3 access
- Custom error pages
- Access logging to S3

### Security

**IAM Roles:**

- **ECS Task Execution Role:** Pull images from ECR, write logs to CloudWatch
- **ECS Task Role:** Application runtime permissions (S3, Secrets Manager, RDS, Redis)

**Security Groups:**

- **ALB Security Group:** HTTPS (443) and HTTP (80) ingress from internet
- **ECS Tasks Security Group:** HTTP (3000) from ALB only
- **RDS Security Group:** PostgreSQL (5432) from ECS tasks only
- **Redis Security Group:** Redis (6379) from ECS tasks only

**Encryption:**

- **KMS Key:** `arn:aws:kms:ca-central-1:ACCOUNT_ID:key/KEY_ID`
- **Purpose:** Encrypt RDS, Redis, S3, and Secrets Manager

**Secrets Manager:**

- `berthcare/staging/database` - RDS credentials
- `berthcare/staging/redis` - Redis auth token
- `berthcare/staging/twilio` - Twilio credentials

### Cost Estimation (Staging)

| Service           | Configuration                   | Monthly Cost (USD) |
| ----------------- | ------------------------------- | ------------------ |
| RDS PostgreSQL    | db.t4g.medium, Multi-AZ, 100 GB | $120               |
| ElastiCache Redis | cache.t4g.micro x2, Multi-AZ    | $30                |
| NAT Gateways      | 2 NAT Gateways                  | $65                |
| S3 Storage        | 100 GB + requests               | $5                 |
| CloudFront        | 100 GB data transfer            | $10                |
| Data Transfer     | Inter-AZ, outbound              | $10                |
| CloudWatch        | Logs, metrics, alarms           | $5                 |
| **Total**         |                                 | **~$245/month**    |

**Reference:** [E5: AWS Infrastructure Setup](./E5-aws-infrastructure-setup.md)

---

## Communication Services (Twilio)

### Overview

BerthCare uses Twilio for two critical communication features:

1. **Voice Alerts:** caregivers send urgent voice alerts to care coordinators
2. **Family SMS Portal:** Automated daily updates to family members

**Design Philosophy:** "Voice calls over messaging platform" - urgent issues need human voices, not text messages.

### Twilio Account Structure

**Master Account:**

- **Account Name:** BerthCare
- **Account SID:** `AC...` (master account)

**Subaccounts:**

| Environment | Friendly Name        | Account SID | Purpose                     |
| ----------- | -------------------- | ----------- | --------------------------- |
| Staging     | BerthCare Staging    | `AC...`     | Development and testing     |
| Production  | BerthCare Production | `AC...`     | Live production environment |

### Phone Numbers

**Staging:**

- **Number:** `+1 (XXX) XXX-XXXX` (to be configured)
- **Capabilities:** Voice + SMS
- **Type:** Local (Canadian)
- **Friendly Name:** BerthCare Staging

**Production:**

- **Number:** `+1 (XXX) XXX-XXXX` (to be configured)
- **Capabilities:** Voice + SMS
- **Type:** Local (Canadian)
- **Friendly Name:** BerthCare Production

### Webhook Configuration

**Staging Webhooks:**

```
Voice:
- Incoming Call: https://api-staging.berthcare.ca/v1/twilio/voice
- Status Callback: https://api-staging.berthcare.ca/v1/twilio/voice/status

SMS:
- Incoming Message: https://api-staging.berthcare.ca/v1/twilio/sms
- Status Callback: https://api-staging.berthcare.ca/v1/twilio/sms/status
```

**Production Webhooks:**

```
Voice:
- Incoming Call: https://api.berthcare.ca/v1/twilio/voice
- Status Callback: https://api.berthcare.ca/v1/twilio/voice/status

SMS:
- Incoming Message: https://api.berthcare.ca/v1/twilio/sms
- Status Callback: https://api.berthcare.ca/v1/twilio/sms/status
```

### Credentials Storage

**AWS Secrets Manager:**

- `berthcare/staging/twilio` - Staging credentials
- `berthcare/production/twilio` - Production credentials

**Secret Structure:**

```json
{
  "account_sid": "AC...",
  "auth_token": "your_auth_token",
  "phone_number": "+1234567890",
  "voice_url": "https://api-staging.berthcare.ca/v1/twilio/voice",
  "sms_url": "https://api-staging.berthcare.ca/v1/twilio/sms"
}
```

### Security Configuration

**Geo Permissions:**

- Voice: Canada + US only
- SMS: Canada + US only

**Rate Limits:**

- Voice calls: 100 calls/hour per number
- SMS messages: 200 messages/hour per number
- API requests: 10,000 requests/hour

**Billing Alerts:**

- Warning: $50/month
- Critical: $100/month
- Emergency: $200/month

### Cost Estimation (Twilio)

| Service                | Usage             | Cost           |
| ---------------------- | ----------------- | -------------- |
| Phone Numbers          | 2 numbers         | $2.00/month    |
| Voice Calls (outbound) | 500 calls @ 1 min | $6.50/month    |
| Voice Calls (inbound)  | 500 calls @ 1 min | $4.25/month    |
| SMS (outbound)         | 1,000 messages    | $7.50/month    |
| SMS (inbound)          | 100 messages      | $0.75/month    |
| **Total**              |                   | **~$21/month** |

**Reference:** [E7: Twilio Setup](./E7-twilio-setup.md)

---

## Monitoring & Observability

### CloudWatch

**Dashboards:**

- **BerthCare Staging Dashboard:** Pre-configured metrics for all services

**Metrics Monitored:**

- RDS: CPU, memory, connections, storage, IOPS
- Redis: CPU, memory, evictions, connections
- ECS: CPU, memory, task count
- ALB: Request count, latency, error rate
- CloudFront: Requests, data transfer, error rate

**Alarms Configured:**

| Alarm                     | Threshold    | Action           |
| ------------------------- | ------------ | ---------------- |
| RDS CPU Utilization       | > 80%        | SNS notification |
| RDS Freeable Memory       | < 512 MB     | SNS notification |
| RDS Free Storage          | < 10 GB      | SNS notification |
| RDS Connections           | > 80% of max | SNS notification |
| Redis CPU Utilization     | > 75%        | SNS notification |
| Redis Memory Utilization  | > 80%        | SNS notification |
| Redis Evictions           | > 1000       | SNS notification |
| CloudFront 5xx Error Rate | > 5%         | SNS notification |

**Log Groups:**

- `/berthcare/staging/application` - Application logs
- `/berthcare/staging/ecs` - ECS task logs
- `/aws/rds/instance/berthcare-staging-postgres` - RDS logs
- `/aws/elasticache/berthcare-staging-redis` - Redis logs

### Sentry

**Projects:**

- **berthcare-backend-staging:** Backend error tracking
- **berthcare-mobile-staging:** Mobile app error tracking

**Configuration:**

- **DSN:** Stored in environment variables
- **Environment:** `staging`
- **Traces Sample Rate:** 10% (0.1)
- **Profiles Sample Rate:** 10% (0.1)
- **Release Tracking:** Enabled (version from package.json)

**Features:**

- Real-time error notifications
- Stack trace analysis
- Breadcrumb tracking
- Performance monitoring
- Release health tracking

**Integration:**

```typescript
// Backend
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT,
  tracesSampleRate: 0.1,
  profilesSampleRate: 0.1,
});

// Mobile
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enableInExpoDevelopment: false,
  debug: false,
});
```

**Reference:** [E6: Monitoring & Observability Setup](./E6-monitoring-observability-setup.md)

---

## Security & Compliance

### Data Residency

**Canadian Data Residency:**

- All AWS resources in `ca-central-1` region
- No data replication outside Canada
- CloudFront edge locations globally, but origin in Canada

### Compliance

**PIPEDA (Personal Information Protection and Electronic Documents Act):**

- ✅ Consent management
- ✅ Data minimization
- ✅ Purpose limitation
- ✅ Accuracy and retention
- ✅ Safeguards (encryption, access controls)
- ✅ Openness (privacy policy)
- ✅ Individual access
- ✅ Challenging compliance

**PHIPA (Personal Health Information Protection Act - Ontario):**

- ✅ Health information custodian responsibilities
- ✅ Consent requirements
- ✅ Security safeguards
- ✅ Breach notification procedures
- ✅ Audit trails

### Encryption

**At Rest:**

- RDS PostgreSQL: AWS KMS encryption
- ElastiCache Redis: AWS KMS encryption
- S3 Buckets: AES256 or KMS encryption
- Secrets Manager: KMS encryption
- EBS Volumes: KMS encryption

**In Transit:**

- HTTPS/TLS 1.2+ for all API communication
- Redis: TLS encryption enabled
- RDS: SSL/TLS connections enforced
- CloudFront: TLS 1.2+ enforced

### Access Control

**IAM Policies:**

- Least privilege principle
- Role-based access control (RBAC)
- MFA required for console access
- Service-specific roles (no shared credentials)

**Application-Level:**

- JWT-based authentication
- Role-based authorization (caregiver, coordinator, admin)
- Session management via Redis
- Password hashing with bcrypt

### Audit Trails

**CloudTrail:**

- All API calls logged
- 90-day retention
- S3 archival for long-term storage

**Application Logs:**

- All user actions logged
- Structured logging (JSON format)
- Log aggregation in CloudWatch
- Retention: 30 days (staging), 1 year (production)

**Database Audit:**

- Trigger-based audit tables
- Track all data modifications
- Immutable audit records

### Network Security

**Security Groups:**

- Restrictive ingress/egress rules
- Principle of least privilege
- No direct internet access to databases

**VPC:**

- Private subnets for sensitive resources
- NAT Gateways for outbound traffic only
- VPC Flow Logs for network monitoring

**DDoS Protection:**

- AWS Shield Standard (automatic)
- CloudFront rate limiting
- Application-level rate limiting

---

## Deployment Architecture

### CI/CD Pipeline

**GitHub Actions Workflows:**

1. **Pull Request Checks:**
   - Lint code (ESLint, Prettier)
   - Run unit tests
   - Run integration tests
   - Build validation
   - Security scanning (pnpm audit)

2. **Staging Deployment (on merge to main):**
   - Build Docker image
   - Push to Amazon ECR
   - Update ECS task definition
   - Deploy to ECS Fargate
   - Run smoke tests
   - Notify team (Slack/email)

3. **Production Deployment (on release tag):**
   - Same as staging
   - Additional approval required
   - Blue-green deployment
   - Automated rollback on failure

### Container Architecture

**Backend Docker Image:**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY . .
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

**Image Registry:**

- **ECR Repository:** `berthcare/backend`
- **Tags:** `staging-latest`, `staging-{git-sha}`, `production-latest`, `production-{git-sha}`

### ECS Fargate Configuration

**Task Definition:**

- **CPU:** 512 (0.5 vCPU)
- **Memory:** 1024 MB (1 GB)
- **Network Mode:** awsvpc
- **Task Role:** `berthcare-staging-ecs-task-role`
- **Execution Role:** `berthcare-staging-ecs-execution-role`

**Service Configuration:**

- **Desired Count:** 2 (for high availability)
- **Deployment Type:** Rolling update
- **Health Check Grace Period:** 60 seconds
- **Auto Scaling:** Target CPU 70%, min 2, max 10 tasks

### Load Balancer

**Application Load Balancer:**

- **Scheme:** Internet-facing
- **Subnets:** Public subnets (2 AZs)
- **Security Group:** Allow HTTPS (443) and HTTP (80)
- **Target Group:** ECS tasks on port 3000
- **Health Check:** `/health` endpoint, 30s interval

**SSL/TLS:**

- **Certificate:** AWS Certificate Manager (ACM)
- **Domain:** `api-staging.berthcare.ca` (to be configured)
- **Protocol:** TLS 1.2+

---

## Resource Inventory

### AWS Resources (Staging Environment)

#### Networking

| Resource Type           | Name/ID                          | Purpose                                |
| ----------------------- | -------------------------------- | -------------------------------------- |
| VPC                     | `berthcare-staging-vpc`          | Main VPC (10.0.0.0/16)                 |
| Internet Gateway        | `berthcare-staging-igw`          | Internet access for public subnets     |
| NAT Gateway (AZ-a)      | `berthcare-staging-nat-a`        | Outbound internet for private subnet A |
| NAT Gateway (AZ-b)      | `berthcare-staging-nat-b`        | Outbound internet for private subnet B |
| Public Subnet (AZ-a)    | `berthcare-staging-public-a`     | 10.0.1.0/24                            |
| Public Subnet (AZ-b)    | `berthcare-staging-public-b`     | 10.0.2.0/24                            |
| Private Subnet (AZ-a)   | `berthcare-staging-private-a`    | 10.0.11.0/24                           |
| Private Subnet (AZ-b)   | `berthcare-staging-private-b`    | 10.0.12.0/24                           |
| Route Table (Public)    | `berthcare-staging-public-rt`    | Routes to IGW                          |
| Route Table (Private A) | `berthcare-staging-private-rt-a` | Routes to NAT Gateway A                |
| Route Table (Private B) | `berthcare-staging-private-rt-b` | Routes to NAT Gateway B                |

#### Compute

| Resource Type             | Name/ID                             | Purpose                 |
| ------------------------- | ----------------------------------- | ----------------------- |
| ECS Cluster               | `berthcare-staging-cluster`         | Container orchestration |
| ECS Service               | `berthcare-staging-backend-service` | Backend API service     |
| ECS Task Definition       | `berthcare-staging-backend-task`    | Backend container spec  |
| Application Load Balancer | `berthcare-staging-alb`             | Load balancing          |
| Target Group              | `berthcare-staging-backend-tg`      | ECS task targets        |

#### Database & Cache

| Resource Type               | Name/ID                                | Purpose                    |
| --------------------------- | -------------------------------------- | -------------------------- |
| RDS Instance                | `berthcare-staging-postgres`           | PostgreSQL 15 database     |
| RDS Subnet Group            | `berthcare-staging-db-subnet-group`    | DB subnet configuration    |
| RDS Parameter Group         | `berthcare-staging-postgres-params`    | DB parameters              |
| ElastiCache Cluster         | `berthcare-staging-redis`              | Redis cache cluster        |
| ElastiCache Subnet Group    | `berthcare-staging-redis-subnet-group` | Redis subnet configuration |
| ElastiCache Parameter Group | `berthcare-staging-redis-params`       | Redis parameters           |

#### Storage & CDN

| Resource Type           | Name/ID                        | Purpose               |
| ----------------------- | ------------------------------ | --------------------- |
| S3 Bucket               | `berthcare-photos-staging`     | Visit photos          |
| S3 Bucket               | `berthcare-documents-staging`  | Care plans, reports   |
| S3 Bucket               | `berthcare-signatures-staging` | Client signatures     |
| S3 Bucket               | `berthcare-logs-staging`       | Access logs           |
| CloudFront Distribution | `E1234567890ABC`               | CDN for static assets |

#### Security

| Resource Type          | Name/ID                                | Purpose                  |
| ---------------------- | -------------------------------------- | ------------------------ |
| KMS Key                | `berthcare-staging-kms-key`            | Encryption key           |
| Security Group         | `berthcare-staging-alb-sg`             | ALB security group       |
| Security Group         | `berthcare-staging-ecs-sg`             | ECS tasks security group |
| Security Group         | `berthcare-staging-rds-sg`             | RDS security group       |
| Security Group         | `berthcare-staging-redis-sg`           | Redis security group     |
| IAM Role               | `berthcare-staging-ecs-execution-role` | ECS task execution       |
| IAM Role               | `berthcare-staging-ecs-task-role`      | ECS task runtime         |
| Secrets Manager Secret | `berthcare/staging/database`           | RDS credentials          |
| Secrets Manager Secret | `berthcare/staging/redis`              | Redis auth token         |
| Secrets Manager Secret | `berthcare/staging/twilio`             | Twilio credentials       |

#### Monitoring

| Resource Type        | Name/ID                          | Purpose                 |
| -------------------- | -------------------------------- | ----------------------- |
| CloudWatch Dashboard | `BerthCare-Staging`              | Metrics dashboard       |
| CloudWatch Log Group | `/berthcare/staging/application` | Application logs        |
| CloudWatch Log Group | `/berthcare/staging/ecs`         | ECS task logs           |
| SNS Topic            | `berthcare-staging-alarms`       | Alarm notifications     |
| CloudWatch Alarm     | `berthcare-staging-rds-cpu`      | RDS CPU monitoring      |
| CloudWatch Alarm     | `berthcare-staging-redis-memory` | Redis memory monitoring |

### Twilio Resources

| Resource Type             | Name/ID             | Purpose                |
| ------------------------- | ------------------- | ---------------------- |
| Master Account            | `AC...`             | Main Twilio account    |
| Subaccount (Staging)      | `AC...`             | Staging environment    |
| Subaccount (Production)   | `AC...`             | Production environment |
| Phone Number (Staging)    | `+1 (XXX) XXX-XXXX` | Staging voice/SMS      |
| Phone Number (Production) | `+1 (XXX) XXX-XXXX` | Production voice/SMS   |

### Sentry Resources

| Resource Type | Name/ID                     | Purpose                |
| ------------- | --------------------------- | ---------------------- |
| Organization  | `berthcare`                 | Sentry organization    |
| Project       | `berthcare-backend-staging` | Backend error tracking |
| Project       | `berthcare-mobile-staging`  | Mobile error tracking  |

---

## Appendix

### Related Documentation

- [E1: Git Repository Initialization](./E1-git-repository-initialization.md)
- [E2: CI Pipeline Setup](./E2-ci-pipeline-setup.md)
- [E3: Monorepo Structure Setup](./E3-monorepo-structure-setup.md)
- [E4: Local Development Setup](./E4-local-setup.md)
- [E5: AWS Infrastructure Setup](./E5-aws-infrastructure-setup.md)
- [E6: Monitoring & Observability Setup](./E6-monitoring-observability-setup.md)
- [E7: Twilio Setup](./E7-twilio-setup.md)
- [Architecture Blueprint](../project-documentation/architecture-output.md)
- [Task Plan](../project-documentation/task-plan.md)

### Quick Reference Guides

- [Monitoring Quick Reference](./monitoring-quick-reference.md)
- [Twilio Quick Reference](./twilio-quick-reference.md)
- [Sentry Setup](./sentry-setup.md)

### Terraform Modules

- [Networking Module](../terraform/modules/networking/)
- [Database Module](../terraform/modules/database/)
- [Cache Module](../terraform/modules/cache/)
- [Storage Module](../terraform/modules/storage/)
- [CDN Module](../terraform/modules/cdn/)
- [Security Module](../terraform/modules/security/)
- [Monitoring Module](../terraform/modules/monitoring/)

---

**Document Version:** 1.0.0  
**Last Updated:** October 10, 2025  
**Maintained By:** DevOps Team  
**Status:** ✅ Staging Environment Deployed
