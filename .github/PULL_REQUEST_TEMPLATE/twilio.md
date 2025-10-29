## Twilio Integration - Draft PR

**Closes #6**

### Overview

This PR implements Twilio integration for BerthCare, enabling voice alerts, SMS notifications, and webhook handling for real-time communication with users.

### Design Philosophy Alignment

- **Simplicity**: Twilio integration works invisibly in the background
- **User Experience**: Notifications feel natural and timely, not intrusive
- **Quality**: Every message, alert, and interaction is crafted with care
- **Integration**: Seamless connection between backend services and communication layer

---

## Implementation Checklist

### 🎯 Core Features

#### Voice Alerts

- [ ] Set up Twilio Voice API credentials
- [ ] Create voice call service module
- [ ] Implement emergency alert voice calls
- [ ] Add configurable voice message templates
- [ ] Handle call status callbacks (answered, busy, failed)
- [ ] Implement retry logic for failed calls
- [ ] Add call logging and audit trail
- [ ] Test voice quality and clarity

#### SMS Notifications

- [ ] Configure Twilio SMS API
- [ ] Create SMS service module
- [ ] Implement notification templates (alerts, reminders, updates)
- [ ] Add SMS delivery status tracking
- [ ] Handle opt-out/opt-in preferences
- [ ] Implement rate limiting and throttling
- [ ] Add SMS queue for bulk notifications
- [ ] Support international phone numbers
- [ ] Test message delivery across carriers

#### Webhooks

- [ ] Set up webhook endpoints for Twilio callbacks
- [ ] Implement webhook signature verification
- [ ] Handle incoming SMS webhooks
- [ ] Handle voice call status webhooks
- [ ] Process delivery receipts
- [ ] Add webhook retry handling
- [ ] Implement webhook event logging
- [ ] Create webhook testing utilities

#### Acceptance Criteria & Verification

- [ ] Voice alerts: Successfully initiate call and receive callback with call status
- [ ] SMS notifications: Send message and receive delivery confirmation within 5 seconds
- [ ] Webhooks: Verify signature validation rejects tampered requests (test with invalid signature)
- [ ] API responses: Confirm all endpoints return correct status codes and error messages
- [ ] Edge cases: Test with invalid phone numbers, network failures, Twilio API errors
- [ ] Feature toggles: Verify voice/SMS can be independently enabled/disabled via config
- [ ] Rate limiting: Confirm per-user limits enforced (test exceeding limit returns 429)
- [ ] Retry logic: Verify failed calls/SMS retry with exponential backoff (check logs)

---

### 🏗️ Infrastructure

- [ ] Add Twilio SDK dependencies
- [ ] Configure environment variables (Account SID, Auth Token, Phone Numbers)
- [ ] Set up Twilio phone number(s)
- [ ] Configure webhook URLs in Twilio console
- [ ] Add Twilio service configuration
- [ ] Implement connection pooling
- [ ] Add health check for Twilio connectivity
- [ ] Create database schema for phone numbers (user associations, verification status, opt-in/opt-out preferences)
- [ ] Create database schema for message history (SMS/voice records, timestamps, delivery status, content)
- [ ] Create database schema for webhook event logs (event type, payload, processing status, retry attempts)
- [ ] Define data retention policy for message history (GDPR/compliance requirements, archival strategy)
- [ ] Define data archival policy for old communications (cold storage, deletion timelines)
- [ ] Add database indexes for delivery status queries (failed messages, pending retries)
- [ ] Add database indexes for audit trail queries (user communication history, compliance reports)
- [ ] Add database indexes for webhook event lookups (event ID, timestamp, processing status)
- [ ] Create database migration scripts with version control
- [ ] Document rollback procedures for schema changes
- [ ] Test migration on staging database before production deployment
- [ ] Test rollback procedures on staging database before production deployment

#### Acceptance Criteria & Verification

- [ ] IaC applied: Terraform/CloudFormation changes applied successfully to staging
- [ ] Resources tagged: All AWS resources have required tags (Environment, Service, Owner)
- [ ] Monitoring enabled: CloudWatch dashboards show Twilio metrics (API calls, errors, latency)
- [ ] Health checks: `/health` endpoint reports Twilio connectivity status
- [ ] Database migrations: Run migrations on staging, verify schema matches expected structure
- [ ] Rollback tested: Execute rollback migration, verify data integrity maintained
- [ ] Connection pooling: Verify Twilio client reuses connections (check connection count)
- [ ] Secrets Manager: Confirm credentials loaded from Secrets Manager (check startup logs)

---

### 🔒 Security & Compliance

