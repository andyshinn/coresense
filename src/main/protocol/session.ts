import { Buffer } from 'node:buffer';
import type {
  Channel,
  ContactKind,
  RawPacket,
  SyncProgress,
  TransportState,
} from '../../shared/types';
import { DEFAULT_SYNC_PROGRESS } from '../../shared/types';
import { type AdminMode, type AdminRole, adminSessions } from '../bridge/adminSession';
import { bus, type ContactsSyncSignal, emit } from '../events/bus';
import { child } from '../log';
import { stateHolder } from '../state/holder';
import { discoveredStore } from '../storage/discoveredContacts';
import { transportManager } from '../transport/manager';
import { ADV_TYPE, ERR_CODE, PUSH, REQ_TYPE, RESP, STATS_TYPE, TXT_TYPE } from './codes';
import { buildReboot, buildSendSelfAdvert } from './encode';
import {
  ContactTableFullError,
  ProtocolError,
  ProtocolTimeoutError,
  UnknownContactError,
} from './errors';
import type { FeatureContext } from './feature';
import {
  encodeSetAdvertLatLon,
  encodeSetAdvertName,
  encodeSetOtherParams,
} from './features/advert';
import {
  type AutoAddFlagsInput,
  autoAddFeature,
  requestAutoAddConfig,
  setAutoAddConfig,
} from './features/autoAdd';
import { battStorageFeature, encodeGetBattAndStorage } from './features/battStorage';
import * as channelMessages from './features/channelMessages';
import * as channels from './features/channels';
import {
  contactsFeature,
  emitDiscovered,
  encodeAddUpdateContact,
  encodeGetContacts,
  encodeRemoveContact,
  encodeResetPath,
  resetContactsIter,
  scheduleContactsResync,
  upsertOnRadioContact,
} from './features/contacts';
import { contactsFullFeature } from './features/contactsFull';
import { customVarsFeature, encodeGetCustomVar, encodeSetCustomVar } from './features/customVars';
import { deviceInfoFeature, encodeDeviceQuery } from './features/deviceInfo';
import * as directMessages from './features/directMessages';
import { drainFeature, resetDrain, scheduleDrain } from './features/drain';
import { encodeSetPathHashMode, pathHashSizeToMode } from './features/pathHash';
import { encodeSetRadioParams, encodeSetRadioTxPower } from './features/radioParams';
import { encodeAppStart, selfInfoFeature } from './features/selfInfo';
import { getDeviceTime, setDeviceTime, syncDeviceTime } from './features/time';
import { FeatureRegistry } from './registry';
import {
  type AclEntry,
  buildAnonLogin,
  buildGetStats,
  buildLogout,
  buildSendBinaryReq,
  buildSendLogin,
  buildSendStatusReq,
  buildSendTelemetryReq,
  buildSendTracePath,
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
  parseStatusResponse,
  parseTelemetryResponse,
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

// How long to wait for RESP_OK / RESP_ERR after a SET_CHANNEL write before
// giving up. The radio normally responds within ~50ms; 2s leaves slack for a
// busy BLE link without leaving the UI hanging on a dead device.
const SET_CHANNEL_TIMEOUT_MS = 2000;

// Periodic CMD_DEVICE_QUERY to keep the link warm — the firmware replies with
// RESP_DEVICE_INFO so a dead link surfaces as a write timeout or missing reply
// rather than waiting on user-initiated traffic. Mirrors meshcore-open's
// battery/radio-stats polling pattern (protocol traffic doubles as liveness).
const LIVENESS_POLL_MS = 60_000;

export interface AckResult {
  ok: boolean;
  /** Firmware error code byte from a RESP_ERR reply (frame[1]); undefined on
   *  RESP_OK or on timeout. */
  errorCode?: number;
}

interface PendingAck {
  resolve: (result: AckResult) => void;
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

// Awaiter for a solicited typed reply (a GET command's RESP_* frame), keyed by
// expected code in `pendingTyped`. FIFO per code.
interface PendingTyped {
  resolve: (frame: Buffer) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const ADMIN_SENT_TIMEOUT_MS = 5_000;
const ADMIN_REPLY_TIMEOUT_MS = 20_000;
const CLI_REPLY_TIMEOUT_MS = 30_000;
// Default wait for a typed RESP_* reply to a feature ctx.request({ expect }).
const REQUEST_TIMEOUT_MS = 5_000;

export class ProtocolSession {
  private connected = false;
  /** Queue of awaiters for the next RESP_OK / RESP_ERR. The companion protocol
   *  has no correlation id, so we FIFO: any OK/ERR routes to the oldest
   *  pending awaiter. Only SET_CHANNEL currently uses this; if more writers
   *  appear we'll need to serialize them through here too. */
  private readonly pendingAcks: PendingAck[] = [];
  /** High-level handshake progress surfaced to the UI footer. Updated as we
   *  enumerate channel slots (and, later, contacts) during handshake. */
  private syncProgress: SyncProgress = { ...DEFAULT_SYNC_PROGRESS };
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
   *  ahead of the DM send queue via the directMessages `onSentTag` hook —
   *  admin writes are serialised, so the oldest entry is always the one the
   *  radio just acknowledged. */
  private readonly adminSentQueue: PendingAdminSent[] = [];
  /** Active CLI reply awaiters keyed by 6B sender pubkey prefix hex. */
  private readonly pendingCli = new Map<string, PendingCli>();
  /** Awaiter for the next RESP_CODE_STATS frame from a CMD_GET_STATS write. */
  private pendingLocalStats: {
    resolve: (s: LocalStats) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  /** FIFO of awaiters per expected RESP_* code, for ctx.request({ expect }). */
  private readonly pendingTyped = new Map<number, PendingTyped[]>();
  /** The capability surface handed to feature modules. */
  private readonly ctx: FeatureContext = {
    writeFrame: (frame) => this.writeFrame(frame),
    request: (frame, opts) => this.request(frame, opts),
  };
  /** Inbound-frame handlers, keyed by wire code. Empty until features migrate. */
  private readonly registry = new FeatureRegistry([
    contactsFullFeature,
    battStorageFeature,
    autoAddFeature,
    deviceInfoFeature,
    selfInfoFeature,
    customVarsFeature,
    contactsFeature,
    drainFeature,
    channels.channelsFeature,
    channelMessages.channelMessagesFeature,
    directMessages.directMessagesFeature,
  ]);
  private livenessTimer: NodeJS.Timeout | null = null;

  start(): void {
    bus.on('packet', this.onPacket);
    bus.on('transportState', this.onTransportState);
    bus.on('contactsSync', this.onContactsSync);
    // Repeater admin (Phase 2f) shares the RESP_SENT / CONTACT_MSG_RECV opcodes
    // the directMessages feature now owns. Until repeater-admin migrates, the
    // session's admin queues get first crack via these hooks (returning true
    // when an admin awaiter consumed the frame).
    directMessages.setAdminHooks({
      onSentTag: (tagHex) => {
        const adminAwait = this.adminSentQueue.shift();
        if (!adminAwait) return false;
        clearTimeout(adminAwait.timer);
        adminAwait.resolve(tagHex);
        return true;
      },
      onCliReply: (prefix, body) => {
        const pending = this.pendingCli.get(prefix);
        if (!pending) return false;
        clearTimeout(pending.timer);
        this.pendingCli.delete(prefix);
        pending.resolve(body);
        return true;
      },
    });
    this.purgeCorruptedChannels();
    channels.rebuildIndexes();
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
    bus.off('contactsSync', this.onContactsSync);
    resetContactsIter();
    resetDrain();
    directMessages.resetDmState('session stopped');
    this.stopLivenessPoll();
  }

  /** Returns ok on transport-level write success. When ok, `channelHash` is
   *  the byte the firmware tags GRP_TXT packets with on this channel — the
   *  caller uses it to register a pending-send entry so subsequent
   *  PUSH_CODE_LOG_RX_DATA observations matching that byte can be attributed
   *  back to the outgoing message (repeater relays we hear over the air). */
  async sendChannelText(
    channelKey: string,
    text: string,
  ): Promise<{ ok: boolean; error?: string; channelHash?: number }> {
    return channelMessages.sendChannelText(this.ctx, channelKey, text);
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
    return directMessages.sendDmText(this.ctx, contactKey, text, messageId, opts);
  }

  /** Send a DM with retry + flood fallback, mirroring the official client's
   *  behavior. */
  async sendDmTextWithRetry(
    contactKey: string,
    text: string,
    messageId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return directMessages.sendDmTextWithRetry(this.ctx, contactKey, text, messageId);
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
    const frame = encodeAddUpdateContact({
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
    await this.writeFrame(encodeResetPath(contact.publicKeyHex));
    holder.upsertContact({
      ...contact,
      outPathHex: undefined,
      pathManual: true,
      hops: undefined,
    });
    emit.contacts(holder.getContacts());
  }

  /** Commit a discovered contact to the radio's store (CMD_ADD_UPDATE_CONTACT).
   *  Awaits the radio's RESP_OK/ERR before marking the contact on-radio. */
  async addContactToRadio(publicKeyHex: string): Promise<void> {
    const row = discoveredStore.get(publicKeyHex);
    if (!row) {
      log.warn(`unknown discovered contact ${publicKeyHex.slice(0, 12)}`);
      throw new UnknownContactError(publicKeyHex);
    }
    const hasFix = row.gps_lat !== 0 || row.gps_lon !== 0;
    const frame = encodeAddUpdateContact({
      publicKeyHex,
      advType: row.type,
      flags: row.flags,
      outPathHex: row.out_path_len === 0xff ? '' : row.out_path_hex,
      name: row.name,
      ...(hasFix
        ? { gpsLat: row.gps_lat, gpsLon: row.gps_lon, lastAdvertUnix: row.last_advert_unix }
        : {}),
    });
    // Await the radio's reply before claiming the contact is on-radio. RESP_ERR
    // with ERR_CODE_TABLE_FULL means the store is full — surface it and leave
    // on_radio untouched rather than lying to the UI.
    const ack = this.awaitAck();
    try {
      await this.writeFrame(frame);
    } catch (err) {
      this.popPendingAck(ack.entry);
      throw err;
    }
    const result = await ack.promise;
    if (!result.ok) {
      if (result.errorCode === ERR_CODE.TABLE_FULL) {
        log.warn(`add contact rejected: contact table full ${publicKeyHex.slice(0, 12)}`);
        throw new ContactTableFullError();
      }
      throw new Error('radio did not confirm add-contact');
    }
    discoveredStore.setOnRadio(publicKeyHex, true);
    upsertOnRadioContact({
      publicKeyHex,
      type: row.type,
      flags: row.flags,
      outPathLen: row.out_path_len,
      outPathHex: row.out_path_hex,
      name: row.name,
      lastAdvertUnix: row.last_advert_unix,
      gpsLat: row.gps_lat,
      gpsLon: row.gps_lon,
      lastmod: row.lastmod,
    });
    emitDiscovered();
    scheduleContactsResync(this.ctx);
  }

  /** Delete a contact from the radio's store (CMD_REMOVE_CONTACT). Keeps it in
   *  the discovered pool, flagged off-radio. */
  async removeContactFromRadio(publicKeyHex: string): Promise<void> {
    await this.writeFrame(encodeRemoveContact(publicKeyHex));
    discoveredStore.setOnRadio(publicKeyHex, false);
    const holder = stateHolder();
    holder.removeContact(`c:${publicKeyHex}`);
    emit.contacts(holder.getContacts());
    emitDiscovered();
  }

  /** Toggle the favourite flag (contact flags bit 0). For on-radio contacts,
   *  round-trips CMD_ADD_UPDATE_CONTACT so the firmware persists the flag
   *  (protects from overwrite-oldest). Discovered-only contacts update locally. */
  async setContactFavourite(publicKeyHex: string, favourite: boolean): Promise<void> {
    const row = discoveredStore.get(publicKeyHex);
    if (!row) {
      log.warn(`unknown discovered contact ${publicKeyHex.slice(0, 12)}`);
      throw new UnknownContactError(publicKeyHex);
    }
    if (row.on_radio !== 0) {
      const flags = favourite ? row.flags | 0x01 : row.flags & ~0x01;
      const hasFix = row.gps_lat !== 0 || row.gps_lon !== 0;
      const frame = encodeAddUpdateContact({
        publicKeyHex,
        advType: row.type,
        flags,
        outPathHex: row.out_path_len === 0xff ? '' : row.out_path_hex,
        name: row.name,
        ...(hasFix
          ? { gpsLat: row.gps_lat, gpsLon: row.gps_lon, lastAdvertUnix: row.last_advert_unix }
          : {}),
      });
      await this.writeFrame(frame);
    }
    discoveredStore.setFavourite(publicKeyHex, favourite);
    const holder = stateHolder();
    const existing = holder.getContacts().find((c) => c.key === `c:${publicKeyHex}`);
    if (existing) {
      holder.upsertContact({ ...existing, favourite });
      emit.contacts(holder.getContacts());
    }
    emitDiscovered();
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
  async setPathHashMode(size: 1 | 2 | 3): Promise<void> {
    await this.writeFrame(encodeSetPathHashMode(pathHashSizeToMode(size)));
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
        encodeSetRadioParams({
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
    const ok1 = (await paramsAck.promise).ok;
    if (!ok1) return false;
    await sleep(WRITE_GAP_MS);
    const powerAck = this.awaitAck();
    try {
      await this.writeFrame(encodeSetRadioTxPower(opts.txPowerDbm));
    } catch (err) {
      this.popPendingAck(powerAck.entry);
      log.warn(`setRadioTxPower write failed: ${(err as Error).message}`);
      return false;
    }
    const ok2 = (await powerAck.promise).ok;
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
      await this.writeFrame(encodeSetAdvertName(name));
    } catch (err) {
      this.popPendingAck(ack.entry);
      log.warn(`setAdvertName write failed: ${(err as Error).message}`);
      return false;
    }
    const ok = (await ack.promise).ok;
    if (!ok) return false;
    const holder = stateHolder();
    holder.setDeviceIdentity({ ...holder.getDeviceIdentity(), name });
    emit.deviceIdentity(holder.getDeviceIdentity());
    const owner = holder.getOwner();
    if (owner) {
      const nextOwner = { ...owner, name };
      holder.setOwner(nextOwner);
      emit.owner(nextOwner);
    }
    return true;
  }

  /** Push device GPS coords used in self-adverts. */
  async setAdvertLatLon(lat: number, lon: number): Promise<boolean> {
    if (!this.connected) return false;
    const ack = this.awaitAck();
    try {
      await this.writeFrame(encodeSetAdvertLatLon(lat, lon));
    } catch (err) {
      this.popPendingAck(ack.entry);
      log.warn(`setAdvertLatLon write failed: ${(err as Error).message}`);
      return false;
    }
    const ok = (await ack.promise).ok;
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
        encodeSetOtherParams({
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
    const ok = (await ack.promise).ok;
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
    return setAutoAddConfig(this.ctx, flags);
  }

  /** Ask the radio for its current auto-add flags. RESP_AUTOADD_CONFIG lands in
   *  the feature handler → updates holder + emits. */
  async requestAutoAddConfig(): Promise<void> {
    if (!this.connected) return;
    await requestAutoAddConfig(this.ctx);
  }

  /** Toggle the GPS module / change interval via custom-var KV. The firmware
   *  ignores intervals outside [60, 86399]; we clamp client-side too. */
  async setGpsConfig(cfg: { enabled: boolean; intervalSec: number }): Promise<boolean> {
    if (!this.connected) return false;
    const interval = Math.min(86399, Math.max(60, Math.floor(cfg.intervalSec)));
    const ack1 = this.awaitAck();
    try {
      await this.writeFrame(encodeSetCustomVar('gps', cfg.enabled));
    } catch (err) {
      this.popPendingAck(ack1.entry);
      log.warn(`setCustomVar(gps) write failed: ${(err as Error).message}`);
      return false;
    }
    if (!(await ack1.promise).ok) return false;
    await sleep(WRITE_GAP_MS);
    const ack2 = this.awaitAck();
    try {
      await this.writeFrame(encodeSetCustomVar('gps_interval', interval));
    } catch (err) {
      this.popPendingAck(ack2.entry);
      log.warn(`setCustomVar(gps_interval) write failed: ${(err as Error).message}`);
      return false;
    }
    if (!(await ack2.promise).ok) return false;
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

  /** Read the radio's RTC clock (unix seconds). */
  getDeviceTime(): Promise<number> {
    return getDeviceTime(this.ctx);
  }

  /** Set the radio's RTC clock (unix seconds). Rejects ProtocolError if the
   *  radio returns RESP_ERR (e.g. a clock earlier than its own → ILLEGAL_ARG). */
  setDeviceTime(epochSecs: number): Promise<void> {
    return setDeviceTime(this.ctx, epochSecs);
  }

  /** Push the host's current time to the radio. */
  syncDeviceTime(): Promise<void> {
    return syncDeviceTime(this.ctx);
  }

  /** Query battery + storage. Replies land in onPacket and update DeviceInfo. */
  async requestBattAndStorage(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.writeFrame(encodeGetBattAndStorage());
    } catch (err) {
      log.warn(`requestBattAndStorage write failed: ${(err as Error).message}`);
    }
  }

  /** Re-issue DEVICE_QUERY to refresh DeviceInfo + capabilities. */
  async requestDeviceInfo(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.writeFrame(encodeDeviceQuery());
    } catch (err) {
      log.warn(`requestDeviceInfo write failed: ${(err as Error).message}`);
    }
  }

  /** Query the firmware's custom-var store ("gps", "gps_interval", etc.).
   *  Empty key requests all known keys. Reply: RESP_CUSTOM_VARS. */
  async requestCustomVars(key = ''): Promise<void> {
    if (!this.connected) return;
    try {
      await this.writeFrame(encodeGetCustomVar(key));
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
    const frame = directMessages.encodeSendDmText({
      destPublicKeyHex: contact.publicKeyHex,
      text: command,
      txtType: TXT_TYPE.CLI_DATA,
    });
    // CLI sends are still DMs at the wire level — push onto the DM send FIFO so
    // the RESP_SENT FIFO advances correctly. The id is synthetic; the radio
    // doesn't ack CLI sends with PUSH_SEND_CONFIRMED so we won't get a state flip.
    const syntheticId = `cli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    directMessages.enqueueDmSend(syntheticId);
    try {
      await this.writeFrame(frame);
    } catch (err) {
      directMessages.dequeueDmSend(syntheticId);
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

  /** Generic send→await for feature modules. See FeatureContext.request. */
  private async request(
    frame: Buffer,
    opts?: { expect?: number; timeoutMs?: number },
  ): Promise<Buffer> {
    if (opts?.expect === undefined) {
      // RESP_OK / RESP_ERR path — reuse the shared, correlation-id-less ack FIFO
      // (see the pendingAcks field comment): concurrent OK/ERR writers can
      // cross-resolve, so callers must serialize. A timeout surfaces here as
      // ProtocolError(undefined) — indistinguishable from a real bare RESP_ERR.
      const { promise, entry } = this.awaitAck(opts?.timeoutMs ?? REQUEST_TIMEOUT_MS);
      try {
        await this.writeFrame(frame);
      } catch (err) {
        this.popPendingAck(entry);
        throw err;
      }
      const ack = await promise;
      if (!ack.ok) throw new ProtocolError(ack.errorCode);
      return Buffer.alloc(0);
    }
    // Typed-reply path — resolve the next inbound frame whose code === expect.
    const expect = opts.expect;
    // RESP_OK / RESP_ERR must flow through the bare-ack path above (omit `expect`);
    // intercepting them as typed replies would steal a concurrent device-write's ack.
    if (expect === RESP.OK || expect === RESP.ERR) {
      throw new Error('request({ expect }) cannot await RESP_OK/RESP_ERR — omit `expect`');
    }
    const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
    return new Promise<Buffer>((resolve, reject) => {
      const queue = this.pendingTyped.get(expect) ?? [];
      const remove = () => {
        const q = this.pendingTyped.get(expect);
        if (!q) return;
        const i = q.indexOf(entry);
        if (i !== -1) q.splice(i, 1);
        if (q.length === 0) this.pendingTyped.delete(expect);
      };
      const timer = setTimeout(() => {
        remove();
        reject(new ProtocolTimeoutError(expect));
      }, timeoutMs);
      const entry: PendingTyped = { resolve, reject, timer };
      queue.push(entry);
      this.pendingTyped.set(expect, queue);
      this.writeFrame(frame).catch((err) => {
        clearTimeout(timer);
        remove();
        reject(err as Error);
      });
    });
  }

  private onTransportState = (state: TransportState) => {
    const wasConnected = this.connected;
    this.connected = state === 'connected';
    if (this.connected && !wasConnected) {
      log.info('transport connected — running handshake');
      channels.clearPresence();
      void this.handshake();
      this.startLivenessPoll();
    } else if (!this.connected && wasConnected) {
      log.info('transport disconnected');
      this.stopLivenessPoll();
      // Abandon any in-flight drain round; a reconnect's handshake starts fresh.
      resetDrain();
      channels.clearPresence();
      this.updateSyncProgress({ ...DEFAULT_SYNC_PROGRESS });
      // Resolve any in-flight acks as failures rather than leaving callers hung.
      for (const p of this.pendingAcks.splice(0)) {
        clearTimeout(p.timer);
        p.resolve({ ok: false });
      }
      // Any DM still awaiting RESP_SENT will never get one — fail them so the
      // UI doesn't leave 'sending' spinners forever.
      directMessages.resetDmState('transport disconnected');
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
      // Fail any typed-reply awaiters (ctx.request with `expect`) so feature GETs
      // reject promptly on disconnect instead of waiting out their timeout.
      for (const queue of this.pendingTyped.values()) {
        for (const entry of queue) {
          clearTimeout(entry.timer);
          entry.reject(new Error('transport disconnected'));
        }
      }
      this.pendingTyped.clear();
      adminSessions.reset('transport disconnected');
    }
  };

  /** Snapshot of channel keys currently present on the radio. Empty when the
   *  transport is disconnected. */
  getDevicePresence(): string[] {
    return channels.getDevicePresence();
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
    return channels.setChannel(this.ctx, idx, name, secretHex);
  }

  /** Mark a channel as present on the device. Call after a successful
   *  SET_CHANNEL ack — the firmware doesn't echo CHANNEL_INFO back, so without
   *  this the new channel would stay grayed-out in the UI until the next
   *  full re-enumeration. */
  markChannelPresent(channel: Channel): void {
    channels.markChannelPresent(channel);
  }

  /** Mark a slot as no longer on the device (paired with a zero-key write).
   *  Frees the slot for pickFreeSlot and clears the presence flag. */
  markChannelAbsent(idx: number): void {
    channels.markChannelAbsent(idx);
  }

  /** Lowest unused slot index in 0..15, or null if all 16 are taken. The
   *  device-presence set is the authority; persisted `idx` on a Channel only
   *  counts when the radio confirmed it this session. */
  pickFreeSlot(): number | null {
    return channels.pickFreeSlot();
  }

  /** Derive the 16-byte secret for a public/hashtag channel by name. Callers
   *  supplying their own secret (e.g. private channel imported from a share
   *  link) should pass it directly to setChannel instead. */
  deriveSecret(name: string): string {
    return channels.deriveChannelSecret(name);
  }

  private awaitAck(timeoutMs: number = SET_CHANNEL_TIMEOUT_MS): {
    promise: Promise<AckResult>;
    entry: PendingAck;
  } {
    let entry!: PendingAck;
    const promise = new Promise<AckResult>((resolve) => {
      const timer = setTimeout(() => {
        const i = this.pendingAcks.indexOf(entry);
        if (i !== -1) this.pendingAcks.splice(i, 1);
        resolve({ ok: false });
      }, timeoutMs);
      entry = { resolve, timer };
      this.pendingAcks.push(entry);
    });
    return { promise, entry };
  }

  private resolveNextAck(ok: boolean, errorCode?: number): boolean {
    const entry = this.pendingAcks.shift();
    if (!entry) return false;
    clearTimeout(entry.timer);
    entry.resolve({ ok, errorCode });
    return true;
  }

  private startLivenessPoll(): void {
    this.stopLivenessPoll();
    this.livenessTimer = setInterval(() => {
      if (!this.connected) return;
      this.writeFrame(encodeDeviceQuery()).catch((err) => {
        log.debug(`liveness DEVICE_QUERY failed: ${(err as Error).message}`);
      });
      // Refresh battery/storage on the same cadence so the identity card's
      // battery readout stays current without a manual device refresh.
      this.writeFrame(encodeGetBattAndStorage()).catch((err) => {
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
      await this.writeFrame(encodeDeviceQuery());
      await sleep(WRITE_GAP_MS);
      await this.writeFrame(encodeAppStart(APP_NAME, APP_VERSION));
      await sleep(WRITE_GAP_MS);
      // Kick the contact iterator FIRST so RESP_CONTACTS_START gives us the
      // contact total before we start incrementing channel progress, and so
      // RESP_CONTACT × N can stream in via onPacket while the channel loop
      // runs below. We arm contactsDone *before* writing GET_CONTACTS so a
      // very fast END_OF_CONTACTS can't race past us.
      const contactsStart = this.armWaiter('contactsStartWaiter', CONTACTS_START_WAIT_MS);
      const contactsDone = this.armWaiter('contactsDoneWaiter', CONTACTS_DONE_WAIT_MS);
      await this.writeFrame(encodeGetContacts());
      await contactsStart;
      await sleep(WRITE_GAP_MS);
      // Enumerate channels. Empty slots return RESP_ERR or an all-zero key
      // RESP_CHANNEL_INFO; both are filtered by decodeChannelInfo / channelsFeature.
      for (let i = 0; i < CHANNEL_SLOT_COUNT; i += 1) {
        await this.writeFrame(channels.encodeGetChannel(i));
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
      await this.writeFrame(encodeGetBattAndStorage());
      await sleep(WRITE_GAP_MS);
      // Drain any messages queued during the disconnect window. Self-advert
      // is user-initiated only (Cmd-Shift-A) — matching the official mobile
      // clients, which never auto-advertise.
      void scheduleDrain(this.ctx);
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

  /** Bridge the contacts feature's iterator signals into the handshake's
   *  progress bar + start/done waiters. The feature owns the iterator state;
   *  the session owns the composite SyncProgress and the handshake coordination.
   *  `EventEmitter.emit` runs this synchronously, so the timing matches the old
   *  inline `updateSyncProgress` / `resolveWaiter` calls exactly. */
  private onContactsSync = (s: ContactsSyncSignal): void => {
    if (s.phase === 'start') {
      if (s.total !== null) this.updateSyncProgress({ contacts: { done: 0, total: s.total } });
      this.resolveWaiter('contactsStartWaiter');
    } else if (s.phase === 'progress') {
      this.updateSyncProgress({ contacts: { done: s.done, total: s.total } });
    } else {
      this.updateSyncProgress({ contacts: { done: s.done, total: s.done } });
      this.resolveWaiter('contactsDoneWaiter');
    }
  };

  private onPacket = (p: RawPacket) => {
    if (p.kind !== 'companion') return;
    const code = p.code;
    if (code === undefined) return;
    const frame = Buffer.from(p.bytes);
    log.trace(
      `rx code=0x${code.toString(16).padStart(2, '0')} (${p.codeName ?? '?'}) len=${frame.length}`,
    );

    // (1) Solicited typed replies (ctx.request with `expect`) get first crack.
    const typedQueue = this.pendingTyped.get(code);
    if (typedQueue && typedQueue.length > 0) {
      const entry = typedQueue.shift();
      if (typedQueue.length === 0) this.pendingTyped.delete(code);
      if (entry) {
        clearTimeout(entry.timer);
        entry.resolve(frame);
        return;
      }
    }
    // (2) Modular feature handlers. Falls through to the legacy chain below for
    //     any code no feature has claimed yet.
    const feature = this.registry.get(code);
    if (feature) {
      feature.handle(code, frame, this.ctx);
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
    if (code === RESP.OK || code === RESP.ERR) {
      // Device-write awaiters get first crack at any OK/ERR. A RESP_ERR carries
      // an error-code byte (frame[1]) — thread it through so callers like
      // addContactToRadio can detect ERR_CODE_TABLE_FULL. If no awaiter is
      // queued and a DM is in flight, a bare RESP_ERR means the radio rejected
      // the send (e.g. unknown recipient prefix) — fail the DM.
      const errorCode = code === RESP.ERR ? frame[1] : undefined;
      if (this.resolveNextAck(code === RESP.OK, errorCode)) return;
      if (code === RESP.ERR) directMessages.failOldestDmSend('radio rejected send');
      return;
    }
  };

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
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
