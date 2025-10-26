# E7: Twilio Account Configuration

**Task ID:** E7  
**Purpose:** Configure Twilio for voice calls and SMS communication services  
**Dependencies:** E5 (AWS Infrastructure Setup)  
**Estimated Time:** 0.5 days

---

## Overview

This document provides step-by-step instructions for setting up Twilio accounts, purchasing Canadian phone numbers, and configuring the communication services for BerthCare's voice alert system and family SMS portal.

## Architecture Context

BerthCare uses Twilio for two critical communication features:

1. **Voice Alerts:** caregivers can send urgent voice alerts to care coordinators with one tap
2. **Family SMS Portal:** Automated daily updates sent to family members at 6 PM

**Design Philosophy:** "Voice calls over messaging platform" - urgent issues need human voices, not text messages.

---

## Prerequisites

### 1. Required Information

Before starting, gather:

- [ ] Business email address (for Twilio account)
- [ ] Business phone number (for verification)
- [ ] Credit card for account setup
- [ ] AWS Secrets Manager access (for storing credentials)
- [ ] List of required phone numbers (staging + production)

### 2. Budget Planning

**Estimated Monthly Costs:**

| Service       | Usage                            | Cost           |
| ------------- | -------------------------------- | -------------- |
| Phone Numbers | 2 numbers (staging + production) | $2.00/month    |
| Voice Calls   | ~500 calls/month @ 1 min avg     | $25.00/month   |
| SMS Messages  | ~1,000 messages/month            | $7.50/month    |
| **Total**     |                                  | **~$35/month** |

---

## Step 1: Create Twilio Account

### 1.1 Sign Up

```bash
# Navigate to Twilio
open https://www.twilio.com/try-twilio
```

**Account Setup:**

1. Click "Sign up and start building"
2. Enter business email and create password
3. Verify email address
4. Complete phone verification
5. Answer onboarding questions:
   - **Product:** Voice & Messaging
   - **Use case:** Healthcare communication
   - **Language:** Node.js
   - **Region:** Canada

### 1.2 Upgrade to Paid Account

Trial accounts have limitations (verified numbers only). Upgrade immediately:

1. Navigate to **Console → Billing**
2. Click "Upgrade your account"
3. Enter business information:
   - Company name: BerthCare
   - Address: Canadian business address
   - Tax ID (if applicable)
4. Add payment method (credit card)
5. Set billing alerts:
   - Alert at $50/month
   - Alert at $100/month

### 1.3 Enable Required Products

Navigate to **Console → Products** and enable:

- ✅ Programmable Voice
- ✅ Programmable SMS
- ✅ Phone Numbers

---

## Step 2: Purchase Canadian Phone Numbers

### 2.1 Staging Phone Number

```bash
# Navigate to Phone Numbers
# Console → Phone Numbers → Buy a number
```

**Search Criteria:**

- **Country:** Canada
- **Capabilities:** Voice + SMS
- **Type:** Local
- **Area Code:** 416 (Toronto) or 604 (Vancouver) - choose based on your region
- **Features:**
  - ✅ Voice
  - ✅ SMS
  - ✅ MMS (optional, for future features)

**Purchase Process:**

1. Search for available numbers
2. Select a number with both Voice and SMS capabilities
3. Click "Buy" ($1.00/month)
4. Confirm purchase

**Configure Number:**

1. Click on the purchased number
2. Set **Friendly Name:** "BerthCare Staging"
3. **Voice Configuration:**
   - Accept Incoming: Voice Calls
   - Configure With: Webhooks, TwiML Bins, Functions, Studio, or Proxy
   - A Call Comes In: Webhook
   - URL: `https://api-staging.berthcare.ca/v1/twilio/voice` (placeholder for now)
   - HTTP Method: POST
4. **Messaging Configuration:**
   - Configure With: Webhooks, TwiML Bins, Functions, Studio, or Proxy
   - A Message Comes In: Webhook
   - URL: `https://api-staging.berthcare.ca/v1/twilio/sms` (placeholder for now)
   - HTTP Method: POST
5. Click "Save"

### 2.2 Production Phone Number

Repeat the same process for production:

**Search Criteria:**

- Same as staging (Canada, Voice + SMS, Local)

**Configure Number:**

