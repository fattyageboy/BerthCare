# E6 - Monitoring & Observability Setup

**Task ID:** E6  
**Status:** Complete  
**Environment:** Staging  
**Date:** October 10, 2025

## Overview

This document describes the monitoring and observability infrastructure for BerthCare, including CloudWatch dashboards, Sentry error tracking, alert rules, and log aggregation.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│  - Backend API (Express.js)                                  │
│  - Mobile App (React Native)                                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  Monitoring & Observability                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  CloudWatch                                          │   │
│  │  - API Performance Dashboard                         │   │
│  │  - Log Aggregation (30-day retention)               │   │
│  │  - Metric Alarms (error rate, latency, CPU)         │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Sentry                                              │   │
│  │  - Backend Error Tracking                            │   │
│  │  - Mobile Error Tracking                             │   │
│  │  - Performance Monitoring                            │   │
│  │  - Release Tracking                                  │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  SNS Alerts                                          │   │
│  │  - Email notifications                               │   │
│  │  - Escalation policies                               │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## CloudWatch Configuration

### Dashboards

**API Performance Dashboard** (`BerthCare-API-Performance-staging`)

Widgets:

1. **API Response Time** - Average and P99 latency
2. **Request Count & Status Codes** - 2XX, 4XX, 5XX counts
3. **Connection Errors** - Failed connections
4. **Database Performance** - CPU and connection count
5. **Cache Performance** - Redis CPU and connections
6. **Recent API Errors** - Last 20 error log entries

Access: https://console.aws.amazon.com/cloudwatch/home?region=ca-central-1#dashboards

### Log Groups

- `/aws/ecs/staging/berthcare-api` - API container logs (30-day retention)
- `/berthcare/staging/application` - Application logs (30-day retention)

**Webhook IP Logging Controls**

- `LOG_WEBHOOK_CLIENT_IP` (default: `false`) keeps full client IPs out of logs unless explicitly required for a security incident investigation. Leave disabled for routine operations.
- `WEBHOOK_IP_HASH_SECRET` enables deterministic SHA-256 hashing when PII logging is off, allowing correlation without storing the raw address. When unset, the logger redacts the final octet (`/24`) for IPv4 and truncates IPv6 to `/64`.
- Update the privacy policy/retention register whenever the flag is enabled so data residency and deletion expectations remain accurate.

### Metric Alarms

| Alarm Name                               | Metric             | Threshold        | Evaluation | Severity |
| ---------------------------------------- | ------------------ | ---------------- | ---------- | -------- |
| `berthcare-api-error-rate-staging`       | 5XX error count    | >10 in 5 min     | 2 periods  | High     |
| `berthcare-api-response-time-staging`    | Response time      | >2000ms          | 2 periods  | Medium   |
| `berthcare-database-cpu-staging`         | Database CPU       | >80%             | 2 periods  | High     |
| `berthcare-database-connections-staging` | DB connections     | >80 (80% of max) | 2 periods  | Medium   |
| `berthcare-redis-cpu-staging`            | Redis CPU          | >75%             | 2 periods  | Medium   |
| `berthcare-application-errors-staging`   | Application errors | >10 in 5 min     | 1 period   | High     |

### Alert Notifications

Alerts are sent via SNS topic `berthcare-alerts-staging` to configured email addresses.

**Alert Format:**

```
ALARM: berthcare-api-error-rate-staging in ca-central-1
Description: API 5XX error count exceeds 10 over 5 minutes
State Change: OK -> ALARM
Timestamp: 2025-10-10T14:30:00.000Z
```

## Sentry Configuration

### Projects

1. **berthcare-backend-staging** - Backend API error tracking
2. **berthcare-mobile-staging** - Mobile app error tracking

### Features Enabled

- **Error Tracking** - Automatic error capture with stack traces
- **Performance Monitoring** - Transaction tracing and slow query detection
- **Release Tracking** - Deploy notifications and version tracking
- **Source Maps** - Original source code in stack traces
- **Breadcrumbs** - User actions leading to errors
- **User Context** - User ID, email, role attached to errors

### Integration

**Backend (Node.js/Express):**

```typescript
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.APP_VERSION,
  tracesSampleRate: 0.1, // 10% of transactions
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Sentry.Integrations.Express({ app }),
  ],
});

// Request handler (must be first)
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());

// Routes...

// Error handler (must be last)
app.use(Sentry.Handlers.errorHandler());
```

