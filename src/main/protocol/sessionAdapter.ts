import { MeshCoreSession, type Ports } from '@andyshinn/meshcore-ts';
import { adminSessions } from '../bridge/adminSession';
import { wireSessionEvents } from './adapterEvents';

const APP_NAME = 'coresense';
const APP_VERSION = 1;

/** Owns a MeshCoreSession and bridges its events into coresense's persistence
 *  + bus, and its command methods to the API layer. Replaces ProtocolSession. */
export class SessionAdapter {
  readonly session: MeshCoreSession;
  private started = false;

  constructor(transport: Ports.Transport) {
    this.session = new MeshCoreSession({ transport, appName: APP_NAME, appVersion: APP_VERSION });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    wireSessionEvents(this.session);
    this.session.start();
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
  setOtherParams(policy: Parameters<MeshCoreSession['setOtherParams']>[0], sharePos: boolean) {
    return this.session.setOtherParams(policy, sharePos);
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
  repeaterSendCli(key: string, command: string) {
    return this.session.repeaterSendCli(key, command);
  }
  repeaterTracePath(opts: Parameters<MeshCoreSession['repeaterTracePath']>[0]) {
    return this.session.repeaterTracePath(opts);
  }
  repeaterGetLocalStats(subtype: Parameters<MeshCoreSession['repeaterGetLocalStats']>[0]) {
    return this.session.repeaterGetLocalStats(subtype);
  }
}
