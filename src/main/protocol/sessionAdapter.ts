import { Buffer } from 'node:buffer';
import { MeshCoreSession, type Models, type Ports, Protocol } from '@andyshinn/meshcore-ts';
import { pubkeyFromKey } from '../../shared/conversationKey';
import type { TelemetryPerms, TelemetryPolicy } from '../../shared/types';
import { adminSessions } from '../bridge/adminSession';
import { child } from '../log';
import { stateHolder } from '../state/holder';
import { policyFromSelfInfo } from '../telemetry/policy';
import { wireSessionEvents } from './adapterEvents';
import { type LibAutoAddFlags, toLibAutoAdd } from './autoAddMapping';

const APP_NAME = 'coresense';
const APP_VERSION = 1;

/** RESP_SENT details for a binary request (`onSent`). */
export interface BinaryRequestSentInfo {
  /** The radio flooded the request (no stored path). */
  flood: boolean;
  /** The radio's own estimate of the reply time, ms. */
  estTimeoutMs: number;
}

export interface BinaryRequestOptions {
  timeoutMs?: number;
  /** Abort the wait (rejects with the signal's reason, releases the tag). */
  signal?: AbortSignal;
  /** Fires once RESP_SENT arrives for this request. */
  onSent?: (info: BinaryRequestSentInfo) => void;
}

/** Owns a MeshCoreSession and bridges its events into coresense's persistence
 *  + bus, and its command methods to the API layer. */
export class SessionAdapter {
  readonly session: MeshCoreSession;
  private started = false;
  /** Separate from `started` because it is not undone by stop().
   *
   *  `MeshCoreSession.stop()` leaves `session.events` listeners attached — it
   *  tears the connection down and clears its own started/connected flags, and
   *  nothing more. So a second `wireSessionEvents` on the same session does not
   *  replace the first, it ADDS to it, and every frame after that is written
   *  through twice: two `owner` broadcasts, two message persists, two contact
   *  write-throughs.
   *
   *  Not reachable while nothing in src/ calls stop(), but restart became a
   *  working flow in meshcore-ts 0.8.1 — before it, stop() left `connected`
   *  latched and the next start() was a silent no-op, so nothing came back to
   *  re-drive. It works now, which makes this the wrong thing to leave armed. */
  private wired = false;

