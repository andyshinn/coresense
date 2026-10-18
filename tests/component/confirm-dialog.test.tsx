import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '@/components/ConfirmDialog';

function renderDialog() {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      open
      title="Clear discovered list"
      description="Delete 3 discovered-only contacts? On-radio contacts are kept."
      confirmLabel="Delete 3"
      tone="danger"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onCancel };
}

describe('ConfirmDialog', () => {
  it('renders the title and description and confirms on the confirm button', () => {
    const { onConfirm, onCancel } = renderDialog();
    expect(screen.getByText('Clear discovered list')).toBeTruthy();
    expect(screen.getByText('Delete 3 discovered-only contacts? On-radio contacts are kept.')).toBeTruthy();

    fireEvent.click(screen.getByText('Delete 3'));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels on the Cancel button', () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('treats Escape as Cancel', () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
