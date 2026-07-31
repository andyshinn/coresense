import { describe, expect, it } from 'vitest';
import { settlePatchForError, settlePatchForReply } from '../../../../../../src/renderer/panels/repeater-admin/cli/lib/send';

describe('settlePatchForReply', () => {
  it('marks an ordinary reply ok and keeps the text', () => {
    expect(settlePatchForReply({ ok: true, reply: 'radio: 869.525' }, 5)).toEqual({
      state: 'ok',
      reply: 'radio: 869.525',
      error: null,
      endedAt: 5,
    });
  });

  it('marks an Err- reply refused, keeping it as a reply (HTTP 200, not a transport failure)', () => {
    expect(settlePatchForReply({ ok: true, reply: 'Err - unknown command' }, 5)).toEqual({
      state: 'error',
      reply: 'Err - unknown command',
      error: { kind: 'refused', message: 'Err - unknown command' },
      endedAt: 5,
    });
  });

  it('detects Err after leading whitespace', () => {
    expect(settlePatchForReply({ ok: true, reply: '  Err -3' }, 5).error).toEqual({
      kind: 'refused',
      message: '  Err -3',
    });
  });

  it('marks a no-reply send as sent, with no reply body', () => {
    expect(settlePatchForReply({ ok: true, sent: true }, 5)).toEqual({
      state: 'sent',
      reply: null,
      error: null,
      endedAt: 5,
    });
  });
});

describe('settlePatchForError', () => {
  it('reads superseded off the message before the transport code', () => {
    const err = Object.assign(new Error('superseded by newer CLI command'), { code: 'transport' });
    expect(settlePatchForError(err, 5)).toEqual({
      state: 'error',
      error: { kind: 'superseded', message: 'superseded by newer CLI command' },
      endedAt: 5,
    });
  });

  it('maps a cli_timeout code to a timeout state', () => {
    const err = Object.assign(new Error('CLI command timed out after 30000ms'), { code: 'cli_timeout' });
    expect(settlePatchForError(err, 5)).toEqual({
      state: 'timeout',
      error: { kind: 'timeout', message: 'CLI command timed out after 30000ms' },
      endedAt: 5,
    });
  });

  it('maps everything else to transport', () => {
    const err = Object.assign(new Error('device offline'), { code: 'transport' });
    expect(settlePatchForError(err, 5)).toEqual({
      state: 'error',
      error: { kind: 'transport', message: 'device offline' },
      endedAt: 5,
    });
  });

  it('degrades a non-Error rejection to a transport failure', () => {
    expect(settlePatchForError('boom', 5)).toEqual({
      state: 'error',
      error: { kind: 'transport', message: 'boom' },
      endedAt: 5,
    });
  });
});
