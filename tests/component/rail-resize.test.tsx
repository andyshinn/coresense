// Perf regression tests for issue #35: dragging the right rail's resize handle
// re-rendered the entire People roster (577 unvirtualized rows on ch:Public) on
// every pointermove.
//
// These pin BEHAVIOUR THAT IS INVISIBLE, so they are the only thing standing
// between the fix and a silent rot back to the old cost. Two independent
// mechanisms have to hold:
//
//   1. The raw px width must not reach the section subtrees. `ChannelPeopleSection`
//      selects `railIsWide(s.ui.rightWidth)` — a boolean — so zustand's Object.is
//      check swallows the frames that don't cross 304px. A store subscription is
//      not a prop, so no amount of React.memo below can substitute for this.
//   2. Every member of the body's `rowProps` must be referentially stable across
//      a frame, or `React.memo(PeopleRow)`'s comparator fails and all 577 rows
//      re-render regardless. The original `railWidth` member did exactly that.
//
// The row render counter below is wrapped in its own `memo`, so it increments
// precisely when PeopleRow's props changed — i.e. exactly when the real memo
// comparator would have failed.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { memo } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

const getChannelStats = vi.fn();
vi.mock('@/lib/api', async (orig) => {
  const actual = (await orig()) as typeof import('@/lib/api');
  return { ...actual, api: { ...actual.api, getChannelStats: (...a: unknown[]) => getChannelStats(...a) } };
});

const { NOW, rowRenders } = vi.hoisted(() => ({
  NOW: new Date('2026-07-25T12:00:00').getTime(),
  rowRenders: { n: 0 },
}));
vi.mock('@/hooks/useNowTick', () => ({ useNowTick: () => NOW }));

vi.mock('@/shell/rightrail/sections/PeopleRow', async (orig) => {
  const actual = (await orig()) as typeof import('@/shell/rightrail/sections/PeopleRow');
  const Real = actual.PeopleRow;
  const Counting = memo(function CountingPeopleRow(props: React.ComponentProps<typeof Real>) {
    rowRenders.n++;
    return <Real {...props} />;
  });
  return { ...actual, PeopleRow: Counting };
});

import { __resetChannelStatsCacheForTests } from '@/hooks/useChannelStats';
import { useStore } from '@/lib/store';
import { ResizeHandle } from '@/shell/rightrail/ResizeHandle';
import { RAIL_COLLAPSE_WIDTH } from '@/shell/rightrail/railWidth';
import { ChannelPeopleSection } from '@/shell/rightrail/sections/ChannelPeople';
import { PEOPLE_ROW_CAP } from '@/shell/rightrail/sections/peopleModel';
import type { Channel, ChannelSenderStat, ChannelStats, Contact } from '../../src/shared/types';

const ROSTER_SIZE = 120;

function roster(): ChannelSenderStat[] {
  const out: ChannelSenderStat[] = [];
  for (let i = 0; i < ROSTER_SIZE; i++) {
    out.push({ fromPk: `name:person-${i}`, count: (i * 7) % 300, lastTs: NOW - i * 3_600_000 });
  }
  return out;
}

function contacts(): Contact[] {
  const out: Contact[] = [];
  for (let i = 0; i < 20; i++) out.push({ key: `c:pk${i}`, publicKeyHex: `pk${i}`, name: `person-${i}`, kind: 'chat' });
  return out;
}

const stats = (): ChannelStats => ({
  count: 900,
  firstTs: 1,
  lastTs: NOW,
  count24h: 10,
  count7d: 90,
  distinctSenders: ROSTER_SIZE,
  roster: roster(),
  perDay: [1, 2, 3, 4, 5, 6, 7],
});

const ch: Channel = { key: 'ch:public', name: 'public', kind: 'public' };
const client = { baseUrl: 'http://x', apiKey: 'k' };

function setWidth(w: number) {
  act(() => {
    useStore.setState((s) => ({ ui: { ...s.ui, rightWidth: w } }));
  });
}

async function mountSection() {
  const view = render(
    <TooltipProvider>
      <ChannelPeopleSection channel={ch} client={client} />
    </TooltipProvider>,
  );
  await waitFor(() => expect(screen.getByText('person-0')).toBeTruthy());
  return view;
}