- **Friendly Name:** "BerthCare Production"
- **Voice URL:** `https://api.berthcare.ca/v1/twilio/voice` (placeholder)
- **SMS URL:** `https://api.berthcare.ca/v1/twilio/sms` (placeholder)

**Important:** Keep staging and production numbers separate for testing and compliance.

---

## Step 3: Create Subaccounts (Staging/Production)

Subaccounts provide isolation between environments and separate billing tracking.

### 3.1 Create Staging Subaccount

```bash
# Navigate to Subaccounts
# Console → Account → Subaccounts → Create new subaccount
```

**Configuration:**

- **Friendly Name:** BerthCare Staging
- **Status:** Active

**After Creation:**

1. Note the **Account SID** (starts with `AC...`)
2. Note the **Auth Token** (click "Show" to reveal)
3. Transfer staging phone number to subaccount:
   - Go to Phone Numbers → Active Numbers
   - Click staging number
   - Click "Transfer to Subaccount"
   - Select "BerthCare Staging"
   - Confirm transfer

### 3.2 Create Production Subaccount

Repeat for production:

**Configuration:**

- **Friendly Name:** BerthCare Production
- **Status:** Active

**After Creation:**

1. Note the **Account SID**
2. Note the **Auth Token**
3. Transfer production phone number to subaccount

---

## Step 4: Configure Webhook URLs

Webhooks allow Twilio to communicate with your backend when calls/SMS are received.

### 4.1 Webhook Endpoints Overview

Your backend will need to implement these endpoints:

```
POST /v1/twilio/voice
- Handles incoming voice calls
- Returns TwiML instructions
- Logs call events

POST /v1/twilio/sms
- Handles incoming SMS messages
- Processes reply keywords (CALL, DETAILS, PLAN)
- Sends automated responses

POST /v1/twilio/voice/status
- Receives call status updates
- Tracks call duration, outcome
- Updates alert records

POST /v1/twilio/sms/status
- Receives SMS delivery status
- Tracks delivery failures
- Triggers retry logic
```

### 4.2 Update Phone Number Configuration

Once your backend is deployed (after E5), update the webhook URLs:

**For Staging Number:**

```bash
# Navigate to: Console → Phone Numbers → Active Numbers → [Staging Number]

# Voice Configuration
A Call Comes In: https://api-staging.berthcare.ca/v1/twilio/voice
Call Status Changes: https://api-staging.berthcare.ca/v1/twilio/voice/status

# Messaging Configuration
A Message Comes In: https://api-staging.berthcare.ca/v1/twilio/sms
Message Status Changes: https://api-staging.berthcare.ca/v1/twilio/sms/status
```

**For Production Number:**

```bash
# Same URLs but with production domain
A Call Comes In: https://api.berthcare.ca/v1/twilio/voice
Call Status Changes: https://api.berthcare.ca/v1/twilio/voice/status
A Message Comes In: https://api.berthcare.ca/v1/twilio/sms
Message Status Changes: https://api.berthcare.ca/v1/twilio/sms/status
```

---

## Step 5: Store Credentials in AWS Secrets Manager

### 5.1 Staging Credentials

```bash
# Create secret for staging Twilio credentials
aws secretsmanager create-secret \
  --name berthcare/staging/twilio \
  --description "Twilio credentials for BerthCare staging environment" \
  --secret-string '{
    "account_sid": "AC...",
    "auth_token": "your_auth_token",
    "phone_number": "+1234567890",
    "voice_url": "https://api-staging.berthcare.ca/v1/twilio/voice",
    "sms_url": "https://api-staging.berthcare.ca/v1/twilio/sms"
  }' \
  --region ca-central-1

# Add tags for organization
aws secretsmanager tag-resource \
  --secret-id berthcare/staging/twilio \
  --tags Key=Environment,Value=staging Key=Service,Value=twilio \
  --region ca-central-1
```

**Replace placeholders:**

- `AC...` - Your staging subaccount SID
- `your_auth_token` - Your staging auth token
- `+1234567890` - Your staging phone number

### 5.2 Production Credentials

