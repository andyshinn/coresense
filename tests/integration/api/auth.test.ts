import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { apiKeyAuth, checkWsKey, getApiKey } from '../../../src/main/api/middleware/auth';

function app() {
  const a = new Hono();
  a.use('/api/*', apiKeyAuth);
  a.get('/api/capabilities', (c) => c.json({ ok: true }));
  a.get('/api/status', (c) => c.json({ ok: true }));
  return a;
}

describe('apiKeyAuth', () => {
  it('lets the public capabilities probe through without a key', async () => {
    expect((await app().request('/api/capabilities')).status).toBe(200);
  });

  it('rejects a request with no Authorization header', async () => {
    expect((await app().request('/api/status')).status).toBe(401);
  });

  it('rejects a wrong key, including one of a different length', async () => {
    const key = getApiKey();
    const wrong = `${key.slice(0, -1)}${key.endsWith('0') ? '1' : '0'}`;
    for (const k of [wrong, 'short']) {
      const res = await app().request('/api/status', { headers: { Authorization: `Bearer ${k}` } });
      expect(res.status).toBe(401);
    }
  });

  it('accepts the stored key', async () => {
    const res = await app().request('/api/status', { headers: { Authorization: `Bearer ${getApiKey()}` } });
    expect(res.status).toBe(200);
  });
});

describe('checkWsKey', () => {
  it('accepts only the stored key', () => {
    expect(checkWsKey(getApiKey())).toBe(true);
    expect(checkWsKey('nope')).toBe(false);
    expect(checkWsKey(null)).toBe(false);
    expect(checkWsKey(undefined)).toBe(false);
  });
});
