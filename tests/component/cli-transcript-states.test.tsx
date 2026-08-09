import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CliRow } from '@/panels/repeater-admin/cli/CliRow';
import { CliTranscript } from '@/panels/repeater-admin/cli/CliTranscript';
import type { CliEntry } from '@/panels/repeater-admin/cli/lib/queue';

const base: CliEntry = {
  id: 'e1',
  text: 'get radio',
  cmd: null,
  state: 'ok',
  queuedAt: 0,
  startedAt: 100,
  endedAt: 1600,
  reply: '869.525,250,11,5',
  error: null,
};
const noop = () => {};
const row = (over: Partial<CliEntry>) => (
  <CliRow entry={{ ...base, ...over }} timeoutMs={30_000} followUps={[]} onRetry={noop} onEdit={noop} onCancel={noop} />
);

describe('CliRow error kinds', () => {
  it('refused: renders the Err reply in danger and offers no Retry', () => {
    render(
      row({ state: 'error', reply: 'Err - unknown command', error: { kind: 'refused', message: 'Err - unknown command' } }),
    );
    expect(screen.getByText(/Err - unknown command/).className).toMatch(/text-cs-danger/);
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('timeout: explains the 30s wait and offers Retry + edit-and-resend', () => {
    render(row({ state: 'timeout', reply: null, error: { kind: 'timeout', message: 'no reply' } }));
    expect(screen.getByText(/no reply after 30 s/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
    expect(screen.getByText(/edit and resend/)).toBeTruthy();
  });

  it('timeout on a serial-only command adds the serial hint', () => {
    render(
      row({
        state: 'timeout',
        cmd: { name: 'erase', group: 'System', desc: 'x', serialOnly: true },
        error: { kind: 'timeout', message: 'no reply' },
      }),
    );
    expect(screen.getByText(/serial-console only/)).toBeTruthy();
  });

  it('superseded: reads as another client taking over', () => {
    render(row({ state: 'error', error: { kind: 'superseded', message: 'superseded by newer CLI command' } }));
    expect(screen.getByText(/another client sent a command/)).toBeTruthy();
  });

  it('transport: shows the server message and Retry', () => {
    render(row({ state: 'error', error: { kind: 'transport', message: 'radio disconnected' } }));
    expect(screen.getByText(/radio disconnected/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });
});

describe('CliRow reply states', () => {
  it('in-flight: dims the row (once, not double-dimmed on the echo) and shows a blinking cursor', () => {
    const { container } = render(row({ state: 'sending', startedAt: Date.now(), endedAt: null, reply: null }));
    expect(container.firstElementChild?.className).toMatch(/opacity-50/);
    expect(container.querySelector('[data-testid="cli-echo"]')?.className).not.toMatch(/opacity-50/);
    expect(container.querySelector('[data-testid="cli-cursor"]')).toBeTruthy();
  });

  it('adds a truncation hint when the reply is at least 156 bytes', () => {
    render(row({ reply: 'x'.repeat(156) }));
    expect(screen.getByText(/may be truncated by firmware/)).toBeTruthy();
  });

  it('omits the truncation hint below 156 bytes', () => {
    render(row({ reply: 'x'.repeat(155) }));
    expect(screen.queryByText(/may be truncated by firmware/)).toBeNull();
  });

  it('renders follow-up chips', () => {
    render(
      <CliRow
        entry={base}
        timeoutMs={30_000}
        followUps={[{ label: 'Change this value', text: 'set radio 869.525,250,11,5' }]}
        onRetry={noop}
        onEdit={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByText('set radio 869.525,250,11,5')).toBeTruthy();
  });
});

describe('CliTranscript', () => {
  it('renders the empty state legend when there are no entries', () => {
    render(
      <CliTranscript entries={[]} timeoutMs={30_000} followUpsFor={() => []} onRetry={noop} onEdit={noop} onCancel={noop} />,
    );
    expect(screen.getByText(/reverse search/)).toBeTruthy();
  });

  it('offers a cancel × on a queued entry', () => {
    render(
      <CliTranscript
        entries={[{ ...base, state: 'queued', reply: null, endedAt: null, startedAt: null }]}
        timeoutMs={30_000}
        followUpsFor={() => []}
        onRetry={noop}
        onEdit={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByRole('button', { name: /cancel queued/i })).toBeTruthy();
  });
});