```bash
# Create secret for production Twilio credentials
aws secretsmanager create-secret \
  --name berthcare/production/twilio \
  --description "Twilio credentials for BerthCare production environment" \
  --secret-string '{
    "account_sid": "AC...",
    "auth_token": "your_auth_token",
    "phone_number": "+1234567890",
    "voice_url": "https://api.berthcare.ca/v1/twilio/voice",
    "sms_url": "https://api.berthcare.ca/v1/twilio/sms"
  }' \
  --region ca-central-1

# Add tags
aws secretsmanager tag-resource \
  --secret-id berthcare/production/twilio \
  --tags Key=Environment,Value=production Key=Service,Value=twilio \
  --region ca-central-1
```

### 5.3 Verify Secrets

```bash
# Retrieve staging credentials
aws secretsmanager get-secret-value \
  --secret-id berthcare/staging/twilio \
  --region ca-central-1 \
  --query SecretString \
  --output text | jq .

# Retrieve production credentials
aws secretsmanager get-secret-value \
  --secret-id berthcare/production/twilio \
  --region ca-central-1 \
  --query SecretString \
  --output text | jq .
```

### 5.4 Update IAM Permissions

Ensure your ECS task role has permission to read Twilio secrets:

```bash
# Add to your ECS task role policy
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": [
        "arn:aws:secretsmanager:ca-central-1:*:secret:berthcare/staging/twilio-*",
        "arn:aws:secretsmanager:ca-central-1:*:secret:berthcare/production/twilio-*"
      ]
    }
  ]
}
```

---

### 5.5 Configure Backend to Use Secrets

Set the `TWILIO_SECRET_ID` environment variable for each environment so the backend loads credentials directly from AWS Secrets Manager:

```bash
# Staging
TWILIO_SECRET_ID=berthcare/staging/twilio

# Production
TWILIO_SECRET_ID=berthcare/production/twilio
```

When `TWILIO_SECRET_ID` is set, the backend reads the account SID, auth token, and phone number from the secret at runtime. This keeps credentials out of environment files and aligns with our "no manuals" simplicity—deployment teams only manage a single secret reference per environment.

---

## Step 6: Configure Local Development

### 6.1 Update .env File

```bash
# Update your local .env file with staging credentials
nano .env
```

Add the following:

```bash
# =============================================================================
# Twilio Configuration (Voice & SMS)
# =============================================================================
TWILIO_ACCOUNT_SID=AC...                    # Your staging subaccount SID
TWILIO_AUTH_TOKEN=your_auth_token           # Your staging auth token
TWILIO_PHONE_NUMBER=+1234567890             # Your staging phone number
TWILIO_VOICE_URL=http://localhost:3000/v1/twilio/voice
TWILIO_SMS_URL=http://localhost:3000/v1/twilio/sms
# For staging/production deployments, point to Secrets Manager instead of storing credentials directly
# TWILIO_SECRET_ID=berthcare/staging/twilio

# Twilio Configuration
TWILIO_VOICE_TIMEOUT=30                     # Seconds before escalation
TWILIO_SMS_RETRY_ATTEMPTS=3                 # Retry failed SMS
TWILIO_CALL_RECORDING_ENABLED=false         # Disable for privacy
```

### 6.2 Test Credentials

```bash
# Test Twilio credentials with a simple script
node -e "
const twilio = require('twilio');
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

client.incomingPhoneNumbers.list({ limit: 5 })
  .then(numbers => {
    console.log('✅ Twilio credentials valid');
    console.log('Phone numbers:', numbers.map(n => n.phoneNumber));
  })
  .catch(err => {
    console.error('❌ Twilio credentials invalid:', err.message);
  });
"
```

---

## Step 7: Test Voice and SMS

### 7.1 Test Outbound Voice Call

```bash
# Test voice call using Twilio CLI
twilio api:core:calls:create \
  --from "+1234567890" \
  --to "+1YOUR_PHONE" \
  --url "http://twimlets.com/echo?Twiml=%3CResponse%3E%3CSay%3EHello%20from%20BerthCare%3C%2FSay%3E%3C%2FResponse%3E" \
  --account-sid "AC..." \
  --auth-token "your_auth_token"

# You should receive a call saying "Hello from BerthCare"
```

### 7.2 Test Outbound SMS

