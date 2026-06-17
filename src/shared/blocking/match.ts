import type { BlockRule, Message } from '../types';

/** Resolved sender info that the bare Message struct doesn't carry. The caller
 *  is responsible for resolving these from the live state holder (contacts,
 *  paths). All fields are optional — missing info just means the relevant
 *  rule type can't match. */
export interface BlockMatchHints {
  /** Resolver for DM-style messages: pubkey -> display name. */
  contactNameByPk?: (pk: string) => string | undefined;
  /** Channel-message origin hop resolved full pubkey (lowercase hex), when
   *  an advert was matched. Undefined otherwise. */
  originHopPk?: string;
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

/** Sender display name for matching purposes.
 *  - Channel messages: parsed from the `name:` sentinel in fromPublicKeyHex
 *    (the protocol decoder strips the "name: " prefix from the body and
 *    encodes the sender into fromPublicKeyHex; see the channel-message
 *    decode path in @andyshinn/meshcore-ts, bridged via protocol/adapterEvents.ts).
 *  - DMs: resolved through the caller-provided contactNameByPk lookup. */
function senderNameOf(msg: Message, hints: BlockMatchHints): string | undefined {
  if (isChannelMessage(msg)) {
    const pk = msg.fromPublicKeyHex;
    if (pk?.startsWith('name:')) return pk.slice(5);
    return undefined;
  }
  return msg.fromPublicKeyHex != null ? hints.contactNameByPk?.(msg.fromPublicKeyHex) : undefined;
}

/** Per-rule predicate. Pure — no holder access, no I/O, no logging. */
function ruleMatches(msg: Message, hints: BlockMatchHints, rule: BlockRule, regex: RegExp | undefined): boolean {
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
        // originHopPk is the only meaningful source of a real pubkey prefix
        // for channel messages. The path's shortId is a name-derived display
        // label, not a hex prefix, so it would silently match by name
        // lookalike if used here — wrong semantic for this rule type.
        return hints.originHopPk?.startsWith(rule.pattern) ?? false;
      }
      return msg.fromPublicKeyHex?.startsWith(rule.pattern) ?? false;
    }
    case 'name': {
      const name = senderNameOf(msg, hints);
      return name != null && name === rule.pattern;
    }
    case 'nameRegex': {
      if (regex == null) return false;
      const name = senderNameOf(msg, hints);
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