describe('rail resize does not re-render the People roster (issue #35)', () => {
  beforeEach(() => {
    getChannelStats.mockReset();
    getChannelStats.mockResolvedValue(stats());
    __resetChannelStatsCacheForTests();
    rowRenders.n = 0;
    useStore.setState((s) => ({
      contacts: contacts(),
      discovered: [],
      peopleQuery: '',
      messagesByKey: {},
      ui: { ...s.ui, rightWidth: 400, peopleRail: {} },
    }));
  });

  afterEach(() => {
    act(() => {
      useStore.setState((s) => ({ ui: { ...s.ui, rightWidth: 320 } }));
    });
  });

  it('renders zero rows for a burst of drag frames that never cross the breakpoint', async () => {
    await mountSection();
    const afterMount = rowRenders.n;
    expect(afterMount).toBeGreaterThan(0);

    // 20 frames of a drag entirely on the wide side of 304px. Before the fix
    // every one of these re-rendered every row.
    for (let i = 1; i <= 20; i++) setWidth(400 + i);

    expect(rowRenders.n - afterMount).toBe(0);
  });

  it('re-renders the rows exactly once when a drag actually crosses the breakpoint', async () => {
    await mountSection();
    const afterMount = rowRenders.n;
    const rows = screen.getAllByText(/^person-\d+$/).length;

    // Walk down across 304 and keep going: only the crossing frame counts.
    for (let w = RAIL_COLLAPSE_WIDTH + 3; w >= RAIL_COLLAPSE_WIDTH - 3; w--) setWidth(w);

    expect(rowRenders.n - afterMount).toBe(rows);
  });

  it('still flips the section controls when the drag crosses the breakpoint', async () => {
    await mountSection();
    expect(screen.getByLabelText('Sort people')).toBeTruthy();

    setWidth(RAIL_COLLAPSE_WIDTH - 1);
    await waitFor(() => expect(screen.queryByLabelText('Sort people')).toBeNull());
    expect(screen.getByLabelText('Search people')).toBeTruthy();

    setWidth(RAIL_COLLAPSE_WIDTH);
    await waitFor(() => expect(screen.getByLabelText('Sort people')).toBeTruthy());
  });

  // The clipped-name tooltip re-measures off the rail width. Dropping the live
  // width is what makes the drag cheap, so the trigger moved to a ~120ms
  // trailing debounce (useRailSettleTick). Both halves matter: nothing during
  // the drag, exactly one re-measure after it.
  it('re-measures the rows once after the drag settles, not during it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await mountSection();
      const afterMount = rowRenders.n;
      const rows = screen.getAllByText(/^person-\d+$/).length;

      for (let i = 1; i <= 15; i++) {
        setWidth(400 + i);
        act(() => {
          vi.advanceTimersByTime(16);
        });
      }
      expect(rowRenders.n - afterMount).toBe(0);

      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(rowRenders.n - afterMount).toBe(rows);
    } finally {
      vi.useRealTimers();
    }
  });

  // ...and it must still re-measure when the drag ends on the width it started
  // on. That is an ordinary gesture rather than a pixel coincidence: both rail
  // clamps (MIN_WIDTH 240 / MAX_WIDTH 640) turn "drag past the stop and let go"
  // into exactly this. Handing rows the settled *width* would make React bail
  // on the no-op setState and skip the re-measure — while the frames in between
  // have already crossed 304px and measured every row against a name track the
  // rail no longer has, leaving the tooltip pinned shut on genuinely clipped
  // names. Hence a counter, which always changes. See useRailSettleTick.
  it('re-measures after a drag that crosses the breakpoint and returns to its starting width', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await mountSection();
      const rows = screen.getAllByText(/^person-\d+$/).length;

      for (const w of [360, 320, 300, 280, 300, 320, 360, 400]) {
        setWidth(w);
        act(() => {
          vi.advanceTimersByTime(16);
        });
      }

      // Every breakpoint crossing above has already been accounted for; what is
      // left is purely the settle.
      const beforeSettle = rowRenders.n;
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(rowRenders.n - beforeSettle).toBe(rows);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ChannelPeopleBody caps the painted roster', () => {
  beforeEach(() => {
    getChannelStats.mockReset();
    getChannelStats.mockResolvedValue(stats());
    __resetChannelStatsCacheForTests();
    rowRenders.n = 0;
    useStore.setState((s) => ({
      contacts: contacts(),
      discovered: [],
      peopleQuery: '',
      messagesByKey: {},
      ui: { ...s.ui, rightWidth: 400, peopleRail: {} },
    }));
  });

  it('paints only the cap and offers a reveal for the rest', async () => {
    await mountSection();
    expect(screen.getAllByText(/^person-\d+$/).length).toBe(PEOPLE_ROW_CAP);
    expect(screen.getByRole('button', { name: new RegExp(`Show all ${ROSTER_SIZE}`) })).toBeTruthy();
  });

  // Text queries, not `*ByRole({ name })`, on purpose. A role query with a
  // `name` computes the accessible name of EVERY button in the document, and
  // each computation goes through jsdom's getComputedStyle — so once the full
  // roster is painted, one such query cost more than the render it was checking
  // (measured under coverage: ~540ms, against ~12ms for the text query). That
  // is what pushed this test past the 5s timeout on CI's slower, contended
  // runners while it passed locally. It loses nothing: that the reveal is a
  // genuine accessible button is pinned by the test above, which runs its role
  // query against the capped roster, where it is cheap.
  it('reveals the full roster on demand', async () => {
    await mountSection();
    fireEvent.click(screen.getByText(new RegExp(`Show all ${ROSTER_SIZE}`)));
    await waitFor(() => expect(screen.getAllByText(/^person-\d+$/).length).toBe(ROSTER_SIZE));
    expect(screen.queryByText(/Show all/)).toBeNull();
  });

  // The cap is a paint-time slice, applied after search. Capping the data
  // instead would make people past the first 60 unsearchable, which is exactly
  // the failure mode a server-side LIMIT would have shipped.
  it('still finds a person who sorts well past the cap', async () => {
    await mountSection();
    expect(screen.queryByText('person-119')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'person-119' } });
    await waitFor(() => expect(screen.getByText('person-119')).toBeTruthy());
  });

  // Slicing before `groupByBucket` is what keeps a bucket header from appearing
  // above zero visible rows; the header's own count then describes what is
  // actually on screen.
  it('gives every recency bucket a truthful, non-zero count', async () => {
    await mountSection();
    let summed = 0;
    let seen = 0;
    for (const label of ['Today', 'Yesterday', 'This week', 'Earlier']) {
      const el = screen.queryByText(label);
      if (!el) continue;
      seen++;
      const count = Number(el.nextElementSibling?.textContent);
      expect(count).toBeGreaterThan(0);
      summed += count;
    }
    expect(seen).toBeGreaterThan(1);
    // Slicing before grouping is what makes this hold: the headers describe the
    // rows actually on screen, never the uncapped roster behind them.
    expect(summed).toBe(PEOPLE_ROW_CAP);
    expect(screen.getAllByText(/^person-\d+$/).length).toBe(PEOPLE_ROW_CAP);
  });
});