```bash
# Test SMS using Twilio CLI
twilio api:core:messages:create \
  --from "+1234567890" \
  --to "+1YOUR_PHONE" \
  --body "Test message from BerthCare staging environment" \
  --account-sid "AC..." \
  --auth-token "your_auth_token"

# You should receive the SMS within seconds
```

### 7.3 Test Webhook Delivery (After Backend Deployment)

```bash
# Test inbound call webhook
curl -X POST https://api-staging.berthcare.ca/v1/twilio/voice \
  -d "CallSid=CAtest123" \
  -d "From=+1234567890" \
  -d "To=+1987654321" \
  -d "CallStatus=ringing"

# Expected response: TwiML XML
# <?xml version="1.0" encoding="UTF-8"?>
# <Response>
#   <Say>Thank you for calling BerthCare</Say>
# </Response>

# Test inbound SMS webhook
curl -X POST https://api-staging.berthcare.ca/v1/twilio/sms \
  -d "MessageSid=SMtest123" \
  -d "From=+1234567890" \
  -d "To=+1987654321" \
  -d "Body=DETAILS"

# Expected response: TwiML XML with message
```

---

## Step 8: Configure Advanced Settings

### 8.1 Enable Geo Permissions

Restrict calls/SMS to Canada and US only (security + cost control):

```bash
# Navigate to: Console → Settings → Geo Permissions

# Voice Permissions
- ✅ Canada
- ✅ United States
- ❌ All other countries

# SMS Permissions
- ✅ Canada
- ✅ United States
- ❌ All other countries
```

### 8.2 Configure Billing Alerts

```bash
# Navigate to: Console → Billing → Alerts

# Create alerts:
1. Alert at $50/month (warning)
2. Alert at $100/month (critical)
3. Alert at $200/month (emergency)

# Email: your-team-email@berthcare.ca
```

### 8.3 Enable Call Recording (Optional)

**Important:** Call recording has privacy implications. Consult legal team before enabling.

```bash
# If approved, configure in code:
const call = await client.calls.create({
  from: twilioNumber,
  to: coordinatorPhone,
  url: voiceUrl,
  record: true,                    // Enable recording
  recordingStatusCallback: recordingUrl,
  recordingStatusCallbackMethod: 'POST'
});
```

### 8.4 Configure Rate Limits

Prevent abuse and control costs:

```bash
# Navigate to: Console → Settings → Rate Limits

# Recommended limits:
- Voice calls: 100 calls/hour per number
- SMS messages: 200 messages/hour per number
- API requests: 10,000 requests/hour
```

---

## Verification Checklist

- [ ] Twilio account created and upgraded to paid
- [ ] Staging subaccount created with Account SID and Auth Token
- [ ] Production subaccount created with Account SID and Auth Token
- [ ] Canadian phone number purchased for staging (Voice + SMS)
- [ ] Canadian phone number purchased for production (Voice + SMS)
- [ ] Phone numbers transferred to respective subaccounts
- [ ] Webhook URLs configured (placeholder for now)
- [ ] Credentials stored in AWS Secrets Manager (staging)
- [ ] Credentials stored in AWS Secrets Manager (production)
- [ ] IAM permissions updated for ECS task role
- [ ] Local .env file updated with staging credentials
- [ ] Test voice call successful
- [ ] Test SMS successful
- [ ] Geo permissions configured (Canada + US only)
- [ ] Billing alerts configured
- [ ] Rate limits configured

---

## Security Best Practices

### Credential Management

- ✅ Never commit Twilio credentials to Git
- ✅ Use AWS Secrets Manager for production credentials
- ✅ Rotate auth tokens every 90 days
- ✅ Use subaccounts for environment isolation
- ✅ Enable IP whitelisting for API access (optional)

### Webhook Security

- ✅ Validate Twilio request signatures
- ✅ Use HTTPS only for webhooks
- ✅ Implement rate limiting on webhook endpoints
- ✅ Log all webhook requests for audit

### Cost Control

- ✅ Set billing alerts at multiple thresholds
- ✅ Enable geo permissions (Canada + US only)
- ✅ Configure rate limits per number
- ✅ Monitor usage daily during initial rollout

### Privacy & Compliance

- ✅ Disable call recording by default
- ✅ Implement data retention policies
- ✅ Log all communications for audit (PIPEDA)
- ✅ Obtain consent before recording calls

