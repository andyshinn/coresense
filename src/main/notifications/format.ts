import type { Capabilities } from './capabilities';
import { DELIMITER, MAX_BODY, MENTION_SUFFIX } from './config';

// Mirror of the renderer's deriveSenderName (src/renderer/lib/utils.ts): channel
// messages carry no pubkey, so the origin node's display name is encoded as
// fromPublicKeyHex = "name:<name>". Kept as a local copy to avoid a
// renderer→main import; the logic is trivial and stable.
export function channelSenderName(fromPublicKeyHex: string | undefined): string {
  if (!fromPublicKeyHex || fromPublicKeyHex === 'unknown') return '';
  if (fromPublicKeyHex.startsWith('name:')) return fromPublicKeyHex.slice(5);
  return `${fromPublicKeyHex.slice(0, 8)}…`;
}

export function truncateBody(body: string): string {
  return body.length > MAX_BODY ? `${body.slice(0, MAX_BODY - 3)}…` : body;
}

export interface Content {
  title: string;
  subtitle?: string;
  body: string;
}

export interface ContentInput {
  isChannel: boolean;
  displayName: string;
  senderName: string; // '' when none (unknown / self) or for DMs
  mention: boolean;
  body: string;
  caps: Capabilities;
}

export function buildContent(input: ContentInput): Content {
  const body = truncateBody(input.body);
  if (!input.isChannel) {
    // DM: the contact name IS the sender, and it's already the title.
    return { title: input.displayName, body };
  }
  const mentionPart = input.mention ? ` ${MENTION_SUFFIX}` : '';
  if (input.caps.subtitle && input.senderName) {
    return { title: `${input.displayName}${mentionPart}`, subtitle: input.senderName, body };
  }
  const senderPart = input.senderName ? ` ${DELIMITER} ${input.senderName}` : '';
  return { title: `${input.displayName}${senderPart}${mentionPart}`, body };
}

export function formatSummaryBody(count: number, senders: string[]): string {
  if (senders.length === 0) {
    return `${count} new ${count === 1 ? 'message' : 'messages'}`;
  }
  const shown = senders.slice(0, 2);
  const extra = senders.length - shown.length;
  const names = extra > 0 ? `${shown.join(', ')} +${extra}` : shown.join(', ');
  return `${count} ${count === 1 ? 'message' : 'messages'} from ${names}`;
}
