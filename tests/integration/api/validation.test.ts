import { beforeEach, describe, expect, it, vi } from 'vitest';
import { macrosStore, resetMacrosCacheForTests } from '../../../src/main/macros/store';
import { hasApiKey } from '../../../src/main/map/api-key';
import type { SessionAdapter } from '../../../src/main/protocol/sessionAdapter';
import { stateHolder } from '../../../src/main/state/holder';
import { transportManager } from '../../../src/main/transport/manager';
import type { ITransport } from '../../../src/main/transport/types';
import type { ApiErrorBody, MacroResponse, NewBlockRule } from '../../../src/shared/api/contract';
import {
  type Channel,
  type Contact,
  DEFAULT_APP_SETTINGS,
  DEFAULT_AUTO_ADD_CONFIG,
  DEFAULT_DEVICE_IDENTITY,
  DEFAULT_GPS_CONFIG,
  DEFAULT_MAP_SETTINGS,
  DEFAULT_RADIO_SETTINGS,
  DEFAULT_TELEMETRY_POLICY,
  DEFAULT_UI_STATE,
} from '../../../src/shared/types';
import { installSessionStub, json, testRoutes } from '../../support/api';
import { captureBusEvents } from '../../support/bus';

// Every body the API reads goes through readJson(schema). A body that fails
// its schema must answer 400 `invalid_body` BEFORE anything is stored,
// broadcast or sent to the radio: these endpoints are a public surface, and a
// half-applied bad request is worse than a refused one.

const PK = 'ab'.repeat(32);
const general: Channel = { key: 'ch:General', name: 'General', kind: 'public' };
const alice: Contact = { key: `c:${PK}`, publicKeyHex: PK, name: 'Alice', kind: 'chat' };
const RULE: NewBlockRule = { type: 'name', pattern: 'Spammer', tsFrom: 0, enabled: true };

/** A radio double that records every method called on it. Any call is a
 *  failure for a rejected body, so each one also rejects. */
function tripwireRadio(): string[] {
  const calls: string[] = [];
  const stub = new Proxy(
    {},
    {
      get: (_target, prop) =>
        // Not a thenable: protocolSession() is never awaited, but be safe.
        prop === 'then'
          ? undefined
          : (..._args: unknown[]) => {
              calls.push(String(prop));
              return Promise.reject(new Error(`radio reached: ${String(prop)}`));
            },
    },
  );
  installSessionStub(stub as Partial<SessionAdapter>);
  return calls;
}

/** Answer must be the zod-driven 400, with at least one located issue. */
async function expectInvalidBody(res: Response): Promise<ApiErrorBody> {
  expect(res.status).toBe(400);
  const body = (await res.json()) as ApiErrorBody;
  expect(body.code).toBe('invalid_body');
  expect(body.issues?.length).toBeGreaterThan(0);
  return body;
}

function seedState(): void {
  const holder = stateHolder();
  holder.setAppSettings(DEFAULT_APP_SETTINGS);
  holder.setRadioSettings(DEFAULT_RADIO_SETTINGS);
  holder.setMapSettings(DEFAULT_MAP_SETTINGS);
  holder.setUiState(DEFAULT_UI_STATE);
  holder.setDrafts({ 'ch:General': 'draft' });
  holder.setDeviceIdentity({ ...DEFAULT_DEVICE_IDENTITY, name: 'Base' });
  holder.setAutoAddConfig(DEFAULT_AUTO_ADD_CONFIG);
  holder.setTelemetryPolicy(DEFAULT_TELEMETRY_POLICY);
  holder.setGpsConfig(DEFAULT_GPS_CONFIG);
  holder.setChannels([general]);
  holder.setContacts([alice]);
}

beforeEach(() => {
  resetMacrosCacheForTests();
  seedState();
});

type Method = 'POST' | 'PUT';
const REPEATER = `/api/repeater/c%3A${PK}`;
const holder = () => stateHolder();

