// Mapping an api.repeaterCli outcome to a CliEntry settle patch. Pure, so the
// four §5.4 failure kinds are pinned without a DOM or a live transport.
//
// The split is deliberate: a refused command is HTTP 200 with an `Err -` reply
// body — the transport succeeded, the firmware said no — so it stays a reply,
// tinted danger, not a transport failure. A superseded rejection arrives tagged
// `code: 'transport'` from the route (§7.2), so it is disambiguated by MESSAGE
// before the code is consulted.

import type { CliEntry } from './queue';

export type CliReplyResult = { ok: true; reply: string } | { ok: true; sent: true };

export function settlePatchForReply(result: CliReplyResult, endedAt: number): Partial<CliEntry> {
  if ('reply' in result) {
    const reply = result.reply;
    if (reply.trimStart().startsWith('Err')) {
      return { state: 'error', reply, error: { kind: 'refused', message: reply }, endedAt };
    }
    return { state: 'ok', reply, error: null, endedAt };
  }
  return { state: 'sent', reply: null, error: null, endedAt };
}

export function settlePatchForError(err: unknown, endedAt: number): Partial<CliEntry> {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: unknown } | null)?.code;
  if (message.includes('superseded by newer CLI command')) {
    return { state: 'error', error: { kind: 'superseded', message }, endedAt };
  }
  if (code === 'cli_timeout') {
    return { state: 'timeout', error: { kind: 'timeout', message }, endedAt };
  }
  return { state: 'error', error: { kind: 'transport', message }, endedAt };
}
