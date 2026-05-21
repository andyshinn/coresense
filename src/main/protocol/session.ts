import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type {
  Channel,
  Contact,
  ContactKind,
  Message,
  MessageHop,
  MessagePath,
  Owner,
  RawPacket,
  SyncProgress,
  TransportState,
} from '../../shared/types';
import { DEFAULT_SYNC_PROGRESS } from '../../shared/types';
import { type AdminMode, type AdminRole, adminSessions } from '../bridge/adminSession';
import { bus, emit } from '../events/bus';
import { child } from '../log';
import { stateHolder } from '../state/holder';
import { transportManager } from '../transport/manager';
import { ADV_TYPE, PUSH, REQ_TYPE, RESP, STATS_TYPE, TXT_TYPE } from './codes';
import {
  type ContactRecord,
  parseAutoAddConfig,
  parseBattAndStorage,
  parseChannelInfo,
  parseChannelMsgV1,
  parseChannelMsgV3,
  parseContact,
  parseContactMsgV1,
  parseContactMsgV3,
  parseContactsStart,
  parseCustomVars,
  parseDeviceInfo,
  parseEndOfContacts,
  parseSelfInfo,
  parseSendConfirmed,
  parseSentAck,
  parseStatusResponse,
  parseTelemetryResponse,
} from './decode';
import {
  type AutoAddFlagsInput,
  autoAddByteToFlags,
  buildAddUpdateContact,
  buildAnonLogin,
  buildAppStart,
  buildDeviceQuery,
  buildGetAutoAddConfig,
  buildGetBattAndStorage,
  buildGetChannel,
  buildGetContacts,
  buildGetCustomVar,
  buildGetNextMsg,
  buildGetStats,
  buildLogout,
  buildReboot,
  buildResetPath,
  buildSendBinaryReq,
  buildSendChannelText,
  buildSendDmText,
  buildSendLogin,
  buildSendSelfAdvert,
  buildSendStatusReq,
  buildSendTelemetryReq,
  buildSendTracePath,
  buildSetAdvertLatLon,
  buildSetAdvertName,
  buildSetAutoAddConfig,
  buildSetChannel,
  buildSetCustomVar,
  buildSetOtherParams,
  buildSetPathHashMode,
  buildSetRadioParams,
  buildSetRadioTxPower,
  deriveChannelSecret,
  pathHashSizeToMode,
} from './encode';
import { consumeMatching as consumeMeshObs } from './meshObservations';
import {
  type AclEntry,
  type LocalStats,
  type LoginFail,
  type LoginSuccess,
  type NeighboursPage,
  type OwnerInfo,
  parseAclList,
  parseBinaryResponse,
  parseLocalStats,
  parseLoginFail,
  parseLoginSuccess,
  parseNeighbours,
  parseOwnerInfo,
  parseRawData,
  parseTraceData,
  type TraceData,
} from './repeater';

const log = child('protocol');

const APP_NAME = 'coresense';
const APP_VERSION = 1;
const CHANNEL_SLOT_COUNT = 40; // enumerate idx 0..39 on connect (matches official firmware)

// Cap on how long the handshake waits for RESP_CONTACTS_START before falling
// back to enumerating channels with an unknown contact total. The radio
// normally answers within a frame; this just keeps us from stalling forever on
// a misbehaving device.
const CONTACTS_START_WAIT_MS = 3000;

// Cap on how long the handshake waits for RESP_END_OF_CONTACTS after the
// channel-enumeration loop completes. Without this, a dropped end-frame leaves
// the UI stuck in 'syncing' forever.
const CONTACTS_DONE_WAIT_MS = 10_000;

// Small delay between consecutive cmd writes so the BLE link doesn't queue too
// many frames the radio can't ack in time. Empirical on Heltec/RAK hardware.
const WRITE_GAP_MS = 50;
// Backoff on the inbox-pump. The bridge's InboxRouter already serialises 0x0a
// across proxy clients; we issue our own 0x0a but pace ourselves so we don't
// starve concurrent phones.
const DRAIN_INTERVAL_MS = 250;

interface SessionDeps {
  /** Channel keys we've seen the radio publish, indexed by slot index. The
   *  device tags incoming RESP_CHANNEL_MSG_RECV(_V3) frames with the channel
   *  index, not a hash, so this is the dispatch map. */
  channelByIdx: Map<number, Channel>;
}

// DM send → RESP_SENT has no correlation id, so we FIFO outgoing DMs and pop on
// each RESP_SENT. After RESP_SENT lands we hold the expected_ack hash → message
// id mapping until a PUSH_SEND_CONFIRMED arrives (or until ACK_RETENTION_MS).
const ACK_RETENTION_MS = 60_000;

// How long to wait for RESP_OK / RESP_ERR after a SET_CHANNEL write before
// giving up. The radio normally responds within ~50ms; 2s leaves slack for a
// busy BLE link without leaving the UI hanging on a dead device.
const SET_CHANNEL_TIMEOUT_MS = 2000;

// Periodic CMD_DEVICE_QUERY to keep the link warm — the firmware replies with
// RESP_DEVICE_INFO so a dead link surfaces as a write timeout or missing reply
// rather than waiting on user-initiated traffic. Mirrors meshcore-open's
// battery/radio-stats polling pattern (protocol traffic doubles as liveness).
const LIVENESS_POLL_MS = 60_000;

interface PendingAck {
  resolve: (ok: boolean) => void;
  timer: NodeJS.Timeout;
}

