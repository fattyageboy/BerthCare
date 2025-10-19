# E8: Architecture Documentation Update

**Task ID:** E8  
**Purpose:** Document all infrastructure decisions, AWS resource IDs, Twilio configuration, and local development setup  
**Dependencies:** E7 (Twilio Configuration)  
**Estimated Time:** 0.5 days  
**Status:** ✅ Complete

---

## Overview

This task consolidates all infrastructure decisions, resource configurations, and setup procedures into a comprehensive architecture document. The documentation serves as the single source of truth for the BerthCare system architecture.

---

## Deliverables

### 1. Comprehensive Architecture Document

**File:** `docs/architecture.md`

**Contents:**

- System overview and design philosophy
- Architecture principles (offline-first, zero friction, invisible technology)
- Technology stack summary
- High-level system component diagram
- Local development environment details
- AWS infrastructure (staging) configuration
- Twilio communication services setup
- Monitoring and observability configuration
- Security and compliance measures
- Deployment architecture
- Complete resource inventory

**Key Sections:**

#### Local Development Environment

- Docker Compose service configuration
- PostgreSQL, Redis, and LocalStack setup
- Connection strings and credentials
- Development workflow
- Quick start commands

#### AWS Infrastructure (Staging)

- Network architecture (VPC, subnets, NAT gateways)
- RDS PostgreSQL configuration
- ElastiCache Redis configuration
- S3 buckets and lifecycle policies
- CloudFront CDN setup
- Security groups and IAM roles
- Cost estimation

#### Communication Services (Twilio)

- Account structure (master account + subaccounts)
- Phone numbers (staging + production)
- Webhook configuration
- Credentials storage in AWS Secrets Manager
- Security configuration (geo permissions, rate limits)
- Cost estimation

#### Monitoring & Observability

- CloudWatch dashboards and alarms
- Sentry error tracking configuration
- Log groups and retention policies
- Performance monitoring setup

#### Security & Compliance

- Canadian data residency (ca-central-1)
- PIPEDA and PHIPA compliance
- Encryption at rest and in transit
- Access control (IAM, RBAC)
- Audit trails

#### Deployment Architecture

- CI/CD pipeline overview
- Container architecture
- ECS Fargate configuration
- Load balancer setup

#### Resource Inventory

- Complete list of AWS resources with names/IDs
- Twilio resources
- Sentry projects
- Organized by category (networking, compute, database, storage, security, monitoring)

### 2. Updated Documentation Index

**File:** `docs/README.md`

**Updates:**

- Added E7: Twilio Setup to documentation index
- Added Twilio Quick Reference to quick references section
- Updated directory structure to include new files

### 3. Updated Scripts Documentation

**File:** `scripts/README.md`

**Updates:**

- Added `setup-twilio-secrets.sh` documentation
- Documented deployment scripts section
- Added prerequisites and usage instructions

---

## Architecture Decisions Documented

### 1. Offline-First Architecture

**Decision:** Local SQLite database is source of truth, server is sync destination

**Rationale:**

- Rural connectivity unreliable
- caregivers can't wait for network
- Data loss unacceptable

**Implementation:**

- WatermelonDB (SQLite wrapper) on mobile
- Background sync with conflict resolution
- Last-write-wins strategy with audit trail

### 2. Voice Calls Over Messaging

**Decision:** Use Twilio Voice API for urgent alerts, not messaging platform

**Rationale:**

- Urgent issues need human voices
- 150 words/min (voice) vs 40 words/min (typing)
- No notification fatigue

**Implementation:**

- One-tap voice alert button
- coordinator receives phone call
- Voice message playback
- SMS backup if no answer

### 3. Canadian Data Residency

**Decision:** All AWS resources in ca-central-1 region

**Rationale:**

- PIPEDA compliance requirement
- Customer trust and confidence
- Legal and regulatory compliance

**Implementation:**

- VPC in ca-central-1
- RDS, Redis, S3 all in ca-central-1
- CloudFront edge locations globally, origin in Canada

### 4. Multi-AZ Deployment

**Decision:** Deploy RDS and Redis across multiple availability zones

**Rationale:**

- High availability requirement
- Automatic failover capability
- Minimize downtime

**Implementation:**

- RDS Multi-AZ (primary + standby)
- Redis cluster with replica
- RTO: 1-2 minutes, RPO: 0 (RDS) / <1 min (Redis)

### 5. Infrastructure as Code

**Decision:** Use Terraform for all infrastructure provisioning

**Rationale:**

- Version control for infrastructure
- Reproducible deployments
- Easy environment replication

**Implementation:**

- Modular Terraform structure
- Separate staging and production environments
- State stored in S3 with DynamoDB locking

---

## Resource Inventory

### AWS Resources (Staging)

**Networking:**

- 1 VPC (10.0.0.0/16)
- 2 Public Subnets (ca-central-1a, ca-central-1b)
- 2 Private Subnets (ca-central-1a, ca-central-1b)
- 2 NAT Gateways (one per AZ)
- 1 Internet Gateway
- 3 Route Tables (1 public, 2 private)

**Compute:**

- 1 ECS Cluster
- 1 ECS Service (backend API)
- 1 ECS Task Definition
- 1 Application Load Balancer
- 1 Target Group

**Database & Cache:**

- 1 RDS PostgreSQL instance (Multi-AZ)
- 1 RDS Subnet Group
- 1 RDS Parameter Group
- 1 ElastiCache Redis cluster (2 nodes)
- 1 ElastiCache Subnet Group
- 1 ElastiCache Parameter Group

**Storage & CDN:**

