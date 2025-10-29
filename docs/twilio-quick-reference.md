# Twilio Quick Reference

Quick commands and information for managing Twilio integration.

---

## Phone Numbers

### Staging

- **Number:** [To be configured]
- **Subaccount SID:** [To be configured]
- **Friendly Name:** BerthCare Staging

### Production

- **Number:** [To be configured]
- **Subaccount SID:** [To be configured]
- **Friendly Name:** BerthCare Production

---

## Webhook URLs

### Staging

```
Voice: https://api-staging.berthcare.ca/v1/twilio/voice
Voice Status: https://api-staging.berthcare.ca/v1/twilio/voice/status
SMS: https://api-staging.berthcare.ca/v1/twilio/sms
SMS Status: https://api-staging.berthcare.ca/v1/twilio/sms/status
```

### Production

```
Voice: https://api.berthcare.ca/v1/twilio/voice
Voice Status: https://api.berthcare.ca/v1/twilio/voice/status
SMS: https://api.berthcare.ca/v1/twilio/sms
SMS Status: https://api.berthcare.ca/v1/twilio/sms/status
```

---

## AWS Secrets Manager

### Retrieve Staging Credentials

```bash
aws secretsmanager get-secret-value \
  --secret-id berthcare/staging/twilio \
  --region ca-central-1 \
  --query SecretString \
  --output text | jq .
```

### Retrieve Production Credentials

```bash
aws secretsmanager get-secret-value \
  --secret-id berthcare/production/twilio \
  --region ca-central-1 \
  --query SecretString \
  --output text | jq .
```

### Update Credentials

```bash
# Run the setup script
./scripts/setup-twilio-secrets.sh
```

### Backend Configuration

- Set `TWILIO_SECRET_ID=berthcare/staging/twilio` (staging) or `TWILIO_SECRET_ID=berthcare/production/twilio` (production) so the backend pulls credentials from Secrets Manager at runtime.
- Local development can continue using direct environment variables; when `TWILIO_SECRET_ID` is present, direct credential variables become optional.

---

## Testing

### Test Voice Call (Staging)

```bash
# Using Twilio CLI
twilio api:core:calls:create \
  --from "+1YOUR_STAGING_NUMBER" \
  --to "+1YOUR_PHONE" \
  --url "http://twimlets.com/echo?Twiml=%3CResponse%3E%3CSay%3ETest%20from%20BerthCare%3C%2FSay%3E%3C%2FResponse%3E" \
  --account-sid "AC..." \
  --auth-token "your_auth_token"
```

### Test SMS (Staging)

```bash
# Using Twilio CLI
twilio api:core:messages:create \
  --from "+1YOUR_STAGING_NUMBER" \
  --to "+1YOUR_PHONE" \
  --body "Test SMS from BerthCare staging" \
  --account-sid "AC..." \
  --auth-token "your_auth_token"
```

### Test Webhook (After Backend Deployment)

```bash
# Test voice webhook
curl -X POST https://api-staging.berthcare.ca/v1/twilio/voice \
  -d "CallSid=CAtest123" \
  -d "From=+1234567890" \
  -d "To=+1987654321" \
  -d "CallStatus=ringing"

# Test SMS webhook
curl -X POST https://api-staging.berthcare.ca/v1/twilio/sms \
  -d "MessageSid=SMtest123" \
  -d "From=+1234567890" \
  -d "To=+1987654321" \
  -d "Body=DETAILS"
```

---

## Common Commands

### Install Twilio CLI

```bash
# macOS
brew tap twilio/brew && brew install twilio

# Verify installation
twilio --version
```

### Login to Twilio CLI

```bash
twilio login
# Enter Account SID and Auth Token when prompted
```

### List Phone Numbers

```bash
twilio api:core:incoming-phone-numbers:list
```

### Check Account Balance

```bash
twilio api:core:accounts:fetch --account-sid "AC..."
```

### View Recent Calls

```bash
twilio api:core:calls:list --limit 10
```

### View Recent Messages

```bash
twilio api:core:messages:list --limit 10
```

---

## Monitoring

### Twilio Console URLs

- **Dashboard:** https://console.twilio.com
- **Phone Numbers:** https://console.twilio.com/us1/develop/phone-numbers/manage/incoming
- **Call Logs:** https://console.twilio.com/us1/monitor/logs/calls
- **Message Logs:** https://console.twilio.com/us1/monitor/logs/messages
- **Debugger:** https://console.twilio.com/us1/monitor/logs/debugger
- **Usage:** https://console.twilio.com/us1/monitor/usage

### Check Service Status

```bash
# Twilio Status Page
open https://status.twilio.com
```

---

## Cost Tracking

### Current Rates (Canada)

