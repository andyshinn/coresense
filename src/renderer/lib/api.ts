import type {
  AddBlockRulesResponse,
  AdvertPathResponse,
  ApiKeyPresenceResponse,
  BlockRulePatch,
  BlockRuleResponse,
  ContactPathRequest,
  DiscoveredContactsResponse,
  MacroPatch,
  MacroRenderRequest,
  MacroResponse,
  NewBlockRule,
  NewMacro,
  OkResponse,
  PushChannelResponse,
  RadioSettingsRequest,
  RefreshContactsResponse,
  RepeaterAclResponse,
  RepeaterCliResponse,
  RepeaterLocalStatsResponse,
  RepeaterLocalStatsSubtype,
  RepeaterLoginResponse,
  RepeaterNeighboursRequest,
  RepeaterNeighboursResponse,
  RepeaterOwnerResponse,
  RepeaterSessionResponse,
  RepeaterTraceRequest,
  RepeaterTraceResponse,
  SendMessageResponse,
  UpdateCheckResponse,
} from '../../shared/api/contract';
import type { MacroManifest, MacroTemplate, RenderResult, ValidateResult } from '../../shared/macros/types';
import type { RequestDetailDto, SavedRequestDto } from '../../shared/telemetry/types';
import type {
  AppSettings,
  AutoAddConfig,
  BlockRule,
  Capabilities,
  Channel,
  ChannelActivity,
  ChannelStats,
  Contact,
  DeviceIdentity,
  GpsConfig,
  MapSettings,
  Message,
  SearchOptions,
  SearchResults,
  ServerStatus,
  StateSnapshot,
  TelemetryPerms,
  TelemetryPolicy,
  TileCacheInfo,
  UiState,
} from '../../shared/types';
import { withTelemetryRetention } from './telemetryRetention';

export interface ApiClient {
  baseUrl: string;
  apiKey: string;
}

/** Pull a `{ "error": "…" }` message out of a JSON error body, or null if the
 *  body isn't JSON / has no string error. Lets callers show the server's
 *  friendly message instead of the raw status + payload. */
export function parseServerError(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed?.error === 'string' ? parsed.error : null;
  } catch {
    return null;
  }
}

/** Thrown by `request()` on a non-2xx response. Carries the HTTP status and the
 *  server's `code` field (an ApiErrorCode, when present) so callers classify
 *  without re-parsing status text — e.g. the repeater CLI route's
 *  `cli_timeout` / `cli_superseded` / `transport` (§5.4). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Pull a `{ "code": "…" }` classifier out of a JSON error body, or null. */
export function parseServerErrorCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { code?: unknown };
    return typeof parsed?.code === 'string' ? parsed.code : null;
  } catch {
    return null;
  }
}

/** Build an API path, percent-encoding every interpolated value:
 *  apiPath`/api/contacts/${key}/path`. Conversation keys can hold '/', '%' and
 *  spaces, so an unencoded one would address a different route. */
export function apiPath(strings: TemplateStringsArray, ...values: Array<string | number>): string {
  return strings.reduce((out, s, i) => out + s + (i < values.length ? encodeURIComponent(values[i]) : ''), '');
}

async function request<T>(client: ApiClient, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${client.baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${client.apiKey}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(
      parseServerError(body) ?? `${res.status} ${body || res.statusText}`,
      res.status,
      parseServerErrorCode(body),
    );
  }
  return res.json() as Promise<T>;
}

const get = <T>(c: ApiClient, path: string) => request<T>(c, path);

const withBody =
  (method: 'POST' | 'PUT' | 'DELETE') =>
  <T>(c: ApiClient, path: string, body?: unknown, init: RequestInit = {}) =>
    request<T>(c, path, { ...init, method, body: body === undefined ? undefined : JSON.stringify(body) });

const post = withBody('POST');
const put = withBody('PUT');
const del = withBody('DELETE');

/** The repeater-admin commands that are a bare POST to /api/repeater/:key/<action>. */
const repeaterPost = <T>(c: ApiClient, key: string, action: string, body?: unknown, init?: RequestInit) =>
  post<T>(c, `${apiPath`/api/repeater/${key}`}/${action}`, body, init);

export async function fetchCapabilities(baseUrl: string): Promise<Capabilities> {
  const res = await fetch(`${baseUrl}/api/capabilities`);
  if (!res.ok) throw new Error(`Capabilities probe failed: ${res.status}`);
  return res.json() as Promise<Capabilities>;
}