// [label, method, path, bad body, the state that must not move]
const CASES: Array<[string, Method, string, unknown, () => unknown]> = [
  [
    'settings/app',
    'PUT',
    '/api/settings/app',
    { ...DEFAULT_APP_SETTINGS, timeFormat: '13h' },
    () => holder().getAppSettings(),
  ],
  [
    'settings/radio',
    'PUT',
    '/api/settings/radio',
    { ...DEFAULT_RADIO_SETTINGS, pathHashMode: 4 },
    () => holder().getRadioSettings(),
  ],
  [
    'settings/map',
    'PUT',
    '/api/settings/map',
    { ...DEFAULT_MAP_SETTINGS, styleTheme: 'neon' },
    () => holder().getMapSettings(),
  ],
  ['ui-state', 'PUT', '/api/ui-state', { ...DEFAULT_UI_STATE, pinned: 'ch:General' }, () => holder().getUiState()],
  ['drafts (no text)', 'PUT', '/api/drafts', { key: 'ch:General' }, () => holder().getDrafts()],
  ['device identity', 'PUT', '/api/device/identity', { name: 42 }, () => holder().getDeviceIdentity()],
  [
    'device auto-add',
    'PUT',
    '/api/device/auto-add',
    { ...DEFAULT_AUTO_ADD_CONFIG, manualAddContacts: 256 },
    () => holder().getAutoAddConfig(),
  ],
  [
    'device telemetry',
    'PUT',
    '/api/device/telemetry-policy',
    { ...DEFAULT_TELEMETRY_POLICY, base: 3 },
    () => holder().getTelemetryPolicy(),
  ],
  ['device gps', 'PUT', '/api/device/gps', { enabled: 'yes', intervalSec: 60 }, () => holder().getGpsConfig()],
  ['radio path-hash-mode', 'PUT', '/api/radio/path-hash-mode', { size: 4 }, () => holder().getRadioSettings()],
  ['channels PUT', 'PUT', '/api/channels/ch%3AGeneral', { ...general, kind: 'secret' }, () => holder().getChannels()],
  ['channels reorder', 'POST', '/api/channels/reorder', { keys: 'ch:General' }, () => holder().getChannels()],
  ['contacts PUT', 'PUT', `/api/contacts/c%3A${PK}`, { ...alice, kind: 'robot' }, () => holder().getContacts()],
  ['contacts favourite', 'PUT', `/api/contacts/c%3A${PK}/favourite`, { favourite: 'yes' }, () => holder().getContacts()],
  ['contacts path', 'PUT', `/api/contacts/c%3A${PK}/path`, { outPathHex: 5 }, () => holder().getContacts()],
  ['blocks POST (no rules)', 'POST', '/api/blocks', { rules: [] }, () => holder().getBlockRules()],
  ['blocks POST (bad type)', 'POST', '/api/blocks', { rules: [{ ...RULE, type: 'regex' }] }, () => holder().getBlockRules()],
  [
    'blocks POST (empty pattern)',
    'POST',
    '/api/blocks',
    { rules: [{ ...RULE, pattern: '' }] },
    () => holder().getBlockRules(),
  ],
  ['macros POST', 'POST', '/api/macros', { name: '', template: 'hi', scope: 'global' }, () => macrosStore.list()],
  ['macros validate', 'POST', '/api/macros/validate', {}, () => macrosStore.list()],
  ['macros render (no macroId/template)', 'POST', '/api/macros/render', { mode: 'send' }, () => macrosStore.list()],
  ['map api-key (blank)', 'POST', '/api/map/api-key', { key: '   ' }, () => [holder().getMapSettings(), hasApiKey()]],
  ['repeater cli (empty command)', 'POST', `${REPEATER}/cli`, { command: '' }, () => null],
  ['repeater trace (string tag)', 'POST', `${REPEATER}/trace`, { tag: '1', pathHex: 'aa' }, () => null],
  ['repeater login (no password)', 'POST', `${REPEATER}/login`, {}, () => null],
  ['repeater neighbours (fractional count)', 'POST', `${REPEATER}/neighbours`, { count: 1.5 }, () => null],
  ['repeater local stats (unknown subtype)', 'POST', '/api/repeater/local/stats', { subtype: 'ALL' }, () => null],
  ['transport advert (non-boolean flood)', 'POST', '/api/transport/advert', { flood: 'yes' }, () => null],
  [
    'messages POST (empty body text)',
    'POST',
    '/api/messages/ch%3AGeneral',
    { body: '' },
    () => holder().getMessagesForKey('ch:General'),
  ],
  ['search (no sort)', 'POST', '/api/search', { query: 'beacon' }, () => null],
];

describe('a body that fails its schema', () => {
  it.each(CASES)('%s: 400 invalid_body, nothing stored, broadcast or sent', async (_label, method, path, body, state) => {
    const radio = tripwireRadio();
    transportManager.setState('connected');
    const before = structuredClone(state());
    const bus = captureBusEvents();

    await expectInvalidBody(await testRoutes().request(path, json(method, body)));

    expect(state()).toEqual(before);
    expect(bus.names).toEqual([]);
    expect(radio).toEqual([]);
  });

  it('names the offending field in issues', async () => {
    const res = await testRoutes().request(
      '/api/settings/radio',
      json('PUT', { ...DEFAULT_RADIO_SETTINGS, pathHashMode: 4 }),
    );

    const body = await expectInvalidBody(res);
    expect(body.issues?.map((i) => i.path)).toEqual(['pathHashMode']);
  });

  it('macros PUT: keeps the stored macro', async () => {
    const created = await testRoutes().request(
      '/api/macros',
      json('POST', { name: 'sig', template: 'hi', scope: 'global' }),
    );
    const { macro } = (await created.json()) as MacroResponse;
    const bus = captureBusEvents();

    await expectInvalidBody(await testRoutes().request(`/api/macros/${macro.id}`, json('PUT', { scope: 'world' })));

    expect(macrosStore.list()).toEqual([macro]);
    expect(bus.names).toEqual([]);
  });

  it('blocks PUT: keeps the rule as it was', async () => {
    const [rule] = holder().addBlockRules([RULE]);
    const bus = captureBusEvents();

    await expectInvalidBody(await testRoutes().request(`/api/blocks/${rule.id}`, json('PUT', { enabled: 'no' })));

    expect(
      holder()
        .getBlockRules()
        .find((r) => r.id === rule.id),
    ).toEqual(rule);
    expect(bus.names).toEqual([]);
  });
});

