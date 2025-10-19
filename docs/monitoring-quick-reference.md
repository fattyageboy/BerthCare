# Monitoring & Observability Quick Reference

Quick reference guide for BerthCare monitoring and observability tools.

## 🎯 Quick Links

### CloudWatch

- **Dashboard:** <https://console.aws.amazon.com/cloudwatch/home?region=ca-central-1#dashboards:name=BerthCare-API-Performance-staging>
- **Logs:** <https://console.aws.amazon.com/cloudwatch/home?region=ca-central-1#logsV2:log-groups>
- **Alarms:** <https://console.aws.amazon.com/cloudwatch/home?region=ca-central-1#alarmsV2:>

### Sentry

- **Dashboard:** <https://sentry.io/organizations/berthcare/>
- **Backend Issues:** <https://sentry.io/organizations/berthcare/issues/?project=berthcare-backend-staging>
- **Mobile Issues:** <https://sentry.io/organizations/berthcare/issues/?project=berthcare-mobile-staging>

## 📊 Key Metrics

### API Performance

| Metric              | Target  | Warning | Critical |
| ------------------- | ------- | ------- | -------- |
| Response Time (avg) | <500ms  | >1000ms | >2000ms  |
| Response Time (p99) | <2000ms | >3000ms | >5000ms  |
| Error Rate          | <1%     | >3%     | >5%      |
| Throughput          | -       | -       | -        |

### Database

| Metric           | Target | Warning | Critical |
| ---------------- | ------ | ------- | -------- |
| CPU Utilization  | <50%   | >70%    | >80%     |
| Connections      | <50    | >70     | >80      |
| Query Time (avg) | <100ms | >500ms  | >1000ms  |
| Disk Space       | <70%   | >80%    | >90%     |

### Cache (Redis)

| Metric          | Target | Warning | Critical |
| --------------- | ------ | ------- | -------- |
| CPU Utilization | <50%   | >65%    | >75%     |
| Memory Usage    | <70%   | >80%    | >90%     |
| Hit Rate        | >90%   | <80%    | <70%     |
| Connections     | <100   | >150    | >200     |

## 🚨 Alert Thresholds

### High Severity (Immediate Action)

- API error rate >5% for 10 minutes
- Database CPU >80% for 10 minutes
- Application errors >10 in 5 minutes
- New error affecting >10 users

### Medium Severity (Review Within 1 Hour)

- API response time >2000ms for 10 minutes
- Database connections >80 (80% of max)
- Redis CPU >75% for 10 minutes
- Error rate >1% for 1 hour

### Low Severity (Daily Review)

- Slow queries >1000ms
- Cache hit rate <80%
- Disk space >70%

## 🔍 Common Queries

### CloudWatch Insights

#### Top 10 Errors (Last Hour)

```
fields @timestamp, @message
| filter level = "error"
| stats count() as error_count by @message
| sort error_count desc
| limit 10
```

#### Slow API Requests (>2s)

```
fields @timestamp, context.path, context.duration
| filter context.duration > 2000
| sort context.duration desc
| limit 20
```

#### User Activity

```
fields @timestamp, context.userId, context.action
| filter context.userId = "user_123"
| sort @timestamp desc
```

#### Error Rate by Endpoint

```
fields @timestamp, context.path
| filter level = "error"
| stats count() as errors by context.path
| sort errors desc
```

#### Database Query Performance

```
fields @timestamp, context.query, context.duration
| filter context.query like /SELECT/
| stats avg(context.duration) as avg_duration by context.query
| sort avg_duration desc
```

### AWS CLI Commands

#### Tail API Logs

```bash
aws logs tail /aws/ecs/staging/berthcare-api --follow --region ca-central-1
```

#### Query Recent Errors

```bash
aws logs filter-log-events \
  --log-group-name /berthcare/staging/application \
  --filter-pattern "[ERROR]" \
  --region ca-central-1
```

#### Check Alarm Status

```bash
aws cloudwatch describe-alarms \
  --alarm-name-prefix "berthcare-" \
  --region ca-central-1
```

#### Test Alarm

