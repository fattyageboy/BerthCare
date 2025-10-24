/**
 * Twilio Voice Service Tests
 *
 * Tests voice call initiation, webhook processing, and error handling
 */

import { TwilioVoiceService, TwilioVoiceError } from '../src/services/twilio-voice.service';

// Mock Twilio client
jest.mock('twilio', () => {
  return {
    Twilio: jest.fn().mockImplementation(() => ({
      calls: {
        create: jest.fn(),
      },
    })),
  };
});

// Mock webhook validation
jest.mock('twilio/lib/webhooks/webhooks', () => ({
  validateRequest: jest.fn(),
}));

describe('TwilioVoiceService', () => {
  let service: TwilioVoiceService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockTwilioClient: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create service with test credentials
    service = new TwilioVoiceService(
      'test_account_sid',
      'test_auth_token',
      '+15551234567',
      'https://api.test.com'
    );

    // Get mock client instance
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { Twilio } = require('twilio');
    mockTwilioClient = Twilio.mock.results[0].value;
  });

  describe('constructor', () => {
    it('should throw error if credentials not provided', () => {
      expect(() => {
        new TwilioVoiceService('', '', '+15551234567', 'https://api.test.com');
      }).toThrow('Twilio credentials not configured');
    });

    it('should throw error if account SID missing', () => {
      expect(() => {
        new TwilioVoiceService('', 'test_token', '+15551234567', 'https://api.test.com');
      }).toThrow('Twilio credentials not configured');
    });

    it('should throw error if auth token missing', () => {
      expect(() => {
        new TwilioVoiceService('test_sid', '', '+15551234567', 'https://api.test.com');
      }).toThrow('Twilio credentials not configured');
    });

    it('should throw error if phone number not provided', () => {
      expect(() => {
        new TwilioVoiceService('test_sid', 'test_token', '', 'https://api.test.com');
      }).toThrow('Twilio phone number not configured');
    });

    it('should create service with valid credentials', () => {
      expect(service).toBeInstanceOf(TwilioVoiceService);
    });
  });

  describe('initiateCall', () => {
    const validPhoneNumber = '+15559876543';
    const validVoiceMessageUrl = 'https://s3.amazonaws.com/bucket/message.mp3';
    const alertId = 'alert-123';

    beforeEach(() => {
      mockTwilioClient.calls.create.mockResolvedValue({
        sid: 'CA1234567890abcdef',
        status: 'queued',
        to: validPhoneNumber,
        from: '+15551234567',
      });
    });

    it('should initiate call successfully', async () => {
      const result = await service.initiateCall(validPhoneNumber, validVoiceMessageUrl, alertId);

      expect(result).toMatchObject({
        callSid: 'CA1234567890abcdef',
        status: 'queued',
        to: validPhoneNumber,
        from: '+15551234567',
      });
      expect(result.initiatedAt).toBeInstanceOf(Date);
    });

    it('should call Twilio API with correct parameters', async () => {
      await service.initiateCall(validPhoneNumber, validVoiceMessageUrl, alertId);

      expect(mockTwilioClient.calls.create).toHaveBeenCalledWith(
        expect.objectContaining({
          to: validPhoneNumber,
          from: '+15551234567',
          statusCallback: 'https://api.test.com/webhooks/twilio/voice/status?alertId=alert-123',
          statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
          statusCallbackMethod: 'POST',
          timeout: 30,
          record: false,
        })
      );
    });

    it('should include TwiML with voice message URL', async () => {
      await service.initiateCall(validPhoneNumber, validVoiceMessageUrl, alertId);

      const callArgs = mockTwilioClient.calls.create.mock.calls[0][0];
      expect(callArgs.twiml).toContain(validVoiceMessageUrl);
      expect(callArgs.twiml).toContain('You have an urgent care alert');
    });

    it('should throw error for invalid phone number format', async () => {
      await expect(
        service.initiateCall('1234567890', validVoiceMessageUrl, alertId)
      ).rejects.toThrow(TwilioVoiceError);

      await expect(service.initiateCall('invalid', validVoiceMessageUrl, alertId)).rejects.toThrow(
        'Invalid phone number format'
      );
    });

    it('should throw error for invalid voice message URL', async () => {
      await expect(service.initiateCall(validPhoneNumber, 'not-a-url', alertId)).rejects.toThrow(
        TwilioVoiceError
      );

      await expect(service.initiateCall(validPhoneNumber, '', alertId)).rejects.toThrow(
        'Invalid voice message URL'
      );
    });

    it('should handle Twilio API error 21211 (invalid number)', async () => {
      mockTwilioClient.calls.create.mockRejectedValue({
        code: 21211,
        message: 'Invalid phone number',
      });

      await expect(
        service.initiateCall(validPhoneNumber, validVoiceMessageUrl, alertId)
      ).rejects.toThrow('Invalid phone number');
    });

    it('should handle Twilio API error 21608 (unverified number)', async () => {
      mockTwilioClient.calls.create.mockRejectedValue({
        code: 21608,
        message: 'Phone number not verified',
      });

      await expect(
        service.initiateCall(validPhoneNumber, validVoiceMessageUrl, alertId)
      ).rejects.toThrow('Phone number not verified');
    });

    it('should handle generic Twilio API errors', async () => {
      mockTwilioClient.calls.create.mockRejectedValue({
        code: 20003,
        message: 'Authentication error',
      });

      await expect(
        service.initiateCall(validPhoneNumber, validVoiceMessageUrl, alertId)
      ).rejects.toThrow(TwilioVoiceError);
    });

    it('should handle network errors', async () => {
      mockTwilioClient.calls.create.mockRejectedValue(new Error('Network timeout'));

      await expect(
        service.initiateCall(validPhoneNumber, validVoiceMessageUrl, alertId)
      ).rejects.toThrow('Failed to initiate call');
    });
  });

  describe('processCallStatusWebhook', () => {
    it('should process completed call webhook', () => {
      const webhookData = {
        CallSid: 'CA1234567890abcdef',
        CallStatus: 'completed',
        To: '+15559876543',
        From: '+15551234567',
        CallDuration: '45',
      };

      const event = service.processCallStatusWebhook(webhookData);

      expect(event).toMatchObject({
        callSid: 'CA1234567890abcdef',
        status: 'completed',
        to: '+15559876543',
        from: '+15551234567',
        duration: 45,
      });
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    it('should process ringing call webhook', () => {
      const webhookData = {
        CallSid: 'CA1234567890abcdef',
        CallStatus: 'ringing',
        To: '+15559876543',
        From: '+15551234567',
      };

      const event = service.processCallStatusWebhook(webhookData);

      expect(event).toMatchObject({
        callSid: 'CA1234567890abcdef',
        status: 'ringing',
        to: '+15559876543',
        from: '+15551234567',
      });
      expect(event.duration).toBeUndefined();
    });

    it('should process failed call webhook with error', () => {
      const webhookData = {
        CallSid: 'CA1234567890abcdef',
        CallStatus: 'failed',
        To: '+15559876543',
        From: '+15551234567',
        ErrorCode: '30008',
        ErrorMessage: 'Unknown destination',
      };

      const event = service.processCallStatusWebhook(webhookData);

      expect(event).toMatchObject({
        callSid: 'CA1234567890abcdef',
        status: 'failed',
        to: '+15559876543',
        from: '+15551234567',
        errorCode: '30008',
        errorMessage: 'Unknown destination',
      });
    });

    it('should process no-answer webhook', () => {
      const webhookData = {
        CallSid: 'CA1234567890abcdef',
        CallStatus: 'no-answer',
        To: '+15559876543',
        From: '+15551234567',
      };

      const event = service.processCallStatusWebhook(webhookData);

      expect(event.status).toBe('no-answer');
    });

    it('should handle missing optional fields', () => {
      const webhookData = {
        CallSid: 'CA1234567890abcdef',
        CallStatus: 'queued',
        To: '+15559876543',
        From: '+15551234567',
      };

      const event = service.processCallStatusWebhook(webhookData);

      expect(event.duration).toBeUndefined();
      expect(event.errorCode).toBeUndefined();
      expect(event.errorMessage).toBeUndefined();
    });
  });

  describe('validateWebhookSignature', () => {
    const signature = 'test_signature';
    const url = 'https://api.test.com/webhooks/twilio/voice/status';
    const params = {
      CallSid: 'CA1234567890abcdef',
      CallStatus: 'completed',
    };

    let mockValidateRequest: jest.Mock;

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { validateRequest } = require('twilio/lib/webhooks/webhooks');
      mockValidateRequest = validateRequest as jest.Mock;
    });

    it('should validate correct signature', () => {
      mockValidateRequest.mockReturnValue(true);

      const isValid = service.validateWebhookSignature(signature, url, params);

      expect(isValid).toBe(true);
      // Note: validateRequest uses env.twilio.authToken, not the constructor token
      expect(mockValidateRequest).toHaveBeenCalled();
    });

    it('should reject invalid signature', () => {
      mockValidateRequest.mockReturnValue(false);

      const isValid = service.validateWebhookSignature(signature, url, params);

      expect(isValid).toBe(false);
    });

    it('should handle validation errors gracefully', () => {
      mockValidateRequest.mockImplementation(() => {
        throw new Error('Validation error');
      });

      const isValid = service.validateWebhookSignature(signature, url, params);

      expect(isValid).toBe(false);
    });
  });

  describe('TwiML generation', () => {
    it('should generate valid TwiML with voice message', async () => {
      const voiceMessageUrl = 'https://s3.amazonaws.com/bucket/message.mp3';

      mockTwilioClient.calls.create.mockResolvedValue({
        sid: 'CA1234567890abcdef',
        status: 'queued',
        to: '+15559876543',
        from: '+15551234567',
      });

      await service.initiateCall('+15559876543', voiceMessageUrl, 'alert-123');

      const callArgs = mockTwilioClient.calls.create.mock.calls[0][0];
      const twiml = callArgs.twiml;

      // Verify TwiML structure
      expect(twiml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(twiml).toContain('<Response>');
      expect(twiml).toContain('<Say voice="alice">You have an urgent care alert.</Say>');
      expect(twiml).toContain(`<Play>${voiceMessageUrl}</Play>`);
      expect(twiml).toContain('<Gather numDigits="1" timeout="10">');
      expect(twiml).toContain('</Response>');
    });
  });

  describe('error handling', () => {
    it('should create TwilioVoiceError with code and details', () => {
      const error = new TwilioVoiceError('Test error', 'TEST_CODE', { foo: 'bar' });

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('TwilioVoiceError');
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.details).toEqual({ foo: 'bar' });
    });
  });
});
