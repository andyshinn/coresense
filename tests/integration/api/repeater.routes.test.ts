import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AdminSessionState, adminSessions } from '../../../src/main/bridge/adminSession';
import type { SessionAdapter } from '../../../src/main/protocol/sessionAdapter';
import type {
  ApiErrorBody,
  OkResponse,
  RepeaterAclResponse,
  RepeaterLocalStatsResponse,
  RepeaterLoginResponse,
  RepeaterNeighboursResponse,
  RepeaterOwnerResponse,
  RepeaterSessionResponse,
} from '../../../src/shared/api/contract';
import { installSessionStub, json, testRoutes } from '../../support/api';
import { makeTestSession } from '../../support/session-harness';

const PK = 'cc'.repeat(32);
const KEY = `c:${PK}`;
const BASE = `/api/repeater/c%3A${PK}`;

type LibLogin = Awaited<ReturnType<SessionAdapter['session']['repeaterLogin']>>;

const LOGIN: LibLogin = {
  permissions: 1,
  pubKeyPrefixHex: PK.slice(0, 12),
  serverTagHex: null,
  aclPermissions: 0x03,
  firmwareVerLevel: 2,
  isAdmin: true,
  mode: 'remote',
  effective: 'flood',
};

const SESSION: AdminSessionState = {
  contactKey: KEY,
  publicKeyHex: PK,
  mode: 'remote',
  role: 'admin',
  permissionsBits: 1,
  aclPermissionsBits: 3,
  aclRole: 'admin',
  firmwareVerLevel: 2,
  loggedInAt: 1_750_000_000_000,
};

const post = (path: string, init: RequestInit = { method: 'POST' }) => testRoutes().request(path, init);

/** A real SessionAdapter over a loopback transport, installed as
 *  protocolSession(), so the adapter's own adminSessions bookkeeping runs.
 *  Only the library call is replaced. */
function realAdapter() {
  const { adapter } = makeTestSession({ installAsProtocolSession: true });
  return adapter.session;
}

beforeEach(() => adminSessions.clearSession(KEY));

describe('GET /api/repeater/:key/session', () => {
  it('answers null before any login', async () => {
    const res = await testRoutes().request(`${BASE}/session`);

    expect(res.status).toBe(200);
    expect((await res.json()) as RepeaterSessionResponse).toEqual({ session: null });
  });

  it('serves the recorded admin session', async () => {
    adminSessions.setSession(SESSION);

    const res = await testRoutes().request(`${BASE}/session`);

    expect((await res.json()) as RepeaterSessionResponse).toEqual({ session: SESSION });
  });
});

describe('POST /api/repeater/:key/login', () => {
  it('logs in and answers with the recorded session and the login result', async () => {
    const lib = realAdapter();
    const login = vi.spyOn(lib, 'repeaterLogin').mockResolvedValue(LOGIN);

    const res = await post(`${BASE}/login`, json('POST', { password: 'hunter2' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as RepeaterLoginResponse;
    expect(login).toHaveBeenCalledWith(KEY, 'hunter2');
    expect(body.ok).toBe(true);
    expect(body.login).toEqual(LOGIN);
    expect(body.session).toMatchObject({ contactKey: KEY, publicKeyHex: PK, role: 'admin', aclRole: 'admin' });
    expect(adminSessions.getSession(KEY)).toEqual(body.session);
  });

  it('accepts an empty password (a guest login)', async () => {
    const lib = realAdapter();
    const login = vi.spyOn(lib, 'repeaterLogin').mockResolvedValue({ ...LOGIN, isAdmin: false });

    const res = await post(`${BASE}/login`, json('POST', { password: '' }));

    expect(res.status).toBe(200);
    expect(login).toHaveBeenCalledWith(KEY, '');
    expect(adminSessions.getSession(KEY)?.role).toBe('guest');
  });

  it('answers 503 and records no session when the login fails', async () => {
    const lib = realAdapter();
    vi.spyOn(lib, 'repeaterLogin').mockRejectedValue(new Error('login timed out'));

    const res = await post(`${BASE}/login`, json('POST', { password: 'hunter2' }));

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'login timed out' });
    expect(adminSessions.getSession(KEY)).toBeNull();
  });
});

describe('POST /api/repeater/:key/logout', () => {
  it('logs out and clears the recorded session', async () => {
    const lib = realAdapter();
    const logout = vi.spyOn(lib, 'repeaterLogout').mockResolvedValue();
    adminSessions.setSession(SESSION);

    const res = await post(`${BASE}/logout`);

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(logout).toHaveBeenCalledWith(KEY);
    expect(adminSessions.getSession(KEY)).toBeNull();
  });

  it('answers 503 and keeps the session when the logout fails', async () => {
    const lib = realAdapter();
    vi.spyOn(lib, 'repeaterLogout').mockRejectedValue(new Error('not connected'));
    adminSessions.setSession(SESSION);

    const res = await post(`${BASE}/logout`);

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'not connected' });
    expect(adminSessions.getSession(KEY)).toEqual(SESSION);
  });
});