describe('ResizeHandle coalesces pointermoves into one frame', () => {
  let frames: FrameRequestCallback[] = [];
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let cancelSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    frames = [];
    rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id: number) => {
      frames[id - 1] = () => {};
    });
    // jsdom implements neither of these on Element; the handle uses them to keep
    // receiving moves once the pointer leaves the 2px hit area.
    if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
    if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  });

  afterEach(() => {
    rafSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  function flush() {
    const queued = frames;
    frames = [];
    act(() => {
      for (const cb of queued) cb(0);
    });
  }

  function mountHandle(onChange: (w: number) => void) {
    const { container } = render(<ResizeHandle width={320} onChange={onChange} />);
    return container.firstElementChild as HTMLElement;
  }

  it('publishes one width per frame, carrying the newest pointer position', () => {
    const onChange = vi.fn();
    const handle = mountHandle(onChange);

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 });
    // Five moves inside one frame. The handle sits on the rail's LEFT edge, so
    // leftward motion widens: 320 + (500 - clientX).
    for (const x of [495, 490, 480, 470, 460]) fireEvent.pointerMove(handle, { pointerId: 1, clientX: x });
    expect(onChange).not.toHaveBeenCalled();

    flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(360);
  });

  it('clamps to the rail bounds', () => {
    const onChange = vi.fn();
    const handle = mountHandle(onChange);
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -5000 });
    flush();
    expect(onChange).toHaveBeenCalledWith(640);
  });

  it('flushes the last coalesced move on pointerup rather than dropping it', () => {
    const onChange = vi.fn();
    const handle = mountHandle(onChange);
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 450 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 450 });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(370);

    // The queued frame must not publish a second time.
    flush();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  // `releasePointerCapture` is the only statement in the handler that can throw
  // (NotFoundError, if the pointer is no longer active — Firefox shipped
  // exactly that from inside this very handler, mozilla bug 1556703). It is
  // therefore last. Were it first, a throw would skip the whole cleanup and
  // leave `startRef` set, and since React does not route event-handler throws
  // to an error boundary the component would stay mounted in that state: moving
  // the mouse over the handle with no button down would go on resizing the rail
  // until the next successful drag. The browser implicitly releases capture
  // after this event regardless, so a failed release costs nothing.
  it('ends the drag cleanly even when releasePointerCapture throws', () => {
    const onChange = vi.fn();
    const handle = mountHandle(onChange);
    const release = Element.prototype.releasePointerCapture;
    Element.prototype.releasePointerCapture = () => {
      throw new DOMException('InvalidPointerId', 'NotFoundError');
    };
    // jsdom reports a throwing listener to window.onerror rather than
    // propagating it out of dispatchEvent; swallow it so the run stays clean.
    const onError = (e: Event) => e.preventDefault();
    window.addEventListener('error', onError);

    try {
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 450 });
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 450 });

      // The flush still happened, so the drag lands on the pointer...
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(370);

      // ...the queued frame was still cancelled...
      flush();
      expect(onChange).toHaveBeenCalledTimes(1);

      // ...and the drag is genuinely over: a button-less hover across the
      // handle publishes nothing.
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 200 });
      flush();
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('error', onError);
      Element.prototype.releasePointerCapture = release;
    }
  });

  it('drops the pending frame when Esc cancels the drag', () => {
    const onChange = vi.fn();
    const handle = mountHandle(onChange);
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 450 });
    fireEvent.keyDown(window, { key: 'Escape' });

    flush();
    expect(onChange).not.toHaveBeenCalled();

    // ...and the cancelled drag stays cancelled.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 });
    flush();
    expect(onChange).not.toHaveBeenCalled();
  });
});
