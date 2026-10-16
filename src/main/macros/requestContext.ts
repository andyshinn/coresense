import { channelNameFromKey } from '../../shared/conversationKey';
import type { MacroContext, MacroRenderMode } from '../../shared/macros/types';
import { stateHolder } from '../state/holder';
import { messagesStore } from '../storage/messages';
import { buildReplyContext, buildSendContext } from './contextBuilder';

/** Which conversation (and, for a reply, which message) a render is for. */
export interface MacroRenderTarget {
  mode?: MacroRenderMode;
  messageId?: string;
  contactKey?: string;
  channelKey?: string;
}

/** The macro context for a render request, read from live state. Null when a
 *  reply names a message that no longer exists. contextBuilder stays pure;
 *  this is the half that looks things up. */
export function buildMacroContextForRequest(target: MacroRenderTarget): MacroContext | null {
  const holder = stateHolder();
  const self = {
    owner: holder.getOwner(),
    deviceInfo: holder.getDeviceInfo(),
    deviceIdentity: holder.getDeviceIdentity(),
  };
  const channelName = target.channelKey
    ? (holder.getChannels().find((ch) => ch.key === target.channelKey)?.name ?? channelNameFromKey(target.channelKey))
    : null;

  if (target.mode === 'reply') {
    const message = target.messageId ? messagesStore.findById(target.messageId) : null;
    if (!message) return null;
    const contacts = holder.getContacts();
    const senderContact = message.fromPublicKeyHex
      ? (contacts.find((ct) => ct.publicKeyHex === message.fromPublicKeyHex) ?? null)
      : null;
    const repeaters = contacts.filter((ct) => ct.kind === 'repeater');
    return buildReplyContext({ self, message, senderContact, channelName, repeaters });
  }
  const peerContact = target.contactKey ? (holder.getContacts().find((ct) => ct.key === target.contactKey) ?? null) : null;
  return buildSendContext({ self, peerContact, channelName });
}
