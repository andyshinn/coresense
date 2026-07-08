import { type BlockMatchHints, isMessageBlocked } from '../../shared/blocking/match';
import {
  type AppSettings,
  type AutoAddConfig,
  type BlockRule,
  type Channel,
  type ChannelStats,
  type Contact,
  DEFAULT_DEVICE_CAPABILITIES,
  type DeviceCapabilities,
  type DeviceIdentity,
  type DeviceInfo,
  type GpsConfig,
  type MapSettings,
  type MapTileStatus,
  type Message,
  type MessageMeta,
  type MessagePath,
  type Owner,
  type RadioSettings,
  type TelemetryPolicy,
  type UiState,
} from '../../shared/types';
import { blockingStore } from '../blocking/store';
import { emit } from '../events/bus';
import { hasApiKey } from '../map/api-key';
import { messagesStore } from '../storage/messages';
import { rebuildConversationsIndex, type SearchBlockContext } from '../storage/search';
import { settingsStore } from '../storage/settings';

// Persistent state holder. Settings/channels/contacts/ui live in JSON files;
// messages live in node:sqlite. The holder caches in memory and writes through
// on mutation so the renderer doesn't pay an I/O round-trip per push.
class StateHolder {
  private channels: Channel[] = [];
  private contacts: Contact[] = [];
  private owner: Owner | null = null;
  private appSettings: AppSettings;
  private radioSettings: RadioSettings;
  private mapSettings: MapSettings;
  private mapTileStatus: MapTileStatus;
  private uiState: UiState;
  private deviceIdentity: DeviceIdentity;
  private autoAddConfig: AutoAddConfig;
  private telemetryPolicy: TelemetryPolicy;
  private gpsConfig: GpsConfig;
  private deviceInfo: DeviceInfo;
  // Capabilities are derived from the live connection (firmware ver_code) so
  // we don't persist them — the renderer resets to DEFAULT when the device
  // disconnects.
  private deviceCapabilities: DeviceCapabilities = { ...DEFAULT_DEVICE_CAPABILITIES };

  constructor() {
    // Drop the deprecated first-run "ch:public" seed if an earlier version
    // persisted it. The radio enumerates its own Public channel under the key
    // `ch:Public` (derived from the channel name); keeping the lowercase seed
    // alongside it produced a duplicate "Public" row. Channels now come
    // exclusively from the radio — see handleChannelInfo.
    const loadedChannels = settingsStore.loadChannels();
    this.channels = loadedChannels.filter((c) => c.key !== 'ch:public');
    this.contacts = settingsStore.loadContacts();
    this.appSettings = settingsStore.loadAppSettings();
    this.radioSettings = settingsStore.loadRadioSettings();
    // hasProtomapsApiKey is server-owned — recompute from the encrypted blob's
    // presence so flipping the file on/off out of band stays consistent.
    this.mapSettings = {
      ...settingsStore.loadMapSettings(),
      hasProtomapsApiKey: hasApiKey(),
    };
    // Runtime-only status (never persisted). keyConfigured mirrors the blob.
    this.mapTileStatus = { keyConfigured: hasApiKey(), keyRejected: false };
    this.uiState = settingsStore.loadUiState();
    this.deviceIdentity = settingsStore.loadDeviceIdentity();
    this.autoAddConfig = settingsStore.loadAutoAddConfig();
    this.telemetryPolicy = settingsStore.loadTelemetryPolicy();
    this.gpsConfig = settingsStore.loadGpsConfig();
    this.deviceInfo = settingsStore.loadDeviceInfo();

    // Persist the seed removal once so it doesn't re-run every launch, then
    // (re)seed the FTS index since the DB was just (re)opened.
    if (this.channels.length !== loadedChannels.length) {
      settingsStore.saveChannels(this.channels);
    }
    this.refreshConversationsIndex();
  }

  private refreshConversationsIndex(): void {
    rebuildConversationsIndex({ channels: this.channels, contacts: this.contacts });
  }

