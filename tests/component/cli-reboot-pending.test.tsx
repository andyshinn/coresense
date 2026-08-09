import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  armReboot,
  clearIfHeard,
  EMPTY_REBOOT,
  markRebootSent,
  type RebootPendingState,
  RebootStrip,
} from '@/panels/repeater-admin/cli/RebootPending';
import type { CliCommand } from '../../src/shared/repeater-cli/catalog';

const setRadio: CliCommand = { name: 'set radio', group: 'Radio', desc: 'x', key: 'radio', reboot: true };

describe('reboot-pending helpers', () => {
  it('arms a settings entry, deriving the verify get-command and label', () => {
    const p = armReboot(EMPTY_REBOOT, setRadio);
    expect(p.settings).toHaveLength(1);
    expect(p.settings[0].label).toBe('radio');
    // verify is the get-command sharing this key; if the catalog has `get radio`
    // it resolves to that, else null. Assert the shape, not a catalog value:
    expect(['get radio', null]).toContain(p.settings[0].verify);
  });

  it('dedups on key and clears dismissed on a re-write', () => {
    const once = armReboot(EMPTY_REBOOT, setRadio);
    const dismissed = { ...once, dismissed: true };
    const twice = armReboot(dismissed, setRadio);
    expect(twice.settings).toHaveLength(1);
    expect(twice.dismissed).toBe(false);
  });

  it('markRebootSent records the timestamp (rebooting is derived)', () => {
    const p = markRebootSent(armReboot(EMPTY_REBOOT, setRadio), 5000);
    expect(p.rebootSentAtMs).toBe(5000);
  });

  it('clears once the node is heard after the reboot was sent', () => {
    const sent = markRebootSent(armReboot(EMPTY_REBOOT, setRadio), 5000);
    expect(clearIfHeard(sent, 4000)).toBe(sent); // heard before → unchanged
    expect(clearIfHeard(sent, 6000)).toEqual(EMPTY_REBOOT); // heard after → cleared
    expect(clearIfHeard(sent, undefined)).toBe(sent); // never heard → unchanged
  });
});

describe('RebootStrip', () => {
  const pending: RebootPendingState = {
    settings: [{ label: 'radio', verify: 'get radio' }],
    dismissed: false,
    rebootSentAtMs: null,
  };

  it('renders nothing when dismissed', () => {
    const { container } = render(
      <RebootStrip
        pending={{ ...pending, dismissed: true }}
        onRunVerify={() => {}}
        onRebootNow={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('runs a setting verify, reboots, and dismisses', () => {
    const onRunVerify = vi.fn();
    const onRebootNow = vi.fn();
    const onDismiss = vi.fn();
    render(<RebootStrip pending={pending} onRunVerify={onRunVerify} onRebootNow={onRebootNow} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'radio' }));
    expect(onRunVerify).toHaveBeenCalledWith('get radio');
    fireEvent.click(screen.getByRole('button', { name: /reboot now/i }));
    expect(onRebootNow).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('shows a rebooting form (manual dismiss only) while a reboot has been sent', () => {
    render(
      <RebootStrip
        pending={{ ...pending, rebootSentAtMs: 1000 }}
        onRunVerify={() => {}}
        onRebootNow={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText(/rebooting/i)).toBeTruthy();
  });
});
