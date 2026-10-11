import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelemetryRequestList } from '../../../src/renderer/features/telemetry/TelemetryRequestList';
import { dto, PLAN_FIXTURE, use24h } from './helpers';

const NOW = new Date(2026, 9, 9, 21, 30, 0).getTime();
const t = (d: number, h: number, m: number, s: number) => new Date(2026, 9, d, h, m, s).getTime();

const requests = [
  dto('r1', t(9, 21, 29, 48), PLAN_FIXTURE),
  dto('r2', t(9, 18, 40, 11), null, { outcome: 'timeout', route: 'flood', hops: null, roundTripMs: 15_000 }),
  dto('r3', t(8, 22, 51, 9), '01 74 01 A9', { aclRole: 'guest', permsGranted: 1 }),
  dto('r4', t(5, 17, 30, 20), PLAN_FIXTURE, { hops: 1, roundTripMs: 2900 }),
];

const option = (id: string) => document.querySelector(`[data-request-id="${id}"]`) as HTMLElement;

beforeEach(() => use24h());
afterEach(() => vi.useRealTimers());

describe('TelemetryRequestList — select mode', () => {
  it('groups rows by day: Today, Yesterday, then the date', () => {
    render(<TelemetryRequestList requests={requests} selectedId="r1" onSelect={() => {}} now={NOW} />);
    const groups = Array.from(document.querySelectorAll('[role="group"]')).map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual([
      'Today',
      'Yesterday',
      new Date(t(5, 0, 0, 0)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    ]);
  });

  it('renders time with seconds, age, outcome chip and the detail line', () => {
    render(<TelemetryRequestList requests={requests} selectedId="r1" onSelect={() => {}} now={NOW} />);
    expect(screen.getByText('21:29:48')).toBeTruthy();
    expect(screen.getByText('12 s ago')).toBeTruthy();
    expect(screen.getAllByText('9 readings')).toHaveLength(2);
    expect(screen.getByText('1.8 s · 0 hops · admin')).toBeTruthy();
    expect(screen.getByText('timeout')).toBeTruthy();
    expect(screen.getByText('no reply in 15 s · flood')).toBeTruthy();
    expect(screen.getByText('1 reading')).toBeTruthy();
    expect(screen.getByText('1.8 s · 0 hops · guest · base only')).toBeTruthy();
    expect(screen.getByText('2.9 s · 1 hop · admin')).toBeTruthy();
  });

  it('marks the selected row (aria-selected, accent border) and is the only tab stop', () => {
    render(<TelemetryRequestList requests={requests} selectedId="r3" onSelect={() => {}} now={NOW} />);
    expect(option('r3').getAttribute('aria-selected')).toBe('true');
    expect(option('r3').className).toContain('border-cs-accent');
    expect(option('r1').getAttribute('aria-selected')).toBe('false');
    expect(option('r3').tabIndex).toBe(0);
    expect(option('r1').tabIndex).toBe(-1);
  });

  it('selects on click, failed rows included', () => {
    const onSelect = vi.fn();
    render(<TelemetryRequestList requests={requests} selectedId="r1" onSelect={onSelect} now={NOW} />);
    fireEvent.click(option('r2'));
    expect(onSelect).toHaveBeenCalledWith('r2');
  });

  it('moves and selects with the arrow keys, Home and End', () => {
    const onSelect = vi.fn();
    function Harness() {
      const [selected, setSelected] = useState('r1');
      return (
        <TelemetryRequestList
          requests={requests}
          selectedId={selected}
          onSelect={(id) => {
            onSelect(id);
            setSelected(id);
          }}
          now={NOW}
        />
      );
    }
    render(<Harness />);
    option('r1').focus();
    const list = screen.getByRole('listbox');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenLastCalledWith('r2');
    expect(document.activeElement).toBe(option('r2'));
    fireEvent.keyDown(list, { key: 'End' });
    expect(onSelect).toHaveBeenLastCalledWith('r4');
    fireEvent.keyDown(list, { key: 'Home' });
    expect(onSelect).toHaveBeenLastCalledWith('r1');
  });
});

describe('TelemetryRequestList — compare mode', () => {
  it('shows checkboxes; failed rows are disabled and do not toggle', () => {
    const onToggle = vi.fn();
    render(
      <TelemetryRequestList
        requests={requests}
        selectedId="r1"
        onSelect={() => {}}
        mode="compare"
        compareIds={['r1', 'r4']}
        onToggleCompare={onToggle}
        now={NOW}
      />,
    );
    const list = screen.getByRole('listbox');
    expect(list.getAttribute('aria-multiselectable')).toBe('true');
    expect(option('r1').getAttribute('aria-selected')).toBe('true');
    expect(option('r4').getAttribute('aria-selected')).toBe('true');
    expect(option('r3').getAttribute('aria-selected')).toBe('false');
    expect(option('r2').getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(option('r2'));
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.click(option('r3'));
    expect(onToggle).toHaveBeenCalledWith('r3');
  });

  it('moves the age into the detail line and skips disabled rows with the arrows', () => {
    const onToggle = vi.fn();
    const onSelect = vi.fn();
    render(
      <TelemetryRequestList
        requests={requests}
        selectedId="r1"
        onSelect={onSelect}
        mode="compare"
        compareIds={[]}
        onToggleCompare={onToggle}
        now={NOW}
      />,
    );
    expect(screen.getByText('12 s ago · admin')).toBeTruthy();
    expect(screen.getByText('no reply in 15 s · flood')).toBeTruthy();
    option('r1').focus();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(option('r3'));
    // Moving focus never toggles or selects in compare mode.
    expect(onToggle).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('disables the unticked rows at the cap, and skips them with the arrows', () => {
    const onToggle = vi.fn();
    render(
      <TelemetryRequestList
        requests={requests}
        selectedId="r1"
        onSelect={() => {}}
        mode="compare"
        compareIds={['r1', 'r4']}
        maxCompare={2}
        onToggleCompare={onToggle}
        now={NOW}
      />,
    );
    expect(option('r3').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(option('r3'));
    expect(onToggle).not.toHaveBeenCalled();
    // A ticked row can still be unticked.
    expect(option('r4').getAttribute('aria-disabled')).toBeNull();
    option('r1').focus();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(option('r4'));
    fireEvent.click(option('r4'));
    expect(onToggle).toHaveBeenCalledWith('r4');
  });
});

describe('TelemetryRequestList — its own clock', () => {
  it('advances a fresh row’s age every second, and older ones on the 30 s tick, without a parent render', () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const list = [dto('a', NOW - 5_000, PLAN_FIXTURE), dto('b', NOW - 5 * 60_000, PLAN_FIXTURE)];
    render(<TelemetryRequestList requests={list} selectedId="a" onSelect={() => {}} />);
    expect(screen.getByText('5 s ago')).toBeTruthy();
    expect(screen.getByText('5 m ago')).toBeTruthy();

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText('6 s ago')).toBeTruthy();

    // Past a minute the fresh row hands over to the list's 30 s clock.
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText('1 m ago')).toBeTruthy();
    expect(screen.getByText('6 m ago')).toBeTruthy();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText('2 m ago')).toBeTruthy();
    expect(screen.getByText('7 m ago')).toBeTruthy();
  });
});
