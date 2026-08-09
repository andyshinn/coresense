import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliConfirmBar } from '@/panels/repeater-admin/cli/CliConfirmBar';
import type { CliCommand } from '../../src/shared/repeater-cli/catalog';

const cmd: CliCommand = {
  name: 'reboot',
  group: 'System',
  desc: 'Reboot the node.',
  danger: true,
  note: 'The node drops off the mesh briefly.',
};

afterEach(() => vi.useRealTimers());

describe('CliConfirmBar', () => {
  it('fires onConfirm only after a full 900ms hold', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<CliConfirmBar text="reboot" cmd={cmd} onConfirm={onConfirm} onCancel={() => {}} />);
    const hold = screen.getByRole('button', { name: /hold to send/i });
    fireEvent.mouseDown(hold);
    vi.advanceTimersByTime(899);
    expect(onConfirm).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancels the hold when the pointer releases early', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<CliConfirmBar text="reboot" cmd={cmd} onConfirm={onConfirm} onCancel={() => {}} />);
    const hold = screen.getByRole('button', { name: /hold to send/i });
    fireEvent.mouseDown(hold);
    vi.advanceTimersByTime(400);
    fireEvent.mouseUp(hold);
    vi.advanceTimersByTime(1000);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows the command note and a Cancel control', () => {
    const onCancel = vi.fn();
    render(<CliConfirmBar text="reboot" cmd={cmd} onConfirm={() => {}} onCancel={onCancel} />);
    expect(screen.getByText(/drops off the mesh briefly/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