  getChannels(): Channel[] {
    return this.channels;
  }
  setChannels(next: Channel[]): void {
    this.channels = next;
    settingsStore.saveChannels(next);
    this.refreshConversationsIndex();
  }
  upsertChannel(channel: Channel): void {
    const idx = this.channels.findIndex((c) => c.key === channel.key);
    const next = idx === -1 ? [...this.channels, channel] : this.channels.map((c, i) => (i === idx ? channel : c));
    this.setChannels(next);
  }
  removeChannel(key: string): void {
    this.setChannels(this.channels.filter((c) => c.key !== key));
  }

  getContacts(): Contact[] {
    return this.contacts;
  }
  setContacts(next: Contact[]): void {
    this.contacts = next;
    settingsStore.saveContacts(next);
    this.refreshConversationsIndex();
  }
  upsertContact(contact: Contact): void {
    const idx = this.contacts.findIndex((c) => c.key === contact.key);
    const next = idx === -1 ? [...this.contacts, contact] : this.contacts.map((c, i) => (i === idx ? contact : c));
    this.setContacts(next);
  }
  removeContact(key: string): void {
    this.setContacts(this.contacts.filter((c) => c.key !== key));
  }

  getOwner(): Owner | null {
    return this.owner;
  }
  setOwner(next: Owner | null): void {
    this.owner = next;
  }

  getAppSettings(): AppSettings {
    return this.appSettings;
  }
  setAppSettings(next: AppSettings): void {
    this.appSettings = next;
    settingsStore.saveAppSettings(next);
  }

  getRadioSettings(): RadioSettings {
    return this.radioSettings;
  }
  setRadioSettings(next: RadioSettings): void {
    this.radioSettings = next;
    settingsStore.saveRadioSettings(next);
  }

  getMapSettings(): MapSettings {
    return this.mapSettings;
  }
  setMapSettings(next: MapSettings): void {
    this.mapSettings = next;
    settingsStore.saveMapSettings(next);
  }

  getMapTileStatus(): MapTileStatus {
    return this.mapTileStatus;
  }

  setMapTileStatus(next: MapTileStatus): void {
    this.mapTileStatus = next; // in-memory only — not saved to disk
  }

  getUiState(): UiState {
    return this.uiState;
  }
  setUiState(next: UiState): void {
    this.uiState = next;
    settingsStore.saveUiState(next);
  }

  getDeviceIdentity(): DeviceIdentity {
    return this.deviceIdentity;
  }
  setDeviceIdentity(next: DeviceIdentity): void {
    this.deviceIdentity = next;
    settingsStore.saveDeviceIdentity(next);
  }

  getAutoAddConfig(): AutoAddConfig {
    return this.autoAddConfig;
  }
  setAutoAddConfig(next: AutoAddConfig): void {
    this.autoAddConfig = next;
    settingsStore.saveAutoAddConfig(next);
  }

  getTelemetryPolicy(): TelemetryPolicy {
    return this.telemetryPolicy;
  }
  setTelemetryPolicy(next: TelemetryPolicy): void {
    this.telemetryPolicy = next;
    settingsStore.saveTelemetryPolicy(next);
  }

  getGpsConfig(): GpsConfig {
    return this.gpsConfig;
  }
  setGpsConfig(next: GpsConfig): void {
    this.gpsConfig = next;
    settingsStore.saveGpsConfig(next);
  }

  getDeviceInfo(): DeviceInfo {
    return this.deviceInfo;
  }
  setDeviceInfo(next: DeviceInfo): void {
    this.deviceInfo = next;
    settingsStore.saveDeviceInfo(next);
  }

  getDeviceCapabilities(): DeviceCapabilities {
    return this.deviceCapabilities;
  }
  setDeviceCapabilities(next: DeviceCapabilities): void {
    this.deviceCapabilities = next;
  }

