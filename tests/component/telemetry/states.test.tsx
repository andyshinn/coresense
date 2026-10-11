import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionChips } from '../../../src/renderer/features/telemetry/PermissionChips';
import {
  failureContext,
  TelemetryEmpty,
  TelemetryFailed,
  TelemetryGuest,
  TelemetryLoading,
  TelemetryNoSensors,
  TelemetryOlderRequest,
} from '../../../src/renderer/features/telemetry/states';
import { fmtDateTime, fmtTime } from '../../../src/renderer/lib/time';
import { groups, use24h } from './helpers';

beforeEach(() => use24h());

const NOW = new Date(2026, 9, 9, 21, 42, 0).getTime();
const base = groups('01 74 01 A9')[0].readings;

describe('TelemetryLoading', () => {
  it('shows skeleton tiles and the live "waiting for reply · Ns · timeout at Ts" line', () => {
    render(<TelemetryLoading startedAt={NOW - 4_200} deadlineAt={NOW - 4_200 + 15_000} now={NOW} />);
    expect(screen.getByTestId('telemetry-waiting').textContent).toBe('waiting for reply · 4 s · timeout at 15 s');
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('omits the timeout until the deadline is known', () => {
    render(<TelemetryLoading startedAt={NOW - 2_000} deadlineAt={null} now={NOW} />);
    expect(screen.getByTestId('telemetry-waiting').textContent).toBe('waiting for reply · 2 s');
  });

  it('ticks every second on its own clock', () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      render(<TelemetryLoading startedAt={start} deadlineAt={start + 20_000} />);
      expect(screen.getByTestId('telemetry-waiting').textContent).toBe('waiting for reply · 0 s · timeout at 20 s');
      act(() => {
        vi.advanceTimersByTime(3_000);
      });
      expect(screen.getByTestId('telemetry-waiting').textContent).toBe('waiting for reply · 3 s · timeout at 20 s');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('TelemetryGuest', () => {
  it('explains base-only and offers "Log in as admin" (no ellipsis: it switches tab)', () => {
    const onLogIn = vi.fn();
    render(<TelemetryGuest readings={base} onLogIn={onLogIn} />);
    expect(screen.getByText('Base only')).toBeTruthy();
    expect(screen.getByText('Environment and location are hidden for guests. Log in as admin to see sensors.')).toBeTruthy();
    expect(screen.getByText('4.25 V')).toBeTruthy();
    fireEvent.click(screen.getByText('Log in as admin'));
    expect(onLogIn).toHaveBeenCalledTimes(1);
  });

  it('hides the action without a handler', () => {
    render(<TelemetryGuest />);
    expect(screen.queryByText('Log in as admin')).toBeNull();
  });
});

describe('TelemetryNoSensors', () => {
  it('says battery only when that is all ch 1 carried', () => {
    render(<TelemetryNoSensors readings={base} />);
    expect(screen.getByText('Battery only. This node reported no environment sensors.')).toBeTruthy();
    expect(screen.getByText('firmware detects I²C sensors at boot')).toBeTruthy();
  });

  it('drops "Battery only" when the MCU temperature came too', () => {
    render(<TelemetryNoSensors readings={groups('01 74 01 A9 01 67 01 36')[0].readings} />);
    expect(screen.getByText('This node reported no environment sensors.')).toBeTruthy();
    expect(screen.getByText('MCU temp')).toBeTruthy();
  });
});

describe('TelemetryOlderRequest', () => {
  it('shows the age chip and "Showing the saved request from HH:MM" today', () => {
    const at = NOW - 3 * 3_600_000;
    render(<TelemetryOlderRequest requestedAt={at} readings={base} now={NOW} />);
    expect(screen.getByText('3 h old')).toBeTruthy();
    expect(
      screen.getByText(`Showing the saved request from ${fmtTime(at, '24h')}. Request telemetry for current values.`),
    ).toBeTruthy();
  });

  it('uses the full date on another day, and the caller’s action name', () => {
    const at = NOW - 2 * 86_400_000;
    render(<TelemetryOlderRequest requestedAt={at} actionLabel="Read telemetry" now={NOW} />);
    expect(screen.getByText('2 d old')).toBeTruthy();
    expect(
      screen.getByText(`Showing the saved request from ${fmtDateTime(at, '24h')}. Read telemetry for current values.`),
    ).toBeTruthy();
  });
});

describe('TelemetryFailed', () => {
  const timeout = { outcome: 'timeout' as const, roundTripMs: 15_000, hops: 2, route: 'direct' as const };

  it('reads "Telemetry request failed: <reason>" with path context, Try again and Reset to flood', () => {
    const onRetry = vi.fn();
    const onReset = vi.fn();
    render(<TelemetryFailed request={timeout} onRetry={onRetry} onResetToFlood={onReset} />);
    expect(screen.getByText('Telemetry request failed: timeout')).toBeTruthy();
    expect(screen.getByText('No reply in 15 s over a 2-hop path. Try again, or reset the path to flood.')).toBeTruthy();
    fireEvent.click(screen.getByText('Try again'));
    fireEvent.click(screen.getByText('Reset to flood'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Log in')).toBeNull();
  });

  it('hides Reset to flood when the request already went flood, and offers Log in when asked', () => {
    const onLogIn = vi.fn();
    render(
      <TelemetryFailed
        request={{ ...timeout, route: 'flood', hops: null }}
        onRetry={() => {}}
        onResetToFlood={() => {}}
        onLogIn={onLogIn}
      />,
    );
    expect(screen.queryByText('Reset to flood')).toBeNull();
    expect(screen.getByText('No reply in 15 s over flood. Try again.')).toBeTruthy();
    expect(screen.getByText('Repeaters and sensors reply only to logged-in clients.')).toBeTruthy();
    fireEvent.click(screen.getByText('Log in'));
    expect(onLogIn).toHaveBeenCalledTimes(1);
  });

  it('uses the saved error as the reason and disables Try again while the radio is busy', () => {
    render(
      <TelemetryFailed
        request={{ outcome: 'error', error: 'disconnected', roundTripMs: null, hops: null, route: null }}
        onRetry={() => {}}
        retryBlockedHint="Waiting for telemetry request"
      />,
    );
    expect(screen.getByText('Telemetry request failed: disconnected')).toBeTruthy();
    const retry = screen.getByText('Try again').closest('button') as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    expect(retry.title).toBe('Waiting for telemetry request');
  });

  it('describes a direct neighbour without a hop count', () => {
    expect(failureContext({ ...timeout, hops: 0 })).toBe('No reply in 15 s to a direct neighbour.');
    expect(failureContext({ ...timeout, roundTripMs: null, route: null, hops: null })).toBe('No reply.');
  });
});

describe('TelemetryEmpty', () => {
  it('defaults to the repeater copy', () => {
    render(<TelemetryEmpty />);
    expect(screen.getByText('No telemetry yet. Click Request telemetry to ask this repeater.')).toBeTruthy();
  });

  it('takes source-aware copy and a hint', () => {
    render(
      <TelemetryEmpty
        actionLabel="Read telemetry"
        target="your radio"
        hint="Repeaters and sensors reply only to logged-in clients."
      />,
    );
    expect(screen.getByText('No telemetry yet. Click Read telemetry to ask your radio.')).toBeTruthy();
    expect(screen.getByText('Repeaters and sensors reply only to logged-in clients.')).toBeTruthy();
  });
});

describe('PermissionChips', () => {
  it('shows "Granted as admin" with every permission ticked', () => {
    render(<PermissionChips permsGranted={7} aclRole="admin" />);
    expect(screen.getByText('Granted as admin')).toBeTruthy();
    for (const p of ['Base', 'Location', 'Environment']) {
      expect(screen.getByText(p).closest('span')?.textContent).toBe(`${p} granted`);
    }
  });

  it('marks a guest’s location and environment as not granted', () => {
    render(<PermissionChips permsGranted={1} aclRole="guest" />);
    expect(screen.getByText('Granted as guest')).toBeTruthy();
    expect(screen.getByText('Base').closest('span')?.textContent).toBe('Base granted');
    expect(screen.getByText('Location').closest('span')?.textContent).toBe('Location not granted');
  });

  it('names read-only and read-write roles, and renders nothing when grants are unknown', () => {
    const { rerender, container } = render(<PermissionChips permsGranted={7} aclRole="readOnly" />);
    expect(screen.getByText('Granted as read-only')).toBeTruthy();
    rerender(<PermissionChips permsGranted={7} aclRole="readWrite" />);
    expect(screen.getByText('Granted as read-write')).toBeTruthy();
    rerender(<PermissionChips permsGranted={null} aclRole="admin" />);
    expect(container.textContent).toBe('');
  });
});