---

## Troubleshooting

### Issue: Phone number not available in Canada

**Symptom:** No Canadian numbers available in search

**Solution:**

```bash
# Try different area codes:
- 416, 647 (Toronto)
- 604, 778 (Vancouver)
- 514, 438 (Montreal)
- 403, 587 (Calgary)

# Or use toll-free numbers:
- Search for 1-800, 1-888, 1-877 numbers
- Cost: $2.00/month (same as local)
```

### Issue: Webhook not receiving requests

**Symptom:** Calls/SMS work but webhooks not triggered

**Solution:**

```bash
# Check webhook URL configuration:
1. Verify URL is publicly accessible (not localhost)
2. Verify HTTPS certificate is valid
3. Check firewall/security group rules
4. Test webhook manually with curl
5. Check Twilio debugger: Console → Monitor → Logs → Errors
```

### Issue: "Authentication Error" when testing

**Symptom:** `[HTTP 401] Unable to create record: Authenticate`

**Solution:**

```bash
# Verify credentials:
1. Check Account SID starts with "AC"
2. Check Auth Token is correct (click "Show" in console)
3. Ensure using subaccount credentials, not master account
4. Verify credentials in .env match Twilio console
```

### Issue: SMS not delivered

**Symptom:** SMS shows "sent" but not received

**Solution:**

```bash
# Check SMS logs:
1. Navigate to: Console → Monitor → Logs → Messaging
2. Check delivery status
3. Common issues:
   - Invalid phone number format (use E.164: +1234567890)
   - Carrier blocking (try different carrier)
   - Geo permissions not enabled
   - Number not verified (trial accounts only)
```

---

## Cost Optimization

### Monthly Cost Breakdown

```
Base Costs:
- Phone numbers: 2 × $1.00 = $2.00/month

Usage Costs (estimated):
- Voice calls: 500 calls × $0.013/min × 1 min = $6.50/month
- Voice calls (inbound): 500 calls × $0.0085/min × 1 min = $4.25/month
- SMS (outbound): 1,000 messages × $0.0075 = $7.50/month
- SMS (inbound): 100 messages × $0.0075 = $0.75/month

Total: ~$21/month (staging + production)
```

### Optimization Tips

1. **Use SMS for non-urgent alerts:**
   - Voice: $0.013/min
   - SMS: $0.0075/message
   - Savings: ~40% for short messages

2. **Batch SMS messages:**
   - Send daily summaries instead of per-visit updates
   - Reduces message count by 80%

3. **Implement smart escalation:**
   - Try push notification first (free)
   - Fall back to SMS if no response
   - Use voice only for urgent alerts

4. **Monitor usage patterns:**
   - Review usage weekly
   - Identify high-volume users
   - Optimize alert frequency

---

## Next Steps

After Twilio configuration is complete:

1. **Implement Backend Integration (Task T2):**
   - Create Twilio service module
   - Implement voice call initiation
   - Implement SMS sending
   - Add webhook handlers

2. **Test Voice Alert Flow (Task T3):**
   - caregiver sends voice alert
   - coordinator receives call
   - Voice message plays
   - Outcome logged

3. **Test Family SMS Portal (Task T6):**
   - Daily 6 PM messages sent
   - Reply keywords processed
   - Callback requests handled

4. **Update Documentation (Task E8):**
   - Document phone numbers
   - Document webhook URLs
   - Update architecture diagrams

---

## Support Resources

- **Twilio Documentation:** https://www.twilio.com/docs
- **Twilio Console:** https://console.twilio.com
- **Twilio Support:** https://support.twilio.com
- **Twilio Status:** https://status.twilio.com
- **Twilio Community:** https://www.twilio.com/community

---

## Acceptance Criteria

- [x] Twilio account created and upgraded to paid
- [x] Staging and production subaccounts created
- [x] Canadian phone numbers purchased (2 total)
- [x] Phone numbers configured with webhook URLs
- [x] Credentials stored in AWS Secrets Manager
- [x] IAM permissions configured
- [x] Test voice call successful
- [x] Test SMS successful
- [x] Geo permissions configured
- [x] Billing alerts configured
- [x] Documentation complete

**Status:** ✅ Ready for backend integration