- 4 S3 Buckets (photos, documents, signatures, logs)
- 1 CloudFront Distribution

**Security:**

- 1 KMS Key
- 4 Security Groups (ALB, ECS, RDS, Redis)
- 2 IAM Roles (execution, task)
- 3 Secrets Manager Secrets (database, redis, twilio)

**Monitoring:**

- 1 CloudWatch Dashboard
- 2 CloudWatch Log Groups
- 1 SNS Topic
- 8+ CloudWatch Alarms

### Twilio Resources

- 1 Master Account
- 2 Subaccounts (staging, production)
- 2 Phone Numbers (staging, production)

### Sentry Resources

- 1 Organization
- 2 Projects (backend-staging, mobile-staging)

---

## Configuration Details

### Local Development

**PostgreSQL:**

- Host: localhost:5432
- Database: berthcare_dev
- User: berthcare
- Password: berthcare_dev_password

**Redis:**

- Host: localhost:6379
- Password: berthcare_redis_password
- Database: 0

**LocalStack S3:**

- Endpoint: http://localhost:4566
- Region: ca-central-1
- Access Key: test
- Secret Key: test

### AWS Staging

**RDS PostgreSQL:**

- Endpoint: berthcare-staging-postgres.xxxxx.ca-central-1.rds.amazonaws.com
- Port: 5432
- Database: berthcare
- User: berthcare_admin
- Password: Stored in AWS Secrets Manager

**ElastiCache Redis:**

- Endpoint: berthcare-staging-redis.xxxxx.cache.amazonaws.com
- Port: 6379
- Auth Token: Stored in AWS Secrets Manager

**S3 Buckets:**

- berthcare-photos-staging
- berthcare-documents-staging
- berthcare-signatures-staging
- berthcare-logs-staging

### Twilio

**Staging:**

- Account SID: AC... (stored in Secrets Manager)
- Auth Token: Stored in Secrets Manager
- Phone Number: +1 (XXX) XXX-XXXX
- Voice URL: https://api-staging.berthcare.ca/v1/twilio/voice
- SMS URL: https://api-staging.berthcare.ca/v1/twilio/sms

**Production:**

- Account SID: AC... (stored in Secrets Manager)
- Auth Token: Stored in Secrets Manager
- Phone Number: +1 (XXX) XXX-XXXX
- Voice URL: https://api.berthcare.ca/v1/twilio/voice
- SMS URL: https://api.berthcare.ca/v1/twilio/sms

---

## Verification Checklist

- [x] Architecture document created (`docs/architecture.md`)
- [x] All infrastructure decisions documented
- [x] Local development environment documented
- [x] AWS infrastructure (staging) documented
- [x] Twilio configuration documented
- [x] Monitoring and observability documented
- [x] Security and compliance documented
- [x] Deployment architecture documented
- [x] Complete resource inventory included
- [x] Connection strings and credentials documented
- [x] Cost estimations included
- [x] Related documentation cross-referenced
- [x] Documentation index updated
- [x] Scripts documentation updated

---

## Documentation Structure

```
docs/
├── architecture.md                        # ✅ NEW: Comprehensive architecture doc
├── E1-git-repository-initialization.md
├── E2-ci-pipeline-setup.md
├── E3-monorepo-structure-setup.md
├── E4-local-setup.md
├── E5-aws-infrastructure-setup.md
├── E6-monitoring-observability-setup.md
├── E7-twilio-setup.md
├── E7-twilio-checklist.md
├── E8-architecture-documentation-update.md # ✅ NEW: This document
├── twilio-quick-reference.md
├── monitoring-quick-reference.md
├── sentry-setup.md
└── README.md                              # ✅ UPDATED
```

---

## Next Steps

After completing this documentation:

1. **Backend Implementation (Phase G - Git Workflow):**
   - Create feature branches
   - Implement REST API endpoints
   - Add database migrations
   - Implement authentication

2. **Twilio Integration (Phase T):**
   - Implement Twilio Voice client
   - Implement Twilio SMS client
   - Add webhook handlers
   - Test voice alerts and SMS

3. **Mobile App Development (Phase M):**
   - Set up React Native project
   - Implement offline-first data layer
   - Build core UI components
   - Integrate with backend API

4. **Production Deployment (Future):**
   - Replicate staging infrastructure for production
   - Configure production domain and SSL
   - Set up production monitoring
   - Implement blue-green deployment

---

## Support Resources

- **Architecture Document:** [docs/architecture.md](./architecture.md)
- **Local Setup:** [docs/E4-local-setup.md](./E4-local-setup.md)
- **AWS Infrastructure:** [docs/E5-aws-infrastructure-setup.md](./E5-aws-infrastructure-setup.md)
- **Twilio Setup:** [docs/E7-twilio-setup.md](./E7-twilio-setup.md)
- **Monitoring Setup:** [docs/E6-monitoring-observability-setup.md](./E6-monitoring-observability-setup.md)
- **Task Plan:** [project-documentation/task-plan.md](../project-documentation/task-plan.md)

---

## Acceptance Criteria

- [x] Comprehensive architecture document created
- [x] All infrastructure decisions documented with rationale
- [x] AWS resource IDs and configurations documented
- [x] Twilio configuration documented
- [x] Local development setup documented
- [x] Monitoring and observability documented
- [x] Security and compliance measures documented
- [x] Deployment architecture documented
- [x] Complete resource inventory included
- [x] Documentation cross-referenced and indexed
- [x] Architecture diagrams included
- [x] Cost estimations provided

**Status:** ✅ Complete

---

**Document Version:** 1.0.0  
**Completed:** October 10, 2025  
**Completed By:** DevOps Team
