import { type ContentToken, parseMessageContent } from '../lib/messageContent';
import { MentionPill } from './MentionPill';
import { MeshcoreLink } from './MeshcoreLink';

/**
 * Renders a chat message body with inline @mentions, web links, and custom-URI
 * links expanded. Shared by the channel conversation view (MessageRow) and the
 * Unreads triage previews so message content renders identically in both. The
 * caller owns the surrounding text sizing / wrapping styles.
 */
export function MessageBody({ body }: { body: string }) {
  const tokens = parseMessageContent(body);
  if (tokens.length === 1 && tokens[0].type === 'text') return <>{body}</>;
  return (
    <>
      {tokens.map((token, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional within an immutable body
        <ContentSpan key={i} token={token} />
      ))}
    </>
  );
}

function ContentSpan({ token }: { token: ContentToken }) {
  switch (token.type) {
    case 'text':
      return <span>{token.value}</span>;
    case 'mention':
      return <MentionPill name={token.name} />;
    case 'link':
      return <MessageLink href={token.href} />;
    case 'uri':
      // Only schemes in KNOWN_URI_SCHEMES reach here — give each one a
      // renderer; add a branch when registering a new scheme.
      if (token.scheme === 'meshcore') return <MeshcoreLink raw={token.raw} />;
      return <span>{token.raw}</span>;
  }
}

function MessageLink({ href }: { href: string }) {
  // target=_blank routes the click through the main process's
  // setWindowOpenHandler, which opens http(s) URLs in the system browser.
  // stopPropagation keeps the click from also selecting the message row.
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      className="break-all text-cs-accent underline underline-offset-2 hover:opacity-80"
    >
      {href}
    </a>
  );
}
