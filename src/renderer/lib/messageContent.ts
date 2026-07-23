// Tokenises a chat message body into renderable spans: plain text, @mentions,
// web links, and custom-scheme URIs (e.g. meshcore://). Rendering lives in
// MessageRow's MessageBody — this module only decides *where* the boundaries
// are.
//
// Adding support for a new URI scheme is two steps:
//   1. list its scheme in KNOWN_URI_SCHEMES below;
//   2. give MessageBody a renderer for `token.scheme` (with a decoder in lib/).

export type ContentToken =
  | { type: 'text'; value: string }
  | { type: 'mention'; name: string }
  /** An http(s) URL — rendered as a link that opens in the system browser. */
  | { type: 'link'; href: string }
  /** A non-http URI with a scheme listed in KNOWN_URI_SCHEMES. */
  | { type: 'uri'; scheme: string; raw: string };

/**
 * Non-http URI schemes the message renderer knows how to expand inline.
 * Extend this list (and MessageBody's switch) to support more schemes.
 */
export const KNOWN_URI_SCHEMES = ['meshcore'] as const;

const MENTION = String.raw`@\[[^\]]+\]`;
const WEB_LINK = String.raw`https?:\/\/[^\s<>]+`;
const CUSTOM_URI = `(?:${KNOWN_URI_SCHEMES.join('|')}):\\/\\/[^\\s<>]+`;

// One pass, three alternatives. Capture groups: 1 mention, 2 web link, 3 URI.
const TOKEN_RE = new RegExp(`(${MENTION})|(${WEB_LINK})|(${CUSTOM_URI})`, 'gi');

const TRAILING_PUNCTUATION = `.,;:!?'"`;

/**
 * Trailing punctuation almost always belongs to the surrounding sentence, not
 * the URL — "see https://x.com." must not capture the period. A closing
 * bracket is trimmed only when the URL has no matching opener (so wiki-style
 * links like `https://x.com/Foo_(bar)` survive intact).
 */
function trimUrlTail(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1];
    if (TRAILING_PUNCTUATION.includes(ch)) {
      end -= 1;
      continue;
    }
    if (ch === ')' && !url.slice(0, end).includes('(')) {
      end -= 1;
      continue;
    }
    if (ch === ']' && !url.slice(0, end).includes('[')) {
      end -= 1;
      continue;
    }
    break;
  }
  return url.slice(0, end);
}

/** Splits a message body into an ordered list of renderable tokens. */
export function parseMessageContent(body: string): ContentToken[] {
  const tokens: ContentToken[] = [];
  let cursor = 0;

  for (const m of body.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    let consumed: string;
    let token: ContentToken;

    if (m[1] != null) {
      consumed = m[1];
      token = { type: 'mention', name: m[1].slice(2, -1) };
    } else if (m[2] != null) {
      consumed = trimUrlTail(m[2]);
      token = { type: 'link', href: consumed };
    } else {
      consumed = trimUrlTail(m[3]);
      token = {
        type: 'uri',
        scheme: consumed.slice(0, consumed.indexOf(':')).toLowerCase(),
        raw: consumed,
      };
    }

    // Emit any plain text since the previous token. Punctuation trimmed off a
    // URL falls between `cursor` and the next match, so it lands here as text.
    if (start > cursor) tokens.push({ type: 'text', value: body.slice(cursor, start) });
    tokens.push(token);
    cursor = start + consumed.length;
  }

  if (cursor < body.length) tokens.push({ type: 'text', value: body.slice(cursor) });
  return tokens;
}

/**
 * Ordered, de-duplicated names of every well-formed `@[Name]` mention in a
 * body. Only complete `@[…]` tokens are recognized, so a partially-typed or
 * broken mention (e.g. `@[TLF` with no closing bracket) is simply absent.
 */
export function mentionedNames(body: string): string[] {
  const seen = new Set<string>();
  for (const token of parseMessageContent(body)) {
    if (token.type === 'mention') seen.add(token.name);
  }
  return [...seen];
}