describe('POST /api/repeater/:key/status', () => {
  it.each([['status', 'sendStatusReq']] as const)('%s: acknowledges the accepted request', async (path, method) => {
    const send = vi.fn((_key: string) => Promise.resolve({ ok: true }));
    installSessionStub({ [method]: send });

    const res = await post(`${BASE}/${path}`);

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(KEY);
  });

  it.each([['status', 'sendStatusReq']] as const)(
    '%s: answers 503 with the radio error when the request is refused',
    async (path, method) => {
      installSessionStub({ [method]: () => Promise.resolve({ ok: false, error: 'unknown contact' }) });

      const res = await post(`${BASE}/${path}`);

      expect(res.status).toBe(503);
      expect((await res.json()) as ApiErrorBody).toEqual({ error: 'unknown contact' });
    },
  );
});

describe('POST /api/repeater/:key/acl', () => {
  it('answers with the ACL entries', async () => {
    const entries = [
      { pubKeyPrefixHex: '010101010101', permissions: 3, role: 'admin', isAdmin: true, isGuest: false },
    ] as const;
    const requestAcl = vi.fn((_key: string) => Promise.resolve([...entries]));
    installSessionStub({ repeaterRequestAcl: requestAcl });

    const res = await post(`${BASE}/acl`);

    expect(res.status).toBe(200);
    expect((await res.json()) as RepeaterAclResponse).toEqual({ ok: true, entries });
    expect(requestAcl).toHaveBeenCalledWith(KEY);
  });

  it('answers 503 with the message when the request fails', async () => {
    installSessionStub({ repeaterRequestAcl: () => Promise.reject(new Error('not logged in')) });

    const res = await post(`${BASE}/acl`);

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'not logged in' });
  });
});

describe('POST /api/repeater/:key/neighbours', () => {
  const PAGE = { total: 1, neighbours: [{ pubKeyPrefixHex: '0a0b0c0d', heardSecsAgo: 30, snrDb: 7.5 }] };

  function neighboursStub() {
    const request = vi.fn((_key: string, _opts: Parameters<SessionAdapter['repeaterRequestNeighbours']>[1]) =>
      Promise.resolve(PAGE),
    );
    installSessionStub({ repeaterRequestNeighbours: request });
    return request;
  }

  it('passes the paging options through and answers with the page', async () => {
    const request = neighboursStub();

    const res = await post(`${BASE}/neighbours`, json('POST', { count: 10, offset: 20, orderBy: 1, prefixLen: 4 }));

    expect(res.status).toBe(200);
    expect((await res.json()) as RepeaterNeighboursResponse).toEqual({ ok: true, page: PAGE });
    expect(request).toHaveBeenCalledWith(KEY, { count: 10, offset: 20, orderBy: 1, prefixLen: 4 });
  });

  it('answers 503 with the message when the request fails', async () => {
    installSessionStub({ repeaterRequestNeighbours: () => Promise.reject(new Error('timed out')) });

    const res = await post(`${BASE}/neighbours`);

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'timed out' });
  });
});

describe('POST /api/repeater/:key/owner', () => {
  it('answers with the owner info', async () => {
    const info = { firmwareVersion: 'v1.15.0', nodeName: 'Hilltop', ownerInfo: 'ops@example' };
    const request = vi.fn((_key: string) => Promise.resolve(info));
    installSessionStub({ repeaterRequestOwnerInfo: request });

    const res = await post(`${BASE}/owner`);

    expect(res.status).toBe(200);
    expect((await res.json()) as RepeaterOwnerResponse).toEqual({ ok: true, info });
    expect(request).toHaveBeenCalledWith(KEY);
  });

  it('answers 503 with the message when the request fails', async () => {
    installSessionStub({ repeaterRequestOwnerInfo: () => Promise.reject(new Error('timed out')) });

    const res = await post(`${BASE}/owner`);

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'timed out' });
  });
});

describe('POST /api/repeater/local/stats', () => {
  const CORE = { kind: 'core', battMv: 4100, uptimeSecs: 3600, errFlags: 0, queueLen: 0 } as const;

  function statsStub() {
    const request = vi.fn((_subtype: Parameters<SessionAdapter['repeaterGetLocalStats']>[0]) =>
      Promise.resolve({ ...CORE }),
    );
    installSessionStub({ repeaterGetLocalStats: request });
    return request;
  }

  it('asks for CORE stats by default and answers with them', async () => {
    const request = statsStub();

    const res = await post('/api/repeater/local/stats');

    expect(res.status).toBe(200);
    expect((await res.json()) as RepeaterLocalStatsResponse).toEqual({ ok: true, stats: CORE });
    expect(request).toHaveBeenCalledWith('CORE');
  });

  it('asks for the requested subtype', async () => {
    const request = statsStub();

    await post('/api/repeater/local/stats', json('POST', { subtype: 'PACKETS' }));

    expect(request).toHaveBeenCalledWith('PACKETS');
  });

  it('answers 503 with the message when the request fails', async () => {
    installSessionStub({ repeaterGetLocalStats: () => Promise.reject(new Error('RESP_ERR')) });

    const res = await post('/api/repeater/local/stats');

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'RESP_ERR' });
  });
});
