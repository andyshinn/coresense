import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useStore } from '@/lib/store';
import { ActivityBody, ChannelActivitySection } from '@/shell/rightrail/sections/channel-activity';
import { COLLAPSE_WIDTH } from '@/shell/rightrail/sections/channel-activity/activity';
import type { ActivityWindow, ActivityWindowKey, Channel, ChannelActivity } from '../../src/shared/types';

const NOW = 1_700_000_000_000;
const midnight = (() => {
  const d = new Date(NOW);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
})();

const w = (len: number, total: number, prevTotal: number): ActivityWindow => ({
  buckets: new Array(len).fill(Math.floor(total / len)),
  total,
  prevTotal,
  startMs: midnight,
});

const activity = (over: Partial<ChannelActivity> = {}): ChannelActivity => ({
  windows: { '24h': w(24, 123, 104), '7d': w(7, 412, 498), '30d': w(30, 1637, 1290) },
  peakBand: { startHour: 19, endHour: 22 },
  quietBand: { startHour: 2, endHour: 6 },
  lastTs: NOW - 180_000,
  ...over,
});

// ChannelActivitySection (the store-wired wrapper) needs a live api module to mock,
// since useChannelActivity calls through it. The mock's inner arrow only closes over
// `getChannelActivity` — it isn't invoked until a test's fetch actually runs, by which
// point the const below has been assigned — so this declaration order is safe despite
// vi.mock's hoisting above the imports.
const getChannelActivity = vi.fn(async () => activity());
vi.mock('@/lib/api', () => ({
  api: {
    getChannelActivity: (...args: unknown[]) => getChannelActivity(...(args as [])),
  },
}));

const client = { baseUrl: 'http://x', apiKey: 'k' };
const channel: Channel = { key: 'ch:Test', name: 'Test', kind: 'public' };

const body = (props: Partial<React.ComponentProps<typeof ActivityBody>> = {}) =>
  render(
    <TooltipProvider>
      <ActivityBody
        activity={activity()}
        loading={false}
        error={null}
        mode="full"
        win="24h"
        onWindow={() => {}}
        now={NOW}
        {...props}
      />
    </TooltipProvider>,
  );

