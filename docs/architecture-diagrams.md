# BerthCare Architecture Diagrams

Visual representations of the BerthCare system architecture.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Mobile App (React Native)                       │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Offline-First Data Layer (WatermelonDB/SQLite)                 │    │
│  │  • Local source of truth                                        │    │
│  │  • Instant reads/writes (<10ms)                                 │    │
│  │  • 30 days offline storage                                      │    │
│  │  • Automatic conflict resolution                                │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Background Sync Engine                                         │    │
│  │  • Intelligent sync scheduling                                  │    │
│  │  • Exponential backoff on failures                              │    │
│  │  • Delta sync (only changed data)                               │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↕
                      HTTPS/WSS (Encrypted, Compressed)
                                    ↕
┌─────────────────────────────────────────────────────────────────────────┐
│                    Backend Services (Node.js + Express)                 │
│                                                                         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐       │
│  │   REST API       │  │  Voice Alerts    │  │   Family SMS     │       │
│  │   Endpoints      │  │  (Twilio Voice)  │  │  (Twilio SMS)    │       │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘       │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Sync Conflict Resolution Engine                                │    │
│  │  • Last-write-wins with audit trail                             │    │
│  │  • Comprehensive logging                                        │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↕
┌─────────────────────────────────────────────────────────────────────────┐
│                              Data Layer                                 │
│                                                                         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐       │
│  │  PostgreSQL 15   │  │    Redis 7       │  │     AWS S3       │       │
│  │  (Server DB)     │  │  (Cache/Session) │  │  (File Storage)  │       │
│  │  • ACID          │  │  • Fast access   │  │  • Photos        │       │
│  │  • Multi-AZ      │  │  • Multi-AZ      │  │  • Documents     │       │
│  │  • Encrypted     │  │  • Encrypted     │  │  • Signatures    │       │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## AWS Infrastructure (Staging)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CloudFront CDN                                  │
│                    (Global Edge Locations)                              │
│                    d1234567890abc.cloudfront.net                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                    VPC: berthcare-staging-vpc                           │
│                         (10.0.0.0/16)                                   │
│                      Region: ca-central-1                               │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                      Public Subnets                               │  │
│  │                                                                   │  │
│  │  ┌─────────────────────────┐  ┌─────────────────────────┐         │  │
│  │  │  ca-central-1a          │  │  ca-central-1b          │         │  │
│  │  │  10.0.1.0/24            │  │  10.0.2.0/24            │         │  │
│  │  │                         │  │                         │         │  │
│  │  │  ┌─────────────────┐    │  │  ┌─────────────────┐    │         │  │
│  │  │  │  NAT Gateway A  │    │  │  │  NAT Gateway B  │    │         │  │
│  │  └─────────────────────────┘  └─────────────────────────┘         │  │
│  │                                                                   │  │
│  │  ┌──────────────────────────────────────────────────────────────┐ │  │
│  │  │         Application Load Balancer (ALB)                      │ │  │
│  │  │         api-staging.berthcare.ca                             │ │  │
│  │  └──────────────────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    ↓                                    │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                      Private Subnets                              │  │
│  │                                                                   │  │
│  │  ┌─────────────────────────┐  ┌─────────────────────────┐         │  │
│  │  │  ca-central-1a          │  │  ca-central-1b          │         │  │
│  │  │  10.0.11.0/24           │  │  10.0.12.0/24           │         │  │
│  │  │                         │  │                         │         │  │
│  │  │  ┌─────────────────┐    │  │  ┌─────────────────┐    │         │  │
│  │  │  │  ECS Fargate    │    │  │  │  ECS Fargate    │    │         │  │
│  │  │  │  Backend Tasks  │    │  │  │  Backend Tasks  │    │         │  │
│  │  │  └─────────────────┘    │  │  └─────────────────┘    │         │  │
│  │  │                         │  │                         │         │  │
│  │  │  ┌─────────────────┐    │  │  ┌─────────────────┐    │         │  │
│  │  │  │  RDS PostgreSQL │    │  │  │  RDS Standby    │    │         │  │
│  │  │  │  (Primary)      │◄─ ─┼──┼──┤  (Multi-AZ)     │    │         │  │
│  │  │  └─────────────────┘    │  │  └─────────────────┘    │         │  │
│  │  │                         │  │                         │         │  │
│  │  │  ┌─────────────────┐    │  │  ┌─────────────────┐    │         │  │
│  │  │  │  Redis Primary  │    │  │  │  Redis Replica  │    │         │  │
│  │  │  │                 │◄── ┼──┼──┤                 │    │         │  │
│  │  │  └─────────────────┘    │  │  └─────────────────┘    │         │  │
│  │  └─────────────────────────┘  └─────────────────────────┘         │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                           S3 Buckets                                    │
│                                                                         │
│  ┌──────────────────────┐  ┌──────────────────────┐                     │
│  │ berthcare-photos-    │  │ berthcare-documents- │                     │
│  │ staging              │  │ staging              │                     │
│  └──────────────────────┘  └──────────────────────┘                     │
│                                                                         │
│  ┌──────────────────────┐  ┌──────────────────────┐                     │
│  │ berthcare-signatures-│  │ berthcare-logs-      │                     │
│  │ staging              │  │ staging              │                     │
│  └──────────────────────┘  └──────────────────────┘                     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Visit Documentation

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         caregiver's Mobile Device                           │
│                                                                         │
│  1. caregiver opens app                                                     │
│     └─→ Instant load from local SQLite (<2s)                            │
│                                                                         │
│  2. Taps client                                                         │
│     └─→ Profile loads instantly from local DB (<10ms)                   │
│                                                                         │
│  3. Taps "Start Visit"                                                  │
│     └─→ GPS auto-check-in, saved locally                                │
│                                                                         │
│  4. Documents visit                                                     │
│     └─→ Each field auto-saves after 1s to local DB                      │
│     └─→ Queued for background sync                                      │
│                                                                         │
│  5. Takes photo                                                         │
│     └─→ Saved to local storage                                          │
│     └─→ Queued for S3 upload                                            │
│                                                                         │
│  6. Taps "Complete Visit"                                               │
│     └─→ Instant confirmation (local save)                               │
│     └─→ Background sync starts                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
                      (When connectivity available)
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         Background Sync Process                         │
│                                                                         │
│  1. Detect connectivity                                                 │
│  2. Batch all changes since last sync                                   │
│  3. Compress payload                                                    │
│  4. Send to backend API (HTTPS)                                         │
│  5. Upload photos to S3 (pre-signed URLs)                               │
│  6. Handle conflicts (last-write-wins)                                  │
│  7. Update local sync status                                            │
│  8. All invisible to user                                               │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         Backend Processing                              │
│                                                                         │
│  1. Validate JWT token                                                  │
│  2. Validate request data                                               │
│  3. Check for conflicts                                                 │
│  4. Save to PostgreSQL                                                  │
│  5. Update Redis cache                                                  │
│  6. Log to CloudWatch                                                   │
│  7. Return success response                                             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Voice Alert

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         caregiver's Mobile Device                           │
│                                                                         │
│  1. caregiver discovers urgent issue                                        │
│  2. Taps floating alert button                                          │
│  3. Records voice message: "Margaret seems confused about meds"         │
│  4. Taps "Send Alert"                                                   │
│     └─→ Voice message saved locally                                     │
│     └─→ Alert queued for immediate send                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
                              (Within 15 seconds)
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         Backend Processing                              │
│                                                                         │
│  1. Receive alert request                                               │
│  2. Identify Margaret's coordinator (Mike)                              │
│  3. Upload voice message to S3                                          │
│  4. Create alert record in database                                     │
│  5. Initiate Twilio Voice API call to Mike                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         Twilio Voice Service                            │
│                                                                         │
│  1. Call Mike's phone                                                   │
│  2. Mike answers                                                        │
│  3. Play voice message from S3                                          │
│  4. Log call outcome                                                    │
│                                                                         │
│  If no answer:                                                          │
│  5. Send SMS to Mike with text version                                  │
│  6. After 5 minutes: Call backup coordinator                            │
│  7. Notify caregiver of escalation                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         Resolution                                      │
│                                                                         │
│  1. Mike resolves issue                                                 │
│  2. Outcome documented in care plan                                     │
│  3. Alert marked as resolved                                            │
│  4. caregiver notified                                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Security Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Mobile App (Client)                             │
│                                                                         │
│  • JWT token stored securely (Keychain/Keystore)                        │
│  • Local SQLite encrypted                                               │
│  • HTTPS only for API calls                                             │
│  • Certificate pinning                                                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
                              HTTPS/TLS 1.2+
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         API Gateway / ALB                               │
│                                                                         │
│  • SSL/TLS termination                                                  │
│  • Rate limiting                                                        │
│  • DDoS protection (AWS Shield)                                         │
│  • WAF rules (optional)                                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         Backend Services                                │
│                                                                         │
│  • JWT validation                                                       │
│  • Role-based access control (RBAC)                                     │
│  • Input validation                                                     │
│  • SQL injection prevention (parameterized queries)                     │
│  • XSS prevention                                                       │
│  • CSRF protection                                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         Data Layer                                      │
│                                                                         │
│  ┌──────────────────────┐  ┌──────────────────────┐                     │
│  │  PostgreSQL          │  │  Redis               │                     │
│  │  • Encryption at rest│  │  • Encryption at rest│                     │
│  │  • TLS in transit    │  │  • TLS in transit    │                     │
│  │  • Private subnet    │  │  • Private subnet    │                     │
│  │  • Security group    │  │  • Security group    │                     │
│  │  • IAM auth          │  │  • Auth token        │                     │
│  └──────────────────────┘  └──────────────────────┘                     │
│                                                                         │
│  ┌──────────────────────┐  ┌──────────────────────┐                     │
│  │  S3                  │  │  Secrets Manager     │                     │
│  │  • Encryption at rest│  │  • KMS encryption    │                     │
│  │  • Bucket policies   │  │  • IAM policies      │                     │
│  │  • Versioning        │  │  • Rotation policies │                     │
│  │  • Access logging    │  │  • Audit logging     │                     │
│  └──────────────────────┘  └──────────────────────┘                     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Monitoring & Observability

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Application Layer                               │
│                                                                         │
│  ┌──────────────────────┐  ┌──────────────────────┐                     │
│  │  Mobile App          │  │  Backend API         │                     │
│  │  • Sentry errors     │  │  • Sentry errors     │                     │
│  │  • Performance       │  │  • Performance       │                     │
│  │  • Breadcrumbs       │  │  • Structured logs   │                     │
│  └──────────────────────┘  └──────────────────────┘                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         Monitoring Services                             │
│                                                                         │
│  ┌──────────────────────┐  ┌──────────────────────┐                     │
│  │  Sentry              │  │  CloudWatch          │                     │
│  │  • Error tracking    │  │  • Metrics           │                     │
│  │  • Performance       │  │  • Logs              │                     │
│  │  • Release health    │  │  • Alarms            │                     │
│  │  • User feedback     │  │  • Dashboards        │                     │
│  └──────────────────────┘  └──────────────────────┘                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         Alerting & Notifications                        │
│                                                                         │
│  ┌──────────────────────┐  ┌──────────────────────┐                     │
│  │  SNS Topic           │  │  Sentry Alerts       │                     │
│  │  • Email             │  │  • Email             │                     │
│  │  • Slack (optional)  │  │  • Slack             │                     │
│  │  • PagerDuty (prod)  │  │  • Issue tracking    │                     │
│  └──────────────────────┘  └──────────────────────┘                     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

**Last Updated:** October 10, 2025  
**Maintained By:** DevOps Team