```bash
aws cloudwatch set-alarm-state \
  --alarm-name berthcare-api-error-rate-staging \
  --state-value ALARM \
  --state-reason "Testing alert system" \
  --region ca-central-1
```

## 🛠️ Troubleshooting Playbooks

### High Error Rate

1. **Check CloudWatch Dashboard** - Identify error spike timing
2. **Review Recent Deployments** - Rollback if needed
3. **Check Sentry** - Get error details and stack traces
4. **Verify Services** - Database, Redis, external APIs
5. **Scale Resources** - If capacity issue
6. **Document Incident** - Post-mortem and resolution

### Slow Response Time

1. **Check Database Performance** - CPU, connections, slow queries
2. **Review Cache Hit Rate** - Redis performance
3. **Identify Slow Endpoints** - CloudWatch Insights query
4. **Optimize Queries** - Add indexes, reduce N+1 queries
5. **Increase Cache TTL** - For frequently accessed data
6. **Scale Resources** - If sustained high load

### Database CPU High

1. **Identify Long-Running Queries** - Check RDS Performance Insights
2. **Check Connection Pool** - Verify pool size and usage
3. **Review Recent Changes** - New queries or increased load
4. **Optimize Queries** - Add indexes, rewrite inefficient queries
5. **Consider Read Replica** - For read-heavy workloads
6. **Scale Up Instance** - If sustained high CPU

### Service Degraded

1. **Check Health Endpoint** - `/health` status
2. **Verify All Services** - PostgreSQL, Redis, S3
3. **Check Network** - Security groups, VPC, NAT gateways
4. **Review Logs** - Recent errors or warnings
5. **Restart Services** - If connection issues
6. **Escalate** - If issue persists

## 📈 Daily Monitoring Checklist

- [ ] Review CloudWatch dashboard for anomalies
- [ ] Check Sentry for new error types
- [ ] Review alarm history for any triggers
- [ ] Verify log aggregation is working
- [ ] Check SNS alert delivery
- [ ] Review performance trends
- [ ] Check resource utilization (CPU, memory, disk)
- [ ] Verify backup completion

## 📅 Weekly Monitoring Tasks

- [ ] Analyze error trends and patterns
- [ ] Review and optimize slow queries
- [ ] Check log retention and storage costs
- [ ] Update alert thresholds if needed
- [ ] Review Sentry issue resolution rate
- [ ] Document recurring issues
- [ ] Review capacity planning
- [ ] Update runbooks if needed

## 🔐 Access & Permissions

### CloudWatch Access

```bash
# View dashboards and logs
aws cloudwatch get-dashboard --dashboard-name BerthCare-API-Performance-staging

# View alarms
aws cloudwatch describe-alarms --region ca-central-1
```

### Sentry Access

- **Admin:** Full access to all projects and settings
- **Developer:** View issues, create releases, manage alerts
- **Viewer:** Read-only access to issues and performance

### AWS Secrets Manager

```bash
# Get Sentry DSN
aws secretsmanager get-secret-value \
  --secret-id berthcare/staging/sentry-backend-dsn \
  --region ca-central-1
```

## 📞 Escalation

### Severity Levels

#### P0 - Critical (Immediate)

- Complete service outage
- Data loss or corruption
- Security breach
- Contact: On-call engineer + CTO

#### P1 - High (Within 1 hour)

- Partial service outage
- Error rate >10%
- Database down
- Contact: On-call engineer

#### P2 - Medium (Within 4 hours)

- Performance degradation
- Error rate >5%
- Non-critical feature broken
- Contact: Engineering team

#### P3 - Low (Next business day)

- Minor bugs
- Slow queries
- Low error rate
- Contact: Create ticket

## 📚 Additional Resources

- [E6 Monitoring Setup Documentation](./E6-monitoring-observability-setup.md)
- [Sentry Setup Guide](./SENTRY_SETUP.md)
- [CloudWatch Documentation](https://docs.aws.amazon.com/cloudwatch/)
- [Sentry Documentation](https://docs.sentry.io/)
- [Architecture Blueprint](../project-documentation/architecture-output.md)