export const api = {
  status: (c: ApiClient) => get<ServerStatus>(c, '/api/status'),
  snapshot: (c: ApiClient) => get<StateSnapshot>(c, '/api/state/snapshot'),
  scan: (c: ApiClient) => post<OkResponse>(c, '/api/transport/scan'),
  connect: (c: ApiClient, deviceId: string) => post<OkResponse>(c, '/api/transport/connect', { deviceId }),
  disconnect: (c: ApiClient) => post<OkResponse>(c, '/api/transport/disconnect'),
  putUiState: (c: ApiClient, state: UiState) => put<OkResponse>(c, '/api/ui-state', state),
  /** Persist one conversation's composer draft. Empty text deletes the entry.
   *  The key travels in the body — conversation keys can contain '%'. */
  putDraft: (c: ApiClient, key: string, text: string) => put<OkResponse>(c, '/api/drafts', { key, text }),
  putAppSettings: (c: ApiClient, settings: AppSettings) => put<OkResponse>(c, '/api/settings/app', settings),
  /** Change the global per-node telemetry retention. Goes through the whole-
   *  AppSettings PUT like every other app setting; main clamps it again and
   *  prunes at once when it shrinks. */
  putTelemetryRetention: (c: ApiClient, settings: AppSettings, keep: number) =>
    put<OkResponse>(c, '/api/settings/app', withTelemetryRetention(settings, keep)),
  putRadioSettings: (c: ApiClient, settings: RadioSettingsRequest) => put<OkResponse>(c, '/api/settings/radio', settings),
  addBlockRules: (c: ApiClient, rules: NewBlockRule[]) =>
    post<AddBlockRulesResponse>(c, '/api/blocks', { rules }).then((r) => r.rules),
  updateBlockRule: (c: ApiClient, id: string, patch: BlockRulePatch): Promise<BlockRule> =>
    put<BlockRuleResponse>(c, apiPath`/api/blocks/${id}`, patch).then((r) => r.rule),
  removeBlockRule: (c: ApiClient, id: string) => del<OkResponse>(c, apiPath`/api/blocks/${id}`),
  putDeviceIdentity: (c: ApiClient, identity: Partial<DeviceIdentity>) =>
    put<OkResponse>(c, '/api/device/identity', identity),
  putAutoAddConfig: (c: ApiClient, cfg: AutoAddConfig) => put<OkResponse>(c, '/api/device/auto-add', cfg),
  /** Change some of the radio's telemetry policy. Send only the fields being
   *  changed: main merges them onto the RADIO's value, so the rest of the
   *  shared SET_OTHER_PARAMS frame isn't rewritten from a possibly stale copy. */
  putTelemetryPolicy: (c: ApiClient, policy: Partial<TelemetryPolicy>) =>
    put<OkResponse>(c, '/api/device/telemetry-policy', policy),
  /** Every sensor setting the radio reports (`CMD_GET_CUSTOM_VARS`), e.g.
   *  `{ gps: '1' }`. `{}` is a real answer: no GPS hardware reports nothing.
   *  `gps_interval` is write-only in firmware, so it never appears here. */
  getSensorSettings: (c: ApiClient) => get<Record<string, string>>(c, '/api/device/custom-vars'),
  /** Write one sensor setting. One key per call so a rejected key (T1000
   *  refuses `gps_interval`) fails alone and the UI can report a partial save. */
  putSensorSetting: (c: ApiClient, key: string, value: string) =>
    put<OkResponse>(c, '/api/device/custom-vars', { key, value }),
  putGpsConfig: (c: ApiClient, cfg: GpsConfig) => put<OkResponse>(c, '/api/device/gps', cfg),
  refreshDevice: (c: ApiClient) => post<OkResponse>(c, '/api/device/refresh'),
  rebootDevice: (c: ApiClient) => post<OkResponse>(c, '/api/device/reboot'),
  // Reply to a `requestQuit` broadcast — tells main it's safe to quit now.
  confirmQuit: (c: ApiClient) => post<OkResponse>(c, '/api/app/quit'),
  // Restart the entire app — used after proxy settings (port/bind/enabled/mdns)
  // change, since the bridge listeners are bound at startup.
  relaunchApp: (c: ApiClient) => post<OkResponse>(c, '/api/app/relaunch'),
  putMapSettings: (c: ApiClient, settings: MapSettings) => put<OkResponse>(c, '/api/settings/map', settings),
  setProtomapsApiKey: (c: ApiClient, key: string) =>
    post<OkResponse & ApiKeyPresenceResponse>(c, '/api/map/api-key', { key }),
  clearProtomapsApiKey: (c: ApiClient) => del<OkResponse & ApiKeyPresenceResponse>(c, '/api/map/api-key'),
  getTileCacheInfo: (c: ApiClient) => get<TileCacheInfo>(c, '/api/map/tile-cache'),
  clearTileCache: (c: ApiClient) => del<TileCacheInfo>(c, '/api/map/tile-cache'),
  openTileCacheFolder: (c: ApiClient) => post<OkResponse>(c, '/api/map/tile-cache/open'),
  /** `around` centres the returned window on that message id, for scrolling to
   *  a search hit older than the default trailing window. */
  getMessages: (c: ApiClient, key: string, opts: { around?: string } = {}) =>
    get<Message[]>(c, apiPath`/api/messages/${key}` + (opts.around ? apiPath`?around=${opts.around}` : '')),
  getChannelStats: (c: ApiClient, key: string) => get<ChannelStats>(c, apiPath`/api/channels/${key}/stats`),
  getChannelActivity: (c: ApiClient, key: string) => get<ChannelActivity>(c, apiPath`/api/channels/${key}/activity`),
  sendMessage: (c: ApiClient, key: string, body: string) =>
    post<SendMessageResponse>(c, apiPath`/api/messages/${key}`, { body }),
  deleteMessage: (c: ApiClient, key: string, id: string) => del<OkResponse>(c, apiPath`/api/messages/${key}/${id}`),
  pushChannelToDevice: (c: ApiClient, key: string) =>
    post<PushChannelResponse>(c, apiPath`/api/channels/${key}/push-to-device`),
  removeChannelFromDevice: (c: ApiClient, key: string) =>
    post<OkResponse>(c, apiPath`/api/channels/${key}/remove-from-device`),
  reorderChannels: (c: ApiClient, keys: string[]) => post<OkResponse>(c, '/api/channels/reorder', { keys }),
  putChannel: (c: ApiClient, channel: Channel) => put<OkResponse>(c, apiPath`/api/channels/${channel.key}`, channel),
  deleteChannel: (c: ApiClient, key: string) => del<OkResponse>(c, apiPath`/api/channels/${key}`),
  putContact: (c: ApiClient, contact: Contact) => put<OkResponse>(c, apiPath`/api/contacts/${contact.key}`, contact),
  deleteContact: (c: ApiClient, key: string) => del<OkResponse>(c, apiPath`/api/contacts/${key}`),
  sendAdvert: (c: ApiClient, flood = true) => post<OkResponse>(c, '/api/transport/advert', { flood }),
  repeaterStatus: (c: ApiClient, key: string) => repeaterPost<OkResponse>(c, key, 'status'),
  repeaterSession: (c: ApiClient, key: string) => get<RepeaterSessionResponse>(c, apiPath`/api/repeater/${key}/session`),
  repeaterLogin: (c: ApiClient, key: string, password: string) =>
    repeaterPost<RepeaterLoginResponse>(c, key, 'login', { password }),
  setContactPath: (c: ApiClient, key: string, body: ContactPathRequest) =>
    put<OkResponse>(c, apiPath`/api/contacts/${key}/path`, body),
  resetContactPath: (c: ApiClient, key: string) => del<OkResponse>(c, apiPath`/api/contacts/${key}/path`),
  /** Ask the radio for its cached INBOUND advert path for one contact (#45 item
   *  7). A measurement is persisted server-side and arrives as a `discovered`
   *  websocket push, so the response body is for the toast, not for rendering.
   *  `force` skips the server's re-ask cooldown and is for an explicit user
   *  action only. See AdvertPathResponse for what each answer means. */
  getAdvertPath: (c: ApiClient, key: string, opts: { force?: boolean } = {}) =>
    post<AdvertPathResponse>(c, apiPath`/api/contacts/${key}/advert-path` + (opts.force ? '?force=1' : '')),
  fetchDiscovered: (c: ApiClient) => get<DiscoveredContactsResponse>(c, '/api/discovered-contacts'),
  /** Ask the radio to re-enumerate its contact store; see RefreshContactsResponse. */
  refreshContacts: (c: ApiClient) => post<RefreshContactsResponse>(c, '/api/contacts/refresh'),
  addToRadio: (c: ApiClient, key: string) => post<OkResponse>(c, apiPath`/api/contacts/${key}/add-to-radio`),
  removeFromRadio: (c: ApiClient, key: string) => post<OkResponse>(c, apiPath`/api/contacts/${key}/remove-from-radio`),
  setFavourite: (c: ApiClient, key: string, favourite: boolean) =>
    put<OkResponse>(c, apiPath`/api/contacts/${key}/favourite`, { favourite }),
  /** Per-contact telemetry permission flags on MY radio (contact flags bits
   *  1–3). Only consulted for a mode set to "Per contact". Answers 501
   *  `lib_unsupported` until meshcore-ts can write them. */
  putContactTelemetryPerms: (c: ApiClient, key: string, perms: TelemetryPerms) =>
    put<OkResponse>(c, apiPath`/api/contacts/${key}/telemetry-perms`, perms),
  clearDiscovered: (c: ApiClient) => post<OkResponse>(c, '/api/discovered-contacts/clear'),
  repeaterLogout: (c: ApiClient, key: string) => repeaterPost<OkResponse>(c, key, 'logout'),
  repeaterAcl: (c: ApiClient, key: string) => repeaterPost<RepeaterAclResponse>(c, key, 'acl'),
  repeaterNeighbours: (c: ApiClient, key: string, opts: RepeaterNeighboursRequest = {}) =>
    repeaterPost<RepeaterNeighboursResponse>(c, key, 'neighbours', opts),
  repeaterOwner: (c: ApiClient, key: string) => repeaterPost<RepeaterOwnerResponse>(c, key, 'owner'),
  repeaterCli: (c: ApiClient, key: string, command: string, opts: { expectReply?: boolean; signal?: AbortSignal } = {}) =>
    repeaterPost<RepeaterCliResponse>(c, key, 'cli', { command, expectReply: opts.expectReply }, { signal: opts.signal }),
  repeaterTrace: (c: ApiClient, key: string, payload: RepeaterTraceRequest) =>
    repeaterPost<RepeaterTraceResponse>(c, key, 'trace', payload),
  repeaterLocalStats: (c: ApiClient, subtype: RepeaterLocalStatsSubtype) =>
    post<RepeaterLocalStatsResponse>(c, '/api/repeater/local/stats', { subtype }),
  search: (c: ApiClient, opts: SearchOptions) => post<SearchResults>(c, '/api/search', opts),
  checkForUpdates: (c: ApiClient) => post<UpdateCheckResponse>(c, '/api/updates/check'),
  installUpdate: (c: ApiClient) => post<OkResponse>(c, '/api/updates/install'),
  getMacros: (c: ApiClient) => get<MacroTemplate[]>(c, '/api/macros'),
  getMacroManifest: (c: ApiClient) => get<MacroManifest>(c, '/api/macros/manifest'),
  addMacro: (c: ApiClient, input: NewMacro) => post<MacroResponse>(c, '/api/macros', input).then((r) => r.macro),
  updateMacro: (c: ApiClient, id: string, patch: MacroPatch) =>
    put<MacroResponse>(c, apiPath`/api/macros/${id}`, patch).then((r) => r.macro),
  deleteMacro: (c: ApiClient, id: string) => del<OkResponse>(c, apiPath`/api/macros/${id}`),
  validateMacro: (c: ApiClient, template: string) => post<ValidateResult>(c, '/api/macros/validate', { template }),
  renderMacro: (c: ApiClient, body: MacroRenderRequest) => post<RenderResult>(c, '/api/macros/render', body),
  clearPackets: (c: ApiClient) => post<OkResponse>(c, '/api/packets/clear'),
  /** Ask a node for telemetry, or read my own radio's when `nodeKey` is the
   *  owner key. Resolves once the request finished, with the saved request:
   *  200 even when `outcome` is `timeout`/`error`. Throws ApiError 409
   *  `radio_busy` while another mesh request holds the radio, and 503/422 for
   *  failures before anything was sent (those are not saved). A second call for
   *  the same node joins the in-flight request. `nodeKey` is `c:<hex>` or bare. */
  requestTelemetry: (c: ApiClient, nodeKey: string) => post<SavedRequestDto>(c, apiPath`/api/telemetry/${nodeKey}/request`),
  /** A node's saved requests, newest first, readings decoded. */
  listTelemetry: (c: ApiClient, nodeKey: string) => get<SavedRequestDto[]>(c, apiPath`/api/telemetry/${nodeKey}`),
  /** One saved request plus, per reading, the most recent earlier reading with the same key. */
  getTelemetryRequest: (c: ApiClient, id: string) => get<RequestDetailDto>(c, apiPath`/api/telemetry/request/${id}`),
  deleteTelemetryRequest: (c: ApiClient, id: string) => del<OkResponse>(c, apiPath`/api/telemetry/request/${id}`),
  /** Delete every saved request for one node. */
  clearTelemetry: (c: ApiClient, nodeKey: string) => del<OkResponse>(c, apiPath`/api/telemetry/${nodeKey}`),
};
