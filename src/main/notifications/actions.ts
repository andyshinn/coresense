import type { Channel, Contact, UiState } from '../../shared/types';

export interface NotificationActions {
  reply(key: string, text: string): Promise<void>;
  markRead(key: string): void;
  mute(key: string): void;
}

export interface ActionDeps {
  sendMessage(key: string, body: string): Promise<unknown>;
  getChannels(): Channel[];
  getContacts(): Contact[];
  upsertChannel(c: Channel): void;
  upsertContact(c: Contact): void;
  emitChannels(): void;
  emitContacts(): void;
  getUiState(): UiState;
  setUiState(u: UiState): void;
  emitUiState(u: UiState): void;
  now(): number;
}

export function createNotificationActions(deps: ActionDeps): NotificationActions {
  return {
    async reply(key, text) {
      await deps.sendMessage(key, text);
    },
    markRead(key) {
      const ui = deps.getUiState();
      const next: UiState = { ...ui, lastReadByKey: { ...ui.lastReadByKey, [key]: deps.now() } };
      deps.setUiState(next);
      deps.emitUiState(next);
    },
    mute(key) {
      if (key.startsWith('ch:')) {
        const ch = deps.getChannels().find((c) => c.key === key);
        if (!ch) return;
        deps.upsertChannel({ ...ch, muted: true });
        deps.emitChannels();
        return;
      }
      const contact = deps.getContacts().find((c) => c.key === key);
      if (!contact) return;
      deps.upsertContact({ ...contact, muted: true });
      deps.emitContacts();
    },
  };
}
