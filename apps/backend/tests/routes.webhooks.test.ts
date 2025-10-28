/**
 * Webhook Routes Tests
 */

import express, { Express, json, urlencoded } from 'express';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';

import { createWebhookRoutes } from '../src/routes/webhooks.routes';
import { TwilioSMSService } from '../src/services/twilio-sms.service';
import { TwilioVoiceService } from '../src/services/twilio-voice.service';

// Mock dependencies
jest.mock('../src/config/logger');
jest.mock('../src/middleware/webhook-rate-limit');
jest.mock('../src/services/twilio-voice.service');
jest.mock('../src/services/twilio-sms.service');

describe('Webhook Routes', () => {
  let app: Express;
  let mockPool: {
    query: jest.Mock;
  };

  beforeEach(async () => {
    // Create mock pool
    mockPool = {
      query: jest.fn(),
    };

    // Setup mock methods on prototypes before creating routes
    TwilioVoiceService.prototype.validateWebhookSignature = jest.fn();
    TwilioVoiceService.prototype.processCallStatusWebhook = jest.fn();
    TwilioSMSService.prototype.validateWebhookSignature = jest.fn();
    TwilioSMSService.prototype.processSMSStatusWebhook = jest.fn();

    // Setup express app
    app = express();
    app.use(json());
    app.use(urlencoded({ extended: true }));

    // Mock rate limiter to pass through
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getWebhookRateLimiter } = require('../src/middleware/webhook-rate-limit');
    getWebhookRateLimiter.mockResolvedValue((_req: Request, _res: Response, next: NextFunction) =>
      next()
    );

    // Create routes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webhookRoutes = await createWebhookRoutes(mockPool as any);
    app.use('/webhooks', webhookRoutes);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /webhooks/health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/webhooks/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
    });
  });

  describe('POST /webhooks/twilio/voice/status', () => {
    const validWebhookBody = {
      CallSid: 'CA123456',
      CallStatus: 'completed',
      From: '+15551234567',
      To: '+15559876543',
    };

    it('should reject webhook without signature', async () => {
      const response = await request(app)
        .post('/webhooks/twilio/voice/status')
        .send(validWebhookBody);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Missing signature' });
    });

    it('should reject webhook with invalid signature', async () => {
      (TwilioVoiceService.prototype.validateWebhookSignature as jest.Mock).mockResolvedValue(false);

      const response = await request(app)
        .post('/webhooks/twilio/voice/status')
        .set('X-Twilio-Signature', 'invalid-signature')
        .send(validWebhookBody);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Invalid signature' });
    });

    it('should process valid ringing status webhook', async () => {
      (TwilioVoiceService.prototype.validateWebhookSignature as jest.Mock).mockResolvedValue(true);
      (TwilioVoiceService.prototype.processCallStatusWebhook as jest.Mock).mockReturnValue({
        callSid: 'CA123456',
        status: 'ringing',
        from: '+15551234567',
        to: '+15559876543',
      });

      mockPool.query.mockResolvedValue({ rowCount: 1, rows: [] });

      const response = await request(app)
        .post('/webhooks/twilio/voice/status?alertId=alert-123')
        .set('X-Twilio-Signature', 'valid-signature')
        .send({ ...validWebhookBody, CallStatus: 'ringing' });

      expect(response.status).toBe(200);
      expect(response.text).toBe('OK');
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE care_alerts'), [
        'ringing',
        'CA123456',
      ]);
    });

    it('should process valid in-progress status webhook', async () => {
      (TwilioVoiceService.prototype.validateWebhookSignature as jest.Mock).mockResolvedValue(true);
      (TwilioVoiceService.prototype.processCallStatusWebhook as jest.Mock).mockReturnValue({
        callSid: 'CA123456',
        status: 'in-progress',
        from: '+15551234567',
        to: '+15559876543',
      });

      mockPool.query.mockResolvedValue({ rowCount: 1, rows: [] });

      const response = await request(app)
        .post('/webhooks/twilio/voice/status')
        .set('X-Twilio-Signature', 'valid-signature')
        .send({ ...validWebhookBody, CallStatus: 'in-progress' });

      expect(response.status).toBe(200);
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('answered_at'), [
        'answered',
        'CA123456',
      ]);
    });

    it('should process valid completed status webhook', async () => {
      (TwilioVoiceService.prototype.validateWebhookSignature as jest.Mock).mockResolvedValue(true);
      (TwilioVoiceService.prototype.processCallStatusWebhook as jest.Mock).mockReturnValue({
        callSid: 'CA123456',
        status: 'completed',
        from: '+15551234567',
        to: '+15559876543',
      });

      mockPool.query.mockResolvedValue({ rowCount: 1, rows: [] });

      const response = await request(app)
        .post('/webhooks/twilio/voice/status')
        .set('X-Twilio-Signature', 'valid-signature')
        .send(validWebhookBody);

      expect(response.status).toBe(200);
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('resolved_at'), [
        'resolved',
        'CA123456',
      ]);
    });

    it('should process no-answer status webhook', async () => {
      (TwilioVoiceService.prototype.validateWebhookSignature as jest.Mock).mockResolvedValue(true);
      (TwilioVoiceService.prototype.processCallStatusWebhook as jest.Mock).mockReturnValue({
        callSid: 'CA123456',
        status: 'no-answer',
        from: '+15551234567',
        to: '+15559876543',
      });

      mockPool.query.mockResolvedValue({ rowCount: 1, rows: [] });

      const response = await request(app)
        .post('/webhooks/twilio/voice/status')
        .set('X-Twilio-Signature', 'valid-signature')
        .send({ ...validWebhookBody, CallStatus: 'no-answer' });

      expect(response.status).toBe(200);
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE care_alerts'), [
        'no_answer',
        'CA123456',
      ]);
    });

    it('should process busy status webhook', async () => {
      (TwilioVoiceService.prototype.validateWebhookSignature as jest.Mock).mockResolvedValue(true);
      (TwilioVoiceService.prototype.processCallStatusWebhook as jest.Mock).mockReturnValue({
        callSid: 'CA123456',
        status: 'busy',
        from: '+15551234567',
        to: '+15559876543',
      });

      mockPool.query.mockResolvedValue({ rowCount: 1, rows: [] });

      const response = await request(app)
        .post('/webhooks/twilio/voice/status')
        .set('X-Twilio-Signature', 'valid-signature')
        .send({ ...validWebhookBody, CallStatus: 'busy' });

      expect(response.status).toBe(200);
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE care_alerts'), [
        'no_answer',
        'CA123456',
      ]);
    });

    it('should process failed status webhook', async () => {
      (TwilioVoiceService.prototype.validateWebhookSignature as jest.Mock).mockResolvedValue(true);
      (TwilioVoiceService.prototype.processCallStatusWebhook as jest.Mock).mockReturnValue({
        callSid: 'CA123456',
        status: 'failed',
        from: '+15551234567',
        to: '+15559876543',
      });

      mockPool.query.mockResolvedValue({ rowCount: 1, rows: [] });

      const response = await request(app)
        .post('/webhooks/twilio/voice/status')
        .set('X-Twilio-Signature', 'valid-signature')
        .send({ ...validWebhookBody, CallStatus: 'failed' });

      expect(response.status).toBe(200);
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE care_alerts'), [
        'cancelled',
        'CA123456',
      ]);
    });

    it('should process canceled status webhook', async () => {
      (TwilioVoiceService.prototype.validateWebhookSignature as jest.Mock).mockResolvedValue(true);
      (TwilioVoiceService.prototype.processCallStatusWebhook as jest.Mock).mockReturnValue({
        callSid: 'CA123456',
        status: 'canceled',
        from: '+15551234567',
        to: '+15559876543',
      });

      mockPool.query.mockResolvedValue({ rowCount: 1, rows: [] });

      const response = await request(app)
        .post('/webhooks/twilio/voice/status')
        .set('X-Twilio-Signature', 'valid-signature')
        .send({ ...validWebhookBody, CallStatus: 'canceled' });

      expect(response.status).toBe(200);
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE care_alerts'), [
        'cancelled',
        'CA123456',
      ]);
    });

    it('should handle webhook for non-existent alert', async () => {
      (TwilioVoiceService.prototype.validateWebhookSignature as jest.Mock).mockResolvedValue(true);
      (TwilioVoiceService.prototype.processCallStatusWebhook as jest.Mock).mockReturnValue({
        callSid: 'CA123456',
        status: 'completed',
        from: '+15551234567',
        to: '+15559876543',
      });

      mockPool.query.mockResolvedValue({ rowCount: 0, rows: [] });

      const response = await request(app)
        .post('/webhooks/twilio/voice/status')
        .set('X-Twilio-Signature', 'valid-signature')
        .send(validWebhookBody);

      expect(response.status).toBe(200);
      expect(response.text).toBe('OK');
    });

    it('should handle database errors gracefully', async () => {
      (TwilioVoiceService.prototype.validateWebhookSignature as jest.Mock).mockResolvedValue(true);
      (TwilioVoiceService.prototype.processCallStatusWebhook as jest.Mock).mockReturnValue({
        callSid: 'CA123456',
        status: 'completed',
        from: '+15551234567',
        to: '+15559876543',
      });

      mockPool.query.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/webhooks/twilio/voice/status')
        .set('X-Twilio-Signature', 'valid-signature')
        .send(validWebhookBody);

      expect(response.status).toBe(200);
      expect(response.text).toBe('OK');
    });
  });

  describe('POST /webhooks/twilio/sms/status', () => {
    const validSMSWebhookBody = {
      MessageSid: 'SM123456',
      MessageStatus: 'delivered',
      From: '+15551234567',
      To: '+15559876543',
    };

    it('should reject SMS webhook without signature', async () => {
      const response = await request(app)
        .post('/webhooks/twilio/sms/status')
        .send(validSMSWebhookBody);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Missing signature' });
    });

    it('should reject SMS webhook with invalid signature', async () => {
      (TwilioSMSService.prototype.validateWebhookSignature as jest.Mock).mockReturnValue(false);

      const response = await request(app)
        .post('/webhooks/twilio/sms/status')
        .set('X-Twilio-Signature', 'invalid-signature')
        .send(validSMSWebhookBody);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Invalid signature' });
    });

    it('should process valid SMS delivered webhook', async () => {
      (TwilioSMSService.prototype.validateWebhookSignature as jest.Mock).mockReturnValue(true);
      (TwilioSMSService.prototype.processSMSStatusWebhook as jest.Mock).mockReturnValue({
        messageSid: 'SM123456',
        status: 'delivered',
        from: '+15551234567',
        to: '+15559876543',
      });

      const response = await request(app)
        .post('/webhooks/twilio/sms/status')
        .set('X-Twilio-Signature', 'valid-signature')
        .send(validSMSWebhookBody);

      expect(response.status).toBe(200);
      expect(response.text).toBe('OK');
      expect(TwilioSMSService.prototype.processSMSStatusWebhook).toHaveBeenCalledWith(
        validSMSWebhookBody
      );
    });

    it('should process valid SMS sent webhook', async () => {
      (TwilioSMSService.prototype.validateWebhookSignature as jest.Mock).mockReturnValue(true);
      (TwilioSMSService.prototype.processSMSStatusWebhook as jest.Mock).mockReturnValue({
        messageSid: 'SM123456',
        status: 'sent',
        from: '+15551234567',
        to: '+15559876543',
      });

      const response = await request(app)
        .post('/webhooks/twilio/sms/status')
        .set('X-Twilio-Signature', 'valid-signature')
        .send({ ...validSMSWebhookBody, MessageStatus: 'sent' });

      expect(response.status).toBe(200);
      expect(response.text).toBe('OK');
    });

    it('should process valid SMS failed webhook', async () => {
      (TwilioSMSService.prototype.validateWebhookSignature as jest.Mock).mockReturnValue(true);
      (TwilioSMSService.prototype.processSMSStatusWebhook as jest.Mock).mockReturnValue({
        messageSid: 'SM123456',
        status: 'failed',
        from: '+15551234567',
        to: '+15559876543',
        errorCode: '30003',
        errorMessage: 'Unreachable destination',
      });

      const response = await request(app)
        .post('/webhooks/twilio/sms/status')
        .set('X-Twilio-Signature', 'valid-signature')
        .send({
          ...validSMSWebhookBody,
          MessageStatus: 'failed',
          ErrorCode: '30003',
          ErrorMessage: 'Unreachable destination',
        });

      expect(response.status).toBe(200);
      expect(response.text).toBe('OK');
    });

    it('should handle SMS webhook processing errors gracefully', async () => {
      (TwilioSMSService.prototype.validateWebhookSignature as jest.Mock).mockReturnValue(true);
      (TwilioSMSService.prototype.processSMSStatusWebhook as jest.Mock).mockImplementation(() => {
        throw new Error('Processing error');
      });

      const response = await request(app)
        .post('/webhooks/twilio/sms/status')
        .set('X-Twilio-Signature', 'valid-signature')
        .send(validSMSWebhookBody);

      expect(response.status).toBe(200);
      expect(response.text).toBe('OK');
    });
  });
});