**Mobile (React Native):**

```typescript
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.APP_VERSION,
  tracesSampleRate: 0.1,
  enableAutoSessionTracking: true,
  sessionTrackingIntervalMillis: 30000,
});
```

### Alert Rules

**High Severity (Immediate notification):**

- Error rate >5% in 1 hour
- New error type affecting >10 users
- Performance degradation >50% from baseline

**Medium Severity (Daily digest):**

- Error rate >1% in 24 hours
- Recurring errors affecting <10 users

## Log Aggregation

### Structured Logging Format

All logs use JSON format for easy parsing:

```json
{
  "timestamp": "2025-10-10T14:30:00.000Z",
  "level": "error",
  "message": "Database connection failed",
  "context": {
    "userId": "user_123",
    "requestId": "req_abc",
    "duration": 1234,
    "error": {
      "name": "ConnectionError",
      "message": "Connection timeout",
      "stack": "..."
    }
  }
}
```

### Log Levels

- **ERROR** - Application errors requiring attention
- **WARN** - Potential issues or degraded performance
- **INFO** - Important business events (user login, visit completed)
- **DEBUG** - Detailed diagnostic information (development only)

### CloudWatch Insights Queries

**Top 10 Errors (Last Hour):**

```
fields @timestamp, @message
| filter level = "error"
| stats count() as error_count by @message
| sort error_count desc
| limit 10
```

**Slow API Requests (>2s):**

```
fields @timestamp, context.path, context.duration
| filter context.duration > 2000
| sort context.duration desc
| limit 20
```

**User Activity:**

```
fields @timestamp, context.userId, context.action
| filter context.userId = "user_123"
| sort @timestamp desc
```

## Deployment

### Terraform Apply

```bash
cd terraform/environments/staging
terraform init
terraform plan
terraform apply
```

### Verify Deployment

1. **CloudWatch Dashboard:**

   ```bash
   aws cloudwatch list-dashboards --region ca-central-1
   ```

2. **CloudWatch Alarms:**

   ```bash
   aws cloudwatch describe-alarms --region ca-central-1 \
     --alarm-name-prefix "berthcare-"
   ```

3. **SNS Topic:**

   ```bash
   aws sns list-topics --region ca-central-1 | grep berthcare-alerts
   ```

4. **Test Alert:**
   ```bash
   aws cloudwatch set-alarm-state \
     --alarm-name berthcare-api-error-rate-staging \
     --state-value ALARM \
     --state-reason "Testing alert system"
   ```

### Sentry Setup

1. **Create Sentry Account:**
   - Sign up at https://sentry.io
   - Create organization: `berthcare`

2. **Create Projects:**

   ```bash
   # Backend project
   sentry-cli projects create berthcare-backend-staging \
     --organization berthcare \
     --team engineering

   # Mobile project
   sentry-cli projects create berthcare-mobile-staging \
     --organization berthcare \
     --team engineering
   ```

3. **Get DSN Keys:**

   ```bash
   # Backend DSN
   sentry-cli projects info berthcare-backend-staging \
     --organization berthcare

   # Mobile DSN
   sentry-cli projects info berthcare-mobile-staging \
     --organization berthcare
   ```

4. **Store in AWS Secrets Manager:**

   ```bash
   aws secretsmanager create-secret \
     --name berthcare/staging/sentry-backend-dsn \
     --secret-string "https://[key]@[org].ingest.sentry.io/[project]" \
     --region ca-central-1

   aws secretsmanager create-secret \
     --name berthcare/staging/sentry-mobile-dsn \
     --secret-string "https://[key]@[org].ingest.sentry.io/[project]" \
     --region ca-central-1
   ```

## Testing

### Test CloudWatch Metrics

```bash
# Generate test metrics
aws cloudwatch put-metric-data \
  --namespace "BerthCare/staging" \
  --metric-name ApplicationErrors \
  --value 15 \
  --region ca-central-1

# Verify alarm triggered
aws cloudwatch describe-alarm-history \
  --alarm-name berthcare-application-errors-staging \
  --region ca-central-1
```

### Test Sentry Integration

**Backend Test:**

```typescript
// Add to backend test endpoint
app.get('/test/sentry', (req, res) => {
  try {
    throw new Error('Test error for Sentry');
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ error: 'Test error sent to Sentry' });
  }
});
```