#### Encryption & PII Protection

- [ ] Implement app-level field encryption for stored phone numbers using AWS KMS-backed keys
- [ ] Configure database column-level encryption for message content with key alias rotation support
- [ ] Document key management procedures (key creation, access policies, backup/recovery) in security runbook
- [ ] Encrypt phone numbers at rest using AES-256-GCM with per-record data encryption keys (DEKs)
- [ ] Store only encrypted phone numbers in database; decrypt only in memory for API calls
- [ ] Implement webhook signature validation using Twilio's X-Twilio-Signature header verification

#### Credential Management & Rotation

- [ ] Store Twilio credentials (Account SID, Auth Token) in AWS Secrets Manager with automatic rotation enabled
- [ ] Define credential rotation policy: rotate Auth Token every 90 days minimum
- [ ] Implement automated rotation via Secrets Manager Lambda rotation function
- [ ] Document emergency rotation steps (compromise response, immediate rotation trigger, service restart)
- [ ] Add monitoring alerts for credential expiration (30-day, 7-day warnings)
- [ ] Test credential rotation in staging without service disruption

#### Audit Logging & Compliance

- [ ] Define audit log scope: log message ID, recipient country code, delivery status, timestamp, retry count
- [ ] Explicitly forbid logging: full phone numbers, message body content, user PII
- [ ] Implement structured audit logs with consistent schema (JSON format, indexed fields)
- [ ] Add GDPR-compliant data retention: 90 days for operational logs, 7 years for compliance audit trails
- [ ] Create audit log queries for compliance reports (delivery success rates, failed messages by country)
- [ ] Implement rate limiting to prevent abuse (per-user, per-IP, per-endpoint thresholds)

#### Log Sanitization & Redaction

- [ ] Redact phone numbers in logs: store only last 4 digits (e.g., `***-***-1234`) or tokenized IDs
- [ ] Hash phone numbers using HMAC-SHA256 with secret salt for correlation without exposing PII
- [ ] Sanitize webhook payloads before logging: remove `From`, `To`, `Body` fields, keep only `MessageSid`, `Status`
- [ ] Example acceptable format: `{"message_id": "SM...", "status": "delivered", "recipient_token": "hash_abc123", "country": "US"}`
- [ ] Implement log scrubbing middleware to automatically redact PII patterns (phone regex, email patterns)
- [ ] Add unit tests to verify no PII leaks in log output (test with sample phone numbers, message content)

#### Acceptance Criteria & Verification

- [ ] Verify encryption: query database directly and confirm phone numbers are encrypted (not plaintext)
- [ ] Verify rotation: trigger manual credential rotation and confirm service continues without errors
- [ ] Verify audit logging: review logs and confirm only allowed fields are present (no phone numbers, no message bodies)
- [ ] Verify redaction: search all logs for phone number patterns and confirm zero matches of full numbers
- [ ] Conduct security review with compliance team before production deployment
- [ ] Perform penetration testing on webhook endpoints (signature bypass attempts, replay attacks)

---

### 📊 Monitoring & Observability

- [ ] Add metrics for message delivery rates
- [ ] Track voice call success/failure rates
- [ ] Monitor webhook processing times
- [ ] Set up alerts for service degradation
- [ ] Create dashboard for communication analytics
- [ ] Log all Twilio API errors
- [ ] Implement cost tracking

---

### 🧪 Testing

- [ ] Unit tests for voice service
- [ ] Unit tests for SMS service
- [ ] Unit tests for webhook handlers
- [ ] Integration tests with Twilio test credentials
- [ ] Mock Twilio responses for CI/CD
- [ ] Test error handling and edge cases
- [ ] Load testing for high-volume scenarios
- [ ] End-to-end testing with real phone numbers (sandbox)

#### Acceptance Criteria & Verification

- [ ] Unit coverage: Verify test coverage meets threshold (≥80% for services, ≥90% for critical paths)
- [ ] Integration tests: Confirm Twilio test credentials work and mock responses match real API behavior
- [ ] CI passing: All tests pass in CI pipeline without flakiness (3 consecutive green builds)
- [ ] Edge cases: Verify tests cover invalid inputs, network timeouts, API rate limits, malformed webhooks
- [ ] Load testing: Confirm system handles 100 concurrent SMS/voice requests without degradation
- [ ] Mocks validated: Compare mock responses against Twilio API documentation for accuracy
- [ ] Error handling: Verify all error scenarios have corresponding test cases (API errors, retries, fallbacks)
- [ ] E2E tests: Successfully send test SMS and voice call to sandbox numbers, receive callbacks

