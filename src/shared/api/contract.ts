import type { z } from 'zod';
import type { DiscoveredContact } from '../contacts/discovered';
import type { MacroRenderMode, MacroTemplate } from '../macros/types';
import type {
  BlockRule,
  RepeaterAclEntry,
  RepeaterAdminSession,
  RepeaterLoginResult,
  RepeaterNeighboursPage,
  RepeaterOwnerInfo,
  RepeaterTrace,
  UpdateState,
} from '../types';
import type {
  addBlockRulesBodySchema,
  blockRulePatchSchema,
  contactPathBodySchema,
  macroPatchBodySchema,
  newBlockRuleSchema,
  newMacroBodySchema,
  radioPatchBodySchema,
  radioSettingsBodySchema,
  repeaterNeighboursBodySchema,
  repeaterTraceBodySchema,
} from './schemas';

// The HTTP API's request and response shapes, shared by the routes in
// src/main/api/routes and the renderer client in src/renderer/lib/api.ts.
// Request bodies are inferred from the zod schemas the routes validate with;
// this file only imports their types, so the renderer never bundles zod.

// ---- Errors -----------------------------------------------------------------

/** Every `code` an error response can carry. Errors without a code are
 *  classified by HTTP status alone. */
export type ApiErrorCode =
  /** Anything a route threw that nothing classified (500). */
  | 'internal'
  /** No route matched (404). */
  | 'not_found'
  /** The request body failed validation (400); see `issues`. */
  | 'invalid_body'
  /** The contact is in the discovered pool but not on the radio (422). */
  | 'not_on_radio'
  /** The radio's contact store is full (409). */
  | 'contact_table_full'
  /** A repeater CLI command got no reply in time (504). */
  | 'cli_timeout'
  /** A newer CLI command to the same repeater replaced this one (503). */
  | 'cli_superseded'
  /** The link to the radio failed mid-request (503). */
  | 'transport'
  /** Another awaited mesh request holds the radio (409); see `owner`. */
  | 'radio_busy'
  /** A My Node poll stepped aside for a user command (409); retry next tick. */
  | 'busy_skip'
  /** The radio's firmware can't report its own telemetry (501). */
  | 'self_telemetry_unsupported'
  /** The radio's firmware predates CMD_GET_STATS (501). */
  | 'stats_unsupported'
  /** "Save snapshot" with no live read from the connected radio yet (409). */
  | 'no_live_read'
  /** "Save snapshot" with a live read too old to save (409). */
  | 'stale_live_read';

export interface ApiErrorBody {
  error: string;
  code?: ApiErrorCode;
  /** With `invalid_body`: where the body was wrong. */
  issues?: Array<{ path: string; message: string }>;
}

/** How long the library waits for a repeater CLI reply before rejecting with
 *  `cli_timeout`. Mirrors meshcore-ts's `Models.CLI_REPLY_TIMEOUT_MS`, which
 *  a unit test pins. */
export const CLI_REPLY_TIMEOUT_MS = 30_000;

// ---- Common responses -------------------------------------------------------

export interface OkResponse {
  ok: true;
}

// ---- Requests ---------------------------------------------------------------

export type RadioSettingsRequest = z.input<typeof radioSettingsBodySchema>;
/** PUT /api/device/radio: the radio fields to change; the rest stay as the radio holds them. */
export type RadioPatchRequest = z.input<typeof radioPatchBodySchema>;
export type NewBlockRule = z.output<typeof newBlockRuleSchema>;
export type AddBlockRulesRequest = z.input<typeof addBlockRulesBodySchema>;
export type BlockRulePatch = z.output<typeof blockRulePatchSchema>;
export type ContactPathRequest = z.input<typeof contactPathBodySchema>;
export type RepeaterNeighboursRequest = z.input<typeof repeaterNeighboursBodySchema>;
export type RepeaterTraceRequest = z.input<typeof repeaterTraceBodySchema>;
export type NewMacro = z.output<typeof newMacroBodySchema>;
export type MacroPatch = z.output<typeof macroPatchBodySchema>;

/** POST /api/macros/render. One of `macroId` or `template` is required. */
export interface MacroRenderRequest {
  macroId?: string;
  template?: string;
  mode: MacroRenderMode;
  messageId?: string;
  contactKey?: string;
  channelKey?: string;
  placeholder?: string;
}

// ---- Responses --------------------------------------------------------------

export interface AddBlockRulesResponse {
  rules: BlockRule[];
}

export interface BlockRuleResponse {
  rule: BlockRule;
}

export interface ApiKeyPresenceResponse {
  hasKey: boolean;
}

export interface PushChannelResponse extends OkResponse {
  idx: number;
}

export interface SendMessageResponse extends OkResponse {
  id: string;
}

/** POST /api/contacts/refresh. The refreshed rows arrive over the websocket;
 *  this is the count the radio delivered, or `skipped` when a sync was already
 *  walking the same stream. */
export interface RefreshContactsResponse extends OkResponse {
  count?: number;
  skipped?: boolean;
}

/** POST /api/contacts/:key/advert-path. `cached: false` is the ordinary "the
 *  radio hasn't heard this node lately" answer, not a failure.
 *
 *  `reason: 'noPath'` narrows that `cached: false`: the radio DOES hold an
 *  entry for this node, it just cached the flood / no-path sentinel instead of
 *  a path, so there is a reception time (which may have advanced the row's
 *  Last heard) but no hop count.
 *
 *  `fromCache` is on every answer except `noPath`. With `cached: false` and
 *  `fromCache: true` the radio was NOT asked — the request fell inside the
 *  server's cooldown and the mirror has no measurement. A forced request never
 *  gets one. */
export interface AdvertPathResponse {
  cached: boolean;
  reason?: 'noPath';
  hops?: number;
  pathHex?: string;
  recvTimestampUnix?: number;
  fromCache?: boolean;
}

export interface UpdateCheckResponse extends OkResponse {
  updateState: UpdateState;
}

export interface RepeaterSessionResponse {
  session: RepeaterAdminSession | null;
}

export interface RepeaterLoginResponse extends OkResponse {
  session: RepeaterAdminSession | null;
  login: RepeaterLoginResult & {
    mode: 'local' | 'remote';
    effective: 'direct' | 'flood' | 'path';
  };
}

export interface RepeaterAclResponse extends OkResponse {
  entries: RepeaterAclEntry[];
}

export interface RepeaterNeighboursResponse extends OkResponse {
  page: RepeaterNeighboursPage;
}

/** `info` is null when the repeater answered without owner info. */
export interface RepeaterOwnerResponse extends OkResponse {
  info: RepeaterOwnerInfo | null;
}

/** 200 with the reply, or 202 `sent` when the request opted out of waiting. */
export type RepeaterCliResponse = (OkResponse & { reply: string }) | (OkResponse & { sent: true });

export interface RepeaterTraceResponse extends OkResponse {
  trace: RepeaterTrace;
}

/** GET /api/device/advert-link: the radio's own signed advert. */
export interface AdvertLinkResponse {
  hex: string;
  /** `meshcore://<hex>`: what the MeshCore apps scan or open to add a contact. */
  uri: string;
}

/** GET /api/device/clock. */
export interface DeviceClockResponse {
  /** The radio's RTC, unix seconds. */
  epochSecs: number;
}

export interface MacroResponse {
  macro: MacroTemplate;
}

export type DiscoveredContactsResponse = DiscoveredContact[];
