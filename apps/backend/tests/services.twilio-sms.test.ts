/**
 * Twilio SMS Service Tests
 *
 * Exercises the happy path, validation errors, webhook handling,
 * signature verification, secrets manager integration, and rate limiting.
 * Each service instance is closed after use to avoid open handles that
 * would prevent Jest from exiting cleanly.
 */

import { env } from '../src/config/env';
import { logDebug, logInfo } from '../src/config/logger';
import { TwilioSMSService } from '../src/services/twilio-sms.service';

jest.mock('../src/config/logger', () => ({
  logDebug: jest.fn(),
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

// Mock the Twilio SDK so we do not hit the network.
jest.mock('twilio', () => ({
  Twilio: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn(),
    },
  })),
}));

// Mock webhook signature validation helper.
jest.mock('twilio/lib/webhooks/webhooks', () => ({
  validateRequest: jest.fn(),
}));

type MockTwilioCtor = jest.Mock<
  {
    messages: {
      create: jest.Mock;
    };
  },
  [string, string]
>;

describe('TwilioSMSService', () => {
  const activeServices: TwilioSMSService[] = [];

  type ServiceOptions = ConstructorParameters<typeof TwilioSMSService>[0];

  const getTwilioMock = (): MockTwilioCtor => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports,@typescript-eslint/no-var-requires
    const { Twilio } = require('twilio') as { Twilio: MockTwilioCtor };
    return Twilio;
  };

  const latestClient = () => {
    const Twilio = getTwilioMock();
    if (Twilio.mock.results.length === 0) {
      throw new Error('latestClient called before any Twilio mock instances were created');
    }
    const latestCall = Twilio.mock.results[Twilio.mock.results.length - 1];
    return latestCall.value as { messages: { create: jest.Mock } };
  };

  const makeService = (overrides: ServiceOptions = {}) => {
    const service = new TwilioSMSService({
      accountSid: 'acct',
      authToken: 'token',
      fromNumber: '+15550001111',
      webhookBaseUrl: 'https://example.org',
      rateLimiter: { useRedis: false },
      ...overrides,
    });
    activeServices.push(service);
    return service;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await Promise.all(activeServices.splice(0).map((service) => service.close()));
  });

  describe('constructor', () => {
    it('initialises the Twilio client when credentials are provided', () => {
      makeService();

      const Twilio = getTwilioMock();
      expect(Twilio).toHaveBeenCalledWith('acct', 'token');
    });

    it('normalises webhook base url and rejects invalid values', () => {
      const service = makeService({ webhookBaseUrl: 'https://example.org/' });
      expect(service.getWebhookBaseUrl()).toBe('https://example.org');

      expect(() =>
        makeService({
          webhookBaseUrl: 'not-a-url',
          accountSid: 'sid',
          authToken: 'token',
          fromNumber: '+15550002222',
        })
      ).toThrow(/Invalid webhook base URL format/);
    });
  });

  describe('sendSMS', () => {
    const recipient = '+15551234567';
    const message = 'Hello from BerthCare';

    it('sends a message and returns a normalised result', async () => {
      const service = makeService();
      latestClient().messages.create.mockResolvedValue({
        sid: 'SM123',
        status: 'SENT',
        to: recipient,
        from: '+15550001111',
      });

      const result = await service.sendSMS(recipient, message);

      expect(result).toMatchObject({
        messageSid: 'SM123',
        status: 'sent',
        to: recipient,
        from: '+15550001111',
        body: message,
      });

      expect(latestClient().messages.create).toHaveBeenCalledWith({
        to: recipient,
        from: '+15550001111',
        body: message,
        statusCallback: 'https://example.org/webhooks/twilio/sms/status',
      });

      expect(logDebug).toHaveBeenCalledWith(
        'Twilio SMS status',
        expect.objectContaining({
          to: expect.stringMatching(/^\+\*+4567$/),
          from: expect.stringMatching(/^\+\*+1111$/),
        })
      );
    });

    it('validates phone numbers and message content', async () => {
      const service = makeService();

      await expect(service.sendSMS('12345', message)).rejects.toThrow(/E\.164/);
      await expect(service.sendSMS('+15551234567', '')).rejects.toThrow('Message body cannot be');
      await expect(service.sendSMS('+15551234567', 'a'.repeat(1601))).rejects.toThrow(
        'Message body too long'
      );
    });

    it('maps known Twilio error codes to friendly errors', async () => {
      const service = makeService();
      latestClient().messages.create.mockRejectedValue({
        code: 21610,
        message: 'User opted out',
      });

      await expect(service.sendSMS(recipient, message)).rejects.toMatchObject({
        code: 'OPTED_OUT',
      });
    });

    it('raises a generic Twilio error for unknown codes', async () => {
      const service = makeService();
      latestClient().messages.create.mockRejectedValue({
        code: 99999,
        message: 'Unknown',
      });

      await expect(service.sendSMS(recipient, message)).rejects.toMatchObject({
        code: 'TWILIO_API_ERROR',
      });
    });

    it('wraps unexpected failures', async () => {
      const service = makeService();
      latestClient().messages.create.mockRejectedValue(new Error('Network down'));

      await expect(service.sendSMS(recipient, message)).rejects.toMatchObject({
        code: 'SMS_SEND_FAILED',
      });
    });
  });

  describe('rate limiting', () => {
    const recipient = '+15559876543';

    it('enforces the hourly per-user limit', async () => {
      const service = makeService();
      latestClient().messages.create.mockResolvedValue({
        sid: 'SMR1',
        status: 'queued',
        to: recipient,
        from: '+15550001111',
      });

      // Set count to limit (100) directly instead of looping
      await service.setSMSCountForTesting('user-1', 100);

      await expect(service.sendSMS(recipient, 'over the limit', 'user-1')).rejects.toMatchObject({
        code: 'RATE_LIMIT_EXCEEDED',
      });
    });

    it('tracks quotas separately per user', async () => {
      const service = makeService();
      latestClient().messages.create.mockResolvedValue({
        sid: 'SMR2',
        status: 'queued',
        to: recipient,
        from: '+15550001111',
      });

      // Set user-1 to limit directly instead of looping
      await service.setSMSCountForTesting('user-1', 100);

      await expect(service.sendSMS(recipient, 'blocked', 'user-1')).rejects.toMatchObject({
        code: 'RATE_LIMIT_EXCEEDED',
      });

      // user-2 should still be allowed (separate quota)
      await expect(service.sendSMS(recipient, 'allowed', 'user-2')).resolves.toBeDefined();
    });

    it('can report and reset usage counts', async () => {
      const service = makeService();
      latestClient().messages.create.mockResolvedValue({
        sid: 'SMR3',
        status: 'queued',
        to: recipient,
        from: '+15550001111',
      });

      await service.sendSMS(recipient, 'first', 'user-123');
      expect(await service.getSMSCount('user-123')).toBe(1);

      await service.resetRateLimit('user-123');
      expect(await service.getSMSCount('user-123')).toBe(0);
    });
  });

  describe('processSMSStatusWebhook', () => {
    it('normalises webhook payloads and logs delivered messages', () => {
      const service = makeService();

      const event = service.processSMSStatusWebhook({
        MessageSid: 'SMABC',
        MessageStatus: 'DELIVERED',
        To: '+15550001111',
        From: '+15550002222',
        Body: 'Hello!',
      });

      expect(event).toMatchObject({
        messageSid: 'SMABC',
        status: 'delivered',
        to: '+15550001111',
        from: '+15550002222',
        body: 'Hello!',
      });

      expect(logInfo).toHaveBeenCalledWith(
        'Twilio SMS delivered',
        expect.objectContaining({
          to: expect.stringMatching(/^\+\*+1111$/),
          from: expect.stringMatching(/^\+\*+2222$/),
        })
      );
    });

    it('throws when Twilio omits required fields', () => {
      const service = makeService();

      expect(() => service.processSMSStatusWebhook({})).toThrow('messageSid');
      expect(() => service.processSMSStatusWebhook({ MessageSid: 'SM123' })).toThrow(
        'status is required'
      );
    });
  });

  describe('validateWebhookSignature', () => {
    it('delegates to Twilio helper and returns its result', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports,@typescript-eslint/no-var-requires
      const { validateRequest } = require('twilio/lib/webhooks/webhooks') as {
        validateRequest: jest.Mock;
      };
      const service = makeService();
      validateRequest.mockReturnValue(true);

      const ok = await service.validateWebhookSignature('sig', 'https://example.org/hook', {
        MessageSid: 'SM1',
      });

      expect(ok).toBe(true);
      expect(validateRequest).toHaveBeenCalledWith('token', 'sig', 'https://example.org/hook', {
        MessageSid: 'SM1',
      });
    });

    it('returns false when signature validation throws', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports,@typescript-eslint/no-var-requires
      const { validateRequest } = require('twilio/lib/webhooks/webhooks') as {
        validateRequest: jest.Mock;
      };
      const service = makeService();
      validateRequest.mockImplementation(() => {
        throw new Error('bad signature');
      });

      await expect(
        service.validateWebhookSignature('sig', 'https://example.org/hook', { MessageSid: 'SM2' })
      ).resolves.toBe(false);
    });
  });

  describe('secrets manager integration', () => {
    let originalTwilioConfig: typeof env.twilio;

    beforeEach(() => {
      originalTwilioConfig = { ...env.twilio };
      Object.assign(env.twilio, {
        accountSid: '',
        authToken: '',
        phoneNumber: '',
        secretId: '',
      });
    });

    afterEach(() => {
      Object.assign(env.twilio, originalTwilioConfig);
    });

    it('lazily loads credentials when env vars are absent', async () => {
      jest.clearAllMocks();
      const secretsLoader = jest.fn().mockResolvedValue({
        account_sid: 'secret-sid',
        auth_token: 'secret-token',
        phone_number: '+15550009999',
      });

      const Twilio = getTwilioMock();
      Twilio.mockImplementationOnce(() => ({
        messages: {
          create: jest.fn().mockResolvedValue({
            sid: 'SMSECRET',
            status: 'sent',
            to: '+15551230000',
            from: '+15550009999',
          }),
        },
      }));

      const service = new TwilioSMSService({
        webhookBaseUrl: 'https://example.org',
        secretId: 'berthcare/dev/twilio',
        secretsLoader,
        rateLimiter: { useRedis: false },
      });
      activeServices.push(service);

      const result = await service.sendSMS('+15551230000', 'Secret hello', 'user-secret');

      expect(result.from).toBe('+15550009999');
      expect(secretsLoader).toHaveBeenCalledWith('berthcare/dev/twilio', expect.any(Number));
      expect(Twilio).toHaveBeenLastCalledWith('secret-sid', 'secret-token');
    });

    it('throws when the secret payload is incomplete', async () => {
      jest.clearAllMocks();
      const secretsLoader = jest.fn().mockResolvedValue({
        account_sid: 'sid',
      });

      const service = new TwilioSMSService({
        webhookBaseUrl: 'https://example.org',
        secretId: 'missing',
        secretsLoader,
        rateLimiter: { useRedis: false },
      });
      activeServices.push(service);

      await expect(service.sendSMS('+15551239999', 'Secret fail', 'user')).rejects.toMatchObject({
        code: 'TWILIO_API_ERROR',
        details: expect.objectContaining({
          code: 'CONFIGURATION_ERROR',
          message: 'Twilio secret missing required fields',
        }),
      });
      expect(secretsLoader).toHaveBeenCalledWith('missing', expect.any(Number));
    });
  });
});
