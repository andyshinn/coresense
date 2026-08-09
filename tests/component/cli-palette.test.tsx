import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CliPalette } from '@/panels/repeater-admin/cli/CliPalette';
import type { CliParse } from '@/panels/repeater-admin/cli/lib/parse';
import type { CliSuggestion } from '@/panels/repeater-admin/cli/lib/suggest';
import type { CliCommand } from '../../src/shared/repeater-cli/catalog';

const cmd = (name: string, group: CliCommand['group'], over: Partial<CliCommand> = {}): CliCommand => ({
  name,
  group,
  desc: `${name} desc`,
  ...over,
});

const item = (over: Partial<CliSuggestion>): CliSuggestion => ({
  id: `c:${over.label}`,
  label: over.label ?? 'x',
  desc: 'd',
  kind: 'command',
  insert: over.label ?? 'x',
  replaceFrom: 0,
  group: over.cmd?.group,
  ...over,
});

const commandParse: CliParse = { mode: 'command', token: 's', start: 0 };

const radio = {
  frequencyHz: 910_525_000,
  bandwidthHz: 62_500,
  spreadingFactor: 7,
  codingRate: 5,
  txPowerDbm: 20,
  repeatMode: false,
  pathHashMode: 2 as const,
};

describe('CliPalette', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <CliPalette
        open={false}
        parse={commandParse}
        items={[item({ label: 'set radio', cmd: cmd('set radio', 'Radio') })]}
        activeId="c:set radio"
        nodeValues={{}}
        radioSettings={radio}
        hops={1}
        onApply={() => {}}
      />,
    );
    expect(container.querySelector('[role="option"]')).toBeNull();
  });

  it('orders groups by their best member score (list order), not by CLI_GROUP_ORDER', () => {
    // GPS is CLI_GROUP_ORDER index 10, Operational is index 0 — a naive
    // registry sort would flip these, so this pair genuinely proves
    // first-appearance (score) ordering rather than passing by coincidence.
    const items = [
      item({ label: 'gps', cmd: cmd('gps', 'GPS'), ranges: [[0, 3]] }),
      item({ label: 'reboot', cmd: cmd('reboot', 'Operational') }),
    ];
    render(
      <CliPalette
        open
        parse={commandParse}
        items={items}
        activeId="c:gps"
        nodeValues={{}}
        radioSettings={radio}
        hops={1}
        onApply={() => {}}
      />,
    );
    const headings = Array.from(document.querySelectorAll('[data-group-heading]')).map((n) => n.textContent);
    expect(headings).toEqual(['GPS', 'Operational']); // list order, NOT CLI_GROUP_ORDER (which would give Operational, GPS)
  });

  it('sinks serial-only commands into a trailing group', () => {
    const items = [
      item({ label: 'set radio', cmd: cmd('set radio', 'Radio') }),
      item({ label: 'erase', cmd: cmd('erase', 'System', { serialOnly: true }), serialOnly: true }),
    ];
    render(
      <CliPalette
        open
        parse={commandParse}
        items={items}
        activeId="c:set radio"
        nodeValues={{}}
        radioSettings={radio}
        hops={1}
        onApply={() => {}}
      />,
    );
    const headings = Array.from(document.querySelectorAll('[data-group-heading]')).map((n) => n.textContent);
    expect(headings[headings.length - 1]).toBe('Not available over radio');
  });

  it('reflects the active item via aria-activedescendant', () => {
    const items = [
      item({ label: 'set radio', cmd: cmd('set radio', 'Radio') }),
      item({ label: 'set name', cmd: cmd('set name', 'System') }),
    ];
    const { rerender } = render(
      <CliPalette
        open
        parse={commandParse}
        items={items}
        activeId="c:set radio"
        nodeValues={{}}
        radioSettings={radio}
        hops={1}
        onApply={() => {}}
      />,
    );
    const listbox = screen.getByRole('listbox');
    expect(listbox.getAttribute('aria-activedescendant')).toBe('c:set radio');
    rerender(
      <CliPalette
        open
        parse={commandParse}
        items={items}
        activeId="c:set name"
        nodeValues={{}}
        radioSettings={radio}
        hops={1}
        onApply={() => {}}
      />,
    );
    expect(listbox.getAttribute('aria-activedescendant')).toBe('c:set name');
  });

  it('scrolls the active option into view when the selection moves', () => {
    // jsdom has no layout, so assert the follow-scroll intent: the active row's
    // scrollIntoView is invoked when activeId changes. Stub it on the prototype
    // (defined-or-not in jsdom) and restore after.
    const proto = HTMLElement.prototype as unknown as { scrollIntoView?: (opts?: ScrollIntoViewOptions) => void };
    const original = proto.scrollIntoView;
    const scrollSpy = vi.fn();
    proto.scrollIntoView = scrollSpy;
    try {
      const items = [
        item({ label: 'set radio', cmd: cmd('set radio', 'Radio') }),
        item({ label: 'set name', cmd: cmd('set name', 'System') }),
      ];
      const shared = {
        open: true as const,
        parse: commandParse,
        items,
        nodeValues: {},
        radioSettings: radio,
        hops: 1,
        onApply: () => {},
      };
      const { rerender } = render(<CliPalette {...shared} activeId="c:set radio" />);
      scrollSpy.mockClear(); // ignore the initial-mount scroll
      rerender(<CliPalette {...shared} activeId="c:set name" />);
      expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      proto.scrollIntoView = original;
    }
  });

  it('applies an item on mousedown', () => {
    const onApply = vi.fn();
    const it0 = item({ label: 'set radio', cmd: cmd('set radio', 'Radio') });
    render(
      <CliPalette
        open
        parse={commandParse}
        items={[it0]}
        activeId="c:set radio"
        nodeValues={{}}
        radioSettings={radio}
        hops={1}
        onApply={onApply}
      />,
    );
    fireEvent.mouseDown(screen.getByRole('option'));
    expect(onApply).toHaveBeenCalledWith(it0);
  });

  it('activates a row on hover (mouseEnter) so its docs show before any click', () => {
    const onActivate = vi.fn();
    const it0 = item({ label: 'set radio', cmd: cmd('set radio', 'Radio') });
    render(
      <CliPalette
        open
        parse={commandParse}
        items={[it0]}
        activeId="c:set radio"
        nodeValues={{}}
        radioSettings={radio}
        hops={1}
        onApply={() => {}}
        onActivate={onActivate}
      />,
    );
    fireEvent.mouseEnter(screen.getByRole('option'));
    expect(onActivate).toHaveBeenCalledWith(it0);
  });

  it('renders the empty state when there are no items', () => {
    render(
      <CliPalette
        open
        parse={commandParse}
        items={[]}
        activeId=""
        nodeValues={{}}
        radioSettings={radio}
        hops={1}
        onApply={() => {}}
      />,
    );
    expect(screen.getByText(/press ↵ to send it raw/)).toBeTruthy();
    expect(document.querySelector('[role="option"]')).toBeNull();
  });
});