describe('ActivityBody', () => {
  it('renders the full treatment: tabs, lead number, trend, 24 bars, axis, rhythm', () => {
    const { container } = body();
    expect(screen.getByLabelText('Last 24 hours')).toBeTruthy();
    expect(screen.getByText('123')).toBeTruthy();
    expect(screen.getByText('in 24h')).toBeTruthy();
    expect(screen.getByText('18%')).toBeTruthy(); // (123-104)/104
    expect(container.querySelectorAll('[data-testid="activity-bar"]')).toHaveLength(24);
    expect(container.querySelector('[data-testid="activity-axis"]')).toBeTruthy();
    expect(container.textContent).toContain('2–6 AM');
  });

  it('collapses to number, mini trend, bare sparkline and a two-clause rhythm line', () => {
    const { container } = body({ mode: 'collapsed' });
    expect(screen.queryByLabelText('Last 24 hours')).toBe(null);
    expect(screen.getByText('msgs · 24h')).toBeTruthy();
    // The "mini trend" and "bare sparkline" this test's name promises, actually
    // checked: suppressing TrendChip or dropping VolumeChart entirely in collapsed
    // mode would still pass every assertion above this point.
    expect(screen.getByText('18%')).toBeTruthy();
    expect(container.querySelectorAll('[data-testid="activity-bar"]')).toHaveLength(24);
    expect(screen.queryByText('vs prev')).toBe(null);
    expect(container.querySelector('[data-testid="activity-axis"]')).toBe(null);
    expect(container.textContent).not.toContain('2–6 AM');
    expect(container.textContent).toContain('3m ago');
  });

  it('pins the collapsed view to 24h even when a wider window is stored, without writing back to it', () => {
    const onWindow = vi.fn();
    body({ mode: 'collapsed', win: '30d', onWindow });
    expect(screen.getByText('123')).toBeTruthy();
    expect(screen.getByText('msgs · 24h')).toBeTruthy();
    // The display pin must not be implemented by silently calling back into the
    // caller's window setter — that would clobber the user's stored '30d' choice.
    expect(onWindow).not.toHaveBeenCalled();
  });

  it('reports tab changes to the caller', () => {
    const onWindow = vi.fn();
    body({ onWindow });
    fireEvent.click(screen.getByLabelText('Last 7 days'));
    expect(onWindow).toHaveBeenCalledWith('7d');
  });

  it('renders the selected window when the caller passes one', () => {
    const { container } = body({ win: '7d' });
    expect(screen.getByText('412')).toBeTruthy();
    expect(screen.getByText('in 7d')).toBeTruthy();
    expect(screen.getByText('17%')).toBeTruthy(); // (412-498)/498 rounds to -17
    expect(container.querySelectorAll('[data-testid="activity-bar"]')).toHaveLength(7);
  });

  it('hides the trend chip when there is no previous period to compare against', () => {
    const a = activity();
    a.windows['24h'] = { ...a.windows['24h'], total: 40, prevTotal: 0 };
    const { container } = body({ activity: a });
    expect(screen.getByText('40')).toBeTruthy();
    expect(container.textContent).not.toContain('%');
  });

  it('shows a real, neutral 0% chip when the period is flat, distinct from "no previous period"', () => {
    // total === prevTotal is the one input where `pct !== null` and plain truthiness
    // (`pct && …`) disagree: trendPct returns 0 here, and 0 is a legitimate value that
    // must still render — only a null trend (the test above) has no chip at all. A flat
    // period also has no direction to assert, so it must not borrow the green "up" chip
    // treatment (a live defect: pct=0 previously fell into `up = pct >= 0`).
    const a = activity();
    a.windows['24h'] = w(24, 104, 104);
    const { container } = body({ activity: a });
    expect(screen.getByText('0%')).toBeTruthy();
    expect(container.textContent).not.toContain('NaN');
    // Scoped to the chip itself (its parent element), not container-wide — both the
    // "in 24h" unit label and WindowTabs' track also use bg-cs-bg-3/text-cs-text-muted,
    // so a bare querySelector on those classes would pass regardless of the chip.
    const chip = screen.getByText('0%').parentElement;
    expect(chip?.className).toContain('text-cs-text-muted');
    expect(chip?.className).toContain('bg-cs-bg-3');
    expect(chip?.className).not.toContain('text-cs-trend-up');
    expect(chip?.className).not.toContain('text-cs-trend-down');
  });

  it('renders a zero window without NaN', () => {
    const a = activity();
    a.windows['24h'] = { buckets: new Array(24).fill(0), total: 0, prevTotal: 40, startMs: midnight };
    const { container } = body({ activity: a });
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
    expect(container.textContent).not.toContain('NaN');
    expect(container.textContent).not.toContain('Infinity');
    // textContent can't see inline styles, so it would stay green even if the
    // divide-by-zero guard in VolumeChart (Math.max(1, ...buckets)) were deleted.
    // Read the bars' own height style directly — checked as "is this a valid CSS
    // percentage" rather than "does the string contain NaN": the CSSOM silently
    // discards an invalid value like `height: NaN%` instead of storing the literal
    // text, so `bar.style.height` reads back as `''`, never as a string containing
    // "NaN", when the guard is missing. An empty/malformed value is exactly as
    // wrong as a literal NaN would have been, and this actually catches it.
    const bars = container.querySelectorAll<HTMLElement>('[data-testid="activity-bar"]');
    expect(bars.length).toBe(24);
    for (const bar of bars) {
      expect(bar.style.height).toMatch(/^\d+(\.\d+)?%$/);
    }
  });

  it('shows a placeholder for a channel that has never had a message', () => {
    body({ activity: activity({ lastTs: null }) });
    expect(screen.getByText('no activity yet')).toBeTruthy();
  });

  it('shows a placeholder while loading', () => {
    body({ activity: null, loading: true });
    expect(screen.getByText('loading…')).toBeTruthy();
  });

  it('surfaces a fetch error instead of pretending there is no activity', () => {
    body({ activity: null, loading: false, error: 'network unreachable' });
    expect(screen.getByText('network unreachable')).toBeTruthy();
    expect(screen.queryByText('no activity yet')).toBe(null);
  });

  it('falls back to the 24h window when the stored window key is out of range', () => {
    // ui-state.json is user-writable and mergeDefaults (settings.ts) takes stored
    // primitives wholesale with no validation, so a hand-edited or downgrade-written
    // file can hand us a channelActivityWindow outside {'24h','7d','30d'}. TypeScript's
    // ActivityWindowKey can't express that corrupt value, so the cast is narrowly
    // scoped to this one prop — the point of the test is that the component survives
    // it at runtime rather than throwing when it indexes activity.windows[win].
    const { container } = body({ win: '90d' as unknown as ActivityWindowKey });
    expect(screen.getByText('123')).toBeTruthy();
    expect(screen.getByText('in 24h')).toBeTruthy();
    expect(container.querySelectorAll('[data-testid="activity-bar"]')).toHaveLength(24);
    // The tabs must agree with the body. Passing the raw stored key here would
    // leave every tab unselected while the chart below showed 24h data.
    expect(screen.getByLabelText('Last 24 hours').getAttribute('data-state')).toBe('on');
  });
});

describe('ChannelActivitySection', () => {
  // Restore the store's rail width so this describe block can't leak a narrowed
  // rail into any test that happens to run later in the same module instance.
  afterEach(() => {
    act(() => {
      useStore.setState((s) => ({ ui: { ...s.ui, rightWidth: 320 } }));
    });
  });

  it('derives full vs collapsed mode from ui.rightWidth in the store, not a fixed prop', async () => {
    // Inverting `railWidth < COLLAPSE_WIDTH` to `>` puts every width on the wrong
    // side of the threshold. A test that only ever exercises ActivityBody directly
    // (passing `mode` as a prop) can't catch that — this has to render the real
    // wrapper and drive the store, on either side of COLLAPSE_WIDTH itself.
    act(() => {
      useStore.setState((s) => ({ ui: { ...s.ui, rightWidth: COLLAPSE_WIDTH + 100 } }));
    });
    render(
      <TooltipProvider>
        <ChannelActivitySection channel={channel} client={client} />
      </TooltipProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText('Last 24 hours')).toBeTruthy());

    act(() => {
      useStore.setState((s) => ({ ui: { ...s.ui, rightWidth: COLLAPSE_WIDTH - 50 } }));
    });
    await waitFor(() => expect(screen.queryByLabelText('Last 24 hours')).toBe(null));
    expect(screen.getByText('msgs · 24h')).toBeTruthy();
  });
});
