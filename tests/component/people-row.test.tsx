import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { IDENTITY_NEUTRAL_VAR, identityDotVar } from '@/lib/contactColor';
import { useStore } from '@/lib/store';
import { fmtAgeAbsolute, PeopleRow } from '@/shell/rightrail/sections/PeopleRow';
import type { RosterRow } from '@/shell/rightrail/sections/peopleModel';

// The dot is the row's whole reason for existing: fill answers "is it saved?",
// hue answers "do we know a key for it?". These three cases are the only ones
// that exist (see the task brief's table) and they map 1:1 onto which of the
// two hover actions can fire.
function baseRow(overrides: Partial<RosterRow> = {}): RosterRow {
  return {
    id: 'pk1',
    name: 'alice',
    pubkey: null,
    contactKey: null,
    source: 'none',
    ambiguous: false,
    blocked: false,
    inContacts: false,
    self: false,
    msgCount: 3,
    lastSeenAt: 1_000,
    ...overrides,
  };
}

function renderRow(row: RosterRow, remeasureAt = 320, now = 2_000) {
  return render(
    <TooltipProvider>
      <PeopleRow
        row={row}
        now={now}
        maxCount={10}
        showVolume={false}
        remeasureAt={remeasureAt}
        timeFormat="auto"
        onOpen={() => {}}
        onMessage={() => {}}
        onAddContact={() => {}}
      />
    </TooltipProvider>,
  );
}

function dotOf(container: HTMLElement): HTMLElement {
  const dot = container.querySelector('.rounded-full');
  if (!dot) throw new Error('dot not found');
  return dot as HTMLElement;
}

beforeEach(() => {
  useStore.setState((s) => ({ appSettings: { ...s.appSettings, identityColorMode: 'byKey' } }));
});

describe('PeopleRow identity dot', () => {
  it('renders filled + hued for a saved contact, and hides Add contact', () => {
    const row = baseRow({ inContacts: true, pubkey: 'pk1', contactKey: 'c:pk1' });
    const { container, queryByRole } = renderRow(row);
    const dot = dotOf(container);
    expect(dot.style.backgroundColor).toBe(identityDotVar('pk1'));
    expect(dot.style.boxShadow).toBe('');
    expect(queryByRole('button', { name: /add alice to contacts/i })).toBeNull();
  });

  it('renders hollow + hued for an advert heard but unsaved, with Add contact enabled', () => {
    const row = baseRow({ inContacts: false, pubkey: 'pk1', contactKey: null });
    const { container, getByRole } = renderRow(row);
    const dot = dotOf(container);
    expect(dot.style.backgroundColor).toBe('transparent');
    expect(dot.style.boxShadow).toContain(identityDotVar('pk1'));

    const message = getByRole('button', { name: /add to contacts to message/i });
    expect(message.getAttribute('aria-disabled')).toBe('true');
    const add = getByRole('button', { name: /add alice to contacts/i });
    expect(add.getAttribute('aria-disabled')).toBe('false');
  });

  it('renders hollow + grey for a name never heard from, with both actions disabled', () => {
    const row = baseRow({ inContacts: false, pubkey: null, contactKey: null });
    const { container, getByRole } = renderRow(row);
    const dot = dotOf(container);
    expect(dot.style.backgroundColor).toBe('transparent');
    expect(dot.style.boxShadow).toContain(IDENTITY_NEUTRAL_VAR);

    const message = getByRole('button', { name: /add to contacts to message/i });
    expect(message.getAttribute('aria-disabled')).toBe('true');
    const add = getByRole('button', { name: /no advert heard from this node yet/i });
    expect(add.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('PeopleRow self row', () => {
  const selfRow = baseRow({ id: 'self', name: 'You', pubkey: null, contactKey: null, self: true });

  it('renders hollow + grey and offers no actions', () => {
    const { container, queryByRole } = renderRow(selfRow);
    const dot = dotOf(container);
    expect(dot.style.backgroundColor).toBe('transparent');
    expect(dot.style.boxShadow).toContain(IDENTITY_NEUTRAL_VAR);
    expect(queryByRole('button', { name: /to message/i })).toBeNull();
    expect(queryByRole('button', { name: /contacts/i })).toBeNull();
  });

  // byName hashes row.name, and 'You' is a perfectly good hash input — without
  // the explicit self guard the row would take a stable hue that can collide
  // with a real poster's, reading as just another participant.
  it('stays hueless under byName, where the literal "You" would otherwise hash', () => {
    useStore.setState((s) => ({ appSettings: { ...s.appSettings, identityColorMode: 'byName' } }));
    const { container } = renderRow(selfRow);
    expect(dotOf(container).style.boxShadow).toContain(IDENTITY_NEUTRAL_VAR);
    expect(dotOf(container).style.boxShadow).not.toContain(identityDotVar('You'));
  });

  it('still hues a normal row under byName', () => {
    useStore.setState((s) => ({ appSettings: { ...s.appSettings, identityColorMode: 'byName' } }));
    const { container } = renderRow(baseRow({ name: 'alice' }));
    expect(dotOf(container).style.boxShadow).toContain(identityDotVar('alice'));
  });
});

// Issue #35: `fmtAgeAbsolute` was a plain string child of `TooltipContent`, so
// it ran for every row on every render for a tooltip nobody had opened — 577
// rows x three `toLocale*` calls per parent re-render. It is now a child
// component, which Radix keeps behind a Presence and only calls when the
// tooltip actually mounts.
//
// The visible parts of a row (`fmtAge`, `fmtCount`, the identity dot) are pure
// arithmetic, so *any* `Date.prototype.toLocale*` call during a closed-tooltip
// render is the absolute timestamp being computed eagerly.
describe('PeopleRow age tooltip', () => {
  const LOCALE_METHODS = ['toLocaleTimeString', 'toLocaleString', 'toLocaleDateString'] as const;

  const TS = new Date('2026-07-25T09:15:00').getTime();
  const LATER = TS + 3 * 86_400_000;

  // The age column's own trigger (the compact "3d"), not the name or count ones.
  const ageTrigger = (container: HTMLElement) =>
    container.querySelector('[data-slot="tooltip-trigger"].text-\\[10\\.5px\\]') as HTMLElement;

  it('does not format the absolute timestamp while the tooltip is closed', () => {
    const spies = LOCALE_METHODS.map((m) => vi.spyOn(Date.prototype, m));
    try {
      const { container } = renderRow(baseRow({ lastSeenAt: TS }), 320, LATER);
      expect(ageTrigger(container).textContent).toBe('3d');
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('still formats it once the tooltip opens', async () => {
    const { container } = renderRow(baseRow({ lastSeenAt: TS }), 320, LATER);
    fireEvent.focusIn(ageTrigger(container));
    await waitFor(() => expect(document.body.textContent).toContain(fmtAgeAbsolute(TS, LATER, 'auto')));
  });
});
