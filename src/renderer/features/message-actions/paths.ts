import type { Message, MessagePath } from '../../../shared/types';

/** One path as a comma-separated chain of hop prefix ids (origin→sink order). */
export function formatPathHeard(path: MessagePath): string {
  return path.hops.map((h) => h.shortId).join(',');
}

/** The first observed path, or null when the message has no path data. */
export function formatFirstPathHeard(message: Message): string | null {
  const first = message.meta?.paths?.[0];
  return first ? formatPathHeard(first) : null;
}

/** All observed paths, one comma-separated chain per line, or null when none. */
export function formatAllPathsHeard(message: Message): string | null {
  const paths = message.meta?.paths;
  if (!paths || paths.length === 0) return null;
  return paths.map(formatPathHeard).join('\n');
}