---

### 📝 Documentation

- [ ] API documentation for Twilio services
- [ ] Configuration guide (environment setup)
- [ ] Webhook endpoint documentation
- [ ] Message template documentation
- [ ] Troubleshooting guide
- [ ] Cost estimation guide
- [ ] Update README with Twilio setup instructions

---

### 🚀 Deployment

- [ ] Add Twilio credentials to staging environment
- [ ] Test in staging with real phone numbers
- [ ] Configure production Twilio account
- [ ] Set up production webhook URLs
- [ ] Deploy to production
- [ ] Verify production connectivity
- [ ] Monitor initial production usage

#### Acceptance Criteria & Verification

- [ ] Rollback tested: Execute deployment rollback procedure and verify service restores to previous version
- [ ] Post-deploy smoke tests: Send test SMS and voice call in production, confirm delivery within SLA
- [ ] Zero-downtime: Verify deployment completes without service interruption (monitor error rates)
- [ ] Configuration validated: Confirm all environment variables loaded correctly (check startup logs)
- [ ] Webhook connectivity: Test production webhook endpoints receive and process Twilio callbacks
- [ ] Monitoring active: Verify dashboards show live metrics post-deployment (API calls, latency, errors)
- [ ] Alerts functional: Trigger test alert and confirm notification channels fire correctly
- [ ] Gradual rollout: Verify canary deployment serves 10% traffic before full rollout (if applicable)

---

## Technical Notes

### Architecture Decisions

- Service layer pattern for clean separation
- Queue-based processing for reliability
- Idempotent webhook handlers
- Graceful degradation if Twilio is unavailable

### Dependencies

```json
{
  "twilio": "^5.x.x"
}
```

### Environment Variables

> **🔒 Security Note: Credential Handling**
>
> **DO NOT** commit Twilio credentials to version control:
>
> - Load values from **AWS Secrets Manager** (production/staging)
> - Use **GitHub Actions secrets** for CI/CD pipelines
> - Store in local `.env` files (ensure `.env` is in `.gitignore`)
> - Use environment secret managers (Vault, Parameter Store, etc.)
> - **Rotate keys regularly** and restrict IAM/access permissions
> - Never paste real credentials in PR descriptions or comments

```
TWILIO_ACCOUNT_SID=          # Load from secure secret store
TWILIO_AUTH_TOKEN=           # Load from secure secret store
TWILIO_PHONE_NUMBER=         # Load from secure secret store
TWILIO_WEBHOOK_BASE_URL=     # Public URL, safe to commit
```

---

## Testing Instructions

1. Set up Twilio test credentials
2. Run unit tests: `npm test -- twilio`
3. Test voice calls to your phone
4. Test SMS delivery
5. Verify webhook callbacks

---

## Performance Considerations

- SMS delivery: ~1-3 seconds
- Voice call initiation: ~2-5 seconds
- Webhook processing: <100ms
- Rate limits: Respect Twilio's API limits

---

## Rollout Plan

1. Deploy to staging
2. Internal testing with team phone numbers
3. Beta testing with select users
4. Gradual rollout to production
5. Monitor metrics and adjust

---

## PR Information (Fill in for this PR)

<!-- ⚠️ CONTRIBUTORS: Update the fields below for your specific PR -->

**Status**: [REPLACE: e.g., 🚧 Draft, ✅ Ready for Review, 🔄 In Review]

**Estimated Completion**: [REPLACE: e.g., 10-15 days, 2-3 weeks, or specific date]

**Related Tickets**: [REPLACE: e.g., #6, #123, or "N/A"]

**Assignee**: [REPLACE: e.g., @username, Backend Dev Team]

---

## Estimated Effort Breakdown (Reference)

<!-- This is template guidance - use as reference for planning -->

**Total Estimated Time**: 10-15 days (2-3 weeks)

**Breakdown by Deliverable**:

- Voice Alerts: 2-3 days (service setup, templates, callbacks, retry logic, testing)
- SMS Notifications: 2-3 days (service setup, templates, delivery tracking, queue, testing)
- Webhooks: 2-3 days (endpoints, signature verification, event handling, logging)
- Infrastructure & Persistence: 2-3 days (database schemas, migrations, indexes, retention policies)
- Security & Compliance: 1-2 days (credential management, GDPR compliance, audit logging)
- Testing: 2-3 days (unit, integration, load testing, end-to-end validation)
- Documentation: 1 day (API docs, configuration guides, troubleshooting)
- Deployment & Monitoring: 1-2 days (staging/production setup, observability, rollout)
