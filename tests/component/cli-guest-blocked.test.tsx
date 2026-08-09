import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { type CliGuest, CliPrompt } from '@/panels/repeater-admin/cli/CliPrompt';
import type { CliSuggestCtx } from '@/panels/repeater-admin/cli/lib/suggest';

const ctx: CliSuggestCtx = { recent: [], nodeValues: {} };
const radio = {
  frequencyHz: 910_525_000,
  bandwidthHz: 62_500,
  spreadingFactor: 7,
  codingRate: 5,
  txPowerDbm: 20,
  repeatMode: false,
  pathHashMode: 2 as const,
};

function Harness({ guest }: { guest: CliGuest }) {
  const [sent, setSent] = useState<string[]>([]);
  return (
    <div>
      <div data-testid="sent">{sent.join('|')}</div>
      <CliPrompt
        history={[]}
        ctx={ctx}
        radioSettings={radio}
        hops={1}
        guest={guest}
        queuedCount={0}
        onSubmit={(t) => setSent((s) => [...s, t])}
        onClearTranscript={() => {}}
        onLoginAsAdmin={() => {}}
      />
    </div>
  );
}

const input = () => screen.getByRole('combobox') as HTMLInputElement;

describe('CliPrompt guest states', () => {
  it('checking: no banner, input enabled, submit is a no-op', () => {
    render(<Harness guest="checking" />);
    expect(input().disabled).toBe(false);
    expect(screen.queryByText(/only answers CLI from an admin session/)).toBeNull();
    fireEvent.change(input(), { target: { value: 'reboot' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByTestId('sent').textContent).toBe('');
  });

  it('guest: banner shown, input still enabled, submit blocked', () => {
    render(<Harness guest="guest" />);
    expect(screen.getByText(/only answers CLI from an admin session/)).toBeTruthy();
    expect(input().disabled).toBe(false);
    fireEvent.change(input(), { target: { value: 'reboot' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByTestId('sent').textContent).toBe('');
  });

  it('admin: no banner, submit works', () => {
    render(<Harness guest="admin" />);
    expect(screen.queryByText(/only answers CLI from an admin session/)).toBeNull();
    fireEvent.change(input(), { target: { value: 'reboot' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByTestId('sent').textContent).toBe('reboot');
  });
});
