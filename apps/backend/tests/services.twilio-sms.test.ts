/**
 * Twilio SMS Service Tests
 *
 * Tests for SMS sending, webhook processing, and rate limiting
 */

import { TwilioSMSService, TwilioSMSError } from '../src/services/twilio-sms.service';

// Mock Twilio client
jest.mock('twilio', () => {
  return {
    Twilio: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn(),
      },
    })),
  };
});

// Mock webhook validation
jest.mock('twilio/lib/webhooks/webhooks', () => ({
  validateRequest: jest.fn(),
}));

describe('TwilioSMSService', () => {
  let service: TwilioSMSService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockTwilioClient: any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TwilioSMSService(
      'test-account-sid',
      'test-auth-token',
      '+15551234567',
      'https://test.example.com',
      { useRedis: false } // Use in-memory for tests
    );

    // Get mock client instance
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
    const { Twilio } = require('twilio');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
    mockTwilioClient = Twilio.mock.results[Twilio.mock.results.length - 1].value;
  });

  describe('constructor', () => {
    it('should initialize with provided credentials', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { Twilio } = require('twilio');
      expect(Twilio).toHaveBeenCalledWith('test-account-sid', 'test-auth-token');
    });

    it('should throw error if account SID missing', () => {
      expect(() => {
        new TwilioSMSService('', 'test-auth-token', '+15551234567');
      }).toThrow(TwilioSMSError);
    });

    it('should throw error if auth token missing', () => {
      expect(() => {
        new TwilioSMSService('test-account-sid', '', '+15551234567');
      }).toThrow(TwilioSMSError);
    });

    it('should throw error if phone number missing', () => {
      expect(() => {
        new TwilioSMSService('test-account-sid', 'test-auth-token', '');
      }).toThrow(TwilioSMSError);
    });

    it('should throw error if webhook base URL missing', () => {
      expect(() => {
        new TwilioSMSService('test-account-sid', 'test-auth-token', '+15551234567', '');
      }).toThrow(TwilioSMSError);
      expect(() => {
        new TwilioSMSService('test-account-sid', 'test-auth-token', '+15551234567', '   ');
      }).toThrow(TwilioSMSError);
    });

    it('should throw error if webhook base URL is invalid', () => {
      expect(() => {
        new TwilioSMSService(
          'test-account-sid',
          'test-auth-token',
          '+15551234567',
          'not-a-valid-url'
        );
      }).toThrow(TwilioSMSError);
      expect(() => {
        new TwilioSMSService(
          'test-account-sid',
          'test-auth-token',
          '+15551234567',
          'not-a-valid-url'
        );
      }).toThrow(/Invalid webhook base URL format/);
    });

    it('should normalize webhook base URL by removing trailing slash', () => {
      const serviceWithTrailingSlash = new TwilioSMSService(
        'test-account-sid',
        'test-auth-token',
        '+15551234567',
        'https://test.example.com/',
        { useRedis: false }
      );
      // Access private property for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((serviceWithTrailingSlash as any).webhookBaseUrl).toBe('https://test.example.com');
    });

    it('should trim whitespace from webhook base URL', () => {
      const serviceWithWhitespace = new TwilioSMSService(
        'test-account-sid',
        'test-auth-token',
        '+15551234567',
        '  https://test.example.com  ',
        { useRedis: false }
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((serviceWithWhitespace as any).webhookBaseUrl).toBe('https://test.example.com');
    });
  });

  describe('sendSMS', () => {
    const validTo = '+15559876543';
    const validMessage = 'Test message';

    beforeEach(() => {
      mockTwilioClient.messages.create.mockResolvedValue({
        sid: 'SM123456',
        status: 'queued',
        to: validTo,
        from: '+15551234567',
      });
    });

    it('should send SMS successfully', async () => {
      const result = await service.sendSMS(validTo, validMessage);

      expect(result).toEqual({
        messageSid: 'SM123456',
        status: 'queued',
        to: validTo,
        from: '+15551234567',
        body: validMessage,
        sentAt: expect.any(Date),
      });

      expect(mockTwilioClient.messages.create).toHaveBeenCalledWith({
        to: validTo,
        from: '+15551234567',
        body: validMessage,
        statusCallback: 'https://test.example.com/webhooks/twilio/sms/status',
      });
    });

    it('should throw error for invalid phone number format', async () => {
      await expect(service.sendSMS('invalid', validMessage)).rejects.toThrow(TwilioSMSError);
      await expect(service.sendSMS('1234567890', validMessage)).rejects.toThrow(TwilioSMSError);
      await expect(service.sendSMS('+1', validMessage)).rejects.toThrow(TwilioSMSError);
    });

    it('should throw error for empty message', async () => {
      await expect(service.sendSMS(validTo, '')).rejects.toThrow(TwilioSMSError);
      await expect(service.sendSMS(validTo, '   ')).rejects.toThrow(TwilioSMSError);
    });

    it('should throw error for message too long', async () => {
      const longMessage = 'a'.repeat(1601);
      await expect(service.sendSMS(validTo, longMessage)).rejects.toThrow(TwilioSMSError);
    });

    it('should handle Twilio API error - invalid phone number', async () => {
      mockTwilioClient.messages.create.mockRejectedValue({
        code: 21211,
        message: 'Invalid phone number',
      });

      await expect(service.sendSMS(validTo, validMessage)).rejects.toThrow(TwilioSMSError);
    });

    it('should handle Twilio API error - unverified number', async () => {
      mockTwilioClient.messages.create.mockRejectedValue({
        code: 21608,
        message: 'Phone number not verified',
      });

      await expect(service.sendSMS(validTo, validMessage)).rejects.toThrow(TwilioSMSError);
    });

    it('should handle Twilio API error - opted out', async () => {
      mockTwilioClient.messages.create.mockRejectedValue({
        code: 21610,
        message: 'Phone number has opted out',
      });

      await expect(service.sendSMS(validTo, validMessage)).rejects.toThrow(TwilioSMSError);
    });

    it('should handle generic Twilio API error', async () => {
      mockTwilioClient.messages.create.mockRejectedValue({
        code: 99999,
        message: 'Unknown error',
      });

      await expect(service.sendSMS(validTo, validMessage)).rejects.toThrow(TwilioSMSError);
    });

    it('should handle non-Twilio error', async () => {
      mockTwilioClient.messages.create.mockRejectedValue(new Error('Network error'));

      await expect(service.sendSMS(validTo, validMessage)).rejects.toThrow(TwilioSMSError);
    });
  });

  describe('rate limiting', () => {
    const validTo = '+15559876543';
    const validMessage = 'Test message';
    const userId = 'user-123';

    beforeEach(() => {
      mockTwilioClient.messages.create.mockResolvedValue({
        sid: 'SM123456',
        status: 'queued',
        to: validTo,
        from: '+15551234567',
      });
    });

    it('should allow SMS within rate limit', async () => {
      // Send 100 SMS (at limit)
      for (let i = 0; i < 100; i++) {
        await service.sendSMS(validTo, validMessage, userId);
      }

      expect(mockTwilioClient.messages.create).toHaveBeenCalledTimes(100);
    });

    it('should block SMS when rate limit exceeded', async () => {
      // Send 100 SMS (at limit)
      for (let i = 0; i < 100; i++) {
        await service.sendSMS(validTo, validMessage, userId);
      }

      // 101st SMS should fail
      await expect(service.sendSMS(validTo, validMessage, userId)).rejects.toThrow(TwilioSMSError);
      await expect(service.sendSMS(validTo, validMessage, userId)).rejects.toThrow(
        /Rate limit exceeded/
      );
    });

    it('should include reset time in rate limit error', async () => {
      // Send 100 SMS (at limit)
      for (let i = 0; i < 100; i++) {
        await service.sendSMS(validTo, validMessage, userId);
      }

      // 101st SMS should fail with details
      await expect(service.sendSMS(validTo, validMessage, userId)).rejects.toMatchObject({
        code: 'RATE_LIMIT_EXCEEDED',
        details: expect.objectContaining({
          userId,
          count: 101, // Count after increment
          limit: 100,
          resetInMinutes: expect.any(Number),
          resetAt: expect.any(String),
        }),
      });
    });

    it('should track rate limits per user', async () => {
      const user1 = 'user-1';
      const user2 = 'user-2';

      // Send 100 SMS for user1
      for (let i = 0; i < 100; i++) {
        await service.sendSMS(validTo, validMessage, user1);
      }

      // user1 should be blocked
      await expect(service.sendSMS(validTo, validMessage, user1)).rejects.toThrow(TwilioSMSError);

      // user2 should still be allowed
      await service.sendSMS(validTo, validMessage, user2);
      expect(mockTwilioClient.messages.create).toHaveBeenCalledTimes(101);
    });

    it('should not apply rate limit if userId not provided', async () => {
      // Send 150 SMS without userId (should all succeed)
      for (let i = 0; i < 150; i++) {
        await service.sendSMS(validTo, validMessage);
      }

      expect(mockTwilioClient.messages.create).toHaveBeenCalledTimes(150);
    });
  });

  describe('processSMSStatusWebhook', () => {
    it('should process delivered status webhook', () => {
      const webhookData = {
        MessageSid: 'SM123456',
        MessageStatus: 'delivered',
        To: '+15559876543',
        From: '+15551234567',
        Body: 'Test message',
      };

      const event = service.processSMSStatusWebhook(webhookData);

      expect(event).toEqual({
        messageSid: 'SM123456',
        status: 'delivered',
        to: '+15559876543',
        from: '+15551234567',
        body: 'Test message',
        timestamp: expect.any(Date),
      });
    });

    it('should process failed status webhook with error', () => {
      const webhookData = {
        MessageSid: 'SM123456',
        MessageStatus: 'failed',
        To: '+15559876543',
        From: '+15551234567',
        ErrorCode: '30003',
        ErrorMessage: 'Unreachable destination',
      };

      const event = service.processSMSStatusWebhook(webhookData);

      expect(event).toEqual({
        messageSid: 'SM123456',
        status: 'failed',
        to: '+15559876543',
        from: '+15551234567',
        timestamp: expect.any(Date),
        errorCode: '30003',
        errorMessage: 'Unreachable destination',
      });
    });

    it('should handle webhook with SmsSid (legacy format)', () => {
      const webhookData = {
        SmsSid: 'SM123456',
        SmsStatus: 'sent',
        To: '+15559876543',
        From: '+15551234567',
      };

      const event = service.processSMSStatusWebhook(webhookData);

      expect(event.messageSid).toBe('SM123456');
      expect(event.status).toBe('sent');
    });

    it('should handle webhook with missing optional fields', () => {
      const webhookData = {
        MessageSid: 'SM123456',
        MessageStatus: 'queued',
        To: '+15559876543',
        From: '+15551234567',
      };

      const event = service.processSMSStatusWebhook(webhookData);

      expect(event.body).toBeUndefined();
      expect(event.errorCode).toBeUndefined();
      expect(event.errorMessage).toBeUndefined();
    });
  });

  describe('validateWebhookSignature', () => {
    it('should validate correct signature', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { validateRequest } = require('twilio/lib/webhooks/webhooks');
      validateRequest.mockReturnValue(true);

      const signature = 'valid-signature';
      const url = 'https://test.example.com/webhooks/twilio/sms/status';
      const params = { MessageSid: 'SM123456' };

      const isValid = service.validateWebhookSignature(signature, url, params);

      expect(isValid).toBe(true);
      expect(validateRequest).toHaveBeenCalledWith('test-auth-token', signature, url, params);
    });

    it('should reject invalid signature', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { validateRequest } = require('twilio/lib/webhooks/webhooks');
      validateRequest.mockReturnValue(false);

      const signature = 'invalid-signature';
      const url = 'https://test.example.com/webhooks/twilio/sms/status';
      const params = { MessageSid: 'SM123456' };

      const isValid = service.validateWebhookSignature(signature, url, params);

      expect(isValid).toBe(false);
    });

    it('should handle validation error gracefully', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { validateRequest } = require('twilio/lib/webhooks/webhooks');
      validateRequest.mockImplementation(() => {
        throw new Error('Validation error');
      });

      const signature = 'signature';
      const url = 'https://test.example.com/webhooks/twilio/sms/status';
      const params = { MessageSid: 'SM123456' };

      const isValid = service.validateWebhookSignature(signature, url, params);

      expect(isValid).toBe(false);
    });
  });
});
