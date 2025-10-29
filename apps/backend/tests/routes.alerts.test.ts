/**
 * Voice Alert Routes Integration Tests
 *
 * Tests for POST /api/v1/alerts/voice and PATCH /api/v1/alerts/:alertId endpoints
 *
 * Test Coverage:
 * - Successful voice alert creation
 * - Call initiated to coordinator
 * - Alert recorded in database
 * - Authentication and authorization
 * - Validation errors
 * - Zone access control
 */

import * as crypto from 'crypto';

import express, { Express, json } from 'express';
import { Pool } from 'pg';
import { createClient } from 'redis';
import request from 'supertest';

import { createAlertRoutes } from '../src/routes/alerts.routes';
import { createAuthRoutes } from '../src/routes/auth.routes';

import {
  cleanAllTestData,
  generateTestEmail,
  setupTestConnections,
  teardownTestConnections,
} from './test-helpers';

// Mock Twilio services before importing
const mockInitiateCall = jest.fn();
const mockSendSMS = jest.fn();

jest.mock('../src/services/twilio-voice.service', () => {
  return {
    TwilioVoiceService: jest.fn().mockImplementation(() => {
      return {
        initiateCall: mockInitiateCall,
        processCallStatusWebhook: jest.fn(),
        validateWebhookSignature: jest.fn(),
      };
    }),
    TwilioVoiceError: class TwilioVoiceError extends Error {
      constructor(
        message: string,
        public code: string,
        public details?: unknown
      ) {
        super(message);
        this.name = 'TwilioVoiceError';
      }
    },
  };
});

jest.mock('../src/services/twilio-sms.service', () => {
  return {
    TwilioSMSService: jest.fn().mockImplementation(() => {
      return {
        sendSMS: mockSendSMS,
        processSMSStatusWebhook: jest.fn(),
        validateWebhookSignature: jest.fn(),
      };
    }),
    TwilioSMSError: class TwilioSMSError extends Error {
      constructor(
        message: string,
        public code: string,
        public details?: unknown
      ) {
        super(message);
        this.name = 'TwilioSMSError';
      }
    },
  };
});

