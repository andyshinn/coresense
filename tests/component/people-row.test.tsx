import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { IDENTITY_NEUTRAL_VAR, identityDotVar } from '@/lib/contactColor';
import { useStore } from '@/lib/store';
import { PeopleRow } from '@/shell/rightrail/sections/PeopleRow';
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
    msgCount: 3,
    lastSeenAt: 1_000,
    ...overrides,
  };
}

function renderRow(row: RosterRow) {
  return render(
    <TooltipProvider>
      <PeopleRow
        row={row}
        now={2_000}
        maxCount={10}
        showVolume={false}
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