- **Phone Number:** $1.00/month
- **Voice (outbound):** $0.013/minute
- **Voice (inbound):** $0.0085/minute
- **SMS (outbound):** $0.0075/message
- **SMS (inbound):** $0.0075/message

### View Usage

```bash
# Navigate to: Console → Monitor → Usage
# Filter by date range and service type
```

### Set Billing Alerts

```bash
# Navigate to: Console → Billing → Alerts
# Configure alerts at $50, $100, $200
```

---

## Troubleshooting

### Check Twilio Debugger

```bash
# Navigate to: Console → Monitor → Logs → Debugger
# Shows errors and warnings for recent API calls
```

### Validate Phone Number Format

```bash
# Phone numbers must be in E.164 format
# Correct: +12345678900
# Incorrect: (234) 567-8900, 234-567-8900
```

### Test Webhook Locally (ngrok)

```bash
# Install ngrok
brew install ngrok

# Start local backend
pnpm run dev

# Expose local server
ngrok http 3000

# Update Twilio webhook URL to ngrok URL
# Example: https://abc123.ngrok.io/v1/twilio/voice
```

---

## Rate Limiting Configuration

### SMS Rate Limiter Fail-Open Behavior

The SMS service uses Redis-backed rate limiting (100 SMS per hour per user). When Redis is unavailable, you can configure whether to block or allow SMS:

#### Fail-Closed (Default - Recommended for Production)

```bash
# .env or environment variable
SMS_RATE_LIMITER_FAIL_OPEN=false
```

**Behavior:** Blocks all SMS when Redis is unavailable
**Priority:** Security and rate limit enforcement
**Use case:** Standard SMS operations (family portal notifications, routine alerts)
**Risk:** Service unavailability during Redis outages

#### Fail-Open (For Critical Alerts)

```bash
# .env or environment variable
SMS_RATE_LIMITER_FAIL_OPEN=true
```

**Behavior:** Allows SMS to proceed when Redis is unavailable (logs warning)
**Priority:** Availability and message delivery
**Use case:** Critical emergency alerts, care coordinator notifications
**Risk:** Potential rate limit bypass during Redis outages

### Production Recommendations

#### Standard Production Environment

```bash
# Prioritize security and rate limiting
SMS_RATE_LIMITER_FAIL_OPEN=false
```

#### Critical Alert Service (Separate Instance)

```bash
# Prioritize availability for emergency notifications
SMS_RATE_LIMITER_FAIL_OPEN=true
```

#### Programmatic Override

For services that need both behaviors, override at the service level:

```typescript
// Standard SMS service (fail-closed)
const standardSMSService = new TwilioSMSService({
  // Credentials + webhook base URL will fall back to env/Secrets Manager
  rateLimiter: { failOpen: false }, // enforce rate limits
});

// Critical alert SMS service (fail-open)
const criticalAlertSMSService = new TwilioSMSService({
  rateLimiter: { failOpen: true }, // prioritize delivery
});
```

### Monitoring Rate Limiter Behavior

When Redis fails and fail-open is enabled, the service logs:

```json
WARN: Redis rate limit check failed
{
  "key": "sms:ratelimit:user123",
  "failOpen": true,
  "rateLimitUnavailable": true
}
```

Monitor these logs to detect Redis issues and potential rate limit bypasses.

---

## Security

### Rotate Auth Token

```bash
# Navigate to: Console → Account → API keys & tokens
# Click "View" next to Auth Token
# Click "Rotate" to generate new token
# Update AWS Secrets Manager with new token
```

### Validate Webhook Signatures

```typescript
// In your webhook handler
import twilio from 'twilio';
import { Request, Response } from 'express';

// Ensure Express is configured with: app.use(express.urlencoded({ extended: false }));
const { validateRequest } = twilio;

app.post('/v1/twilio/voice', (req: Request, res: Response) => {
  const signature = req.headers['x-twilio-signature'] as string;
  const url = `https://${req.headers.host}${req.url}`;

  const isValid = validateRequest(process.env.TWILIO_AUTH_TOKEN!, signature, url, req.body);

  if (!isValid) {
    return res.status(403).send('Invalid signature');
  }

  // Process webhook...
});
```

---

## Support

- **Documentation:** https://www.twilio.com/docs
- **Support:** https://support.twilio.com
- **Community:** https://www.twilio.com/community
- **Status:** https://status.twilio.com

---

## Related Documentation

- [E7: Twilio Setup Guide](./E7-twilio-setup.md) - Complete setup instructions
- [Architecture Blueprint](../project-documentation/architecture-output.md) - Communication services design
- [Task Plan](../project-documentation/task-plan.md) - Twilio integration tasks (T1-T7)
