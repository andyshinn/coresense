import type { BlockRule, Message } from '../types';

/** Resolved sender info that the bare Message struct doesn't carry. The caller
 *  is responsible for resolving these from the live state holder (contacts,
 *  paths). All fields are optional — missing info just means the relevant
 *  rule type can't match. */
export interface BlockMatchHints {
  /** For channel messages: the sender's display name parsed from the
   *  "name: body" prefix. Undefined when the body has no name prefix. */
  senderNameFromBody?: string;
  /** Resolver for DM-style messages: pubkey -> display name. */
  contactNameByPk?: (pk: string) => string | undefined;
  /** Channel-message origin hop short id (lowercase hex). */
  originHopShortId?: string;
  /** Channel-message origin hop resolved full pubkey (lowercase hex), when
   *  an advert was matched. Undefined otherwise. */
  originHopPk?: string;
}

/** Channel message bodies look like `"Alice: hello"`. Returns the name half,
 *  or undefined when the body has no `name:` prefix. The split is on the
 *  first occurrence of ": " (colon + space). */
export function extractSenderNameFromBody(body: string): string | undefined {
  const i = body.indexOf(': ');
  if (i <= 0) return undefined;
  return body.slice(0, i);
}

/** True iff the message is from us (no sender pubkey). Self-sent messages
 *  must never match a block rule. */
function isSelfSent(msg: Message): boolean {
  return msg.fromPublicKeyHex == null;
}

/** Returns true if the message is a channel message. Channel keys begin with
 *  `ch:`; DM/contact keys begin with `c:`. */
function isChannelMessage(msg: Message): boolean {
  return msg.key.startsWith('ch:');
}

/** Per-rule predicate. Pure — no holder access, no I/O, no logging. */
function ruleMatches(
  msg: Message,
  hints: BlockMatchHints,
  rule: BlockRule,
  regex: RegExp | undefined,
): boolean {
  if (!rule.enabled) return false;
  if (msg.ts < rule.tsFrom) return false;

  switch (rule.type) {
    case 'pubkey': {
      if (isChannelMessage(msg)) {
        return hints.originHopPk != null && hints.originHopPk === rule.pattern;
      }
      return msg.fromPublicKeyHex != null && msg.fromPublicKeyHex === rule.pattern;
    }
    case 'pubkeyPrefix': {
      if (isChannelMessage(msg)) {
        return hints.originHopShortId?.startsWith(rule.pattern) ?? false;
      }
      return msg.fromPublicKeyHex?.startsWith(rule.pattern) ?? false;
    }
    case 'name': {
      const name = isChannelMessage(msg)
        ? hints.senderNameFromBody
        : msg.fromPublicKeyHex != null
          ? hints.contactNameByPk?.(msg.fromPublicKeyHex)
          : undefined;
      return name != null && name === rule.pattern;
    }
    case 'nameRegex': {
      if (regex == null) return false;
      const name = isChannelMessage(msg)
        ? hints.senderNameFromBody
        : msg.fromPublicKeyHex != null
          ? hints.contactNameByPk?.(msg.fromPublicKeyHex)
          : undefined;
      return regex.test(name ?? '');
    }
  }
}

export interface BlockMatchResult {
  blocked: boolean;
  ruleId?: string;
}

/** Walks `rules` in iteration order (callers pass them sorted by `createdAt
 *  asc`) and returns the first hit. Self-sent messages never match. */
export function isMessageBlocked(
  msg: Message,
  hints: BlockMatchHints,
  rules: BlockRule[],
  regexCache: Map<string, RegExp>,
): BlockMatchResult {
  if (isSelfSent(msg)) return { blocked: false };
  for (const rule of rules) {
    const regex = rule.type === 'nameRegex' ? regexCache.get(rule.id) : undefined;
    if (ruleMatches(msg, hints, rule, regex)) {
      return { blocked: true, ruleId: rule.id };
    }
  }
  return { blocked: false };
}

/** Compile a regex source into a case-insensitive RegExp. Returns null on
 *  invalid source so callers can mark the rule invalid without throwing. */
export function compileRuleRegex(source: string): RegExp | null {
  try {
    return new RegExp(source, 'i');
  } catch {
    return null;
  }
}
