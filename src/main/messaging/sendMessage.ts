import { isChannelKey } from '../../shared/conversationKey';
import { errorMessage } from '../../shared/errors';
import type { Message, MessageState } from '../../shared/types';
import { emit } from '../events/bus';
import { child } from '../log';
import { protocolSession, type SessionAdapter } from '../protocol';
import { type StateHolder, stateHolder } from '../state/holder';

const log = child('messaging');

export interface SendResult {
  ok: boolean;
  id: string;
  error?: string;
}

export interface SenderDeps {
  getSession(): Pick<SessionAdapter, 'sendChannelText' | 'sendDmTextWithRetry' | 'registerChannelSend'>;
  getHolder(): Pick<StateHolder, 'insertMessage' | 'setMessageState' | 'getMessagesForKey'>;
  emitMessages(key: string, messages: Message[]): void;
  emitMessageState(id: string, state: MessageState): void;
  now(): number;
  genId(): string;
  /** Optional sink for background DM send failures. */
  logError?(message: string): void;
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

    if (isChannelKey(key)) {
      const result = await session.sendChannelText(key, body);
      const nextState = result.ok ? 'sent' : 'failed';
      holder.setMessageState(id, nextState);
      deps.emitMessageState(id, nextState);
      if (result.ok && result.channelHash != null) {
        // timestampUnix is the timestamp encrypted into the outgoing packet.
        // Without it the lib can only guess which pending send a heard relay
        // belongs to (arrival order), which put ✓×N chips on the wrong message
        // when two sends were in flight — see meshcore-ts 0.6.0.
        session.registerChannelSend({
          messageId: id,
          channelHash: result.channelHash,
          timestampUnix: result.timestampUnix,
        });
      }
      return { ok: result.ok, id, error: result.error };
    }

    // DM: return after the first write; the retry loop runs in the background.
    // The lib can also RESOLVE {ok:false} without emitting messageState (unknown
    // contact, no full 32B public key), so a resolved failure fails the row the
    // same way a rejection does — otherwise it sits in 'sending' forever.
    const markFailed = (error: string): void => {
      holder.setMessageState(id, 'failed');
      deps.emitMessageState(id, 'failed');
      deps.logError?.(`sendDmTextWithRetry id=${id}: ${error}`);
    };
    session.sendDmTextWithRetry(key, body, id).then(
      (result) => {
        if (!result.ok) markFailed(result.error ?? 'send failed');
      },
      (err) => markFailed(errorMessage(err)),
    );
    return { ok: true, id };
  };
}

export const sendMessage = createSender({
  getSession: () => protocolSession(),
  getHolder: () => stateHolder(),
  emitMessages: (key, messages) => emit.messages(key, messages),
  emitMessageState: (id, state) => emit.messageState(id, state),
  now: () => Date.now(),
  genId: () => `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  logError: (message) => log.warn(message),
});
