import type { Capabilities } from './capabilities';
import { DELIMITER, MAX_BODY, MENTION_SUFFIX } from './config';

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