  constructor(transport: Ports.Transport) {
    // Without a logger the library falls back to its noopLogger and every
    // ctx.log line — including the contacts iterator's start/done counts — is
    // silently discarded. Route it into coresense's logging so the protocol
    // layer is inspectable at the level the user chose.
    this.session = new MeshCoreSession({
      transport,
      appName: APP_NAME,
      appVersion: APP_VERSION,
      logger: child('meshcore'),
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.seedAutoAddConfig();
    this.seedGpsConfig();
    if (!this.wired) {
      this.wired = true;
      wireSessionEvents(this.session);
    }
    this.session.start();
  }

  /** Prime the library's AutoAddConfig mirror from our persisted copy.
   *
   *  The library's mirror is the value it feeds back onto the wire: an omitted
   *  `manualAddContacts` on `setOtherParams` resends it, and its RESP_SELF_INFO
   *  and RESP_AUTOADD_CONFIG handlers emit `autoAddConfig` as "the whole mirror
   *  with the one field the radio just told me about replaced". Left at the
   *  library's own defaults, that emit carries library defaults for every field
   *  the radio has NOT reported yet — so the first RESP_SELF_INFO of a session
   *  (the reply to APP_START, i.e. every connect) would hand us `chat/repeater/
   *  room/sensor/overwriteOldest` = all-true and wipe the user's saved
   *  selection, which holder.setAutoAddConfig then persists to disk.
   *
   *  Seeding makes "the field the radio hasn't mentioned" equal what we already
   *  had, so the emit is a no-op for those fields and a genuine correction for
   *  the ones the radio did report.
   *
   *  It does NOT hand a `mode` to the library's `shouldAutoAdd`, the gate on its
   *  post-advert GET_CONTACTS re-sync. As of meshcore-ts 0.8.1 that gate reads
   *  bit 0 of `manualAddContacts` and, only when that bit is set, the per-kind
   *  flags — never `mode`, which the library neither reads nor writes. `mode` is
   *  seeded for symmetry only, and adapterEvents derives its own `mode` from bit
   *  0 rather than reading the library's back. That is the right way round:
   *  honouring a stored `mode` would let our copy suppress a re-sync that a
   *  radio reporting bit 0 clear has already justified. */
  private seedAutoAddConfig(): void {
    this.session.state.setAutoAddConfig(toLibAutoAdd(stateHolder().getAutoAddConfig()));
  }

  /** Prime the library's GpsConfig mirror from our persisted copy, for the
   *  same reason as seedAutoAddConfig. Firmware's `gps_interval` is
   *  write-only (CMD_GET_CUSTOM_VARS never reports it), so every `gpsConfig`
   *  emit carries the mirror's interval: left unseeded that is the library's
   *  default (300), and the first custom-vars reply would overwrite the value
   *  last set from CoreSense. */
  private seedGpsConfig(): void {
    this.session.state.setGpsConfig(stateHolder().getGpsConfig());
  }

  /** The library's AutoAddConfig mirror, verbatim.
   *
   *  This is NOT the same thing as coresense's holder copy, and callers that
   *  need to know what the RADIO holds must ask here. The holder is written
   *  optimistically the moment the user hits Save — while disconnected, and
   *  even when the frame is rejected — whereas the mirror only ever moves when
   *  the radio reports a value (RESP_SELF_INFO byte 47, RESP_AUTOADD_CONFIG) or
   *  when a command actually reached the wire. Comparing a pending change
   *  against the holder therefore reports "no change" for edits the radio never
   *  received, and nothing ever retries them. */
  getLibAutoAddConfig(): Models.AutoAddConfig {
    return this.session.state.getAutoAddConfig();
  }

  /** Write flags we have just pushed with CMD_SET_AUTO_ADD_CONFIG into the
   *  library's mirror.
   *
   *  `MeshCoreSession.setAutoAddConfig()` only encodes and writes the frame; it
   *  never touches `state`. The mirror is also what the library re-emits as the
   *  WHOLE `autoAddConfig` payload whenever a later frame moves one field of it
   *  (`setOtherParams` doing the manual-add byte, RESP_SELF_INFO doing the
   *  same), and wireSessionEvents writes that payload straight into the holder.
   *  Leaving the mirror stale therefore doesn't just misinform the library's own
   *  `shouldAutoAdd` gate — it hands the user's just-saved kind flags back to
   *  them as whatever they were at process start.
   *
   *  `manualAddContacts` is deliberately NOT settable here: the library owns
   *  that byte (it is the one field it does maintain), and it is our only
   *  radio-confirmed reference for whether the mode bit still needs sending. */
  mirrorAutoAddConfig(flags: LibAutoAddFlags): void {
    this.session.state.setAutoAddConfig({ ...this.session.state.getAutoAddConfig(), ...flags });
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.session.stop();
  }

  // ---- Command delegation ------------------------------------------------
  // Each method is a thin pass-through to the underlying MeshCoreSession so the
  // API layer keeps calling `protocolSession().<cmd>(...)`. Complex arg types use
  // `Parameters<MeshCoreSession['<method>']>[n]` so signatures track the library
  // exactly (no drift if the lib evolves).

  // messaging
  sendChannelText(key: string, text: string) {
    return this.session.sendChannelText(key, text);
  }
  registerChannelSend(params: Parameters<MeshCoreSession['registerChannelSend']>[0]) {
    return this.session.registerChannelSend(params);
  }
  sendDmTextWithRetry(key: string, text: string, id: string) {
    return this.session.sendDmTextWithRetry(key, text, id);
  }
  sendStatusReq(key: string) {
    return this.session.sendStatusReq(key);
  }

  // ---- Telemetry -----------------------------------------------------------

  /** Read the connected radio's own telemetry: raw CayenneLPP, unpadded, no
   *  airtime. Rejects with the library's ProtocolError on RESP_ERR (firmware
   *  without self telemetry says "unsupported") and on timeout. */
  async requestSelfTelemetry(opts: { timeoutMs?: number } = {}): Promise<Uint8Array> {
    return new Uint8Array(await this.session.requestSelfTelemetry(opts));
  }

  /** CMD_SEND_BINARY_REQ to a stored contact, resolving the raw reply body
   *  (tag stripped, mesh padding kept). `reqData` is `[REQ_TYPE, ...params]`. */
  async sendBinaryRequest(key: string, reqData: Uint8Array, opts: BinaryRequestOptions = {}): Promise<Uint8Array> {
    const reply: unknown = await this.session.sendBinaryRequest(key, Buffer.from(reqData), opts);
    // A waiter resolved with anything but bytes (a RESP_SENT swapped with a
    // foreign client's trace on the same radio resolves it with TRACE_DATA)
    // would copy to an empty array — a fake empty `ok` reply — so refuse it.
    if (!(reply instanceof Uint8Array)) throw new Error('binary request resolved with a non-binary reply');
    return new Uint8Array(reply);
  }

  /** Write a contact's telemetry permissions (flags bits 1–3), keeping the
   *  favourite bit. Resolves false when the radio refuses or times out. */
  setContactTelemetryPerms(key: string, perms: TelemetryPerms): Promise<boolean> {
    return this.session.setContactTelemetryPerms(key, { base: perms.base, loc: perms.loc, env: perms.env });
  }

  /** Write one sensor setting. Resolves false when the radio rejects it (T1000
   *  refuses `gps_interval`) or doesn't answer. A `gps`/`gps_interval` write
   *  also updates the library's GpsConfig and emits `gpsConfig`, which
   *  adapterEvents commits. */
  setCustomVar(key: string, value: string): Promise<boolean> {
    return this.session.setCustomVar(key, value);
  }

  /** The telemetry modes and multi-acks the RADIO holds, read back from
   *  RESP_SELF_INFO (bytes 44 and 46). The library folds every SELF_INFO into
   *  its `telemetryPolicy` event, the handshake's included, so this is only
   *  for a route that needs the policy before that has landed. APP_START is
   *  how firmware hands it out, so this re-publishes the owner too. */
  async readTelemetryPolicy(): Promise<TelemetryPolicy> {
    return policyFromSelfInfo(await this.session.getSelfInfo());
  }

  // contacts
  addContactToRadio(pk: string) {
    return this.session.addContactToRadio(pk);
  }
  removeContactFromRadio(pk: string) {
    return this.session.removeContactFromRadio(pk);
  }
  setContactFavourite(pk: string, fav: boolean) {
    return this.session.setContactFavourite(pk, fav);
  }
  setContactPath(key: string, outPathHex: string, opts: Parameters<MeshCoreSession['setContactPath']>[2]) {
    return this.session.setContactPath(key, outPathHex, opts);
  }
  resetContactPath(key: string) {
    return this.session.resetContactPath(key);
  }
  setContactPreferDirect(key: string, preferDirect: boolean) {
    return this.session.setContactPreferDirect(key, preferDirect);
  }
  /** Actively re-enumerate the radio's contact store (CMD_GET_CONTACTS) outside
   *  the handshake. The lib serialises it against a running sync with its own
   *  withSyncLock, and the resulting RESP_CONTACT stream lands on the normal
   *  contactObserved/contacts/discovered/contactsSynced handlers — so callers
   *  broadcast nothing themselves. Gives the user a contact-refresh lever that
   *  isn't "disconnect and reconnect" (#45 item 6). */
  getContacts() {
    return this.session.getContacts();
  }
  /** The radio's cached INBOUND advert path for a contact (CMD_GET_ADVERT_PATH),
   *  or null when its 16-slot RAM ring no longer holds this node. That null is
   *  the normal answer, not an error.
   *
   *  THROWS for a contact the radio doesn't store: the lib resolves the contact
   *  key to a full pubkey through the radio's contact map and raises when it
   *  misses. Call hasRadioContact() first rather than catching that (#45 item 7).
   *
   *  Since meshcore-ts 0.8.1 that null means one of two things: RESP_ERR
   *  NOT_FOUND (the ring has no entry), or a link that dropped mid-round-trip.
   *  The library's teardown resolves the shared ack FIFO as `{ ok: false }`
   *  BEFORE it rejects the typed queue, and requestOrNull's ack entry resolves
   *  null without inspecting `ok`, so an abandoned request is indistinguishable
   *  from a miss in the value itself — state/advertPath.ts separates them by
   *  whether the link is still up when it reads the null. (A request TIMEOUT
   *  does reject, as ProtocolTimeoutError, so that one is distinguishable.)
   *  What 0.8.1 removed from the null is a
   *  THIRD meaning: a reply whose path_len is the 0xFF flood / no-path sentinel
   *  now decodes successfully and is flagged
   *  `{ hops: 0, pathHex: '', flood: true }`. (Through 0.7.2 it
   *  arrived as null instead, because unpacking 0xFF claimed 252 path bytes and
   *  failed decodeAdvertPath's own length guard; 0.8.0 special-cased the length
   *  but not the meaning, so it came back as a bare `hops: 0` indistinguishable
   *  from a genuine direct reception.)
   *
   *  So a caller must branch on `flood` BEFORE reading `hops` — those zero hops
   *  mean "no path known", not "heard direct". The flag is only ever
   *  present-and-true, so test truthiness. state/advertPath.ts is where that
   *  branch lives, and it is the only caller. */
  getAdvertPath(key: string) {
    return this.session.getAdvertPath(key);
  }
  /** Does the radio's contact map hold this key? Reads the library's OWN map —
   *  the exact one getAdvertPath resolves through — rather than coresense's
   *  holder mirror, which is fed by a coalesced `contacts` event and so lags a
   *  contact the radio auto-added a moment ago. */
  hasRadioContact(key: string) {
    return this.session.state.getContact(key) !== null;
  }

  // radio / device
  setPathHashMode(size: 1 | 2 | 3) {
    return this.session.setPathHashMode(size);
  }
  setRadioParams(opts: Parameters<MeshCoreSession['setRadioParams']>[0]) {
    return this.session.setRadioParams(opts);
  }
  setAdvertName(name: string) {
    return this.session.setAdvertName(name);
  }
  setAdvertLatLon(lat: number, lon: number, alt?: number) {
    return this.session.setAdvertLatLon(lat, lon, alt);
  }
  /** `manualAddContacts` is byte 1 of CMD_SET_OTHER_PARAMS, which the firmware
   *  assigns before any length guard — so every telemetry / share-position save
   *  rewrites the radio's auto-add master switch. Omit it and the library
   *  substitutes the value it mirrored from RESP_SELF_INFO byte 47, which is
   *  what a caller changing something else wants; pass it only to deliberately
   *  change auto-add behaviour (the /api/device/auto-add route). */
  setOtherParams(policy: Parameters<MeshCoreSession['setOtherParams']>[0], sharePos: boolean, manualAddContacts?: number) {
    return this.session.setOtherParams(policy, sharePos, manualAddContacts);
  }
  setAutoAddConfig(flags: Parameters<MeshCoreSession['setAutoAddConfig']>[0]) {
    return this.session.setAutoAddConfig(flags);
  }
  requestAutoAddConfig() {
    return this.session.requestAutoAddConfig();
  }
  setGpsConfig(cfg: Parameters<MeshCoreSession['setGpsConfig']>[0]) {
    return this.session.setGpsConfig(cfg);
  }
  reboot() {
    return this.session.reboot();
  }
  sendSelfAdvert(flood?: boolean) {
    return this.session.sendSelfAdvert(flood);
  }
  /** CMD_EXPORT_CONTACT. With no key the radio exports its OWN signed advert
   *  (the `meshcore://` contact link), as hex; null when it refused. */
  exportContact(destPublicKeyHex?: string) {
    return this.session.exportContact(destPublicKeyHex);
  }
  /** CMD_GET_DEVICE_TIME: the radio's RTC, unix seconds. */
  getDeviceTime() {
    return this.session.getDeviceTime();
  }
  requestDeviceInfo() {
    return this.session.requestDeviceInfo();
  }
  requestBattAndStorage() {
    return this.session.requestBattAndStorage();
  }
  /** Every sensor setting the radio reports (CMD_GET_CUSTOM_VARS ignores the
   *  key and returns them all), e.g. `{ gps: '1' }`. `{}` is a real answer
   *  (no GPS hardware), not a missing reply. Also folds `gps` into GpsConfig. */
  requestCustomVars(key?: string) {
    return this.session.requestCustomVars(key);
  }

  // channels
  setChannel(idx: number, name: string, secretHex: string) {
    return this.session.setChannel(idx, name, secretHex);
  }
  markChannelPresent(channel: Parameters<MeshCoreSession['markChannelPresent']>[0]) {
    return this.session.markChannelPresent(channel);
  }
  markChannelAbsent(idx: number) {
    return this.session.markChannelAbsent(idx);
  }
  pickFreeSlot() {
    return this.session.pickFreeSlot();
  }
  deriveSecret(name: string) {
    return this.session.deriveSecret(name);
  }
  getDevicePresence() {
    return this.session.getDevicePresence();
  }
  getSyncProgress() {
    return this.session.getSyncProgress();
  }

  // repeater admin
  async repeaterLogin(key: string, password: string) {
    const result = await this.session.repeaterLogin(key, password);
    // The library owns the login round-trip; mirror the resulting session into
    // coresense's adminSessions read-model so the bridge/API (which reads
    // adminSessions.getSession) reflects the logged-in state.
    adminSessions.setSession({
      contactKey: key,
      publicKeyHex: pubkeyFromKey(key),
      mode: result.mode,
      role: result.isAdmin ? 'admin' : 'guest',
      permissionsBits: result.permissions,
      aclPermissionsBits: result.aclPermissions,
      // The renderer can't import meshcore-ts (Node-only), so the role decode
      // has to happen here. `aclPermissions` is the firmware's
      // `client->permissions` byte, whose low 2 bits are a role VALUE — unlike
      // `permissions` above, which is a plain isAdmin boolean.
      aclRole: result.aclPermissions === null ? null : Protocol.decodeAclRole(result.aclPermissions),
      firmwareVerLevel: result.firmwareVerLevel,
      loggedInAt: Date.now(),
    });
    return result;
  }
  async repeaterLogout(key: string) {
    await this.session.repeaterLogout(key);
    adminSessions.clearSession(key);
  }
  repeaterRequestAcl(key: string) {
    return this.session.repeaterRequestAcl(key);
  }
  repeaterRequestNeighbours(key: string, opts: Parameters<MeshCoreSession['repeaterRequestNeighbours']>[1]) {
    return this.session.repeaterRequestNeighbours(key, opts);
  }
  repeaterRequestOwnerInfo(key: string) {
    return this.session.repeaterRequestOwnerInfo(key);
  }
  repeaterSendCli(key: string, command: string, opts?: Parameters<MeshCoreSession['repeaterSendCli']>[2]) {
    return this.session.repeaterSendCli(key, command, opts);
  }
  repeaterTracePath(opts: Parameters<MeshCoreSession['repeaterTracePath']>[0]) {
    return this.session.repeaterTracePath(opts);
  }
  repeaterGetLocalStats(subtype: Parameters<MeshCoreSession['repeaterGetLocalStats']>[0]) {
    return this.session.repeaterGetLocalStats(subtype);
  }
}