describe('a body key that does not match the path', () => {
  it.each([
    ['channels', '/api/channels/ch%3AGeneral', { ...general, key: 'ch:Other', name: 'Other' }, () => holder().getChannels()],
    ['contacts', `/api/contacts/c%3A${PK}`, { ...alice, key: 'c:ffff' }, () => holder().getContacts()],
  ] as const)('%s: 400 invalid_body, nothing stored or broadcast', async (_label, path, body, state) => {
    const before = structuredClone(state());
    const bus = captureBusEvents();

    const res = await testRoutes().request(path, json('PUT', body));

    expect(res.status).toBe(400);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'body key does not match the path', code: 'invalid_body' });
    expect(state()).toEqual(before);
    expect(bus.names).toEqual([]);
  });
});

describe('fields a body may not set', () => {
  // The patch schema picks the editable fields; anything else is stripped, so
  // a client can't rewrite a rule's identity, type or counters through it.
  it('blocks PUT strips id/type/createdAt/matchCount and applies the rest', async () => {
    const [rule] = holder().addBlockRules([RULE]);

    const res = await testRoutes().request(
      `/api/blocks/${rule.id}`,
      json('PUT', { id: 'hijacked', type: 'pubkey', createdAt: 1, matchCount: 99, enabled: false }),
    );

    expect(res.status).toBe(200);
    const rules = holder().getBlockRules();
    expect(rules.some((r) => r.id === 'hijacked')).toBe(false);
    expect(rules.find((r) => r.id === rule.id)).toEqual({ ...rule, enabled: false });
  });

  it('settings/app strips an unknown field instead of storing it', async () => {
    const res = await testRoutes().request('/api/settings/app', json('PUT', { ...DEFAULT_APP_SETTINGS, injected: 'nope' }));

    expect(res.status).toBe(200);
    expect(holder().getAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
  });
});

describe('a body that is not JSON', () => {
  it.each([
    ['unparsable text', 'not json'],
    ['an empty body', ''],
  ])('answers 400 invalid_body for %s', async (_label, raw) => {
    const bus = captureBusEvents();

    const res = await testRoutes().request('/api/settings/app', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: raw,
    });

    expect(res.status).toBe(400);
    expect((await res.json()) as ApiErrorBody).toMatchObject({
      code: 'invalid_body',
      issues: [{ path: '', message: 'expected a JSON body' }],
    });
    expect(holder().getAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
    expect(bus.names).toEqual([]);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'ch:General'],
  ])('answers 400 invalid_body for JSON %s where an object is expected', async (_label, body) => {
    const res = await testRoutes().request('/api/drafts', json('PUT', body));

    await expectInvalidBody(res);
    expect(holder().getDrafts()).toEqual({ 'ch:General': 'draft' });
  });
});

describe('endpoints whose body is optional', () => {
  it.each([
    ['no body', undefined],
    ['an empty body', ''],
    ['an unparsable body', 'not json'],
  ])('transport/advert accepts %s and floods by default', async (_label, raw) => {
    const sendSelfAdvert = vi.fn((_flood?: boolean) => Promise.resolve({ ok: true }));
    installSessionStub({ sendSelfAdvert });

    const res = await testRoutes().request('/api/transport/advert', { method: 'POST', body: raw });

    expect(res.status).toBe(200);
    expect(sendSelfAdvert).toHaveBeenCalledWith(true);
  });

  it('repeater neighbours accepts no body and asks with no paging options', async () => {
    const request = vi.fn((_key: string, _opts: Parameters<SessionAdapter['repeaterRequestNeighbours']>[1]) =>
      Promise.resolve({ total: 0, neighbours: [] }),
    );
    installSessionStub({ repeaterRequestNeighbours: request });

    const res = await testRoutes().request(`${REPEATER}/neighbours`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(request).toHaveBeenCalledWith(`c:${PK}`, {});
  });

  it('repeater local stats accepts no body and asks for CORE', async () => {
    const request = vi.fn((_subtype: Parameters<SessionAdapter['repeaterGetLocalStats']>[0]) =>
      Promise.resolve({ kind: 'core' as const, battMv: 4000, uptimeSecs: 1, errFlags: 0, queueLen: 0 }),
    );
    installSessionStub({ repeaterGetLocalStats: request });

    const res = await testRoutes().request('/api/repeater/local/stats', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(request).toHaveBeenCalledWith('CORE');
  });

  // Read with `optional`, but deviceId itself is required: a missing body must
  // not reach transport.connect(undefined).
  it('transport/connect still requires deviceId', async () => {
    const connect = vi.fn();
    transportManager.setTransport({ connect, disconnect: vi.fn() } as unknown as ITransport);

    await expectInvalidBody(await testRoutes().request('/api/transport/connect', { method: 'POST' }));

    expect(connect).not.toHaveBeenCalled();
  });
});
