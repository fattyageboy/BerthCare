# Google Maps API Setup Guide

**Purpose:** Configure Google Maps Geocoding API for BerthCare client address geocoding  
**Date:** October 10, 2025  
**Required For:** Task C5 - POST /v1/clients endpoint

## Overview

The BerthCare backend uses Google Maps Geocoding API to convert client addresses to geographic coordinates (latitude/longitude) for zone assignment and route optimization.

## Prerequisites

- Google Cloud account
- Credit card (required for API access, but free tier available)
- Admin access to BerthCare backend environment variables

## Setup Steps

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Enter project name: `BerthCare` (or your preferred name)
4. Select organization (if applicable)
5. Click "Create"

### 2. Enable Geocoding API

1. In Google Cloud Console, go to "APIs & Services" → "Library"
2. Search for "Geocoding API"
3. Click on "Geocoding API"
4. Click "Enable"
5. Wait for API to be enabled (~30 seconds)

### 3. Create API Key

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "API Key"
3. Copy the API key (you'll need this for `.env` file)
4. Click "Restrict Key" (recommended for security)

### 4. Restrict API Key (Recommended)

**Application Restrictions:**

1. Select "IP addresses"
2. Add your server IP addresses:
   - Development: `127.0.0.1` (localhost)
   - Staging: Your staging server IP
   - Production: Your production server IPs
3. Click "Done"

**API Restrictions:**

1. Select "Restrict key"
2. Select "Geocoding API" from the dropdown
3. Click "Save"

**Why restrict?**

- Prevents unauthorized use of your API key
- Reduces risk of quota abuse
- Limits potential costs if key is compromised

### 5. Configure Environment Variables

**Development (.env):**

```bash
GOOGLE_MAPS_API_KEY=AIzaSyD...your_actual_key_here
GOOGLE_MAPS_GEOCODING_CACHE_TTL=86400
```

**Staging/Production:**

- Store API key in AWS Secrets Manager
- Reference secret in environment configuration
- Never commit API keys to version control

### 6. Verify Setup

**Test geocoding service:**

```bash
# Start backend server
npm run dev

# Test endpoint (requires admin token)
curl -X POST http://localhost:3000/v1/clients \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Test",
    "lastName": "User",
    "dateOfBirth": "1950-01-01",
    "address": "100 Queen St W, Toronto, ON M5H 2N2",
    "emergencyContactName": "Emergency Contact",
    "emergencyContactPhone": "416-555-0100",
    "emergencyContactRelationship": "Family"
  }'
```

**Expected response:**

- Status: 201 Created
- Response includes `latitude` and `longitude` fields
- Address is formatted by Google Maps

**If geocoding fails:**

- Check API key is correct in `.env`
- Verify Geocoding API is enabled
- Check API key restrictions
- Review server logs for error details

## Pricing & Quotas

### Free Tier

Google Maps provides a generous free tier:

- **$200 USD credit per month**
- **40,000 geocoding requests per month** (at $5 per 1,000 requests)
- Credit resets monthly

### Cost Calculation

**Geocoding API Pricing:**

- $5.00 per 1,000 requests
- First $200 USD free each month

**Example Usage:**

- 100 clients created per month = 100 requests
- Cost: $0.50 (covered by free tier)

**With Caching:**

- Duplicate addresses use cache (no API call)
- 24 hour cache TTL reduces API calls by ~80%
- Effective cost: ~$0.10 per month for typical usage

### Monitoring Usage

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Go to "APIs & Services" → "Dashboard"
4. Click "Geocoding API"
5. View usage metrics and quotas

**Set up billing alerts:**

1. Go to "Billing" → "Budgets & alerts"
2. Create budget: $10 USD per month
3. Set alert at 50%, 90%, 100%
4. Add email notification

## Security Best Practices

### API Key Protection

**DO:**

- ✅ Store API key in environment variables
- ✅ Use AWS Secrets Manager for production
- ✅ Restrict API key to specific IPs
- ✅ Restrict API key to Geocoding API only
- ✅ Rotate API keys periodically (every 90 days)
- ✅ Monitor API usage for anomalies

**DON'T:**

- ❌ Commit API keys to version control
- ❌ Share API keys in Slack/email
- ❌ Use same API key for multiple environments
- ❌ Leave API keys unrestricted
- ❌ Expose API keys in client-side code

### Key Rotation

**When to rotate:**

- Every 90 days (recommended)
- If key is compromised
- When team member leaves
- After security incident

**How to rotate:**

1. Create new API key in Google Cloud Console
2. Update environment variables with new key
3. Deploy updated configuration
4. Verify new key works
5. Delete old API key
6. Update documentation

## Troubleshooting

### Common Errors

**Error: `CONFIGURATION_ERROR`**

- **Cause:** API key not set in environment variables
- **Solution:** Add `GOOGLE_MAPS_API_KEY` to `.env` file

**Error: `REQUEST_DENIED`**

- **Cause:** API key restrictions or Geocoding API not enabled
- **Solution:**
  - Verify Geocoding API is enabled
  - Check API key restrictions (IP addresses, API restrictions)
  - Ensure billing is enabled on Google Cloud project

**Error: `OVER_QUERY_LIMIT`**

- **Cause:** Exceeded free tier quota (40,000 requests/month)
- **Solution:**
  - Wait for monthly quota reset
  - Enable billing to increase quota
  - Increase cache TTL to reduce API calls

**Error: `INVALID_REQUEST`**

- **Cause:** Invalid address format
- **Solution:** Provide full street address with city and postal code

**Error: `ZERO_RESULTS`**

- **Cause:** Address not found by Google Maps
- **Solution:** Verify address is correct and complete

### Debugging

**Enable debug logging:**

```bash
# In .env
LOG_LEVEL=debug
```

**Check logs:**

```bash
# View backend logs
docker-compose logs -f backend

# Look for geocoding errors
grep "Geocoding" logs/backend.log
```

**Test geocoding directly:**

```bash
# Test Google Maps API directly
curl "https://maps.googleapis.com/maps/api/geocode/json?address=100+Queen+St+W,+Toronto,+ON&key=YOUR_API_KEY"
```

## Alternative: Mock Geocoding (Development)

For development without Google Maps API, you can mock the geocoding service:

**Create mock service:**

```typescript
// apps/backend/src/services/geocoding.service.mock.ts
export class MockGeocodingService {
  async geocodeAddress(address: string) {
    // Return mock coordinates for Toronto
    return {
      latitude: 43.6532,
      longitude: -79.3832,
      formattedAddress: address,
      placeId: 'mock-place-id',
    };
  }
}
```

**Use mock in development:**

```typescript
// apps/backend/src/routes/clients.routes.ts
const geocodingService =
  process.env.NODE_ENV === 'development'
    ? new MockGeocodingService()
    : new GeocodingService(redisClient);
```

**Limitations:**

- All addresses return same coordinates
- No address validation
- No formatted address
- Not suitable for testing zone assignment

## Production Deployment

### AWS Secrets Manager

Replace the region in the commands below with your AWS region.

**Store API key:**

```bash
aws secretsmanager create-secret \
  --name berthcare/google-maps-api-key \
  --secret-string "AIzaSyD...your_actual_key_here" \
  --region ${AWS_REGION}
```

**Reference in ECS task definition:**

```json
{
  "secrets": [
    {
      "name": "GOOGLE_MAPS_API_KEY",
      "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:ACCOUNT_ID:secret:berthcare/google-maps-api-key"
    }
  ]
}
```

### Monitoring

**CloudWatch Metrics:**

- Geocoding API response time
- Geocoding API error rate
- Cache hit rate
- API quota usage

**Alerts:**

- Geocoding error rate > 5%
- API quota usage > 80%
- Response time > 2 seconds

## Support

### Google Maps API Support

- **Documentation:** https://developers.google.com/maps/documentation/geocoding
- **Support:** https://developers.google.com/maps/support
- **Status:** https://status.cloud.google.com/

### BerthCare Support

- **Documentation:** `docs/C5-create-client-endpoint.md`
- **Implementation:** `apps/backend/src/services/geocoding.service.ts`
- **Tests:** `apps/backend/tests/clients.create.test.ts`

## References

- **Google Maps Geocoding API:** https://developers.google.com/maps/documentation/geocoding
- **Google Cloud Console:** https://console.cloud.google.com/
- **Pricing:** https://developers.google.com/maps/billing-and-pricing/pricing
- **Best Practices:** https://developers.google.com/maps/api-security-best-practices

---

**Setup Complete!** You're now ready to use Google Maps Geocoding API with BerthCare.