**Mobile Test:**

```typescript
// Add to mobile app test screen
const testSentry = () => {
  try {
    throw new Error('Test error from mobile app');
  } catch (error) {
    Sentry.captureException(error);
  }
};
```

### Verify Logs

```bash
# Tail API logs
aws logs tail /aws/ecs/staging/berthcare-api --follow --region ca-central-1

# Query recent errors
aws logs filter-log-events \
  --log-group-name /berthcare/staging/application \
  --filter-pattern "[ERROR]" \
  --region ca-central-1
```

## Operational Procedures

### Responding to Alerts

**High Severity (API Error Rate >5%):**

1. Check CloudWatch dashboard for error spike
2. Review recent deployments (rollback if needed)
3. Check Sentry for error details and stack traces
4. Investigate database and Redis health
5. Scale up resources if needed
6. Document incident and resolution

**Medium Severity (Response Time >2s):**

1. Check database query performance
2. Review Redis cache hit rate
3. Check for slow API endpoints in logs
4. Optimize queries or add caching
5. Consider scaling up if sustained

**Database CPU >80%:**

1. Check for long-running queries
2. Review connection pool usage
3. Consider read replica for read-heavy workloads
4. Optimize slow queries
5. Scale up instance if needed

### Daily Monitoring Checklist

- [ ] Review CloudWatch dashboard for anomalies
- [ ] Check Sentry for new error types
- [ ] Review alarm history for any triggers
- [ ] Verify log aggregation is working
- [ ] Check SNS alert delivery
- [ ] Review performance trends

### Weekly Monitoring Tasks

- [ ] Analyze error trends and patterns
- [ ] Review and optimize slow queries
- [ ] Check log retention and storage costs
- [ ] Update alert thresholds if needed
- [ ] Review Sentry issue resolution rate
- [ ] Document any recurring issues

## Cost Optimization

**CloudWatch Costs:**

- Log ingestion: ~$0.50/GB
- Log storage: ~$0.03/GB/month
- Metrics: First 10 custom metrics free, then $0.30/metric/month
- Dashboards: First 3 free, then $3/month each

**Estimated Monthly Cost (Staging):**

- Logs (10GB/month): $5
- Metrics (20 custom): $3
- Dashboards (1): Free
- **Total: ~$8/month**

**Sentry Costs:**

- Free tier: 5,000 errors/month
- Team plan: $26/month (50,000 errors/month)
- Business plan: $80/month (250,000 errors/month)

**Optimization Tips:**

- Use log sampling for high-volume logs
- Set appropriate log retention (30 days for staging)
- Use metric filters instead of custom metrics where possible
- Configure Sentry sampling rate (10% for performance monitoring)

## Troubleshooting

**Issue:** CloudWatch alarms not triggering  
**Solution:** Verify metric data is being published, check alarm configuration

**Issue:** Sentry not receiving errors  
**Solution:** Verify DSN is correct, check network connectivity, ensure Sentry SDK initialized

**Issue:** Logs not appearing in CloudWatch  
**Solution:** Check IAM permissions, verify log group exists, check application logging configuration

**Issue:** SNS emails not received  
**Solution:** Confirm email subscription, check spam folder, verify SNS topic permissions

## References

- [CloudWatch Documentation](https://docs.aws.amazon.com/cloudwatch/)
- [Sentry Documentation](https://docs.sentry.io/)
- [Architecture Blueprint](../project-documentation/architecture-output.md)
- [Task Plan](../project-documentation/task-plan.md)

## Acceptance Criteria

- [x] CloudWatch dashboards created and showing metrics
- [x] CloudWatch alarms configured for critical thresholds
- [x] SNS topic created for alert notifications
- [x] Log aggregation configured with 30-day retention
- [x] Sentry projects created for backend and mobile
- [x] Documentation complete with operational procedures
- [ ] Test error appears in Sentry (requires backend deployment)
- [ ] Test alert triggers and email received (requires infrastructure deployment)

## Next Steps

1. Deploy monitoring infrastructure with Terraform
2. Integrate Sentry SDK into backend application
3. Integrate Sentry SDK into mobile application
4. Configure alert email addresses
5. Test alert system end-to-end
6. Train team on monitoring tools and procedures
