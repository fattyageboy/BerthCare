# Sentry Setup Guide

This guide walks you through setting up Sentry for error tracking and performance monitoring in BerthCare.

## Overview

Sentry provides:

- **Error Tracking** - Automatic capture of exceptions with stack traces
- **Performance Monitoring** - Transaction tracing and slow query detection
- **Release Tracking** - Deploy notifications and version tracking
- **User Context** - Attach user information to errors
- **Breadcrumbs** - Track user actions leading to errors

## Step 1: Create Sentry Account

1. Go to https://sentry.io
2. Sign up for a free account (5,000 errors/month)
3. Create an organization named `berthcare`

## Step 2: Create Projects

### Backend Project

```bash
# Install Sentry CLI (optional, for automation)
pnpm add -g @sentry/cli

# Create backend project
sentry-cli projects create berthcare-backend-staging \
  --organization berthcare \
  --team engineering \
  --platform node
```

Or create via web UI:

1. Click "Create Project"
2. Select platform: **Node.js**
3. Project name: `berthcare-backend-staging`
4. Team: `engineering`

### Mobile Project

```bash
# Create mobile project
sentry-cli projects create berthcare-mobile-staging \
  --organization berthcare \
  --team engineering \
  --platform react-native
```

Or create via web UI:

1. Click "Create Project"
2. Select platform: **React Native**
3. Project name: `berthcare-mobile-staging`
4. Team: `engineering`

## Step 3: Get DSN Keys

### Backend DSN

1. Go to **Settings** → **Projects** → **berthcare-backend-staging**
2. Click **Client Keys (DSN)**
3. Copy the DSN URL (looks like: `https://[key]@[org].ingest.sentry.io/[project]`)

### Mobile DSN

1. Go to **Settings** → **Projects** → **berthcare-mobile-staging**
2. Click **Client Keys (DSN)**
3. Copy the DSN URL

## Step 4: Store DSN in AWS Secrets Manager

### For Staging Environment

```bash
# Backend DSN
aws secretsmanager create-secret \
  --name berthcare/staging/sentry-backend-dsn \
  --description "Sentry DSN for backend error tracking (staging)" \
  --secret-string "https://[key]@[org].ingest.sentry.io/[project]" \
  --region ca-central-1

# Mobile DSN
aws secretsmanager create-secret \
  --name berthcare/staging/sentry-mobile-dsn \
  --description "Sentry DSN for mobile error tracking (staging)" \
  --secret-string "https://[key]@[org].ingest.sentry.io/[project]" \
  --region ca-central-1
```

### For Local Development

Add to your `.env` file:

```bash
SENTRY_DSN=https://[key]@[org].ingest.sentry.io/[project]
SENTRY_ENVIRONMENT=development
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=0.1
APP_VERSION=1.0.0
```

## Step 5: Install Dependencies

### Backend

```bash
cd apps/backend
pnpm add @sentry/node @sentry/profiling-node winston
```

### Mobile (Future)

```bash
cd apps/mobile
pnpm add @sentry/react-native
```

## Step 6: Configure Backend Integration

The backend integration is already configured in:

- `apps/backend/src/config/sentry.ts` - Sentry initialization and utilities
- `apps/backend/src/config/logger.ts` - Structured logging with Sentry integration
- `apps/backend/src/main-with-monitoring.ts` - Server with monitoring enabled

To use the monitoring-enabled server:

```bash
# Update package.json scripts
"dev": "tsx watch src/main-with-monitoring.ts",
"start": "node dist/main-with-monitoring.js"
```

## Step 7: Test Integration

### Test Backend Error Tracking

```bash
# Start the backend
pnpm run dev

# Trigger a test error (development only)
curl http://localhost:3000/test/sentry
```

Check Sentry dashboard - you should see the error appear within seconds.

### Test Performance Monitoring

```bash
# Make some API requests
curl http://localhost:3000/health
curl http://localhost:3000/api/v1
```

Check Sentry **Performance** tab - you should see transaction traces.

## Step 8: Configure Alert Rules

### High Severity Alerts

1. Go to **Alerts** → **Create Alert**
2. Select **Issues**
3. Configure:
   - **When:** Error rate is above 5% in 1 hour
   - **Then:** Send notification to email
   - **Name:** High Error Rate - Immediate Action Required

### New Error Alerts

1. Go to **Alerts** → **Create Alert**
2. Select **Issues**
3. Configure:
   - **When:** A new issue is created
   - **And:** Affecting more than 10 users
   - **Then:** Send notification to email
   - **Name:** New Error Type Detected

### Performance Degradation

