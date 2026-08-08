import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { describe, expect, it } from 'vitest';
import { CliPrompt } from '@/panels/repeater-admin/cli/CliPrompt';
import type { CliSuggestCtx } from '@/panels/repeater-admin/cli/lib/suggest';
import { CLI_BY_NAME } from '../../src/shared/repeater-cli/catalog';

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

function Harness() {
  const [sent, setSent] = useState<string[]>([]);
  return (
    <div>
      <div data-testid="sent">{sent.join('|')}</div>
      <CliPrompt
        history={[
          { text: 'get owner.info', status: 'ok' },
          { text: 'get radio', status: 'ok' },
        ]}
        ctx={ctx}
        radioSettings={radio}
        hops={1}
        guest="admin"
        queuedCount={0}
        onSubmit={(t) => flushSync(() => setSent((s) => [...s, t]))}
        onClearTranscript={() => {}}
        onLoginAsAdmin={() => {}}
      />
    </div>
  );
}

function input() {
  return screen.getByRole('combobox') as HTMLInputElement;
}

describe('CliPrompt keys', () => {
  it('Tab completes to the shared prefix of the matching commands', () => {
    render(<Harness />);
    const el = input();
    fireEvent.change(el, { target: { value: 'set flood.m' } });
    fireEvent.keyDown(el, { key: 'Tab' });
    expect(el.value).toBe('set flood.max');
  });

  it('ArrowUp recalls the last history line', () => {
    render(<Harness />);
    const el = input();
    fireEvent.keyDown(el, { key: 'ArrowUp' });
    expect(el.value).toBe('get radio');
  });

  it('Enter submits the current line', () => {
    render(<Harness />);
    const el = input();
    fireEvent.change(el, { target: { value: 'reboot' } });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(screen.getByTestId('sent').textContent).toBe('reboot');
  });

  it('renders a ghost that preserves typed casing', () => {
    render(<Harness />);
    const el = input();
    fireEvent.change(el, { target: { value: 'SET r' } });
    // The ghost layer holds an invisible copy of the value plus the dim suffix —
    // assert the full node so a broken/empty suffix would fail, not just a prefix
    // that the invisible value span alone would already satisfy.
    const ghost = document.querySelector('[data-testid="cli-ghost"]');
    expect(ghost?.textContent).toBe('SET radio'); // typed 'SET r' (casing preserved) + label suffix 'adio'
  });

  it('the focused input owns the combobox relationship (aria-activedescendant on the input, not the listbox)', () => {
    render(<Harness />);
    const el = input();
    fireEvent.change(el, { target: { value: 'set r' } });
    expect(el.getAttribute('role')).toBe('combobox');
    expect(el.getAttribute('aria-controls')).toBe('cli-palette-listbox');
    expect(el.getAttribute('aria-activedescendant')).toMatch(/^c:/); // active option id
  });

  it('hovering a row surfaces that command’s docs in the detail pane before any click', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'set' } });
    // 'set radio' is a real row but not the default selection; hovering it must
    // both select it and render its docs (cmd.desc, which the rows omit) in the
    // two-pane detail — exercising the full onMouseEnter → item/activate → detail seam.
    const radio = screen.getAllByRole('option').find((o) => o.textContent?.startsWith('set radio')) as HTMLElement;
    expect(radio).toBeTruthy();
    expect(radio.getAttribute('aria-selected')).toBe('false');
    fireEvent.mouseEnter(radio);
    expect(radio.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText(CLI_BY_NAME['set radio'].desc)).toBeTruthy();
  });

  it('treats the console chords as Ctrl-only: ⌘R does not open reverse-search, ⌃R does', () => {
    render(<Harness />);
    const el = input();
    // ⌘R (metaKey) must NOT trigger the readline chord — on macOS it belongs to
    // app-level shortcuts, and the reverse-search bar should stay closed.
    fireEvent.keyDown(el, { key: 'r', metaKey: true });
    expect(screen.queryAllByText(/reverse-i-search/)).toHaveLength(0);
    // ⌃R still opens it.
    fireEvent.keyDown(el, { key: 'r', ctrlKey: true });
    expect(screen.queryAllByText(/reverse-i-search/).length).toBeGreaterThan(0);
  });

  it('reverse-search: ArrowRight accepts the active match into the line', () => {
    render(<Harness />);
    const el = input();
    fireEvent.keyDown(el, { key: 'r', ctrlKey: true });
    fireEvent.keyDown(el, { key: 'o' });
    fireEvent.keyDown(el, { key: 'w' });
    fireEvent.keyDown(el, { key: 'n' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    expect(el.value).toBe('get owner.info');
    // Prove rsearch was actually cleared (not just that value happened to be
    // set): the reducer's key/ctrlG is a no-op unless rsearch is still active
    // (`if (!s.rsearch) return { state: s }`) — while active it would instead
    // restore the pre-search line. Value staying put confirms rsearch is gone.
    fireEvent.keyDown(el, { key: 'g', ctrlKey: true });
    expect(el.value).toBe('get owner.info');
  });
});
