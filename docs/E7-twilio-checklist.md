# E7: Twilio Setup Checklist

Quick checklist for completing Twilio account configuration.

---

## Pre-Setup

- [ ] Business email address ready
- [ ] Business phone number for verification
- [ ] Credit card for account setup
- [ ] AWS CLI configured with ca-central-1 region
- [ ] AWS Secrets Manager access verified

---

## Twilio Account Setup

- [ ] Twilio account created at https://www.twilio.com/try-twilio
- [ ] Email verified
- [ ] Phone verified
- [ ] Account upgraded to paid (removed trial limitations)
- [ ] Billing alerts configured ($50, $100, $200)
- [ ] Programmable Voice enabled
- [ ] Programmable SMS enabled

---

## Subaccounts

### Staging Subaccount

- [ ] Subaccount created with name "BerthCare Staging"
- [ ] Account SID recorded: `AC________________`
- [ ] Auth Token recorded (keep secure)
- [ ] Subaccount status: Active

### Production Subaccount

- [ ] Subaccount created with name "BerthCare Production"
- [ ] Account SID recorded: `AC________________`
- [ ] Auth Token recorded (keep secure)
- [ ] Subaccount status: Active

---

## Phone Numbers

### Staging Phone Number

- [ ] Canadian phone number purchased
- [ ] Number: `+1________________`
- [ ] Capabilities: Voice + SMS
- [ ] Friendly name: "BerthCare Staging"
- [ ] Transferred to staging subaccount
- [ ] Voice webhook configured: `https://api-staging.berthcare.ca/v1/twilio/voice`
- [ ] Voice status webhook configured: `https://api-staging.berthcare.ca/v1/twilio/voice/status`
- [ ] SMS webhook configured: `https://api-staging.berthcare.ca/v1/twilio/sms`
- [ ] SMS status webhook configured: `https://api-staging.berthcare.ca/v1/twilio/sms/status`

### Production Phone Number

- [ ] Canadian phone number purchased
- [ ] Number: `+1________________`
- [ ] Capabilities: Voice + SMS
- [ ] Friendly name: "BerthCare Production"
- [ ] Transferred to production subaccount
- [ ] Voice webhook configured: `https://api.berthcare.ca/v1/twilio/voice`
- [ ] Voice status webhook configured: `https://api.berthcare.ca/v1/twilio/voice/status`
- [ ] SMS webhook configured: `https://api.berthcare.ca/v1/twilio/sms`
- [ ] SMS status webhook configured: `https://api.berthcare.ca/v1/twilio/sms/status`

---

## AWS Secrets Manager

### Staging Credentials

- [ ] Secret created: `berthcare/staging/twilio`
- [ ] Account SID stored
- [ ] Auth Token stored
- [ ] Phone number stored
- [ ] Voice URL stored
- [ ] SMS URL stored
- [ ] Tags applied (Environment=staging, Service=twilio)
- [ ] Secret verified (can retrieve successfully)

### Production Credentials

- [ ] Secret created: `berthcare/production/twilio`
- [ ] Account SID stored
- [ ] Auth Token stored
- [ ] Phone number stored
- [ ] Voice URL stored
- [ ] SMS URL stored
- [ ] Tags applied (Environment=production, Service=twilio)
- [ ] Secret verified (can retrieve successfully)

---

## IAM Permissions

- [ ] ECS task role updated with Secrets Manager read permissions
- [ ] Policy allows `secretsmanager:GetSecretValue`
- [ ] Policy allows `secretsmanager:DescribeSecret`
- [ ] Resource ARNs include both staging and production secrets

---

## Security Configuration

- [ ] Geo permissions configured (Canada + US only)
- [ ] Rate limits configured (100 calls/hour, 200 SMS/hour)
- [ ] Call recording disabled (privacy)
- [ ] IP whitelisting considered (optional)

---

## Testing

### Staging Environment

- [ ] Test outbound voice call successful
- [ ] Test outbound SMS successful
- [ ] Test inbound voice webhook (after backend deployment)
- [ ] Test inbound SMS webhook (after backend deployment)
- [ ] Test voice call status callback
- [ ] Test SMS delivery status callback

### Production Environment

- [ ] Test outbound voice call successful
- [ ] Test outbound SMS successful
- [ ] Test inbound voice webhook (after backend deployment)
- [ ] Test inbound SMS webhook (after backend deployment)
- [ ] Test voice call status callback
- [ ] Test SMS delivery status callback

---

## Local Development

- [ ] `.env` file updated with staging credentials
- [ ] `TWILIO_ACCOUNT_SID` set
- [ ] `TWILIO_AUTH_TOKEN` set
- [ ] `TWILIO_PHONE_NUMBER` set
- [ ] `TWILIO_VOICE_URL` set (localhost)
- [ ] `TWILIO_SMS_URL` set (localhost)
- [ ] Credentials tested with Twilio CLI or Node.js script

---

## Documentation

- [ ] Phone numbers documented in `docs/twilio-quick-reference.md`
- [ ] Subaccount SIDs documented
- [ ] Webhook URLs documented
- [ ] Secret ARNs documented
- [ ] Architecture diagrams updated (if needed)

---

## Monitoring

- [ ] Twilio Console bookmarked
- [ ] Call logs accessible
- [ ] Message logs accessible
- [ ] Debugger accessible
- [ ] Usage dashboard accessible
- [ ] Billing alerts verified

---

## Next Steps

After completing this checklist:

1. **Backend Integration (Task T2):**
   - [ ] Implement Twilio Voice client
   - [ ] Implement Twilio SMS client
   - [ ] Add webhook handlers

2. **Voice Alert Feature (Task T3):**
   - [ ] Implement POST /v1/alerts/voice endpoint
   - [ ] Test caregiver → coordinator voice alert flow
   - [ ] Verify voice message playback

3. **Family SMS Portal (Task T6):**
   - [ ] Implement daily 6 PM SMS messages
   - [ ] Implement reply keyword processing
   - [ ] Test family member experience

4. **Update Documentation (Task E8):**
   - [ ] Update architecture docs with Twilio configuration
   - [ ] Document phone numbers and webhook URLs
   - [ ] Update architecture diagrams

---

## Troubleshooting Resources

- **Twilio Console:** https://console.twilio.com
- **Twilio Debugger:** https://console.twilio.com/us1/monitor/logs/debugger
- **Twilio Status:** https://status.twilio.com
- **Documentation:** [E7: Twilio Setup](./E7-twilio-setup.md)
- **Quick Reference:** [Twilio Quick Reference](./twilio-quick-reference.md)

---

## Sign-Off

**Completed By:** ____________  
**Date:** ____________  
**Verified By:** ____________  
**Date:** ____________

---

**Status:** ⬜ Not Started | 🟡 In Progress | ✅ Complete
