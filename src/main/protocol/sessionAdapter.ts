import { MeshCoreSession, Models, type Ports, Protocol } from '@andyshinn/meshcore-ts';
import { adminSessions } from '../bridge/adminSession';
import { child } from '../log';
import { stateHolder } from '../state/holder';
import { wireSessionEvents } from './adapterEvents';

const APP_NAME = 'coresense';
const APP_VERSION = 1;

/** Owns a MeshCoreSession and bridges its events into coresense's persistence
 *  + bus, and its command methods to the API layer. Replaces ProtocolSession. */
export class SessionAdapter {
  readonly session: MeshCoreSession;
  private started = false;

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
    wireSessionEvents(this.session);
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
   *  the ones the radio did report. It also gives the library's `shouldAutoAdd`
   *  (which gates its post-advert GET_CONTACTS re-sync on `mode`) the real
   *  mode instead of a permanent 'all'. */
  private seedAutoAddConfig(): void {
    const cfg = stateHolder().getAutoAddConfig();
    this.session.state.setAutoAddConfig({
      ...Models.DEFAULT_AUTO_ADD_CONFIG,
      mode: cfg.mode,
      chat: cfg.chat,
      repeater: cfg.repeater,
      room: cfg.room,
      sensor: cfg.sensor,
      overwriteOldest: cfg.overwriteOldest,
      radioMaxHops: cfg.radioMaxHops,
      manualAddContacts: cfg.manualAddContacts,
    });
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
  mirrorAutoAddConfig(flags: {
    mode: Models.AutoAddConfig['mode'];
    chat: boolean;
    repeater: boolean;
    room: boolean;
    sensor: boolean;
    overwriteOldest: boolean;
    radioMaxHops: number;
  }): void {
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
  sendTelemetryReq(key: string) {
    return this.session.sendTelemetryReq(key);
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
  requestDeviceInfo() {
    return this.session.requestDeviceInfo();
  }
  requestBattAndStorage() {
    return this.session.requestBattAndStorage();
  }
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
      publicKeyHex: key.startsWith('c:') ? key.slice(2) : key,
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
