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

# Example output (redacted):
# {
#   "account_sid": "AC********************",
#   "auth_token": "********************************",
#   "phone_number": "+1XXXXXXXXXX",
#   "voice_url": "https://api-staging.berthcare.ca/v1/twilio/voice",
#   "sms_url": "https://api-staging.berthcare.ca/v1/twilio/sms"
# }
```

### Retrieve Production Credentials

```bash
aws secretsmanager get-secret-value \
  --secret-id berthcare/production/twilio \
  --region ca-central-1 \
  --query SecretString \
  --output text | jq .

# Example output (redacted):
# {
#   "account_sid": "AC********************",
#   "auth_token": "********************************",
#   "phone_number": "+1XXXXXXXXXX",
#   "voice_url": "https://api.berthcare.ca/v1/twilio/voice",
#   "sms_url": "https://api.berthcare.ca/v1/twilio/sms"
# }
```

### Update Credentials

```bash
# Run the setup script
./scripts/setup-twilio-secrets.sh
```

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
npm run dev

# Expose local server
ngrok http 3000

# Update Twilio webhook URL to ngrok URL
# Example: https://abc123.ngrok.io/v1/twilio/voice
```

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

Always validate using the exact URL Twilio called. When running behind load balancers or ngrok tunnels, Twilio’s request passes the original protocol/host via proxy headers. Configure Express with `app.set('trust proxy', true)` (in local tests, ngrok already sends `https`), respect `X-Forwarded-Proto`/`X-Forwarded-Host`, and ensure the Host header stays accurate; otherwise signatures will fail.

```javascript
// In your webhook handler
const twilio = require('twilio');

// e.g., placed in your app bootstrap when running behind a proxy / load balancer
app.set('trust proxy', true);

app.post('/v1/twilio/voice', (req, res) => {
  const signature = req.headers['x-twilio-signature'];

  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const originalUrl = `${protocol}://${host}${req.originalUrl}`;

  const isValid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    originalUrl,
    req.body
  );

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
