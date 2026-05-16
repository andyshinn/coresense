export type MentionPart = { type: 'text'; value: string } | { type: 'mention'; name: string };

const MENTION_RE = /@\[([^\]]+)\]/g;

export function parseMentions(body: string): MentionPart[] {
  const out: MentionPart[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ type: 'text', value: body.slice(last, start) });
    out.push({ type: 'mention', name: m[1] });
    last = start + m[0].length;
  }
  if (last < body.length) out.push({ type: 'text', value: body.slice(last) });
  return out;
}
