import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { basicAuth, isUuid } from '../src/server/middleware.js';
import { strategySchema, generatePostSchema } from '../src/server/schemas.js';
import { isValidCron } from '../src/core/scheduler.js';
import { retryDelayMs } from '../src/core/queue.js';
import { NonRetryableError, isRetryable } from '../src/core/errors.js';

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; },
  };
  return res;
}

function run(auth: ReturnType<typeof basicAuth>, path: string, authorization?: string) {
  const req = { path, headers: authorization ? { authorization } : {} } as unknown as Request;
  const res = mockRes();
  const next = vi.fn();
  auth(req, res as unknown as Response, next);
  return { res, next };
}

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

describe('basicAuth', () => {
  const auth = basicAuth({ username: 'admin', password: 's3cret', publicPaths: ['/api/twitter/callback'] });

  it('allows everything when no password is configured', () => {
    const open = basicAuth({ username: 'admin', publicPaths: [] });
    expect(run(open, '/api/posts').next).toHaveBeenCalled();
  });

  it('rejects missing or wrong credentials', () => {
    const missing = run(auth, '/api/posts');
    expect(missing.next).not.toHaveBeenCalled();
    expect(missing.res.statusCode).toBe(401);
    expect(missing.res.headers['WWW-Authenticate']).toContain('Basic');

    expect(run(auth, '/api/posts', basic('admin', 'wrong')).next).not.toHaveBeenCalled();
  });

  it('accepts valid credentials, including passwords containing colons', () => {
    const withColon = basicAuth({ username: 'admin', password: 'a:b', publicPaths: [] });
    expect(run(withColon, '/', basic('admin', 'a:b')).next).toHaveBeenCalled();
    expect(run(auth, '/', basic('admin', 's3cret')).next).toHaveBeenCalled();
  });

  it('skips public paths', () => {
    expect(run(auth, '/api/twitter/callback').next).toHaveBeenCalled();
  });
});

describe('request schemas', () => {
  it('rejects an invalid cron expression', () => {
    const result = strategySchema.safeParse({ cronExpression: 'every day' });
    expect(result.success).toBe(false);
  });

  it('requires a prompt for active strategies', () => {
    expect(strategySchema.safeParse({ active: true, promptTemplate: '' }).success).toBe(false);
    expect(strategySchema.safeParse({ active: true, promptTemplate: 'Write about cats' }).success).toBe(true);
  });

  it('keeps extra UI fields on strategies', () => {
    const parsed = strategySchema.parse({ role: 'pr' });
    expect(parsed).toMatchObject({ role: 'pr', active: false, cronExpression: '0 */4 * * *' });
  });

  it('validates generate requests', () => {
    expect(generatePostSchema.safeParse({
      projectId: 'not-a-uuid', platform: 'twitter', tone: 'friendly', contentType: 'text', prompt: 'x',
    }).success).toBe(false);
    expect(generatePostSchema.safeParse({
      projectId: '4f7a3b8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b', platform: 'myspace', tone: 'friendly', contentType: 'text', prompt: 'x',
    }).success).toBe(false);
  });
});

describe('isRetryable', () => {
  it('does not retry client errors or NonRetryableError', () => {
    expect(isRetryable(new NonRetryableError('nope'))).toBe(false);
    expect(isRetryable(Object.assign(new Error('bad key'), { status: 400 }))).toBe(false);
    expect(isRetryable(Object.assign(new Error('forbidden'), { code: 403 }))).toBe(false);
  });

  it('retries rate limits, server errors and unknown failures', () => {
    expect(isRetryable(Object.assign(new Error('slow down'), { status: 429 }))).toBe(true);
    expect(isRetryable(Object.assign(new Error('oops'), { code: 503 }))).toBe(true);
    expect(isRetryable(new Error('ECONNRESET'))).toBe(true);
    // Node error codes are strings and must not be mistaken for HTTP statuses
    expect(isRetryable(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(true);
  });
});

describe('helpers', () => {
  it('isUuid', () => {
    expect(isUuid('4f7a3b8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b')).toBe(true);
    expect(isUuid("1' OR '1'='1")).toBe(false);
  });

  it('isValidCron', () => {
    expect(isValidCron('0 9,13,18 * * *')).toBe(true);
    expect(isValidCron('61 * * * *')).toBe(false);
  });

  it('retryDelayMs grows exponentially and is capped', () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(20)).toBe(30 * 60 * 1000);
  });
});
