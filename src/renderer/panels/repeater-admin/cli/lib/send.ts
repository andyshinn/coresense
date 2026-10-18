// Mapping an api.repeaterCli outcome to a CliEntry settle patch. Pure, so the
// four §5.4 failure kinds are pinned without a DOM or a live transport.
//
// The split is deliberate: a refused command is HTTP 200 with an `Err -` reply
// body — the transport succeeded, the firmware said no — so it stays a reply,
// tinted danger, not a transport failure. The route classifies every failure
// into an ApiError `code` (cli_timeout / cli_superseded / transport), so the
// message text is never parsed here.

import { errorMessage } from '../../../../../shared/errors';
import { ApiError } from '../../../../lib/api';
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
  const message = errorMessage(err);
  switch (err instanceof ApiError ? err.code : null) {
    case 'cli_superseded':
      return { state: 'error', error: { kind: 'superseded', message }, endedAt };
    case 'cli_timeout':
      return { state: 'timeout', error: { kind: 'timeout', message }, endedAt };
    default:
      return { state: 'error', error: { kind: 'transport', message }, endedAt };
  }
}
