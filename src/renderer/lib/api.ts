import type {
  AppSettings,
  Capabilities,
  Contact,
  Message,
  RadioSettings,
  RepeaterAclEntry,
  RepeaterAdminSession,
  RepeaterLocalStats,
  RepeaterLoginResult,
  RepeaterNeighboursPage,
  RepeaterOwnerInfo,
  RepeaterTrace,
  ServerStatus,
  StateSnapshot,
  UiState,
} from '../../shared/types';

export interface ApiClient {
  baseUrl: string;
  apiKey: string;
}

async function request<T>(client: ApiClient, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${client.baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${client.apiKey}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${message}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchCapabilities(baseUrl: string): Promise<Capabilities> {
  const res = await fetch(`${baseUrl}/api/capabilities`);
  if (!res.ok) throw new Error(`Capabilities probe failed: ${res.status}`);
  return res.json() as Promise<Capabilities>;
}

export const api = {
  status: (c: ApiClient) => request<ServerStatus>(c, '/api/status'),
  snapshot: (c: ApiClient) => request<StateSnapshot>(c, '/api/state/snapshot'),
  scan: (c: ApiClient) => request<{ ok: true }>(c, '/api/transport/scan', { method: 'POST' }),
  connect: (c: ApiClient, deviceId: string) =>
    request<{ ok: true }>(c, '/api/transport/connect', {
      method: 'POST',
      body: JSON.stringify({ deviceId }),
    }),
  disconnect: (c: ApiClient) =>
    request<{ ok: true }>(c, '/api/transport/disconnect', { method: 'POST' }),
  putUiState: (c: ApiClient, state: UiState) =>
    request<{ ok: true }>(c, '/api/ui-state', {
      method: 'PUT',
      body: JSON.stringify(state),
    }),
  putAppSettings: (c: ApiClient, settings: AppSettings) =>
    request<{ ok: true }>(c, '/api/settings/app', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  putRadioSettings: (c: ApiClient, settings: RadioSettings) =>
    request<{ ok: true }>(c, '/api/settings/radio', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  getMessages: (c: ApiClient, key: string) =>
    request<Message[]>(c, `/api/messages/${encodeURIComponent(key)}`),
  sendMessage: (c: ApiClient, key: string, body: string) =>
    request<{ ok: true; id: string }>(c, `/api/messages/${encodeURIComponent(key)}`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  pushChannelToDevice: (c: ApiClient, key: string) =>
    request<{ ok: true; idx: number }>(
      c,
      `/api/channels/${encodeURIComponent(key)}/push-to-device`,
      { method: 'POST' },
    ),
  removeChannelFromDevice: (c: ApiClient, key: string) =>
    request<{ ok: true }>(c, `/api/channels/${encodeURIComponent(key)}/remove-from-device`, {
      method: 'POST',
    }),
  reorderChannels: (c: ApiClient, keys: string[]) =>
    request<{ ok: true }>(c, '/api/channels/reorder', {
      method: 'POST',
      body: JSON.stringify({ keys }),
    }),
  putChannel: (c: ApiClient, channel: import('../../shared/types').Channel) =>
    request<{ ok: true }>(c, `/api/channels/${encodeURIComponent(channel.key)}`, {
      method: 'PUT',
      body: JSON.stringify(channel),
    }),
  deleteChannel: (c: ApiClient, key: string) =>
    request<{ ok: true }>(c, `/api/channels/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  putContact: (c: ApiClient, contact: Contact) =>
    request<{ ok: true }>(c, `/api/contacts/${encodeURIComponent(contact.key)}`, {
      method: 'PUT',
      body: JSON.stringify(contact),
    }),
  deleteContact: (c: ApiClient, key: string) =>
    request<{ ok: true }>(c, `/api/contacts/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  sendAdvert: (c: ApiClient, flood = true) =>
    request<{ ok: true }>(c, '/api/transport/advert', {
      method: 'POST',
      body: JSON.stringify({ flood }),
    }),
  repeaterStatus: (c: ApiClient, key: string) =>
    request<{ ok: true }>(c, `/api/repeater/${encodeURIComponent(key)}/status`, {
      method: 'POST',
    }),
  repeaterTelemetry: (c: ApiClient, key: string) =>
    request<{ ok: true }>(c, `/api/repeater/${encodeURIComponent(key)}/telemetry`, {
      method: 'POST',
    }),
  repeaterSession: (c: ApiClient, key: string) =>
    request<{ session: RepeaterAdminSession | null }>(
      c,
      `/api/repeater/${encodeURIComponent(key)}/session`,
    ),
  repeaterLogin: (c: ApiClient, key: string, password: string) =>
    request<{
      ok: true;
      session: RepeaterAdminSession | null;
      login: RepeaterLoginResult & {
        mode: 'local' | 'remote';
        effective: 'direct' | 'flood' | 'path';
      };
    }>(c, `/api/repeater/${encodeURIComponent(key)}/login`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  setContactPath: (
    c: ApiClient,
    key: string,
    body: { outPathHex: string; preferDirect?: boolean },
  ) =>
    request<{ ok: true }>(c, `/api/contacts/${encodeURIComponent(key)}/path`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  resetContactPath: (c: ApiClient, key: string) =>
    request<{ ok: true }>(c, `/api/contacts/${encodeURIComponent(key)}/path`, {
      method: 'DELETE',
    }),
  setPathHashMode: (c: ApiClient, size: 1 | 2 | 4) =>
    request<{ ok: true }>(c, '/api/radio/path-hash-mode', {
      method: 'PUT',
      body: JSON.stringify({ size }),
    }),
  repeaterLogout: (c: ApiClient, key: string) =>
    request<{ ok: true }>(c, `/api/repeater/${encodeURIComponent(key)}/logout`, {
      method: 'POST',
    }),
  repeaterAcl: (c: ApiClient, key: string) =>
    request<{ ok: true; entries: RepeaterAclEntry[] }>(
      c,
      `/api/repeater/${encodeURIComponent(key)}/acl`,
      { method: 'POST' },
    ),
  repeaterNeighbours: (
    c: ApiClient,
    key: string,
    opts: { count?: number; offset?: number; orderBy?: number; prefixLen?: number } = {},
  ) =>
    request<{ ok: true; page: RepeaterNeighboursPage }>(
      c,
      `/api/repeater/${encodeURIComponent(key)}/neighbours`,
      { method: 'POST', body: JSON.stringify(opts) },
    ),
  repeaterOwner: (c: ApiClient, key: string) =>
    request<{ ok: true; info: RepeaterOwnerInfo }>(
      c,
      `/api/repeater/${encodeURIComponent(key)}/owner`,
      { method: 'POST' },
    ),
  repeaterCli: (c: ApiClient, key: string, command: string) =>
    request<{ ok: true; reply: string }>(c, `/api/repeater/${encodeURIComponent(key)}/cli`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    }),
  repeaterTrace: (
    c: ApiClient,
    key: string,
    payload: { tag: number; authCode?: number; flags?: number; pathHex: string },
  ) =>
    request<{ ok: true; trace: RepeaterTrace }>(
      c,
      `/api/repeater/${encodeURIComponent(key)}/trace`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),
  repeaterLocalStats: (c: ApiClient, subtype: 'CORE' | 'RADIO' | 'PACKETS') =>
    request<{ ok: true; stats: RepeaterLocalStats }>(c, '/api/repeater/local/stats', {
      method: 'POST',
      body: JSON.stringify({ subtype }),
    }),
};