interface PendingAdminSent {
  resolve: (tagHex: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

// Awaiter for an out-of-band CLI reply (PAYLOAD_TYPE_TXT_MSG with txt_type=1)
// from a specific remote pubkey. Matched by sender prefix.
interface PendingCli {
  pubKeyPrefixHex: string;
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const ADMIN_SENT_TIMEOUT_MS = 5_000;
const ADMIN_REPLY_TIMEOUT_MS = 20_000;
// Per-attempt wait inside sendDmTextWithRetry. The radio's RESP_SENT carries
// an `est_timeout` we could read here, but the worst-case for a multi-hop flood
// is bounded by retention not link speed — pick a value generous enough for a
// 3-hop round-trip but short enough that 3+2 attempts don't take all day.
const PER_ATTEMPT_TIMEOUT_MS = 30_000;
const CLI_REPLY_TIMEOUT_MS = 30_000;

export class ProtocolSession {
  private readonly deps: SessionDeps = {
    channelByIdx: new Map(),
  };
  private connected = false;
  private drainBusy = false;
  private drainPending = false;
  /** Channel keys the *currently connected* radio reports owning. Cleared on
   *  disconnect. Renderer uses this to gray out channels that exist only in
   *  app storage. */
  private readonly devicePresence = new Set<string>();
  /** Queue of awaiters for the next RESP_OK / RESP_ERR. The companion protocol
   *  has no correlation id, so we FIFO: any OK/ERR routes to the oldest
   *  pending awaiter. Only SET_CHANNEL currently uses this; if more writers
   *  appear we'll need to serialize them through here too. */
  private readonly pendingAcks: PendingAck[] = [];
  /** High-level handshake progress surfaced to the UI footer. Updated as we
   *  enumerate channel slots (and, later, contacts) during handshake. */
  private syncProgress: SyncProgress = { ...DEFAULT_SYNC_PROGRESS };
  /** DM message ids in transmit order. Popped on each RESP_SENT to attach the
   *  ack-hash + state transition to the right message. */
  private readonly dmSendQueue: string[] = [];
  /** expected_ack hex → message id, populated on RESP_SENT and cleared on
   *  PUSH_SEND_CONFIRMED or after ACK_RETENTION_MS. */
  private readonly pendingDmAcks = new Map<string, { messageId: string; timer: NodeJS.Timeout }>();
  /** Contacts received in the current GET_CONTACTS iteration. Reset when a
   *  fresh RESP_CONTACTS_START arrives; consumed in RESP_END_OF_CONTACTS. */
  private contactsIterTotal = 0;
  private contactsIterCount = 0;
  /** Resolved when RESP_CONTACTS_START arrives during the handshake, so the
   *  channel-enumeration loop can wait for the contact total and avoid the
   *  progress bar jumping backwards when total grows mid-sync. */
  private contactsStartWaiter: {
    resolve: () => void;
    timer: NodeJS.Timeout;
  } | null = null;
  /** Resolved when RESP_END_OF_CONTACTS arrives. The handshake awaits this
   *  after the channel loop so we can flip phase to 'done' inline rather than
   *  juggling completion flags across two async streams. */
  private contactsDoneWaiter: {
    resolve: () => void;
    timer: NodeJS.Timeout;
  } | null = null;
  /** FIFO of admin sends still awaiting their RESP_SENT tag echo. Drained
   *  ahead of `dmSendQueue` in handleSent — admin writes are serialised, so
   *  the oldest entry is always the one the radio just acknowledged. */
  private readonly adminSentQueue: PendingAdminSent[] = [];
  /** Active CLI reply awaiters keyed by 6B sender pubkey prefix hex. */
  private readonly pendingCli = new Map<string, PendingCli>();
  /** Awaiter for the next RESP_CODE_STATS frame from a CMD_GET_STATS write. */
  private pendingLocalStats: {
    resolve: (s: LocalStats) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  private livenessTimer: NodeJS.Timeout | null = null;

  start(): void {
    bus.on('packet', this.onPacket);
    bus.on('transportState', this.onTransportState);
    this.purgeCorruptedChannels();
    this.rebuildIndexes();
    // If the transport already happens to be connected at start (e.g. auto-
    // reconnect on app launch), kick the handshake immediately.
    if (transportManager.getState().state === 'connected') {
      void this.handshake();
    }
  }

  /** Drop persisted channels whose name contains non-printable bytes — these
   *  are leftovers from before parseChannelInfo correctly null-terminated the
   *  name field. The radio will re-publish the clean version on next handshake. */
  private purgeCorruptedChannels(): void {
    const holder = stateHolder();
    const kept = holder.getChannels().filter((c) => /^[\x20-\x7e][\x20-\x7e\s]*$/.test(c.name));
    if (kept.length !== holder.getChannels().length) {
      log.warn(
        `purging ${holder.getChannels().length - kept.length} channel(s) with non-printable names`,
      );
      holder.setChannels(kept);
      emit.channels(kept);
    }
  }

  stop(): void {
    bus.off('packet', this.onPacket);
    bus.off('transportState', this.onTransportState);
    this.stopLivenessPoll();
  }

  /** Returns true if the message was queued for transmission. */
  async sendChannelText(
    channelKey: string,
    text: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const channel = stateHolder()
      .getChannels()
      .find((c) => c.key === channelKey);
    if (!channel) return { ok: false, error: `unknown channel ${channelKey}` };
    const idx = channel.idx ?? findIdxByKey(channelKey, this.deps.channelByIdx);
    if (idx === undefined || idx === null) {
      return { ok: false, error: `no slot index known for ${channelKey}` };
    }

    const frame = buildSendChannelText({ channelIdx: idx, text });
    try {
      await this.writeFrame(frame);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Send a DM to a contact. Returns ok on transport-level write success; the
   *  message state machine continues asynchronously: RESP_SENT flips 'sending'
   *  → 'sent', PUSH_SEND_CONFIRMED flips 'sent' → 'ack'. */
  async sendDmText(
    contactKey: string,
    text: string,
    messageId: string,
    opts: { attempt?: number } = {},
  ): Promise<{ ok: boolean; error?: string }> {
    const contact = stateHolder()
      .getContacts()
      .find((c) => c.key === contactKey);
    if (!contact) return { ok: false, error: `unknown contact ${contactKey}` };
    if (!contact.publicKeyHex || contact.publicKeyHex.length < 12) {
      return { ok: false, error: `contact ${contactKey} has no usable public key` };
    }

    const frame = buildSendDmText({
      destPublicKeyHex: contact.publicKeyHex,
      text,
      attempt: opts.attempt,
    });
    this.dmSendQueue.push(messageId);
    try {
      await this.writeFrame(frame);
      return { ok: true };
    } catch (err) {
      // The radio won't reply with RESP_SENT, so pop the entry to keep the
      // FIFO aligned with the next successful write.
      const i = this.dmSendQueue.indexOf(messageId);
      if (i !== -1) this.dmSendQueue.splice(i, 1);
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Send a DM with retry + flood fallback, mirroring the official client's
   *  behavior. If the contact has a known out_path: 3 attempts using the path,
   *  then 2 more after a CMD_RESET_PATH so the radio floods. If no path is
   *  known: 3 flood attempts straight away. When a flood attempt succeeds and
   *  the radio (via the next advert) hands us a different out_path, emit a
   *  `pathLearned` event so the renderer can prompt-or-toast. */
  async sendDmTextWithRetry(
    contactKey: string,
    text: string,
    messageId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const holder = stateHolder();
    const initial = holder.getContacts().find((c) => c.key === contactKey);
    if (!initial) return { ok: false, error: `unknown contact ${contactKey}` };
    if (!initial.publicKeyHex || initial.publicKeyHex.length < 64) {
      return { ok: false, error: `contact ${contactKey} has no full 32B public key` };
    }
    const initialPathHex = initial.outPathHex ?? '';
    const initialManual = initial.pathManual === true;
    const hadPath = initialPathHex.length > 0;
    const knownAttempts = hadPath ? 3 : 0;
    const floodAttempts = hadPath ? 2 : 3;

    let attempt = 0;
    // Phase 1: try the known path.
    for (let i = 0; i < knownAttempts; i += 1) {
      const r = await this.sendDmText(contactKey, text, messageId, { attempt });
      attempt += 1;
      if (!r.ok) continue;
      if ((await this.awaitDmOutcome(messageId, PER_ATTEMPT_TIMEOUT_MS)) === 'ack') {
        return { ok: true };
      }
    }

    // Phase 2: drop the path on the radio, then flood.
    if (hadPath && floodAttempts > 0) {
      try {
        await this.writeFrame(buildResetPath(initial.publicKeyHex));
        holder.upsertContact({
          ...initial,
          outPathHex: undefined,
          hops: undefined,
          pathManual: false,
        });
        emit.contacts(holder.getContacts());
      } catch (err) {
        log.warn(`resetContactPath during retry failed: ${(err as Error).message}`);
      }
    }
    for (let i = 0; i < floodAttempts; i += 1) {
      const r = await this.sendDmText(contactKey, text, messageId, { attempt });
      attempt += 1;
      if (!r.ok) continue;
      if ((await this.awaitDmOutcome(messageId, PER_ATTEMPT_TIMEOUT_MS)) === 'ack') {
        const post = holder.getContacts().find((c) => c.key === contactKey);
        const newPath = post?.outPathHex ?? '';
        if (newPath && newPath !== initialPathHex) {
          emit.pathLearned({
            contactKey,
            newOutPathHex: newPath,
            newOutPathHashSize: post?.outPathHashSize ?? holder.getRadioSettings().pathHashMode,
            previousOutPathHex: initialPathHex,
            previousManual: initialManual,
            learnedAt: Date.now(),
          });
        }
        return { ok: true };
      }
    }

    // All attempts timed out — surface as 'failed' for the UI.
    holder.setMessageState(messageId, 'failed');
    emit.messageState(messageId, 'failed');
    return { ok: false, error: 'all retry attempts failed' };
  }

  /** Resolve when `messageId` reaches a terminal state ('ack' or 'failed'),
   *  or when `timeoutMs` elapses. Used by sendDmTextWithRetry to know when an
   *  attempt has succeeded vs. when to retry. */
  private awaitDmOutcome(messageId: string, timeoutMs: number): Promise<'ack' | 'timeout'> {
    return new Promise((resolve) => {
      const handler = (id: string, state: string) => {
        if (id !== messageId) return;
        if (state === 'ack') {
          cleanup();
          resolve('ack');
        } else if (state === 'failed') {
          cleanup();
          resolve('timeout');
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve('timeout');
      }, timeoutMs);
      const cleanup = () => {
        bus.off('messageState', handler);
        clearTimeout(timer);
      };
      bus.on('messageState', handler);
    });
  }

  /** Request a status snapshot from a repeater/room/contact. Returns ok on
   *  transport-level write; the actual `RepeaterStatusSnapshot` arrives later
   *  via PUSH_STATUS_RESPONSE → emit.repeaterStatus(). */
  async sendStatusReq(contactKey: string): Promise<{ ok: boolean; error?: string }> {
    const contact = stateHolder()
      .getContacts()
      .find((c) => c.key === contactKey);
    if (!contact) return { ok: false, error: `unknown contact ${contactKey}` };
    if (!contact.publicKeyHex || contact.publicKeyHex.length < 64) {
      return { ok: false, error: `contact ${contactKey} has no full 32B public key` };
    }
    try {
      await this.writeFrame(buildSendStatusReq(contact.publicKeyHex));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Request a CayenneLPP telemetry blob from a contact. See sendStatusReq. */
  async sendTelemetryReq(contactKey: string): Promise<{ ok: boolean; error?: string }> {
    const contact = stateHolder()
      .getContacts()
      .find((c) => c.key === contactKey);
    if (!contact) return { ok: false, error: `unknown contact ${contactKey}` };
    if (!contact.publicKeyHex || contact.publicKeyHex.length < 64) {
      return { ok: false, error: `contact ${contactKey} has no full 32B public key` };
    }
    try {
      await this.writeFrame(buildSendTelemetryReq(contact.publicKeyHex));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  // ---- Repeater administration ------------------------------------------

  /** Login to a repeater. The wire mode is derived from the contact's current
   *  path state:
   *    - `preferDirect=true` → CMD_SEND_LOGIN (companion-side, no mesh routing)
   *    - else → CMD_SEND_ANON_REQ (mesh-routed; the radio uses whatever
   *      out_path the contact currently has — N-hop if set, flood otherwise)
   *  Success arrives later as PUSH_LOGIN_SUCCESS keyed on the recipient's
   *  pubkey prefix; failure as PUSH_LOGIN_FAIL. Returns the effective mode so
   *  the UI can label the toast (Direct / Flood / N-hop). */
  async repeaterLogin(
    contactKey: string,
    password: string,
  ): Promise<LoginSuccess & { mode: AdminMode; effective: 'direct' | 'flood' | 'path' }> {
    const lookup = this.lookupRepeaterContact(contactKey);
    if (!lookup.ok) throw new Error(lookup.error);
    const contact = stateHolder()
      .getContacts()
      .find((c) => c.key === contactKey);
    const preferDirect = contact?.preferDirect === true;
    const hasPath = !!contact?.outPathHex && contact.outPathHex.length > 0;
    const mode: AdminMode = preferDirect ? 'local' : 'remote';
    const effective: 'direct' | 'flood' | 'path' = preferDirect
      ? 'direct'
      : hasPath
        ? 'path'
        : 'flood';

    const prefix = lookup.publicKeyHex.slice(0, 12);
    const wait = adminSessions.awaitLogin<LoginSuccess>(prefix, ADMIN_REPLY_TIMEOUT_MS);
    const frame = preferDirect
      ? buildSendLogin(lookup.publicKeyHex, password)
      : buildAnonLogin(lookup.publicKeyHex, password);
    try {
      await this.writeFrame(frame);
    } catch (err) {
      adminSessions.rejectLogin(prefix, err as Error);
      throw err;
    }
    const result = await wait;
    const role: AdminRole = result.isAdmin ? 'admin' : 'guest';
    adminSessions.setSession({
      contactKey,
      publicKeyHex: lookup.publicKeyHex,
      mode,
      role,
      permissionsBits: result.permissions,
      aclPermissionsBits: result.aclPermissions,
      firmwareVerLevel: result.firmwareVerLevel,
      loggedInAt: Date.now(),
    });
    return { ...result, mode, effective };
  }

  // ---- Path management --------------------------------------------------

  /** Write a contact's out_path back to the radio so the firmware uses it for
   *  future source-routed sends. Round-trips the contact's current type/flags/
   *  name (firmware *replaces* on update, not merges). On RESP_OK, updates
   *  local state with the new path + `pathManual`. */
  async setContactPath(
    contactKey: string,
    outPathHex: string,
    opts: { manual: boolean; preferDirect?: boolean } = { manual: true },
  ): Promise<void> {
    const holder = stateHolder();
    const contact = holder.getContacts().find((c) => c.key === contactKey);
    if (!contact) throw new Error(`unknown contact ${contactKey}`);
    if (!contact.publicKeyHex || contact.publicKeyHex.length < 64) {
      throw new Error(`contact ${contactKey} has no full 32B public key`);
    }
    const hashSize = holder.getRadioSettings().pathHashMode;
    if (outPathHex.length % 2 !== 0) {
      throw new Error(`outPathHex must be even-length, got ${outPathHex.length}`);
    }
    const pathBytes = outPathHex.length / 2;
    if (pathBytes % hashSize !== 0) {
      throw new Error(
        `outPathHex length ${pathBytes}B must be a multiple of pathHashMode ${hashSize}B`,
      );
    }
    const frame = buildAddUpdateContact({
      publicKeyHex: contact.publicKeyHex,
      advType: contactKindToAdvType(contact.kind),
      flags: 0,
      outPathHex,
      name: contact.name,
    });
    await this.writeFrame(frame);
    holder.upsertContact({
      ...contact,
      outPathHex: outPathHex || undefined,
      outPathHashSize: outPathHex ? hashSize : contact.outPathHashSize,
      preferDirect: opts.preferDirect ?? contact.preferDirect,
      pathManual: opts.manual,
      pathLearnedAt: opts.manual ? contact.pathLearnedAt : Date.now(),
      hops: outPathHex ? pathBytes / hashSize : undefined,
    });
    emit.contacts(holder.getContacts());
  }

  /** Drop a contact's path back to flood. Mirrors CMD_RESET_PATH. */
  async resetContactPath(contactKey: string): Promise<void> {
    const holder = stateHolder();
    const contact = holder.getContacts().find((c) => c.key === contactKey);
    if (!contact) throw new Error(`unknown contact ${contactKey}`);
    if (!contact.publicKeyHex || contact.publicKeyHex.length < 64) {
      throw new Error(`contact ${contactKey} has no full 32B public key`);
    }
    await this.writeFrame(buildResetPath(contact.publicKeyHex));
    holder.upsertContact({
      ...contact,
      outPathHex: undefined,
      pathManual: true,
      hops: undefined,
    });
    emit.contacts(holder.getContacts());
  }

  /** Toggle the per-contact "always use direct (companion-side) login" flag.
   *  Local-only; no firmware write. */
  setContactPreferDirect(contactKey: string, preferDirect: boolean): void {
    const holder = stateHolder();
    const contact = holder.getContacts().find((c) => c.key === contactKey);
    if (!contact) throw new Error(`unknown contact ${contactKey}`);
    holder.upsertContact({ ...contact, preferDirect });
    emit.contacts(holder.getContacts());
  }

  /** Set the radio's global path-hash mode (bytes per hop). Persists on the
   *  radio and updates local RadioSettings on RESP_OK. */
  async setPathHashMode(size: 1 | 2 | 4): Promise<void> {
    await this.writeFrame(buildSetPathHashMode(pathHashSizeToMode(size)));
    const holder = stateHolder();
    const current = holder.getRadioSettings();
    holder.setRadioSettings({ ...current, pathHashMode: size });
    emit.radioSettings(holder.getRadioSettings());
  }

  // ---- Settings-parity device writes -------------------------------------
  // All of these go through awaitAck() to wait for RESP_OK/ERR; the FIFO is
  // shared with SET_CHANNEL but each user-initiated save is one cmd, so it
  // serialises naturally. Each method updates the holder + emits on RESP_OK.

  /** Push LoRa modulation params (freq/bw/sf/cr) and TX power to the radio.
   *  Sent as two separate frames since the firmware splits them. Includes the
   *  trailing `clientRepeat` byte only when the connected firmware supports it
   *  (ver_code ≥ 9 — surfaced via DeviceCapabilities.repeatMode). */
  async setRadioParams(opts: {
    frequencyHz: number;
    bandwidthHz: number;
    spreadingFactor: number;
    codingRate: number;
    txPowerDbm: number;
    repeatMode: boolean;
  }): Promise<boolean> {
    if (!this.connected) return false;
    const caps = stateHolder().getDeviceCapabilities();
    const paramsAck = this.awaitAck();
    try {
      await this.writeFrame(
        buildSetRadioParams({
          frequencyHz: opts.frequencyHz,
          bandwidthHz: opts.bandwidthHz,
          spreadingFactor: opts.spreadingFactor,
          codingRate: opts.codingRate,
          clientRepeat: caps.repeatMode ? opts.repeatMode : undefined,
        }),
      );
    } catch (err) {
      this.popPendingAck(paramsAck.entry);
      log.warn(`setRadioParams write failed: ${(err as Error).message}`);
      return false;
    }
    const ok1 = await paramsAck.promise;
    if (!ok1) return false;
    await sleep(WRITE_GAP_MS);
    const powerAck = this.awaitAck();
    try {
      await this.writeFrame(buildSetRadioTxPower(opts.txPowerDbm));
    } catch (err) {
      this.popPendingAck(powerAck.entry);
      log.warn(`setRadioTxPower write failed: ${(err as Error).message}`);
      return false;
    }
    const ok2 = await powerAck.promise;
    if (!ok2) return false;
    const holder = stateHolder();
    const next = {
      ...holder.getRadioSettings(),
      frequencyHz: opts.frequencyHz,
      bandwidthHz: opts.bandwidthHz,
      spreadingFactor: opts.spreadingFactor,
      codingRate: opts.codingRate,
      txPowerDbm: opts.txPowerDbm,
      repeatMode: opts.repeatMode,
    };
    holder.setRadioSettings(next);
    emit.radioSettings(next);
    return true;
  }

  /** Push the device's advertised display name. */
  async setAdvertName(name: string): Promise<boolean> {
    if (!this.connected) return false;
    const ack = this.awaitAck();
    try {
      await this.writeFrame(buildSetAdvertName(name));
    } catch (err) {
      this.popPendingAck(ack.entry);
      log.warn(`setAdvertName write failed: ${(err as Error).message}`);
      return false;
    }
    const ok = await ack.promise;
    if (!ok) return false;
    const holder = stateHolder();
    holder.setDeviceIdentity({ ...holder.getDeviceIdentity(), name });
    emit.deviceIdentity(holder.getDeviceIdentity());
    return true;
  }

  /** Push device GPS coords used in self-adverts. */
  async setAdvertLatLon(lat: number, lon: number): Promise<boolean> {
    if (!this.connected) return false;
    const ack = this.awaitAck();
    try {
      await this.writeFrame(buildSetAdvertLatLon(lat, lon));
    } catch (err) {
      this.popPendingAck(ack.entry);
      log.warn(`setAdvertLatLon write failed: ${(err as Error).message}`);
      return false;
    }
    const ok = await ack.promise;
    if (!ok) return false;
    const holder = stateHolder();
    holder.setDeviceIdentity({ ...holder.getDeviceIdentity(), lat, lon });
    emit.deviceIdentity(holder.getDeviceIdentity());
    return true;
  }

  /** Push telemetry policy + multi-acks + advert-location-policy as one frame.
   *  The advert-location-policy flag mirrors `DeviceIdentity.sharePositionInAdvert`
   *  and `TelemetryPolicy` fields drive the rest. */
  async setOtherParams(
    policy: { base: 0 | 1 | 2; loc: 0 | 1 | 2; env: 0 | 1 | 2; multiAcks: number },
    sharePositionInAdvert: boolean,
  ): Promise<boolean> {
    if (!this.connected) return false;
    const ack = this.awaitAck();
    try {
      await this.writeFrame(
        buildSetOtherParams({
          telemetryBase: policy.base,
          telemetryLoc: policy.loc,
          telemetryEnv: policy.env,
          advertLocationPolicy: sharePositionInAdvert ? 1 : 0,
          multiAcks: policy.multiAcks,
        }),
      );
    } catch (err) {
      this.popPendingAck(ack.entry);
      log.warn(`setOtherParams write failed: ${(err as Error).message}`);
      return false;
    }
    const ok = await ack.promise;
    if (!ok) return false;
    const holder = stateHolder();
    holder.setTelemetryPolicy({ ...policy });
    holder.setDeviceIdentity({ ...holder.getDeviceIdentity(), sharePositionInAdvert });
    emit.telemetryPolicy(holder.getTelemetryPolicy());
    emit.deviceIdentity(holder.getDeviceIdentity());
    return true;
  }

  /** Push the auto-add flags byte. App-side `mode`/`maxHops`/`pullToRefresh`/
   *  `showPublicKeys` are stored locally and don't go on the wire. */
  async setAutoAddConfig(flags: AutoAddFlagsInput): Promise<boolean> {
    if (!this.connected) return false;
    const ack = this.awaitAck();
    try {
      await this.writeFrame(buildSetAutoAddConfig(flags));
    } catch (err) {
      this.popPendingAck(ack.entry);
      log.warn(`setAutoAddConfig write failed: ${(err as Error).message}`);
      return false;
    }
    const ok = await ack.promise;
    if (!ok) return false;
    return true;
  }

  /** Ask the radio for its current auto-add flags. RESP_AUTOADD_CONFIG lands in
   *  onPacket → updates holder + emits. */
  async requestAutoAddConfig(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.writeFrame(buildGetAutoAddConfig());
    } catch (err) {
      log.warn(`requestAutoAddConfig write failed: ${(err as Error).message}`);
    }
  }

  /** Toggle the GPS module / change interval via custom-var KV. The firmware
   *  ignores intervals outside [60, 86399]; we clamp client-side too. */
  async setGpsConfig(cfg: { enabled: boolean; intervalSec: number }): Promise<boolean> {
    if (!this.connected) return false;
    const interval = Math.min(86399, Math.max(60, Math.floor(cfg.intervalSec)));
    const ack1 = this.awaitAck();
    try {
      await this.writeFrame(buildSetCustomVar('gps', cfg.enabled));
    } catch (err) {
      this.popPendingAck(ack1.entry);
      log.warn(`setCustomVar(gps) write failed: ${(err as Error).message}`);
      return false;
    }
    if (!(await ack1.promise)) return false;
    await sleep(WRITE_GAP_MS);
    const ack2 = this.awaitAck();
    try {
      await this.writeFrame(buildSetCustomVar('gps_interval', interval));
    } catch (err) {
      this.popPendingAck(ack2.entry);
      log.warn(`setCustomVar(gps_interval) write failed: ${(err as Error).message}`);
      return false;
    }
    if (!(await ack2.promise)) return false;
    const holder = stateHolder();
    holder.setGpsConfig({ enabled: cfg.enabled, intervalSec: interval });
    emit.gpsConfig(holder.getGpsConfig());
    return true;
  }

  /** Reboot the connected device. The link drops within a few hundred ms; the
   *  transport state machine will reflect that via its own state push. */
  async reboot(): Promise<{ ok: boolean; error?: string }> {
    if (!this.connected) return { ok: false, error: 'no radio attached' };
    try {
      await this.writeFrame(buildReboot());
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Query battery + storage. Replies land in onPacket and update DeviceInfo. */
  async requestBattAndStorage(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.writeFrame(buildGetBattAndStorage());
    } catch (err) {
      log.warn(`requestBattAndStorage write failed: ${(err as Error).message}`);
    }
  }

  /** Re-issue DEVICE_QUERY to refresh DeviceInfo + capabilities. */
  async requestDeviceInfo(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.writeFrame(buildDeviceQuery());
    } catch (err) {
      log.warn(`requestDeviceInfo write failed: ${(err as Error).message}`);
    }
  }

  /** Query the firmware's custom-var store ("gps", "gps_interval", etc.).
   *  Empty key requests all known keys. Reply: RESP_CUSTOM_VARS. */
  async requestCustomVars(key = ''): Promise<void> {
    if (!this.connected) return;
    try {
      await this.writeFrame(buildGetCustomVar(key));
    } catch (err) {
      log.warn(`requestCustomVars write failed: ${(err as Error).message}`);
    }
  }

  /** Pop a still-pending ack entry off the FIFO. Used by setters that fail at
   *  write time so a never-arriving RESP_OK doesn't permanently shift the FIFO
   *  off-by-one. */
  private popPendingAck(entry: PendingAck): void {
    const i = this.pendingAcks.indexOf(entry);
    if (i !== -1) this.pendingAcks.splice(i, 1);
    clearTimeout(entry.timer);
  }

  async repeaterLogout(contactKey: string): Promise<void> {
    const contact = this.lookupRepeaterContact(contactKey);
    if (!contact.ok) throw new Error(contact.error);
    await this.writeFrame(buildLogout(contact.publicKeyHex));
    adminSessions.clearSession(contactKey);
  }

  /** Request the ACL list. Admin-only (firmware returns nothing if guest). */
  async repeaterRequestAcl(contactKey: string): Promise<AclEntry[]> {
    const reqData = Buffer.from([REQ_TYPE.GET_ACCESS_LIST, 0, 0]);
    const payload = await this.sendBinaryReq(contactKey, reqData);
    return parseAclList(payload);
  }

  async repeaterRequestNeighbours(
    contactKey: string,
    opts: {
      count?: number;
      offset?: number;
      orderBy?: number;
      prefixLen?: number;
    } = {},
  ): Promise<NeighboursPage> {
    const count = opts.count ?? 16;
    const offset = opts.offset ?? 0;
    const orderBy = opts.orderBy ?? 0;
    const prefixLen = opts.prefixLen ?? 6;
    const reqData = Buffer.alloc(11);
    reqData[0] = REQ_TYPE.GET_NEIGHBOURS;
    reqData[1] = 0; // request version
    reqData[2] = count & 0xff;
    reqData.writeUInt16LE(offset & 0xffff, 3);
    reqData[5] = orderBy & 0xff;
    reqData[6] = prefixLen & 0xff;
    // bytes 7..10: random blob to keep packet hash unique (firmware ignores it)
    for (let i = 7; i < 11; i += 1) reqData[i] = Math.floor(Math.random() * 256);
    const payload = await this.sendBinaryReq(contactKey, reqData);
    const parsed = parseNeighbours(payload, prefixLen);
    if (!parsed) throw new Error('failed to parse neighbours response');
    return parsed;
  }

  async repeaterRequestOwnerInfo(contactKey: string): Promise<OwnerInfo> {
    const reqData = Buffer.from([REQ_TYPE.GET_OWNER_INFO]);
    const payload = await this.sendBinaryReq(contactKey, reqData);
    return parseOwnerInfo(payload);
  }

  /** Send a remote CLI command (e.g. "setperm <hex> 1", "discover.neighbors")
   *  as a text message with txt_type=CLI_DATA. The reply arrives as a normal
   *  RESP_CONTACT_MSG_RECV(_V3) with txt_type=CLI_DATA; we intercept it by
   *  sender prefix and resolve the awaiter. */
  async repeaterSendCli(contactKey: string, command: string): Promise<string> {
    const contact = this.lookupRepeaterContact(contactKey);
    if (!contact.ok) throw new Error(contact.error);
    const prefix = contact.publicKeyHex.slice(0, 12);
    const wait = new Promise<string>((resolve, reject) => {
      const existing = this.pendingCli.get(prefix);
      if (existing) {
        clearTimeout(existing.timer);
        existing.reject(new Error('superseded by newer CLI command'));
      }
      const timer = setTimeout(() => {
        this.pendingCli.delete(prefix);
        reject(new Error(`CLI command timed out after ${CLI_REPLY_TIMEOUT_MS}ms`));
      }, CLI_REPLY_TIMEOUT_MS);
      this.pendingCli.set(prefix, { pubKeyPrefixHex: prefix, resolve, reject, timer });
    });
    const frame = buildSendDmText({
      destPublicKeyHex: contact.publicKeyHex,
      text: command,
      txtType: TXT_TYPE.CLI_DATA,
    });
    // CLI sends are still DMs at the wire level — push onto dmSendQueue so the
    // RESP_SENT FIFO advances correctly. The id is synthetic; the radio doesn't
    // ack CLI sends with PUSH_SEND_CONFIRMED so we won't get a state flip.
    const syntheticId = `cli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.dmSendQueue.push(syntheticId);
    try {
      await this.writeFrame(frame);
    } catch (err) {
      const i = this.dmSendQueue.indexOf(syntheticId);
      if (i !== -1) this.dmSendQueue.splice(i, 1);
      const pending = this.pendingCli.get(prefix);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingCli.delete(prefix);
        pending.reject(err as Error);
      }
      throw err;
    }
    return wait;
  }

  /** CMD_SEND_TRACE_PATH — diagnostic trace along a known path. Reply lands
   *  as PUSH_TRACE_DATA. */
  async repeaterTracePath(opts: {
    tag: number;
    authCode: number;
    flags?: number;
    pathHex: string;
  }): Promise<TraceData> {
    const path = Buffer.from(opts.pathHex, 'hex');
    const tagHex = Buffer.alloc(4);
    tagHex.writeUInt32LE(opts.tag >>> 0, 0);
    const wait = adminSessions.awaitTag<TraceData>(tagHex.toString('hex'), ADMIN_REPLY_TIMEOUT_MS);
    await this.writeFrame(
      buildSendTracePath({ tag: opts.tag, authCode: opts.authCode, flags: opts.flags, path }),
    );
    return wait;
  }

  /** CMD_GET_STATS — local stats for the directly-connected device. Reply
   *  arrives as RESP_CODE_STATS. */
  async repeaterGetLocalStats(subtype: keyof typeof STATS_TYPE): Promise<LocalStats> {
    if (this.pendingLocalStats) {
      this.pendingLocalStats.reject(new Error('superseded by newer GET_STATS'));
      clearTimeout(this.pendingLocalStats.timer);
      this.pendingLocalStats = null;
    }
    const wait = new Promise<LocalStats>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingLocalStats = null;
        reject(new Error('GET_STATS timed out'));
      }, ADMIN_REPLY_TIMEOUT_MS);
      this.pendingLocalStats = { resolve, reject, timer };
    });
    await this.writeFrame(buildGetStats(STATS_TYPE[subtype]));
    return wait;
  }

  /** Generic mesh request (ACL / neighbours / owner). Issues CMD_SEND_BINARY_REQ,
   *  parks an awaiter for the matching PUSH_BINARY_RESPONSE tag, returns the
   *  body (which the caller decodes per req_type). */
  private async sendBinaryReq(contactKey: string, reqData: Buffer): Promise<Buffer> {
    const contact = this.lookupRepeaterContact(contactKey);
    if (!contact.ok) throw new Error(contact.error);
    const frame = buildSendBinaryReq(contact.publicKeyHex, reqData);
    const tagHex = await this.writeAdminAndAwaitTag(frame);
    return adminSessions.awaitTag<Buffer>(tagHex, ADMIN_REPLY_TIMEOUT_MS);
  }

  /** Issue an admin write and resolve the next RESP_SENT's tag. Serialises
   *  through `adminSentQueue` so concurrent admin requests don't cross
   *  responses. */
  private writeAdminAndAwaitTag(frame: Buffer): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.adminSentQueue.indexOf(entry);
        if (i !== -1) this.adminSentQueue.splice(i, 1);
        reject(new Error(`admin RESP_SENT timed out after ${ADMIN_SENT_TIMEOUT_MS}ms`));
      }, ADMIN_SENT_TIMEOUT_MS);
      const entry: PendingAdminSent = { resolve, reject, timer };
      this.adminSentQueue.push(entry);
      this.writeFrame(frame).catch((err) => {
        const i = this.adminSentQueue.indexOf(entry);
        if (i !== -1) this.adminSentQueue.splice(i, 1);
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private lookupRepeaterContact(
    contactKey: string,
  ): { ok: true; publicKeyHex: string } | { ok: false; error: string } {
    const contact = stateHolder()
      .getContacts()
      .find((c) => c.key === contactKey);
    if (!contact) return { ok: false, error: `unknown contact ${contactKey}` };
    if (!contact.publicKeyHex || contact.publicKeyHex.length < 64) {
      return { ok: false, error: `contact ${contactKey} has no full 32B public key` };
    }
    return { ok: true, publicKeyHex: contact.publicKeyHex };
  }

  /** Send a self-advert. `flood=true` propagates many hops (so DM-able by
   *  distant peers); `flood=false` is zero-hop (cheap, only direct neighbors). */
  async sendSelfAdvert(flood = true): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.writeFrame(buildSendSelfAdvert(flood));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private async writeFrame(frame: Buffer): Promise<void> {
    const transport = transportManager.getTransport();
    if (!transport?.sendBytes) throw new Error('no radio attached');
    await transport.sendBytes(frame);
  }

  private onTransportState = (state: TransportState) => {
    const wasConnected = this.connected;
    this.connected = state === 'connected';
    if (this.connected && !wasConnected) {
      log.info('transport connected — running handshake');
      this.devicePresence.clear();
      emit.channelPresence([...this.devicePresence]);
      void this.handshake();
      this.startLivenessPoll();
    } else if (!this.connected && wasConnected) {
      log.info('transport disconnected');
      this.stopLivenessPoll();
      this.devicePresence.clear();
      emit.channelPresence([...this.devicePresence]);
      this.updateSyncProgress({ ...DEFAULT_SYNC_PROGRESS });
      // Resolve any in-flight acks as failures rather than leaving callers hung.
      for (const p of this.pendingAcks.splice(0)) {
        clearTimeout(p.timer);
        p.resolve(false);
      }
      // Any DM still awaiting RESP_SENT will never get one — fail them so the
      // UI doesn't leave 'sending' spinners forever.
      while (this.dmSendQueue.length > 0) this.failOldestDmSend('transport disconnected');
      for (const entry of this.pendingDmAcks.values()) clearTimeout(entry.timer);
      this.pendingDmAcks.clear();
      // Fail any in-flight admin awaiters so callers don't hang past disconnect.
      while (this.adminSentQueue.length > 0) {
        const entry = this.adminSentQueue.shift();
        if (entry) {
          clearTimeout(entry.timer);
          entry.reject(new Error('transport disconnected'));
        }
      }
      for (const entry of this.pendingCli.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('transport disconnected'));
      }
      this.pendingCli.clear();
      if (this.pendingLocalStats) {
        clearTimeout(this.pendingLocalStats.timer);
        this.pendingLocalStats.reject(new Error('transport disconnected'));
        this.pendingLocalStats = null;
      }
      adminSessions.reset('transport disconnected');
    }
  };

  /** Snapshot of channel keys currently present on the radio. Empty when the
   *  transport is disconnected. */
  getDevicePresence(): string[] {
    return [...this.devicePresence];
  }

  /** Snapshot of handshake progress. Used by GET /api/state to seed the
   *  renderer on hydrate; live updates come via bus 'syncProgress'. */
  getSyncProgress(): SyncProgress {
    return {
      phase: this.syncProgress.phase,
      channels: { ...this.syncProgress.channels },
      contacts: { ...this.syncProgress.contacts },
    };
  }

  /** Shallow-merge a patch into the current sync progress and broadcast. Each
   *  sub-object (channels, contacts) is replaced wholesale if present in the
   *  patch — callers pass the new `{done,total}` pair rather than mutating. */
  private updateSyncProgress(patch: Partial<SyncProgress>): void {
    this.syncProgress = { ...this.syncProgress, ...patch };
    emit.syncProgress(this.getSyncProgress());
  }

  /** Write a channel slot (add / edit / delete). Delete = empty name + zero
   *  key, which our enumerator filters as `empty`. Returns true if the radio
   *  acked, false on RESP_ERR / timeout / disconnect. */
  async setChannel(idx: number, name: string, secretHex: string): Promise<boolean> {
    if (!this.connected) return false;
    const frame = buildSetChannel(idx, name, secretHex);
    const ack = this.awaitAck();
    try {
      await this.writeFrame(frame);
    } catch (err) {
      log.warn(`setChannel write failed: ${(err as Error).message}`);
      // Pop our awaiter; nothing will resolve it.
      const i = this.pendingAcks.indexOf(ack.entry);
      if (i !== -1) this.pendingAcks.splice(i, 1);
      clearTimeout(ack.entry.timer);
      return false;
    }
    return ack.promise;
  }

  /** Mark a channel as present on the device. Call after a successful
   *  SET_CHANNEL ack — the firmware doesn't echo CHANNEL_INFO back, so without
   *  this the new channel would stay grayed-out in the UI until the next
   *  full re-enumeration. */
  markChannelPresent(channel: Channel): void {
    if (typeof channel.idx !== 'number') return;
    this.deps.channelByIdx.set(channel.idx, channel);
    this.devicePresence.add(channel.key);
    emit.channelPresence([...this.devicePresence]);
  }

  /** Mark a slot as no longer on the device (paired with a zero-key write).
   *  Frees the slot for pickFreeSlot and clears the presence flag. */
  markChannelAbsent(idx: number): void {
    const existing = this.deps.channelByIdx.get(idx);
    if (!existing) return;
    this.deps.channelByIdx.delete(idx);
    this.devicePresence.delete(existing.key);
    emit.channelPresence([...this.devicePresence]);
  }

  /** Lowest unused slot index in 0..15, or null if all 16 are taken. The
   *  device-presence set is the authority; persisted `idx` on a Channel only
   *  counts when the radio confirmed it this session. */
  pickFreeSlot(): number | null {
    for (let i = 0; i < 16; i += 1) {
      if (!this.deps.channelByIdx.has(i)) return i;
    }
    return null;
  }

  /** Derive the 16-byte secret for a public/hashtag channel by name. Callers
   *  supplying their own secret (e.g. private channel imported from a share
   *  link) should pass it directly to setChannel instead. */
  deriveSecret(name: string): string {
    return deriveChannelSecret(name);
  }

  private awaitAck(): { promise: Promise<boolean>; entry: PendingAck } {
    let entry!: PendingAck;
    const promise = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        const i = this.pendingAcks.indexOf(entry);
        if (i !== -1) this.pendingAcks.splice(i, 1);
        resolve(false);
      }, SET_CHANNEL_TIMEOUT_MS);
      entry = { resolve, timer };
      this.pendingAcks.push(entry);
    });
    return { promise, entry };
  }

  private resolveNextAck(ok: boolean): boolean {
    const entry = this.pendingAcks.shift();
    if (!entry) return false;
    clearTimeout(entry.timer);
    entry.resolve(ok);
    return true;
  }

  private startLivenessPoll(): void {
    this.stopLivenessPoll();
    this.livenessTimer = setInterval(() => {
      if (!this.connected) return;
      this.writeFrame(buildDeviceQuery()).catch((err) => {
        log.debug(`liveness DEVICE_QUERY failed: ${(err as Error).message}`);
      });
      // Refresh battery/storage on the same cadence so the identity card's
      // battery readout stays current without a manual device refresh.
      this.writeFrame(buildGetBattAndStorage()).catch((err) => {
        log.debug(`liveness GET_BATT_AND_STORAGE failed: ${(err as Error).message}`);
      });
    }, LIVENESS_POLL_MS);
  }

  private stopLivenessPoll(): void {
    if (this.livenessTimer) {
      clearInterval(this.livenessTimer);
      this.livenessTimer = null;
    }
  }

  /** Arm a one-shot waiter resolved by a future response handler (or a
   *  timeout). Returns the promise; stores the slot so the handler can find
   *  and resolve it. The slot is single-use — re-arming overwrites. */
  private armWaiter(
    slot: 'contactsStartWaiter' | 'contactsDoneWaiter',
    timeoutMs: number,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (this[slot]) {
          this[slot] = null;
          resolve();
        }
      }, timeoutMs);
      this[slot] = { resolve, timer };
    });
  }

  private async handshake(): Promise<void> {
    this.updateSyncProgress({
      phase: 'syncing',
      channels: { done: 0, total: CHANNEL_SLOT_COUNT },
      contacts: { done: 0, total: 0 },
    });
    try {
      // DEVICE_QUERY first: it carries our protocol version (4), which the
      // firmware reads into app_target_ver. Without this we'd get V1 message
      // frames (no SNR). APP_START's "version" byte is reserved on the device
      // side, so APP_START alone is not enough to negotiate V3.
      await this.writeFrame(buildDeviceQuery());
      await sleep(WRITE_GAP_MS);
      await this.writeFrame(buildAppStart(APP_NAME, APP_VERSION));
      await sleep(WRITE_GAP_MS);
      // Kick the contact iterator FIRST so RESP_CONTACTS_START gives us the
      // contact total before we start incrementing channel progress, and so
      // RESP_CONTACT × N can stream in via onPacket while the channel loop
      // runs below. We arm contactsDone *before* writing GET_CONTACTS so a
      // very fast END_OF_CONTACTS can't race past us.
      const contactsStart = this.armWaiter('contactsStartWaiter', CONTACTS_START_WAIT_MS);
      const contactsDone = this.armWaiter('contactsDoneWaiter', CONTACTS_DONE_WAIT_MS);
      await this.writeFrame(buildGetContacts());
      await contactsStart;
      await sleep(WRITE_GAP_MS);
      // Enumerate channels. Empty slots return RESP_ERR or an all-zero key
      // RESP_CHANNEL_INFO; both are filtered by parseChannelInfo / our handler.
      for (let i = 0; i < CHANNEL_SLOT_COUNT; i += 1) {
        await this.writeFrame(buildGetChannel(i));
        await sleep(WRITE_GAP_MS);
        this.updateSyncProgress({
          channels: { done: i + 1, total: CHANNEL_SLOT_COUNT },
        });
      }
      // Wait for the contact stream to finish (or its watchdog to fire)
      // before flipping phase, so the UI doesn't show 'done' while contacts
      // are still ticking in.
      await contactsDone;
      this.updateSyncProgress({
        phase: 'done',
        channels: { done: CHANNEL_SLOT_COUNT, total: CHANNEL_SLOT_COUNT },
      });
      // Pull battery/storage once up front so the identity card has a reading
      // immediately on connect; the liveness poll keeps it fresh thereafter.
      await this.writeFrame(buildGetBattAndStorage());
      await sleep(WRITE_GAP_MS);
      // Drain any messages queued during the disconnect window. Self-advert
      // is user-initiated only (Cmd-Shift-A) — matching the official mobile
      // clients, which never auto-advertise.
      void this.scheduleDrain();
    } catch (err) {
      log.warn(`handshake failed: ${(err as Error).message}`);
      this.updateSyncProgress({ ...DEFAULT_SYNC_PROGRESS });
    }
  }

  private resolveWaiter(slot: 'contactsStartWaiter' | 'contactsDoneWaiter'): void {
    const w = this[slot];
    if (!w) return;
    clearTimeout(w.timer);
    this[slot] = null;
    w.resolve();
  }

  private onPacket = (p: RawPacket) => {
    if (p.kind !== 'companion') return;
    const code = p.code;
    if (code === undefined) return;
    const frame = Buffer.from(p.bytes);
    log.trace(
      `rx code=0x${code.toString(16).padStart(2, '0')} (${p.codeName ?? '?'}) len=${frame.length}`,
    );

    if (code === RESP.CHANNEL_INFO) {
      this.handleChannelInfo(frame);
      return;
    }
    if (code === RESP.CONTACTS_START) {
      const total = parseContactsStart(frame);
      if (total !== null) {
        this.contactsIterTotal = total;
        this.contactsIterCount = 0;
        this.updateSyncProgress({ contacts: { done: 0, total } });
        log.debug(`contacts iterator starting: total=${total}`);
      }
      this.resolveWaiter('contactsStartWaiter');
      return;
    }
    if (code === RESP.CONTACT) {
      const record = parseContact(frame);
      if (record) {
        this.ingestContact(record);
        this.contactsIterCount += 1;
        // Self-heal if the radio's CONTACTS_START total was optimistic (or
        // never arrived): never let `done` exceed `total`, which would render
        // as e.g. "41/40" in the footer.
        if (this.contactsIterCount > this.contactsIterTotal) {
          this.contactsIterTotal = this.contactsIterCount;
        }
        this.updateSyncProgress({
          contacts: { done: this.contactsIterCount, total: this.contactsIterTotal },
        });
      }
      return;
    }
    if (code === RESP.END_OF_CONTACTS) {
      const mostRecent = parseEndOfContacts(frame);
      log.debug(
        `contacts iterator done: ${this.contactsIterCount}/${this.contactsIterTotal} most_recent_lastmod=${mostRecent}`,
      );
      // Snap contact total to the actual delivered count so the bar reads
      // N/N even if the radio's CONTACTS_START total was optimistic.
      this.updateSyncProgress({
        contacts: { done: this.contactsIterCount, total: this.contactsIterCount },
      });
      this.contactsIterTotal = 0;
      this.contactsIterCount = 0;
      this.resolveWaiter('contactsDoneWaiter');
      return;
    }
    if (code === PUSH.NEW_ADVERT) {
      const record = parseContact(frame);
      if (record) {
        this.ingestContact(record);
        log.debug(`new advert: "${record.name}" (${record.publicKeyHex.slice(0, 12)})`);
      }
      return;
    }
    if (code === RESP.CHANNEL_MSG_RECV_V3 || code === RESP.CHANNEL_MSG_RECV) {
      this.handleChannelMsg(code, frame);
      return;
    }
    if (code === RESP.CONTACT_MSG_RECV_V3 || code === RESP.CONTACT_MSG_RECV) {
      this.handleContactMsg(code, frame);
      return;
    }
    if (code === RESP.SENT) {
      this.handleSent(frame);
      return;
    }
    if (code === PUSH.SEND_CONFIRMED) {
      this.handleSendConfirmed(frame);
      return;
    }
    if (code === PUSH.STATUS_RESPONSE) {
      this.handleStatusResponse(frame);
      return;
    }
    if (code === PUSH.TELEMETRY_RESPONSE) {
      this.handleTelemetryResponse(frame);
      return;
    }
    if (code === PUSH.LOGIN_SUCCESS) {
      const parsed = parseLoginSuccess(frame);
      if (parsed) adminSessions.resolveLogin(parsed.pubKeyPrefixHex, parsed);
      return;
    }
    if (code === PUSH.LOGIN_FAIL) {
      const parsed = parseLoginFail(frame);
      if (parsed) {
        const fail: LoginFail = parsed;
        adminSessions.rejectLogin(fail.pubKeyPrefixHex, new Error('login rejected by repeater'));
      }
      return;
    }
    if (code === PUSH.BINARY_RESPONSE) {
      const parsed = parseBinaryResponse(frame);
      if (parsed) adminSessions.resolveTag(parsed.tagHex, parsed.payload);
      return;
    }
    if (code === PUSH.TRACE_DATA) {
      const parsed = parseTraceData(frame);
      if (parsed) adminSessions.resolveTag(parsed.tagHex, parsed);
      return;
    }
    if (code === PUSH.RAW_DATA) {
      // Currently only useful for debugging; admin responses arrive via
      // BINARY_RESPONSE / LOGIN_SUCCESS instead.
      const parsed = parseRawData(frame);
      if (parsed) log.trace(`raw_data snr=${parsed.snrDb} rssi=${parsed.rssi}`);
      return;
    }
    if (code === RESP.STATS) {
      const parsed = parseLocalStats(frame);
      if (parsed && this.pendingLocalStats) {
        clearTimeout(this.pendingLocalStats.timer);
        this.pendingLocalStats.resolve(parsed);
        this.pendingLocalStats = null;
      }
      return;
    }
    if (code === RESP.SELF_INFO) {
      const parsed = parseSelfInfo(frame);
      if (parsed) {
        const owner: Owner = {
          name: parsed.name,
          publicKeyHex: parsed.publicKeyHex,
          // Codebase convention for pubkey prefixes is the first 12 hex chars
          // (6 bytes); the identity card shows fewer but stores the full key.
          publicKeyShort: parsed.publicKeyHex.slice(0, 12),
        };
        stateHolder().setOwner(owner);
        emit.owner(owner);
        log.debug(`self-info: "${owner.name}" (${owner.publicKeyShort})`);
      }
      return;
    }
    if (code === RESP.BATT_AND_STORAGE) {
      const parsed = parseBattAndStorage(frame);
      if (parsed) {
        const holder = stateHolder();
        const next = {
          ...holder.getDeviceInfo(),
          batteryMv: parsed.batteryMv,
          storageUsedKb: parsed.storageUsedKb,
          storageTotalKb: parsed.storageTotalKb,
        };
        holder.setDeviceInfo(next);
        emit.deviceInfo(next);
      }
      return;
    }
    if (code === RESP.DEVICE_INFO) {
      const parsed = parseDeviceInfo(frame);
      if (parsed) {
        const holder = stateHolder();
        const next = {
          ...holder.getDeviceInfo(),
          firmwareVerCode: parsed.firmwareVerCode,
          maxContacts: parsed.maxContacts,
          maxChannels: parsed.maxChannels,
          deviceModel: parsed.deviceModel || holder.getDeviceInfo().deviceModel,
        };
        holder.setDeviceInfo(next);
        emit.deviceInfo(next);
        // Capabilities follow firmware version codes verbatim — see the
        // meshcore_protocol.dart firmware-version gates. We treat ver ≥ 9 as
        // unlocking the repeat-mode byte; ≥ 25 (anecdotal, fw 1.7.0) gates the
        // CLI export/import private-key flow. We pick the conservative cutoff
        // and refine when we learn the actual ver_code that fw 1.7.0 reports.
        const caps = {
          repeatMode: parsed.firmwareVerCode >= 9,
          identityKeyIO: parsed.firmwareVerCode >= 25,
        };
        holder.setDeviceCapabilities(caps);
        emit.deviceCapabilities(caps);
      }
      return;
    }
    if (code === RESP.CUSTOM_VARS) {
      const kv = parseCustomVars(frame);
      if (kv.gps !== undefined || kv.gps_interval !== undefined) {
        const holder = stateHolder();
        const current = holder.getGpsConfig();
        const next = {
          enabled: kv.gps !== undefined ? kv.gps === '1' || kv.gps === 'true' : current.enabled,
          intervalSec:
            kv.gps_interval !== undefined
              ? Number.parseInt(kv.gps_interval, 10) || current.intervalSec
              : current.intervalSec,
        };
        holder.setGpsConfig(next);
        emit.gpsConfig(next);
      }
      return;
    }
    if (code === RESP.AUTOADD_CONFIG) {
      const byte = parseAutoAddConfig(frame);
      if (byte !== null) {
        const flags = autoAddByteToFlags(byte);
        const holder = stateHolder();
        const current = holder.getAutoAddConfig();
        const next = {
          ...current,
          chat: flags.chat,
          repeater: flags.repeater,
          room: flags.room,
          sensor: flags.sensor,
          overwriteOldest: flags.overwriteOldest,
        };
        holder.setAutoAddConfig(next);
        emit.autoAddConfig(next);
      }
      return;
    }
    if (code === PUSH.MSG_WAITING) {
      void this.scheduleDrain();
      return;
    }
    if (code === RESP.NO_MORE_MESSAGES) {
      this.drainBusy = false;
      log.trace('drain done: NO_MORE_MESSAGES');
      if (this.drainPending) {
        this.drainPending = false;
        void this.scheduleDrain();
      }
      return;
    }
    if (code === RESP.OK || code === RESP.ERR) {
      // SET_CHANNEL awaiters get first crack at any OK/ERR. If none are
      // queued and we have a DM in flight, a bare RESP_ERR means the radio
      // rejected the send (e.g. unknown recipient prefix) — fail the DM.
      if (this.resolveNextAck(code === RESP.OK)) return;
      if (code === RESP.ERR) this.failOldestDmSend('radio rejected send');
      return;
    }
  };

  private handleChannelInfo(frame: Buffer): void {
    const info = parseChannelInfo(frame);
    if (!info) return;
    if (info.empty) {
      // Slot was previously populated but is now empty (e.g. just deleted).
      // Drop it from devicePresence and from the channelByIdx dispatch map so
      // a future re-enumeration starts clean.
      const existing = this.deps.channelByIdx.get(info.idx);
      if (existing) {
        this.deps.channelByIdx.delete(info.idx);
        this.devicePresence.delete(existing.key);
        emit.channelPresence([...this.devicePresence]);
      }
      return;
    }

    const key = `ch:${info.name}`;
    const existing = stateHolder()
      .getChannels()
      .find((c) => c.key === key);
    const channel: Channel = {
      key,
      name: info.name,
      kind: info.name.startsWith('#') ? 'hashtag' : info.name === 'Public' ? 'public' : 'private',
      secretHex: info.secretHex,
      idx: info.idx,
      // Preserve the user's manual ordering if they've reordered; otherwise
      // seed from the radio's slot index so first-sync order is stable.
      order: existing?.order ?? info.idx,
      muted: existing?.muted,
      pinned: existing?.pinned,
    };

    this.deps.channelByIdx.set(info.idx, channel);
    this.devicePresence.add(key);
    emit.channelPresence([...this.devicePresence]);

    const holder = stateHolder();
    holder.upsertChannel(channel);
    // If the seed "ch:public" exists and the radio's slots don't include
    // anything named "Public", drop the seed — the user's radio defines what
    // counts as real.
    if (
      info.idx === 0 &&
      info.name !== 'Public' &&
      holder.getChannels().some((c) => c.key === 'ch:public' && c.kind === 'public')
    ) {
      holder.removeChannel('ch:public');
    }
    emit.channels(holder.getChannels());
    log.debug(`channel idx=${info.idx} "${info.name}"`);
  }

  /** Upsert a contact from a RESP_CONTACT / PUSH_NEW_ADVERT frame. When the
   *  contact matches an existing placeholder (`c:<6-byte-prefix>`), the
   *  placeholder is removed; messages already keyed to the placeholder stay
   *  there (cheap to leave — future cleanup can migrate them). */
  private ingestContact(record: ContactRecord): void {
    const holder = stateHolder();
    const fullKey = `c:${record.publicKeyHex}`;
    const prefix6 = record.publicKeyHex.slice(0, 12);
    const existing = holder.getContacts().find((c) => c.key === fullKey);
    // The radio re-pushes the full contact record on every advert; preserve
    // local-only fields the firmware doesn't know about.
    const hashSize = holder.getRadioSettings().pathHashMode;
    const advertOutPathHex = record.outPathLen === 0xff ? '' : record.outPathHex;
    // Don't let a stray advert that reports "no path" wipe a path the user
    // just set manually — the firmware can occasionally re-emit a contact
    // entry with path_len=0 right after we write CMD_ADD_UPDATE_CONTACT (the
    // advert was generated mid-flight). Only allow overwrites when the advert
    // carries a non-empty path, OR when the existing entry wasn't manually
    // set. Auto-learned paths (pathManual=false) still defer to firmware.
    const newOutPathHex =
      advertOutPathHex.length === 0 && existing?.pathManual === true
        ? (existing.outPathHex ?? '')
        : advertOutPathHex;
    const pathChanged = (existing?.outPathHex ?? '') !== newOutPathHex;

    const contact: Contact = {
      key: fullKey,
      publicKeyHex: record.publicKeyHex,
      name: record.name || record.publicKeyHex.slice(0, 12),
      kind: advTypeToKind(record.type),
      lastSeenMs: record.lastAdvertUnix > 0 ? record.lastAdvertUnix * 1000 : existing?.lastSeenMs,
      hops: record.outPathLen === 0xff ? undefined : Math.floor(record.outPathLen / hashSize),
      pinned: existing?.pinned,
      muted: existing?.muted,
      outPathHex: newOutPathHex || undefined,
      outPathHashSize: newOutPathHex ? hashSize : existing?.outPathHashSize,
      preferDirect: existing?.preferDirect,
      // If the radio's view of the path drifted away from a path the user set
      // by hand, drop the manual flag — the firmware is the source of truth.
      pathManual: pathChanged ? false : existing?.pathManual,
      pathLearnedAt: pathChanged && newOutPathHex ? Date.now() : existing?.pathLearnedAt,
      // Adverts carry the radio's last GPS fix. 0/0 is the firmware default for
      // radios without a GPS module — treat as "no fix" and fall back to the
      // last known position instead of nuking it.
      gpsLat: record.gpsLat !== 0 || record.gpsLon !== 0 ? record.gpsLat : existing?.gpsLat,
      gpsLon: record.gpsLat !== 0 || record.gpsLon !== 0 ? record.gpsLon : existing?.gpsLon,
    };
    holder.upsertContact(contact);

    // Reconcile a synth placeholder we created for a prior incoming DM whose
    // sender we hadn't seen an advert for yet.
    const placeholderKey = `c:${prefix6}`;
    if (placeholderKey !== fullKey && holder.getContacts().some((c) => c.key === placeholderKey)) {
      holder.removeContact(placeholderKey);
      log.debug(`reconciled placeholder ${placeholderKey} → ${fullKey}`);
    }

    emit.contacts(holder.getContacts());
  }

  private handleContactMsg(code: number, frame: Buffer): void {
    const parsed =
      code === RESP.CONTACT_MSG_RECV_V3 ? parseContactMsgV3(frame) : parseContactMsgV1(frame);
    if (!parsed) return;
    // CLI replies arrive on the same opcode as DMs; route them to the
    // matching admin awaiter and don't insert them into the message store.
    if (parsed.txtType === TXT_TYPE.CLI_DATA) {
      const pending = this.pendingCli.get(parsed.senderPubKeyPrefixHex.toLowerCase());
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingCli.delete(parsed.senderPubKeyPrefixHex.toLowerCase());
        pending.resolve(parsed.body);
        if (this.drainBusy) this.pumpNextDrain();
        return;
      }
    }

    const holder = stateHolder();
    const prefix = parsed.senderPubKeyPrefixHex;
    let contact = holder
      .getContacts()
      .find((c) => c.publicKeyHex.toLowerCase().startsWith(prefix.toLowerCase()));

    if (!contact) {
      // Unknown sender — synth a placeholder contact keyed by the 6-byte
      // prefix. A future advert handler (Phase 7+) will reconcile this when
      // the full pubkey + display name arrive.
      contact = {
        key: `c:${prefix}`,
        publicKeyHex: prefix,
        name: `(${prefix})`,
        kind: 'chat',
      };
      holder.upsertContact(contact);
      emit.contacts(holder.getContacts());
      log.debug(`synth contact for unknown sender prefix=${prefix}`);
    }

    const message: Message = {
      id: `radio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      key: contact.key,
      ts: parsed.timestampUnix * 1000,
      fromPublicKeyHex: contact.publicKeyHex,
      body: parsed.body,
      state: 'received',
      meta: { snr: parsed.snrDb },
    };
    holder.insertMessage(message);
    emit.messages(contact.key, holder.getMessagesForKey(contact.key));
    log.debug(
      `contact msg from=${prefix} → "${contact.name}" body=${JSON.stringify(parsed.body.slice(0, 60))}`,
    );
    // The radio only tickles PUSH_MSG_WAITING once per queue event; keep
    // pulling until NO_MORE_MESSAGES.
    if (this.drainBusy) this.pumpNextDrain();
  }

  private handleSent(frame: Buffer): void {
    const sent = parseSentAck(frame);
    if (!sent) return;
    // Admin writes are serialised through adminSentQueue and ack'd ahead of
    // DM sends. The expected_ack u32 from RESP_SENT is the same `tag` the
    // firmware will echo back in PUSH_BINARY_RESPONSE / PUSH_LOGIN_SUCCESS.
    const adminAwait = this.adminSentQueue.shift();
    if (adminAwait) {
      clearTimeout(adminAwait.timer);
      adminAwait.resolve(sent.expectedAckHex);
      return;
    }
    const messageId = this.dmSendQueue.shift();
    if (!messageId) {
      // RESP_SENT for a non-DM (e.g. channel send echo) — no state machine.
      return;
    }
    const holder = stateHolder();
    holder.setMessageState(messageId, 'sent');
    emit.messageState(messageId, 'sent');
    log.debug(
      `dm sent id=${messageId} flood=${sent.flood} ack=${sent.expectedAckHex} timeout=${sent.estTimeoutMs}ms`,
    );

    if (sent.expectedAckHex !== '00000000') {
      const timer = setTimeout(() => {
        this.pendingDmAcks.delete(sent.expectedAckHex);
      }, ACK_RETENTION_MS);
      this.pendingDmAcks.set(sent.expectedAckHex, { messageId, timer });
    }
  }

  private handleStatusResponse(frame: Buffer): void {
    const parsed = parseStatusResponse(frame);
    if (!parsed) return;
    const contact = stateHolder()
      .getContacts()
      .find((c) =>
        c.publicKeyHex.toLowerCase().startsWith(parsed.senderPubKeyPrefixHex.toLowerCase()),
      );
    if (!contact) {
      log.warn(`status response from unknown sender prefix=${parsed.senderPubKeyPrefixHex}`);
      return;
    }
    emit.repeaterStatus({
      contactKey: contact.key,
      receivedAt: Date.now(),
      payloadHex: parsed.payloadHex,
      fields: parsed.fields,
    });
    log.debug(
      `status response from "${contact.name}" payload=${parsed.payloadHex.length / 2}B fields=${parsed.fields.length}`,
    );
  }

  private handleTelemetryResponse(frame: Buffer): void {
    const parsed = parseTelemetryResponse(frame);
    if (!parsed) return;
    const contact = stateHolder()
      .getContacts()
      .find((c) =>
        c.publicKeyHex.toLowerCase().startsWith(parsed.senderPubKeyPrefixHex.toLowerCase()),
      );
    if (!contact) {
      log.warn(`telemetry response from unknown sender prefix=${parsed.senderPubKeyPrefixHex}`);
      return;
    }
    emit.repeaterTelemetry({
      contactKey: contact.key,
      receivedAt: Date.now(),
      payloadHex: parsed.payloadHex,
      fields: parsed.fields,
    });
    log.debug(
      `telemetry response from "${contact.name}" payload=${parsed.payloadHex.length / 2}B fields=${parsed.fields.length}`,
    );
  }

  private handleSendConfirmed(frame: Buffer): void {
    const conf = parseSendConfirmed(frame);
    if (!conf) return;
    const entry = this.pendingDmAcks.get(conf.ackHex);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pendingDmAcks.delete(conf.ackHex);
    stateHolder().setMessageState(entry.messageId, 'ack');
    emit.messageState(entry.messageId, 'ack');
    log.debug(`dm ack id=${entry.messageId} ack=${conf.ackHex} rtt=${conf.tripTimeMs}ms`);
  }

  private failOldestDmSend(reason: string): void {
    const messageId = this.dmSendQueue.shift();
    if (!messageId) return;
    stateHolder().setMessageState(messageId, 'failed');
    emit.messageState(messageId, 'failed');
    log.warn(`dm failed id=${messageId}: ${reason}`);
  }

  private handleChannelMsg(code: number, frame: Buffer): void {
    const parsed =
      code === RESP.CHANNEL_MSG_RECV_V3 ? parseChannelMsgV3(frame) : parseChannelMsgV1(frame);
    if (!parsed) return;
    const channel = this.deps.channelByIdx.get(parsed.channelIdx);
    if (!channel) {
      log.warn(
        `incoming channel msg idx=${parsed.channelIdx} doesn't match any known channel slot`,
      );
      return;
    }

    const holder = stateHolder();
    const owner = holder.getOwner();

    // Pull matching mesh-side observations for this channel + hop count and
    // build the Message's paths from them. parsed.pathLen carries the firmware
    // path_len byte (hashSize in bits 6..7, hashCount in bits 0..5); 0xFF means
    // "direct, no flood" — no per-hop bytes to fetch.
    const paths: MessagePath[] = [];
    let finalSnr = parsed.snrDb;
    if (parsed.pathLen !== 0xff) {
      const hashCount = parsed.pathLen & 0x3f;
      const channelHashByte = channelHashOf(channel);
      if (channelHashByte != null) {
        const observations = consumeMeshObs(channelHashByte, hashCount);
        for (const obs of observations) {
          paths.push(
            buildPath(obs.pathHex, obs.hashSize, obs.finalSnr, parsed.senderName, owner?.name),
          );
        }
        // Prefer the SNR our radio measured on the LoRa frame (mesh side) over
        // the one the firmware quoted in 0x11 — they're the same value when the
        // observation arrived from the same hop, and the mesh one is fresher.
        if (observations.length > 0) finalSnr = observations[0].finalSnr;
      }
    }

    // Deterministic id: re-receipts of the same flood message via different
    // paths collide here so upsertMessage merges them into one row.
    const bodyHash = createHash('sha1').update(parsed.cleanBody).digest('hex').slice(0, 12);
    const id = `chmsg-${channel.key}-${parsed.timestampUnix}-${bodyHash}`;

    const message: Message = {
      id,
      key: channel.key,
      ts: parsed.timestampUnix * 1000,
      // No pubkey at the channel-message layer; the sender is identified by the
      // "name: " prefix the originating node tacks onto the body.
      fromPublicKeyHex: parsed.senderName ? `name:${parsed.senderName}` : 'unknown',
      body: parsed.cleanBody,
      state: 'received',
      meta: {
        snr: finalSnr,
        ...(paths.length > 0 ? { paths } : {}),
      },
    };
    holder.upsertMessage(message);
    emit.messages(channel.key, holder.getMessagesForKey(channel.key));
    log.debug(
      `channel msg idx=${parsed.channelIdx} → "${channel.name}" (${channel.key}) ` +
        `from=${parsed.senderName ?? 'unknown'} paths=${paths.length} ` +
        `body=${JSON.stringify(parsed.cleanBody.slice(0, 60))}`,
    );
    if (this.drainBusy) this.pumpNextDrain();
  }

  /** Pump CMD_SYNC_NEXT_MESSAGE. The firmware sends ONE PUSH_MSG_WAITING per
   *  queue event, so we have to chain GET_NEXT_MSG ourselves after every
   *  *_MSG_RECV until the device replies with NO_MORE_MESSAGES. drainBusy is
   *  cleared only on NO_MORE_MESSAGES — not after writeFrame returns — so the
   *  pump doesn't oversubscribe the radio. */
  private async scheduleDrain(): Promise<void> {
    if (this.drainBusy) {
      this.drainPending = true;
      return;
    }
    this.drainBusy = true;
    await sleep(DRAIN_INTERVAL_MS);
    try {
      await this.writeFrame(buildGetNextMsg());
    } catch (err) {
      log.warn(`drain write failed: ${(err as Error).message}`);
      this.drainBusy = false;
      // No reply will come, so re-arm if another PUSH_MSG_WAITING raced in.
      if (this.drainPending) {
        this.drainPending = false;
        void this.scheduleDrain();
      }
    }
  }

  /** Called from handleChannelMsg / handleContactMsg after a drain returned a
   *  message. Issues the next GET_NEXT_MSG immediately so we keep draining
   *  until the device says NO_MORE_MESSAGES. */
  private pumpNextDrain(): void {
    if (!this.connected) return;
    this.writeFrame(buildGetNextMsg()).catch((err) => {
      log.warn(`drain pump write failed: ${(err as Error).message}`);
      this.drainBusy = false;
    });
  }

  /** Recompute channel indexes from persisted channels so we can send before
   *  enumeration finishes (handshake takes ~1s). */
  private rebuildIndexes(): void {
    for (const ch of stateHolder().getChannels()) {
      if (typeof ch.idx === 'number') this.deps.channelByIdx.set(ch.idx, ch);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function advTypeToKind(type: number): ContactKind {
  switch (type) {
    case ADV_TYPE.REPEATER:
      return 'repeater';
    case ADV_TYPE.ROOM:
      return 'room';
    case ADV_TYPE.SENSOR:
      return 'sensor';
    default:
      return 'chat';
  }
}

function contactKindToAdvType(kind: ContactKind): number {
  switch (kind) {
    case 'repeater':
      return ADV_TYPE.REPEATER;
    case 'room':
      return ADV_TYPE.ROOM;
    case 'sensor':
      return ADV_TYPE.SENSOR;
    default:
      return ADV_TYPE.CHAT;
  }
}

function findIdxByKey(key: string, byIdx: Map<number, Channel>): number | null {
  for (const [idx, channel] of byIdx) {
    if (channel.key === key) return idx;
  }
  return null;
}

// PATH_HASH_SIZE = 1 in firmware MeshCore.h — every channel publishes only the
// first byte of sha256(secret) on the wire so receivers can route GRP_TXT
// without learning the secret.
function channelHashOf(channel: Channel): number | null {
  if (!channel.secretHex) return null;
  const secret = Buffer.from(channel.secretHex, 'hex');
  if (secret.length === 0) return null;
  return createHash('sha256').update(secret).digest()[0];
}

function buildPath(
  pathHex: string,
  hashSize: number,
  finalSnr: number,
  senderName: string | null,
  ownerName: string | undefined,
): MessagePath {
  const hops: MessageHop[] = [];
  hops.push({
    kind: 'origin',
    shortId: senderName ? senderName.slice(0, 2).toLowerCase() : '??',
    name: senderName ?? null,
    pk: null,
    unnamed: senderName == null,
  });
  for (let i = 0; i < pathHex.length; i += hashSize * 2) {
    const shortId = pathHex.slice(i, i + hashSize * 2);
    hops.push({ kind: 'hop', shortId, name: null, pk: null, unnamed: true });
  }
  hops.push({
    kind: 'sink',
    shortId: ownerName ? ownerName.slice(0, 2).toLowerCase() : 'me',
    name: ownerName ?? 'My radio',
    pk: null,
  });
  return {
    id: createHash('sha1').update(`${pathHex}|${hashSize}`).digest('hex').slice(0, 16),
    hops,
    hashMode: hashSize,
    finalSnr,
  };
}
