import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

import { createGlobalRateLimiter } from '../src/middleware/global-rate-limiter';

describe('createGlobalRateLimiter', () => {
  const buildApp = (windowMs = 200, maxRequests = 2, key?: string) => {
    const app = express();

    const limiter = createGlobalRateLimiter({
      windowMs,
      maxRequests,
      keyGenerator: key ? (req) => req.header('x-test-key') ?? 'anonymous' : undefined,
    });

    app.use(limiter);

    app.get('/test', (_req, res) => {
      res.json({ status: 'ok' });
    });

    return { app, limiter };
  };

  it('allows requests under the rate limit', async () => {
    const { app, limiter } = buildApp();
    try {
      const first = await request(app).get('/test');
      expect(first.status).toBe(200);
      expect(first.headers['x-ratelimit-limit']).toBe('2');
      expect(first.headers['x-ratelimit-remaining']).toBe('1');

      const second = await request(app).get('/test');
      expect(second.status).toBe(200);
      expect(second.headers['x-ratelimit-remaining']).toBe('0');
    } finally {
      limiter.stopCleanup();
    }
  });

  it('blocks requests that exceed the rate limit and returns retry metadata', async () => {
    const { app, limiter } = buildApp();
    try {
      await request(app).get('/test');
      await request(app).get('/test');

      const third = await request(app).get('/test');

      expect(third.status).toBe(429);
      expect(third.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(third.headers['retry-after']).toBeDefined();
    } finally {
      limiter.stopCleanup();
    }
  });

  it('resets counts after the window passes and supports custom key generator', () => {
    const limiter = createGlobalRateLimiter({
      windowMs: 100,
      maxRequests: 1,
      keyGenerator: (req) => req.header?.('x-test-key') ?? req.ip ?? 'unknown',
    });

    const makeRequest = (key: string): Request =>
      ({
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
        header: (headerName: string) => (headerName === 'x-test-key' ? key : undefined),
      }) as unknown as Request;

    const createResponse = () => {
      const response = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        body: undefined as unknown,
        setHeader(header: string, value: string) {
          this.headers[header] = value;
        },
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(payload: unknown) {
          this.body = payload;
          return this;
        },
      };
      return response as Response & {
        statusCode: number;
        headers: Record<string, string>;
        body: unknown;
      };
    };

    const clock = jest.spyOn(Date, 'now');

    try {
      // Initial request at t=0 -> allowed
      clock.mockReturnValue(0);
      const res1 = createResponse();
      const next1 = jest.fn();
      limiter(makeRequest('user-a'), res1, next1 as unknown as NextFunction);
      expect(next1).toHaveBeenCalledTimes(1);
      expect(res1.headers['X-RateLimit-Remaining']).toBe('0');

      // Second request before window expires -> blocked
      clock.mockReturnValue(50);
      const res2 = createResponse();
      const next2 = jest.fn();
      limiter(makeRequest('user-a'), res2, next2 as unknown as NextFunction);
      expect(res2.statusCode).toBe(429);
      expect(res2.body).toMatchObject({
        error: { code: 'RATE_LIMIT_EXCEEDED' },
      });
      expect(next2).not.toHaveBeenCalled();

      // Same user after window expires -> allowed again
      clock.mockReturnValue(150);
      expect(Date.now()).toBe(150);
      const res3 = createResponse();
      const next3 = jest.fn();
      limiter(makeRequest('user-a'), res3, next3 as unknown as NextFunction);
      expect(res3.statusCode).toBe(200);
      expect(next3).toHaveBeenCalledTimes(1);

      // Different key should not share rate limits
      const res4 = createResponse();
      const next4 = jest.fn();
      limiter(makeRequest('user-b'), res4, next4 as unknown as NextFunction);
      expect(next4).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
      limiter.stopCleanup();
    }
  });
});