1. Go to **Alerts** → **Create Alert**
2. Select **Metric**
3. Configure:
   - **When:** Average transaction duration increases by 50%
   - **Then:** Send notification to email
   - **Name:** Performance Degradation Detected

## Step 9: Configure Source Maps (Production)

For production deployments, upload source maps so Sentry can show original source code in stack traces:

```bash
# Install Sentry CLI
pnpm add -g @sentry/cli

# Configure auth token
export SENTRY_AUTH_TOKEN=your_auth_token

# Upload source maps after build
sentry-cli releases new $APP_VERSION
sentry-cli releases files $APP_VERSION upload-sourcemaps ./dist
sentry-cli releases finalize $APP_VERSION
```

## Step 10: Configure Release Tracking

### Backend Deployment

Add to your CI/CD pipeline:

```bash
# Create release
sentry-cli releases new $APP_VERSION \
  --project berthcare-backend-staging

# Associate commits
sentry-cli releases set-commits $APP_VERSION --auto

# Deploy notification
sentry-cli releases deploys $APP_VERSION new \
  --env staging

# Finalize release
sentry-cli releases finalize $APP_VERSION
```

## Monitoring Best Practices

### 1. Set User Context

```typescript
import { setSentryUser } from './config/sentry';

// After user authentication
setSentryUser(user.id, user.email, user.role);

// On logout
clearSentryUser();
```

### 2. Add Breadcrumbs

```typescript
import { addSentryBreadcrumb } from './config/sentry';

// Track important actions
addSentryBreadcrumb('User started visit', 'user-action', 'info', {
  clientId: visit.clientId,
  visitId: visit.id,
});
```

### 3. Capture Exceptions Manually

```typescript
import { captureException } from './config/sentry';

try {
  await riskyOperation();
} catch (error) {
  captureException(error, {
    operation: 'riskyOperation',
    userId: user.id,
  });
}
```

### 4. Use Structured Logging

```typescript
import { logError, logInfo } from './config/logger';

// Logs to console AND sends to Sentry
logError('Database connection failed', error, {
  database: 'postgres',
  host: dbHost,
});

// Info logs (not sent to Sentry)
logInfo('User logged in', {
  userId: user.id,
  email: user.email,
});
```

### 5. Filter Sensitive Data

Sensitive data is automatically filtered in `apps/backend/src/config/sentry.ts`:

- Authorization headers
- Cookies
- Password query parameters
- Token query parameters

Add more filters as needed in the `beforeSend` hook.

## Cost Management

### Free Tier Limits

- 5,000 errors/month
- 10,000 performance units/month
- 1 project

### Optimization Tips

1. **Adjust Sample Rates:**

   ```bash
   SENTRY_TRACES_SAMPLE_RATE=0.1  # 10% of transactions
   SENTRY_PROFILES_SAMPLE_RATE=0.1  # 10% of transactions
   ```

2. **Filter Noisy Errors:**
   - Configure **Inbound Filters** in Sentry settings
   - Ignore known errors (e.g., browser extensions)

3. **Use Sampling:**
   - Sample performance monitoring (10% is usually sufficient)
   - Full error tracking (100% sample rate)

4. **Monitor Usage:**
   - Check **Stats** page regularly
   - Set up usage alerts

## Troubleshooting

### Errors Not Appearing in Sentry

1. **Check DSN:** Verify `SENTRY_DSN` is set correctly
2. **Check Network:** Ensure outbound HTTPS to `*.ingest.sentry.io` is allowed
3. **Check Initialization:** Verify `initSentry()` is called before any errors
4. **Check Logs:** Look for Sentry initialization messages in console

### Performance Data Not Showing

1. **Check Sample Rate:** Verify `SENTRY_TRACES_SAMPLE_RATE` > 0
2. **Check Transactions:** Ensure transactions are being created
3. **Wait:** Performance data can take a few minutes to appear

### Source Maps Not Working

1. **Check Upload:** Verify source maps were uploaded successfully
2. **Check Release:** Ensure `APP_VERSION` matches the release name
3. **Check Files:** Verify source map files are in the correct format

## Support

- **Sentry Documentation:** https://docs.sentry.io/
- **Sentry Support:** https://sentry.io/support/
- **BerthCare Team:** Create an issue in the repository

## Next Steps

1. ✅ Create Sentry account and projects
2. ✅ Get DSN keys
3. ✅ Store DSN in AWS Secrets Manager
4. ✅ Install dependencies
5. ✅ Configure backend integration
6. ✅ Test error tracking
7. ✅ Configure alert rules
8. ⏳ Deploy to staging
9. ⏳ Configure mobile integration
10. ⏳ Set up production environment