  getRecentMessages(limit = 500): Message[] {
    return this.annotateBlocked(messagesStore.recent(limit));
  }
  getMessagesForKey(key: string, opts?: { limit?: number; before?: number }): Message[] {
    return this.annotateBlocked(messagesStore.byKey(key, opts));
  }
  getChannelStats(key: string): ChannelStats {
    return messagesStore.statsByKey(key);
  }
  private annotateBlocked(rows: Message[]): Message[] {
    const rules = blockingStore().list();
    if (rules.length === 0) return rows;
    const regexCache = blockingStore().regexCacheRef();
    return rows.map((m) => {
      const { blocked, ruleId } = isMessageBlocked(m, this.buildBlockHints(m), rules, regexCache);
      if (!blocked) return m;
      const meta: MessageMeta = { ...(m.meta ?? {}), blocked: true, blockedByRuleId: ruleId };
      return { ...m, meta };
    });
  }
  /** Build the BlockMatchHints for a single message based on current
   *  contacts + origin hop. Used by both annotateBlocked (read path) and
   *  upsertMessage (write path). */
  private buildBlockHints(msg: Message): BlockMatchHints {
    const originHop = msg.meta?.paths?.[0]?.hops.find((h) => h.kind === 'origin');
    return {
      contactNameByPk: (pk) => this.contacts.find((c) => c.publicKeyHex === pk)?.name,
      originHopPk: originHop?.pk?.toLowerCase(),
    };
  }
  insertMessage(message: Message): void {
    messagesStore.insert(message);
  }
  /** Insert a new Message, or merge into the existing row when the id collides
   *  (channel-msg ids are deterministic by ts + body so multi-path receipts
   *  hit the same row). Merge rules:
   *    - paths are unioned by MessagePath.id (keep all distinct routes)
   *    - timesHeard increments by 1
   *    - ts keeps the earliest receipt
   *    - state only moves forward (received → ack), never backward */
  upsertMessage(message: Message): void {
    // First-match: only count when this id is new. Backfill (re-evaluation on
    // rule creation) is handled by a separate pass; per-render reads never
    // bump the counter.
    const isNew = !messagesStore.findById(message.id);
    if (isNew) {
      const rules = blockingStore().list();
      if (rules.length > 0) {
        const { blocked, ruleId } = isMessageBlocked(
          message,
          this.buildBlockHints(message),
          rules,
          blockingStore().regexCacheRef(),
        );
        if (blocked && ruleId) blockingStore().bumpMatchCount(ruleId);
      }
    }
    const existing = messagesStore.findById(message.id);
    if (!existing) {
      const meta = message.meta ? { ...message.meta } : undefined;
      if (meta?.paths && meta.paths.length > 0 && meta.timesHeard == null) {
        meta.timesHeard = 1;
      }
      messagesStore.insert({ ...message, meta });
      return;
    }
    const existingPaths = existing.meta?.paths ?? [];
    const incomingPaths = message.meta?.paths ?? [];
    const byId = new Map<string, (typeof existingPaths)[number]>();
    for (const p of existingPaths) byId.set(p.id, p);
    for (const p of incomingPaths) if (!byId.has(p.id)) byId.set(p.id, p);
    const mergedPaths = [...byId.values()];

    const stateRank: Record<Message['state'], number> = {
      sending: 0,
      sent: 1,
      received: 1,
      heard: 2,
      ack: 3,
      failed: 0,
    };
    const nextState = stateRank[message.state] > stateRank[existing.state] ? message.state : existing.state;

    const merged: Message = {
      ...existing,
      ts: Math.min(existing.ts, message.ts),
      state: nextState,
      meta: {
        ...existing.meta,
        ...message.meta,
        paths: mergedPaths.length > 0 ? mergedPaths : undefined,
        timesHeard: (existing.meta?.timesHeard ?? 1) + 1,
      },
    };
    messagesStore.insert(merged);
  }
  /** Persist a message the library already merged (idempotent by id). Bumps a
   *  block-rule match counter on genuinely-new ids, but does NOT re-run the
   *  path/timesHeard merge that upsertMessage does (the lib owns that). */
  recordLibMessage(message: Message): void {
    const isNew = !messagesStore.findById(message.id);
    if (isNew) {
      const rules = blockingStore().list();
      if (rules.length > 0) {
        const { blocked, ruleId } = isMessageBlocked(
          message,
          this.buildBlockHints(message),
          rules,
          blockingStore().regexCacheRef(),
        );
        if (blocked && ruleId) blockingStore().bumpMatchCount(ruleId);
      }
    }
    messagesStore.insert(message);
  }
  setMessageState(id: string, state: Message['state']): void {
    messagesStore.markState(id, state);
  }
  /** Append a newly-heard relay path to an outgoing channel message. Dedupes
   *  by MessagePath.id, bumps timesHeard, and (when the message is still in
   *  the 'sent' state) advances it to 'heard'. Returns the message's
   *  post-update state, or null if the id is unknown. */
  appendMessagePath(id: string, path: MessagePath): Message['state'] | null {
    const existing = messagesStore.findById(id);
    if (!existing) return null;
    const existingPaths = existing.meta?.paths ?? [];
    if (existingPaths.some((p) => p.id === path.id)) {
      return existing.state;
    }
    const nextState: Message['state'] = existing.state === 'sent' ? 'heard' : existing.state;
    const merged: Message = {
      ...existing,
      state: nextState,
      meta: {
        ...existing.meta,
        paths: [...existingPaths, path],
        timesHeard: (existing.meta?.timesHeard ?? 0) + 1,
      },
    };
    messagesStore.insert(merged);
    return nextState;
  }

