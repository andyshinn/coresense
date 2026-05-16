import type {
  AppSettings,
  Channel,
  Contact,
  Message,
  Owner,
  RadioSettings,
  UiState,
} from '../../shared/types';
import { messagesStore } from '../storage/messages';
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
  private uiState: UiState;

  constructor() {
    this.channels = settingsStore.loadChannels();
    this.contacts = settingsStore.loadContacts();
    this.appSettings = settingsStore.loadAppSettings();
    this.radioSettings = settingsStore.loadRadioSettings();
    this.uiState = settingsStore.loadUiState();

    // Seed the well-known Public channel on first run so the UI has something
    // to address out of the box. Phase 6b will replace the seed once the
    // protocol layer learns to import shared keys from QR / share links.
    if (this.channels.length === 0) {
      this.setChannels([
        {
          key: 'ch:public',
          name: 'Public',
          kind: 'public',
          order: 0,
        },
      ]);
    }
  }

  getChannels(): Channel[] {
    return this.channels;
  }
  setChannels(next: Channel[]): void {
    this.channels = next;
    settingsStore.saveChannels(next);
  }
  upsertChannel(channel: Channel): void {
    const idx = this.channels.findIndex((c) => c.key === channel.key);
    const next =
      idx === -1
        ? [...this.channels, channel]
        : this.channels.map((c, i) => (i === idx ? channel : c));
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
  }
  upsertContact(contact: Contact): void {
    const idx = this.contacts.findIndex((c) => c.key === contact.key);
    const next =
      idx === -1
        ? [...this.contacts, contact]
        : this.contacts.map((c, i) => (i === idx ? contact : c));
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

  getUiState(): UiState {
    return this.uiState;
  }
  setUiState(next: UiState): void {
    this.uiState = next;
    settingsStore.saveUiState(next);
  }

  getRecentMessages(limit = 500): Message[] {
    return messagesStore.recent(limit);
  }
  getMessagesForKey(key: string, opts?: { limit?: number; before?: number }): Message[] {
    return messagesStore.byKey(key, opts);
  }
  insertMessage(message: Message): void {
    messagesStore.insert(message);
  }
  setMessageState(id: string, state: Message['state']): void {
    messagesStore.markState(id, state);
  }
}

// Constructed lazily so we don't touch electron.app.getPath() until ready.
let _instance: StateHolder | null = null;
export function stateHolder(): StateHolder {
  if (!_instance) _instance = new StateHolder();
  return _instance;
}
