/**
 * Twilio Voice Service Tests
 *
 * Tests voice call initiation, webhook processing, and error handling
 */

import { env } from '../src/config/env';
import { TwilioVoiceError, TwilioVoiceService } from '../src/services/twilio-voice.service';

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

type TwilioMockClient = {
  calls: {
    create: jest.Mock;
  };
};

describe('TwilioVoiceService', () => {
  const { Twilio } = jest.requireMock('twilio') as { Twilio: jest.Mock };
  const { validateRequest } = jest.requireMock('twilio/lib/webhooks/webhooks') as {
    validateRequest: jest.Mock;
  };

  const baseOptions = {
    accountSid: 'test_account_sid',
    authToken: 'test_auth_token',
    fromNumber: '+15551234567',
    webhookBaseUrl: 'https://api.test.com',
  };

  let mockTwilioClient: TwilioMockClient;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createService(): TwilioVoiceService {
    const service = new TwilioVoiceService(baseOptions);
    mockTwilioClient = Twilio.mock.results[Twilio.mock.results.length - 1]
      .value as TwilioMockClient;

    mockTwilioClient.calls.create.mockResolvedValue({
      sid: 'CA1234567890abcdef',
      status: 'queued',
      to: '+15559876543',
      from: baseOptions.fromNumber,
    });

    return service;
  }

  describe('constructor', () => {
    it('should create service with valid credentials', () => {
      const service = new TwilioVoiceService(baseOptions);
      expect(service).toBeInstanceOf(TwilioVoiceService);
      expect(Twilio).toHaveBeenCalledWith(baseOptions.accountSid, baseOptions.authToken);
    });

    it('should throw when webhook base URL is invalid', () => {
      expect(() => {
        new TwilioVoiceService({
          ...baseOptions,
          webhookBaseUrl: 'not-a-url',
        });
      }).toThrow('Invalid webhook base URL format');
    });
  });

  describe('initiateCall', () => {
    const validPhoneNumber = '+15559876543';
    const validVoiceMessageUrl = 'https://s3.amazonaws.com/bucket/message.mp3';

    let service: TwilioVoiceService;

    beforeEach(() => {
      service = createService();
    });

    it('should initiate call successfully', async () => {
      const result = await service.initiateCall(validPhoneNumber, validVoiceMessageUrl, {
        alertId: 'alert-123',
      });

      expect(result).toMatchObject({
        callSid: 'CA1234567890abcdef',
        status: 'queued',
        to: validPhoneNumber,
        from: baseOptions.fromNumber,
      });
      expect(result.initiatedAt).toBeInstanceOf(Date);
    });

    it('should call Twilio API with correct parameters', async () => {
      await service.initiateCall(validPhoneNumber, validVoiceMessageUrl, { alertId: 'alert-123' });

      expect(mockTwilioClient.calls.create).toHaveBeenCalledWith(
        expect.objectContaining({
          to: validPhoneNumber,
          from: baseOptions.fromNumber,
          statusCallback: 'https://api.test.com/webhooks/twilio/voice/status?alertId=alert-123',
          statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
          statusCallbackMethod: 'POST',
          timeout: 30,
          record: false,
        })
      );
    });

    it('should build status callback URL without alertId when not provided', async () => {
      await service.initiateCall(validPhoneNumber, validVoiceMessageUrl);

      const callArgs = mockTwilioClient.calls.create.mock.calls[0][0];
      expect(callArgs.statusCallback).toBe('https://api.test.com/webhooks/twilio/voice/status');
    });

    it('should include TwiML with voice message URL', async () => {
      await service.initiateCall(validPhoneNumber, validVoiceMessageUrl, { alertId: 'alert-123' });

      const callArgs = mockTwilioClient.calls.create.mock.calls[0][0];
      expect(callArgs.twiml).toContain(validVoiceMessageUrl);
      expect(callArgs.twiml).toContain('You have an urgent care alert');
    });

    it('should throw error for invalid phone number format', async () => {
      await expect(
        service.initiateCall('1234567890', validVoiceMessageUrl, { alertId: 'alert-123' })
      ).rejects.toThrow(TwilioVoiceError);

      await expect(
        service.initiateCall('invalid', validVoiceMessageUrl, { alertId: 'alert-123' })
      ).rejects.toThrow('Invalid phone number format');
    });

    it('should throw error for invalid voice message URL', async () => {
      await expect(
        service.initiateCall(validPhoneNumber, 'not-a-url', { alertId: 'alert-123' })
      ).rejects.toThrow(TwilioVoiceError);

      await expect(
        service.initiateCall(validPhoneNumber, '', { alertId: 'alert-123' })
      ).rejects.toThrow('Invalid voice message URL');
    });

    it('should handle Twilio API error 21211 (invalid number)', async () => {
      mockTwilioClient.calls.create.mockRejectedValue({
        code: 21211,
        message: 'Invalid phone number',
      });

      await expect(
        service.initiateCall(validPhoneNumber, validVoiceMessageUrl, { alertId: 'alert-123' })
      ).rejects.toThrow('Invalid phone number');
    });

    it('should handle Twilio API error 21608 (unverified number)', async () => {
      mockTwilioClient.calls.create.mockRejectedValue({
        code: 21608,
        message: 'Phone number not verified',
      });

      await expect(
        service.initiateCall(validPhoneNumber, validVoiceMessageUrl, { alertId: 'alert-123' })
      ).rejects.toThrow('Phone number not verified');
    });

    it('should handle generic Twilio API errors', async () => {
      mockTwilioClient.calls.create.mockRejectedValue({
        code: 20003,
        message: 'Authentication error',
      });

      await expect(
        service.initiateCall(validPhoneNumber, validVoiceMessageUrl, { alertId: 'alert-123' })
      ).rejects.toThrow(TwilioVoiceError);
    });

    it('should handle network errors', async () => {
      mockTwilioClient.calls.create.mockRejectedValue(new Error('Network timeout'));

      await expect(
        service.initiateCall(validPhoneNumber, validVoiceMessageUrl, { alertId: 'alert-123' })
      ).rejects.toThrow('Failed to initiate call');
    });

    it('should throw configuration error when credentials and secret are missing', async () => {
      const serviceWithoutCreds = new TwilioVoiceService({
        accountSid: '',
        authToken: '',
        fromNumber: '',
        secretId: '',
        webhookBaseUrl: 'https://api.test.com',
      });

      await expect(
        serviceWithoutCreds.initiateCall(validPhoneNumber, validVoiceMessageUrl, {
          alertId: 'alert-123',
        })
      ).rejects.toThrow('Twilio credentials not configured');
    });
  });

  describe('processCallStatusWebhook', () => {
    let service: TwilioVoiceService;

    beforeEach(() => {
      service = createService();
    });

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

    it('should process answered call webhook', () => {
      const webhookData = {
        CallSid: 'CA1234567890abcdef',
        CallStatus: 'answered',
        To: '+15559876543',
        From: '+15551234567',
      };

      const event = service.processCallStatusWebhook(webhookData);

      expect(event.status).toBe('answered');
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
        errorCode: '30008',
        errorMessage: 'Unknown destination',
      });
    });
  });

  describe('validateWebhookSignature', () => {
    let service: TwilioVoiceService;

    beforeEach(() => {
      service = createService();
    });

    const signature = 'test_signature';
    const url = 'https://api.test.com/webhooks/twilio/voice/status';
    const params = {
      CallSid: 'CA1234567890abcdef',
      CallStatus: 'completed',
    };

    it('should validate correct signature', async () => {
      validateRequest.mockReturnValue(true);

      const isValid = await service.validateWebhookSignature(signature, url, params);

      expect(isValid).toBe(true);
      expect(validateRequest).toHaveBeenCalledWith(baseOptions.authToken, signature, url, params);
    });

    it('should reject invalid signature', async () => {
      validateRequest.mockReturnValue(false);

      const isValid = await service.validateWebhookSignature(signature, url, params);

      expect(isValid).toBe(false);
    });

    it('should handle validation errors gracefully', async () => {
      validateRequest.mockImplementation(() => {
        throw new Error('Validation error');
      });

      const isValid = await service.validateWebhookSignature(signature, url, params);

      expect(isValid).toBe(false);
    });
  });

  describe('secrets manager integration', () => {
    it('should load credentials from secrets manager when env not provided', async () => {
      // Spy on env properties instead of mutating them
      const accountSidSpy = jest.spyOn(env.twilio, 'accountSid', 'get').mockReturnValue('');
      const authTokenSpy = jest.spyOn(env.twilio, 'authToken', 'get').mockReturnValue('');
      const phoneNumberSpy = jest.spyOn(env.twilio, 'phoneNumber', 'get').mockReturnValue('');
      const secretIdSpy = jest.spyOn(env.twilio, 'secretId', 'get').mockReturnValue('');

      const secretsLoader = jest.fn().mockResolvedValue({
        account_sid: 'secret_account_sid',
        auth_token: 'secret_auth_token',
        phone_number: '+15550001111',
      });

      const secretClient: TwilioMockClient = {
        calls: {
          create: jest.fn().mockResolvedValue({
            sid: 'CAsecret123',
            status: 'queued',
            to: '+15559876543',
            from: '+15550001111',
          }),
        },
      };
      Twilio.mockImplementationOnce(() => secretClient);

      try {
        const service = new TwilioVoiceService({
          webhookBaseUrl: 'https://api.test.com',
          secretId: 'berthcare/staging/twilio',
          secretsLoader,
        });

        await service.initiateCall('+15559876543', 'https://s3.amazonaws.com/bucket/message.mp3', {
          alertId: 'alert-123',
        });

        expect(secretsLoader).toHaveBeenCalledWith('berthcare/staging/twilio', expect.any(Number));
        expect(Twilio).toHaveBeenLastCalledWith('secret_account_sid', 'secret_auth_token');
      } finally {
        // Restore spies
        accountSidSpy.mockRestore();
        authTokenSpy.mockRestore();
        phoneNumberSpy.mockRestore();
        secretIdSpy.mockRestore();
      }
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
