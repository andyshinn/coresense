import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, parseServerError, parseServerErrorCode } from '@/lib/api';

const client = { baseUrl: 'http://x', apiKey: 'k' };

describe('parseServerError', () => {
  it('extracts the error field from a JSON body', () => {
    expect(parseServerError('{"error":"Contact list full"}')).toBe('Contact list full');
  });

  it('returns null for a non-JSON body', () => {
    expect(parseServerError('Internal Server Error')).toBeNull();
  });

  it('returns null when error is absent or not a string', () => {
    expect(parseServerError('{"ok":true}')).toBeNull();
    expect(parseServerError('{"error":123}')).toBeNull();
  });
});

describe('parseServerErrorCode', () => {
  it('extracts the code field from a JSON body', () => {
    expect(parseServerErrorCode('{"error":"no reply","code":"cli_timeout"}')).toBe('cli_timeout');
  });

  it('returns null for a non-JSON body or an absent/non-string code', () => {
    expect(parseServerErrorCode('Internal Server Error')).toBeNull();
    expect(parseServerErrorCode('{"error":"x"}')).toBeNull();
    expect(parseServerErrorCode('{"code":503}')).toBeNull();
  });
});

describe('repeaterCli', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts command + expectReply and forwards the abort signal', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ ok: true, reply: 'radio: 869.525' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const ctrl = new AbortController();

    const res = await api.repeaterCli(client, 'c:abc', 'get radio', {
      expectReply: true,
      signal: ctrl.signal,
    });

    expect(res).toEqual({ ok: true, reply: 'radio: 869.525' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ command: 'get radio', expectReply: true });
    expect(init.signal).toBe(ctrl.signal);
  });

  it('omits expectReply from the body when unspecified', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ ok: true, reply: 'ok' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api.repeaterCli(client, 'c:abc', 'get radio');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ command: 'get radio' });
  });

  it('returns { sent: true } on a 202 no-reply response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true, sent: true }), { status: 202 })),
    );

    const res = await api.repeaterCli(client, 'c:abc', 'set advert.interval 30', { expectReply: false });

    expect(res).toEqual({ ok: true, sent: true });
  });

  it('throws an ApiError carrying the status and code on a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'no reply', code: 'cli_timeout' }), { status: 504 })),
    );

    const promise = api.repeaterCli(client, 'c:abc', 'get radio');
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      name: 'ApiError',
      status: 504,
      code: 'cli_timeout',
      message: 'no reply',
    });
  });
});
