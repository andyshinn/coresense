import { fireEvent, render, screen } from '@testing-library/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { useStore } from '@/lib/store';
import { useDeselectOnOutsideClick } from '@/shell/useDeselectOnOutsideClick';

// Regression test for: clicking a path-row expand/collapse chevron in the detail
// rail wrongly deselected the active message. The chevron renders
// `{open ? <ChevronDown/> : <ChevronRight/>}` (see PathItem.tsx / HopRow.tsx);
// toggling `open` swaps one lucide component for a *different* one, so React
// unmounts the exact <svg> that was clicked. The document-level deselect listener
// (useDeselectOnOutsideClick) then runs against a node that has already been
// detached from the rail subtree.
//
// Why flushSync in the harness: a real browser flushes discrete events (click)
// synchronously, so React commits the chevron swap — detaching the clicked <svg>
// — *before* the native event bubbles up to the document listener. React 19 under
// jsdom/vitest instead defers that commit to its scheduler, so without help the
// node is still attached when the listener runs and the bug can't reproduce.
// flushSync inside the toggle recreates the browser's synchronous-commit timing;
// the hook under test is the real production code and is left untouched.
function RailChevron() {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" aria-expanded={open} onClick={() => flushSync(() => setOpen((v) => !v))}>
      <span data-testid="chevron">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
    </button>
  );
}

// The real AppShell deselect logic (via the hook) plus a minimal detail rail.
function Rail() {
  useDeselectOnOutsideClick();
  return (
    <aside aria-label="Detail rail">
      <RailChevron />
    </aside>
  );
}

// A message row whose own onClick selects it, alongside a plain element that is
// genuinely outside the rail. Exercises both "keep selection" branches.
function RowAndRail() {
  useDeselectOnOutsideClick();
  return (
    <div>
      <button type="button" data-testid="message-row" onClick={() => useStore.getState().setSelectedMessage('msg-2')}>
        a message
      </button>
      <button type="button" data-testid="outside">
        somewhere outside
      </button>
    </div>
  );
}

beforeEach(() => {
  useStore.getState().setSelectedMessage('msg-1');
});

afterEach(() => {
  useStore.getState().setSelectedMessage(null);
});

describe('useDeselectOnOutsideClick', () => {
  test('clicking a path-row chevron in the rail keeps the message selected', () => {
    render(<Rail />);
    expect(useStore.getState().selectedMessageId).toBe('msg-1');

    // Click the chevron <svg> itself — the node React swaps out (and detaches)
    // on toggle.
    const chevronSvg = screen.getByTestId('chevron').firstElementChild;
    expect(chevronSvg?.tagName.toLowerCase()).toBe('svg');
    fireEvent.click(chevronSvg as Element);

    // The toggle happened (rail re-rendered)…
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    // …and the selection survived the now-detached-node click.
    expect(useStore.getState().selectedMessageId).toBe('msg-1');
  });

  test('clicking genuinely outside the rail deselects the message', () => {
    render(<RowAndRail />);
    expect(useStore.getState().selectedMessageId).toBe('msg-1');

    fireEvent.click(screen.getByTestId('outside'));

    expect(useStore.getState().selectedMessageId).toBeNull();
  });

  test('clicking a message row keeps a selection (row onClick wins)', () => {
    render(<RowAndRail />);
    fireEvent.click(screen.getByTestId('message-row'));

    expect(useStore.getState().selectedMessageId).toBe('msg-2');
  });
});
