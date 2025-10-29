# Family Portal Feature - Draft PR

**Issue:** Closes #7

## Overview

The Family Portal enables family members to receive daily updates about their loved ones and interact with the care team through a simple, intuitive SMS interface. This feature embodies our design philosophy: if users need a manual, the design has failed.

## Design Philosophy Applied

**Simplicity First:**
- SMS-based interface - no app download, no login complexity
- Natural conversation flow - families simply reply to messages
- Zero learning curve - works like texting a friend

**User Experience:**
- Start with the family's needs, work backwards to technology
- Daily updates arrive automatically - no action required
- Replies go directly to care coordinators - seamless communication
- Phone calls connect instantly when needed - invisible technology

**Focus & Quality:**
- Three core features done exceptionally well:
  1. Daily status messages
  2. Reply processing
  3. Callback handling
- Every interaction feels natural and effortless
- No unnecessary features or complexity

## Implementation Checklist

### Core Features

#### 1. Daily Messages
- [ ] Database schema for family contacts and preferences
- [ ] Migration: `010_create_family_portal.sql`
- [ ] Scheduled job for daily message generation
- [ ] Message templates (personalized, warm, informative)
- [ ] Twilio SMS delivery integration
- [ ] Delivery status tracking
- [ ] Error handling and retry logic
- [ ] Tests for message generation and delivery

#### 2. Reply Processing
- [ ] Webhook endpoint for incoming SMS
- [ ] Reply parsing and routing logic
- [ ] Store replies in database
- [ ] Notify care coordinators of new replies
- [ ] Handle common reply patterns (questions, concerns, acknowledgments)
- [ ] Rate limiting for webhook endpoint
- [ ] Tests for reply processing

#### 3. Callback Handling
- [ ] Callback request detection in replies
- [ ] Queue callback requests
- [ ] Notify care coordinators
- [ ] Track callback status (pending, completed)
- [ ] Twilio voice call initiation
- [ ] Call status tracking
- [ ] Tests for callback flow

### Supporting Infrastructure

- [ ] Family contact management endpoints
  - [ ] Add family member
  - [ ] Update contact preferences
  - [ ] Remove family member
  - [ ] List family members for client
- [ ] Message history endpoints
  - [ ] View sent messages
  - [ ] View received replies
- [ ] Coordinator dashboard endpoints
  - [ ] Pending replies
  - [ ] Callback queue
- [ ] Authorization middleware (coordinators only)
- [ ] Input validation and sanitization
- [ ] Comprehensive error handling

### Quality & Testing

- [ ] Unit tests for all services
- [ ] Integration tests for API endpoints
- [ ] Webhook endpoint tests
- [ ] Load testing for message delivery
- [ ] Error scenario testing
- [ ] Documentation for API endpoints
- [ ] Code review checklist completed

### Monitoring & Observability

- [ ] CloudWatch metrics for message delivery
- [ ] Alert on delivery failures
- [ ] Track reply response times
- [ ] Monitor callback queue depth
- [ ] Log all family interactions (privacy-compliant)

## Technical Approach

**Database Design:**
- `family_contacts` - family member information and preferences
- `daily_messages` - sent message history
- `family_replies` - incoming message tracking
- `callback_requests` - callback queue and status

**API Endpoints:**
```
POST   /api/family-contacts          - Add family member
GET    /api/family-contacts/:clientId - List family for client
PATCH  /api/family-contacts/:id      - Update preferences
DELETE /api/family-contacts/:id      - Remove family member

GET    /api/family-messages/:clientId - Message history
POST   /api/webhooks/family-sms      - Incoming SMS webhook
GET    /api/coordinator/replies      - Pending replies
GET    /api/coordinator/callbacks    - Callback queue
POST   /api/coordinator/callbacks/:id/complete - Mark callback done
```

**Services:**
- `FamilyMessageService` - Generate and send daily messages
- `ReplyProcessingService` - Parse and route incoming replies
- `CallbackService` - Manage callback requests and voice calls

## Success Criteria

- [ ] Family members receive daily updates automatically
- [ ] Replies reach coordinators within 1 minute
- [ ] Callback requests trigger notifications immediately
- [ ] 99.9% message delivery success rate
- [ ] Zero manual intervention required for normal operation
- [ ] All tests passing
- [ ] CI pipeline green
- [ ] Code review approved

## Notes

This feature makes technology invisible - families simply text and receive updates. The complexity is hidden behind a natural, human interaction. Every detail has been considered to make the experience feel magical and effortless.

---

**Draft PR Status:** Ready for implementation
**Estimated Effort:** 0.1d (as per task plan)
**Assignee:** Backend Dev
