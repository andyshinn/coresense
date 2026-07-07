import { emit } from '../events/bus';
import { protocolSession } from '../protocol';
import { stateHolder } from '../state/holder';

export interface SendResult {
  ok: boolean;
  id: string;
  error?: string;
}

interface Session {
  sendChannelText(key: string, text: string): Promise<{ ok: boolean; error?: string; channelHash?: number }>;
  sendDmTextWithRetry(key: string, text: string, id: string): Promise<{ ok: boolean; error?: string }>;
  registerChannelSend(p: { messageId: string; channelHash: number }): void;
}

interface Holder {
  insertMessage(m: { id: string; key: string; body: string; ts: number; state: 'sending' }): void;
  setMessageState(id: string, state: 'sent' | 'failed'): void;
  getMessagesForKey(key: string): unknown[];
}

export interface SenderDeps {
  getSession(): Session;
  getHolder(): Holder;
  emitMessages(key: string, messages: unknown[]): void;
  emitMessageState(id: string, state: 'sent' | 'failed'): void;
  now(): number;
  genId(): string;
}

// Optimistically records the outgoing message, hands it to the protocol session
// for TX, and drives the state transitions. Extracted from POST /api/messages so
// the notification inline-reply handler reuses the exact same path.
export function createSender(deps: SenderDeps): (key: string, body: string) => Promise<SendResult> {
  return async (key, body) => {
    const holder = deps.getHolder();
    const session = deps.getSession();
    const id = deps.genId();
    holder.insertMessage({ id, key, body, ts: deps.now(), state: 'sending' });
    deps.emitMessages(key, holder.getMessagesForKey(key));

    if (key.startsWith('ch:')) {
      const result = await session.sendChannelText(key, body);
      const nextState = result.ok ? 'sent' : 'failed';
      holder.setMessageState(id, nextState);
      deps.emitMessageState(id, nextState);
      if (result.ok && result.channelHash != null) {
        session.registerChannelSend({ messageId: id, channelHash: result.channelHash });
      }
      return { ok: result.ok, id, error: result.error };
    }

    // DM: return after the first write; the retry loop runs in the background.
    session.sendDmTextWithRetry(key, body, id).catch(() => {
      holder.setMessageState(id, 'failed');
      deps.emitMessageState(id, 'failed');
    });
    return { ok: true, id };
  };
}

export const sendMessage = createSender({
  getSession: () => protocolSession(),
  getHolder: () => stateHolder(),
  emitMessages: (key, messages) => emit.messages(key, messages as never),
  emitMessageState: (id, state) => emit.messageState(id, state),
  now: () => Date.now(),
  genId: () => `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
});