// Helper function to create a client in a specific zone
async function createClientInZone(
  pgPool: Pool,
  zoneId: string,
  firstName = 'Test',
  lastName = 'Client'
): Promise<string> {
  const clientId = crypto.randomUUID();
  await pgPool.query(
    `INSERT INTO clients (
      id, first_name, last_name, date_of_birth, address,
      latitude, longitude, zone_id,
      emergency_contact_name, emergency_contact_phone, emergency_contact_relationship
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      clientId,
      firstName,
      lastName,
      '1950-01-01',
      '123 Test St',
      45.5017,
      -73.5673,
      zoneId,
      'Emergency Contact',
      '+15559876543',
      'Daughter',
    ]
  );
  return clientId;
}

describe('Alert Routes', () => {
  let app: Express;
  let pgPool: Pool;
  let redisClient: ReturnType<typeof createClient>;
  let caregiverToken: string;
  let caregiverId: string;
  let coordinatorToken: string;
  let coordinatorUserId: string;
  let clientId: string;
  let coordinatorId: string;
  let zoneId: string;

  beforeAll(async () => {
    // Set test Twilio credentials to avoid initialization errors
    process.env.TWILIO_ACCOUNT_SID = 'test_account_sid';
    process.env.TWILIO_AUTH_TOKEN = 'test_auth_token';
    process.env.TWILIO_PHONE_NUMBER = '+15550000000';
    process.env.TWILIO_WEBHOOK_BASE_URL = 'http://localhost:3000';

    // Setup connections
    const connections = await setupTestConnections();
    pgPool = connections.pgPool;
    redisClient = connections.redisClient;

    // Create Express app with routes
    app = express();
    app.use(json());
    app.use('/api/v1/auth', createAuthRoutes(pgPool, redisClient));
    app.use('/api/v1/alerts', createAlertRoutes(pgPool, redisClient));

    // Use test zone
    zoneId = '550e8400-e29b-41d4-a716-446655440001';
  });

  beforeEach(async () => {
    // Reset mocks
    mockInitiateCall.mockClear();
    mockInitiateCall.mockResolvedValue({
      callSid: 'CA1234567890abcdef1234567890abcdef',
      status: 'queued',
      to: '+15551234567',
      from: '+15550000000',
      initiatedAt: new Date(),
    });

    mockSendSMS.mockClear();
    mockSendSMS.mockResolvedValue({
      messageSid: 'SM1234567890abcdef1234567890abcdef',
      status: 'queued',
      to: '+15559999999',
      from: '+15550000000',
      body: 'Test message',
      sentAt: new Date(),
    });

    // Clean test data
    await cleanAllTestData(pgPool, redisClient);

    // Create test caregiver
    const caregiverEmail = generateTestEmail('caregiver');
    const caregiverPassword = 'TestPassword123!';

    const registerResponse = await request(app).post('/api/v1/auth/register').send({
      email: caregiverEmail,
      password: caregiverPassword,
      firstName: 'Test',
      lastName: 'Caregiver',
      role: 'caregiver',
      zoneId,
    });

    caregiverId = registerResponse.body.data.user.id;

    // Login to get caregiver token
    const caregiverLoginResponse = await request(app).post('/api/v1/auth/login').send({
      email: caregiverEmail,
      password: caregiverPassword,
      deviceId: 'test-device-id',
    });

    if (!caregiverLoginResponse.body.data) {
      throw new Error(`Caregiver login failed: ${JSON.stringify(caregiverLoginResponse.body)}`);
    }

    caregiverToken = caregiverLoginResponse.body.data.accessToken;

    // Update caregiver with phone number for SMS notifications
    await pgPool.query('UPDATE users SET phone_number = $1 WHERE id = $2', [
      '+15559999999',
      caregiverId,
    ]);

    // Create test coordinator
    const coordinatorEmail = generateTestEmail('coordinator');
    const coordinatorPassword = 'TestPassword123!';

    // Register and login coordinator
    const coordinatorRegisterResponse = await request(app).post('/api/v1/auth/register').send({
      email: coordinatorEmail,
      password: coordinatorPassword,
      firstName: 'Test',
      lastName: 'Coordinator',
      role: 'coordinator',
      zoneId,
    });

    coordinatorUserId = coordinatorRegisterResponse.body.data.user.id;

    const coordinatorLoginResponse = await request(app).post('/api/v1/auth/login').send({
      email: coordinatorEmail,
      password: coordinatorPassword,
      deviceId: 'test-device-id-coordinator',
    });

    if (!coordinatorLoginResponse.body.data) {
      throw new Error(`Coordinator login failed: ${JSON.stringify(coordinatorLoginResponse.body)}`);
    }

    coordinatorToken = coordinatorLoginResponse.body.data.accessToken;

    coordinatorId = crypto.randomUUID();
    await pgPool.query(
      `INSERT INTO coordinators (id, user_id, zone_id, phone_number, is_active)
       VALUES ($1, $2, $3, $4, true)`,
      [coordinatorId, coordinatorUserId, zoneId, '+15551234567']
    );

    // Create test client
    clientId = await createClientInZone(pgPool, zoneId, 'Test', 'Client');
  });

  afterAll(async () => {
    if (pgPool && redisClient) {
      await cleanAllTestData(pgPool, redisClient);
      await teardownTestConnections(pgPool, redisClient);
    }
  });

  describe('Success Cases', () => {
    it('should create voice alert and initiate call', async () => {
      const response = await request(app)
        .post('/api/v1/alerts/voice')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          clientId,
          voiceMessageUrl: 'https://s3.amazonaws.com/bucket/voice-message.mp3',
          alertType: 'medical_concern',
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        id: expect.any(String),
        status: 'initiated',
        coordinatorName: 'Test Coordinator',
        callSid: 'CA1234567890abcdef1234567890abcdef',
        initiatedAt: expect.any(String),
      });

      // Verify alert was created in database
      const alertResult = await pgPool.query('SELECT * FROM care_alerts WHERE id = $1', [
        response.body.data.id,
      ]);

      expect(alertResult.rows.length).toBe(1);
      expect(alertResult.rows[0]).toMatchObject({
        client_id: clientId,
        staff_id: caregiverId,
        alert_type: 'medical_concern',
        voice_message_url: 'https://s3.amazonaws.com/bucket/voice-message.mp3',
        status: 'initiated',
      });
      // Verify coordinator_id is set (it's the user_id, not the coordinators.id)
      expect(alertResult.rows[0].coordinator_id).toBeTruthy();
    });

    it('should default to "other" alert type if not specified', async () => {
      const response = await request(app)
        .post('/api/v1/alerts/voice')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          clientId,
          voiceMessageUrl: 'https://s3.amazonaws.com/bucket/voice-message.mp3',
        });

      expect(response.status).toBe(201);

      const alertResult = await pgPool.query('SELECT alert_type FROM care_alerts WHERE id = $1', [
        response.body.data.id,
      ]);

      expect(alertResult.rows[0].alert_type).toBe('other');
    });
  });

  describe('Authentication & Authorization', () => {
    it('should require authentication', async () => {
      const response = await request(app).post('/api/v1/alerts/voice').send({
        clientId,
        voiceMessageUrl: 'https://s3.amazonaws.com/bucket/voice-message.mp3',
      });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should require caregiver role', async () => {
      // Create coordinator user and get token
      const coordinatorEmail = generateTestEmail('coordinator-user');
      await request(app).post('/api/v1/auth/register').send({
        email: coordinatorEmail,
        password: 'TestPassword123!',
        firstName: 'Test',
        lastName: 'Coordinator',
        role: 'coordinator',
        zoneId,
      });

      const loginResponse = await request(app).post('/api/v1/auth/login').send({
        email: coordinatorEmail,
        password: 'TestPassword123!',
        deviceId: 'test-device-id-coordinator',
      });

      const coordinatorToken = loginResponse.body.data.accessToken;

      const response = await request(app)
        .post('/api/v1/alerts/voice')
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          clientId,
          voiceMessageUrl: 'https://s3.amazonaws.com/bucket/voice-message.mp3',
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should enforce zone access control', async () => {
      // Create client in different zone
      const otherZoneId = '550e8400-e29b-41d4-a716-446655440002';
      const otherClientId = await createClientInZone(pgPool, otherZoneId, 'Other', 'Client');

      const response = await request(app)
        .post('/api/v1/alerts/voice')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          clientId: otherClientId,
          voiceMessageUrl: 'https://s3.amazonaws.com/bucket/voice-message.mp3',
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(response.body.error.message).toContain('zone');
    });
  });

  describe('Validation', () => {
    it('should require clientId', async () => {
      const response = await request(app)
        .post('/api/v1/alerts/voice')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          voiceMessageUrl: 'https://s3.amazonaws.com/bucket/voice-message.mp3',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('MISSING_CLIENT_ID');
    });

    it('should require voiceMessageUrl', async () => {
      const response = await request(app)
        .post('/api/v1/alerts/voice')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          clientId,
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('MISSING_VOICE_MESSAGE');
    });

    it('should validate clientId format', async () => {
      const response = await request(app)
        .post('/api/v1/alerts/voice')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          clientId: 'invalid-uuid',
          voiceMessageUrl: 'https://s3.amazonaws.com/bucket/voice-message.mp3',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_CLIENT_ID');
    });

    it('should validate voiceMessageUrl format', async () => {
      const response = await request(app)
        .post('/api/v1/alerts/voice')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          clientId,
          voiceMessageUrl: 'not-a-url',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_VOICE_MESSAGE_URL');
    });

    it('should return 404 for non-existent client', async () => {
      const nonExistentClientId = crypto.randomUUID();

      const response = await request(app)
        .post('/api/v1/alerts/voice')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          clientId: nonExistentClientId,
          voiceMessageUrl: 'https://s3.amazonaws.com/bucket/voice-message.mp3',
        });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('CLIENT_NOT_FOUND');
    });

    it('should return 404 when no coordinator available', async () => {
      // Delete coordinator
      await pgPool.query('DELETE FROM coordinators WHERE id = $1', [coordinatorId]);

      const response = await request(app)
        .post('/api/v1/alerts/voice')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          clientId,
          voiceMessageUrl: 'https://s3.amazonaws.com/bucket/voice-message.mp3',
        });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NO_COORDINATOR_AVAILABLE');
    });

    it('should return 503 when Twilio call initiation fails', async () => {
      // Mock call initiation to fail for this test only
      mockInitiateCall.mockRejectedValueOnce(new Error('Twilio service unavailable'));

      const response = await request(app)
        .post('/api/v1/alerts/voice')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          clientId,
          voiceMessageUrl: 'https://s3.amazonaws.com/bucket/voice-message.mp3',
          alertType: 'medical_concern',
        });

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('CALL_INITIATION_FAILED');
      expect(response.body.error.message).toContain('call');

      // Verify mock was called
      expect(mockInitiateCall).toHaveBeenCalledTimes(1);

      // Verify no alert was created in database (transaction should rollback)
      const alertResult = await pgPool.query(
        'SELECT * FROM care_alerts WHERE client_id = $1 AND status = $2',
        [clientId, 'initiated']
      );
      expect(alertResult.rows.length).toBe(0);
    });
  });

  describe('PATCH /v1/alerts/:alertId', () => {
    let alertId: string;

    beforeEach(async () => {
      // Create a test alert
      alertId = crypto.randomUUID();
      await pgPool.query(
        `INSERT INTO care_alerts (
          id, client_id, staff_id, coordinator_id, alert_type,
          voice_message_url, call_sid, status, initiated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          alertId,
          clientId,
          caregiverId,
          coordinatorUserId,
          'medical_concern',
          'https://s3.amazonaws.com/bucket/voice-message.mp3',
          'CA1234567890abcdef1234567890abcdef',
          'answered',
        ]
      );
    });

    describe('Success Cases', () => {
      it('should resolve alert with outcome', async () => {
        const outcome = 'Contacted family physician. Medication adjusted. Client feeling better.';

        const response = await request(app)
          .patch(`/api/v1/alerts/${alertId}`)
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({ outcome });

        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({
          id: alertId,
          status: 'resolved',
          outcome,
          resolvedAt: expect.any(String),
        });

        // Verify alert was updated in database
        const alertResult = await pgPool.query(
          'SELECT status, outcome, resolved_at FROM care_alerts WHERE id = $1',
          [alertId]
        );

        expect(alertResult.rows[0]).toMatchObject({
          status: 'resolved',
          outcome,
        });
        expect(alertResult.rows[0].resolved_at).toBeTruthy();
      });

      it('should notify caregiver via SMS', async () => {
        const outcome = 'Issue resolved successfully';

        await request(app)
          .patch(`/api/v1/alerts/${alertId}`)
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({ outcome });

        expect(mockSendSMS).toHaveBeenCalledWith(
          '+15559999999',
          expect.stringContaining('Alert resolved for Test Client')
        );
        expect(mockSendSMS).toHaveBeenCalledWith(
          '+15559999999',
          expect.stringContaining('Issue resolved successfully')
        );
      });

      it('should truncate long outcome in SMS', async () => {
        const longOutcome =
          'This is a very long outcome that exceeds the SMS character limit. ' +
          'It contains detailed information about the resolution process including ' +
          'multiple steps taken, people contacted, and follow-up actions required. ' +
          'This text should be truncated to fit within SMS limits.';

        const response = await request(app)
          .patch(`/api/v1/alerts/${alertId}`)
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({ outcome: longOutcome });

        expect(response.status).toBe(200);

        // Verify SMS was sent
        expect(mockSendSMS).toHaveBeenCalled();
        const smsMessage = mockSendSMS.mock.calls[0][1];

        // Extract the outcome part from the message
        const outcomeMatch = smsMessage.match(/Outcome: (.+)$/);
        expect(outcomeMatch).toBeTruthy();

        const sentOutcome = outcomeMatch[1];

        // Should be truncated to 140 chars + ellipsis
        expect(sentOutcome.length).toBeLessThanOrEqual(141); // 140 + '…'
        expect(sentOutcome).toMatch(/…$/); // Should end with ellipsis
      });

      it('should sanitize newlines and whitespace in SMS', async () => {
        const outcomeWithNewlines = 'Line 1\nLine 2\n\nLine 3\r\nLine 4   with   spaces';

        const response = await request(app)
          .patch(`/api/v1/alerts/${alertId}`)
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({ outcome: outcomeWithNewlines });

        expect(response.status).toBe(200);

        // Verify SMS was sent
        expect(mockSendSMS).toHaveBeenCalled();
        const smsMessage = mockSendSMS.mock.calls[0][1];

        // Should not contain newlines
        expect(smsMessage).not.toMatch(/[\r\n]/);

        // Should have collapsed multiple spaces
        expect(smsMessage).not.toMatch(/\s{2,}/);

        // Should contain the sanitized text
        expect(smsMessage).toContain('Line 1 Line 2 Line 3 Line 4 with spaces');
      });

      it('should trim outcome whitespace', async () => {
        const outcome = '  Resolved with extra spaces  ';

        const response = await request(app)
          .patch(`/api/v1/alerts/${alertId}`)
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({ outcome });

        expect(response.status).toBe(200);
        expect(response.body.data.outcome).toBe('Resolved with extra spaces');
      });
    });

    describe('Authentication & Authorization', () => {
      it('should require authentication', async () => {
        const response = await request(app)
          .patch(`/api/v1/alerts/${alertId}`)
          .send({ outcome: 'Test outcome' });

        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe('MISSING_TOKEN');
      });

      it('should require coordinator role', async () => {
        const response = await request(app)
          .patch(`/api/v1/alerts/${alertId}`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({ outcome: 'Test outcome' });

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('FORBIDDEN');
      });

      it('should enforce zone access control', async () => {
        // Create alert in different zone
        const otherZoneId = '550e8400-e29b-41d4-a716-446655440002';
        const otherClientId = await createClientInZone(pgPool, otherZoneId, 'Other', 'Client');

        const otherAlertId = crypto.randomUUID();
        await pgPool.query(
          `INSERT INTO care_alerts (
            id, client_id, staff_id, coordinator_id, alert_type,
            voice_message_url, call_sid, status, initiated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            otherAlertId,
            otherClientId,
            caregiverId,
            coordinatorUserId,
            'medical_concern',
            'https://s3.amazonaws.com/bucket/voice-message.mp3',
            'CA1234567890abcdef1234567890abcdef',
            'answered',
          ]
        );

        const response = await request(app)
          .patch(`/api/v1/alerts/${otherAlertId}`)
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({ outcome: 'Test outcome' });

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('FORBIDDEN');
        expect(response.body.error.message).toContain('zone');
      });
    });

    describe('Validation', () => {
      it('should require outcome', async () => {
        const response = await request(app)
          .patch(`/api/v1/alerts/${alertId}`)
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({});

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('MISSING_OUTCOME');
      });

      it('should reject empty outcome', async () => {
        const response = await request(app)
          .patch(`/api/v1/alerts/${alertId}`)
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({ outcome: '   ' });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('MISSING_OUTCOME');
      });

      it('should reject non-string outcome', async () => {
        const response = await request(app)
          .patch(`/api/v1/alerts/${alertId}`)
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({ outcome: 123 });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('MISSING_OUTCOME');
      });

      it('should reject outcome that exceeds maximum length', async () => {
        const tooLongOutcome = 'a'.repeat(2001); // 2001 characters

        const response = await request(app)
          .patch(`/api/v1/alerts/${alertId}`)
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({ outcome: tooLongOutcome });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('OUTCOME_TOO_LONG');
        expect(response.body.error.message).toContain('2000');
        expect(response.body.error.details.maxLength).toBe(2000);
        expect(response.body.error.details.actualLength).toBe(2001);
      });

      it('should validate alert ID format', async () => {
        const response = await request(app)
          .patch('/api/v1/alerts/invalid-uuid')
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({ outcome: 'Test outcome' });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('INVALID_ALERT_ID');
      });

      it('should return 404 for non-existent alert', async () => {
        const nonExistentAlertId = crypto.randomUUID();

        const response = await request(app)
          .patch(`/api/v1/alerts/${nonExistentAlertId}`)
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({ outcome: 'Test outcome' });

        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('ALERT_NOT_FOUND');
      });

      it('should reject already resolved alert', async () => {
        // Resolve the alert first
        await pgPool.query(
          `UPDATE care_alerts SET status = 'resolved', outcome = 'Already resolved', resolved_at = NOW() WHERE id = $1`,
          [alertId]
        );

        const response = await request(app)
          .patch(`/api/v1/alerts/${alertId}`)
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({ outcome: 'Trying to resolve again' });

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('ALERT_ALREADY_RESOLVED');
      });

      it('should handle concurrent resolution attempts', async () => {
        // Create a second coordinator in the same zone
        const coordinator2Email = generateTestEmail('coordinator2');
        const coordinator2Password = 'TestPassword123!';

        const coordinator2RegisterResponse = await request(app).post('/api/v1/auth/register').send({
          email: coordinator2Email,
          password: coordinator2Password,
          firstName: 'Second',
          lastName: 'Coordinator',
          role: 'coordinator',
          zoneId,
        });

        const coordinator2UserId = coordinator2RegisterResponse.body.data.user.id;

        const coordinator2LoginResponse = await request(app).post('/api/v1/auth/login').send({
          email: coordinator2Email,
          password: coordinator2Password,
          deviceId: 'test-device-id-coordinator2',
        });

        const coordinator2Token = coordinator2LoginResponse.body.data.accessToken;

        const coordinator2Id = crypto.randomUUID();
        await pgPool.query(
          `INSERT INTO coordinators (id, user_id, zone_id, phone_number, is_active)
           VALUES ($1, $2, $3, $4, true)`,
          [coordinator2Id, coordinator2UserId, zoneId, '+15551234568']
        );

        // Attempt to resolve the same alert concurrently
        const [response1, response2] = await Promise.all([
          request(app)
            .patch(`/api/v1/alerts/${alertId}`)
            .set('Authorization', `Bearer ${coordinatorToken}`)
            .send({ outcome: 'Resolved by coordinator 1' }),
          request(app)
            .patch(`/api/v1/alerts/${alertId}`)
            .set('Authorization', `Bearer ${coordinator2Token}`)
            .send({ outcome: 'Resolved by coordinator 2' }),
        ]);

        // One should succeed (200), one should fail with conflict (409)
        const statuses = [response1.status, response2.status].sort();
        expect(statuses).toEqual([200, 409]);

        // The successful response should have resolved status
        const successResponse = response1.status === 200 ? response1 : response2;
        expect(successResponse.body.data.status).toBe('resolved');

        // The failed response should indicate alert already resolved
        const failedResponse = response1.status === 409 ? response1 : response2;
        expect(failedResponse.body.error.code).toBe('ALERT_ALREADY_RESOLVED');

        // Verify only one outcome was saved in the database
        const alertResult = await pgPool.query(
          'SELECT status, outcome, resolved_at FROM care_alerts WHERE id = $1',
          [alertId]
        );

        expect(alertResult.rows[0].status).toBe('resolved');
        expect(alertResult.rows[0].resolved_at).toBeTruthy();
        // Outcome should be from one of the coordinators
        expect(['Resolved by coordinator 1', 'Resolved by coordinator 2']).toContain(
          alertResult.rows[0].outcome
        );
      });
    });

    describe('SMS Notification Handling', () => {
      it('should continue if SMS notification fails', async () => {
        // Mock SMS failure
        mockSendSMS.mockRejectedValueOnce(new Error('SMS service unavailable'));

        const outcome = 'Resolved successfully';

        const response = await request(app)
          .patch(`/api/v1/alerts/${alertId}`)
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({ outcome });

        // Should still succeed even if SMS fails
        expect(response.status).toBe(200);
        expect(response.body.data.status).toBe('resolved');

        // Verify alert was still updated
        const alertResult = await pgPool.query(
          'SELECT status, outcome FROM care_alerts WHERE id = $1',
          [alertId]
        );

        expect(alertResult.rows[0].status).toBe('resolved');
      });

      it('should skip SMS if caregiver has no phone number', async () => {
        // Remove caregiver phone number
        await pgPool.query('UPDATE users SET phone_number = NULL WHERE id = $1', [caregiverId]);

        const outcome = 'Resolved successfully';

        const response = await request(app)
          .patch(`/api/v1/alerts/${alertId}`)
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({ outcome });

        expect(response.status).toBe(200);
        expect(mockSendSMS).not.toHaveBeenCalled();
      });
    });
  });
});