  // ----- Block rules -----

  getBlockRules(): BlockRule[] {
    return blockingStore().list();
  }
  /** Snapshot of the inputs needed to evaluate block rules against messages
   *  right now (current contacts + active rules + compiled regex cache). Handed
   *  to searchMessages so the search module stays a pure query layer instead of
   *  reaching into the state/blocking singletons itself. */
  getSearchBlockContext(): SearchBlockContext {
    return {
      contacts: this.contacts,
      blockRules: blockingStore().list(),
      regexCache: blockingStore().regexCacheRef(),
    };
  }
  addBlockRules(partials: Array<Omit<BlockRule, 'id' | 'createdAt' | 'matchCount'>>): BlockRule[] {
    const inserted = blockingStore().addMany(partials);
    // Backfill: scan messages from min(tsFrom) across inserted rules; bump
    // counters for any that match. One pass — we don't double-count if multiple
    // new rules match the same message because isMessageBlocked short-circuits
    // on the first hit (createdAt asc).
    if (inserted.length > 0) {
      const minTsFrom = Math.min(...inserted.map((r) => r.tsFrom));
      const recent = messagesStore.sinceTs(minTsFrom);
      const rules = blockingStore().list();
      const cache = blockingStore().regexCacheRef();
      const insertedIds = new Set(inserted.map((r) => r.id));
      for (const m of recent) {
        const { blocked, ruleId } = isMessageBlocked(m, this.buildBlockHints(m), rules, cache);
        // Only credit the new rules — pre-existing rules already counted these
        // messages when they arrived.
        if (blocked && ruleId && insertedIds.has(ruleId)) {
          blockingStore().bumpMatchCount(ruleId);
        }
      }
      emit.blockRules(this.getBlockRules());
    }
    return inserted;
  }
  updateBlockRule(id: string, patch: Partial<Omit<BlockRule, 'id' | 'createdAt'>>): BlockRule | null {
    const updated = blockingStore().update(id, patch);
    if (updated) emit.blockRules(this.getBlockRules());
    return updated;
  }
  removeBlockRule(id: string): boolean {
    const ok = blockingStore().remove(id);
    if (ok) emit.blockRules(this.getBlockRules());
    return ok;
  }
  flushBlockCounters(): void {
    blockingStore().flushNow();
  }
}

// Constructed lazily so we don't touch electron.app.getPath() until ready.
let _instance: StateHolder | null = null;
export function stateHolder(): StateHolder {
  if (!_instance) _instance = new StateHolder();
  return _instance;
}
