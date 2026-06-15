import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { SidebarMenu, SidebarProvider } from '@/components/ui/sidebar';
import { UnreadsNavItem } from '@/shell/leftnav/UnreadsNavItem';

function renderItem(props: { totalUnread: number; isActive?: boolean; onSelect?: () => void }) {
  const onSelect = props.onSelect ?? (() => {});
  return render(
    <SidebarProvider>
      <SidebarMenu>
        <UnreadsNavItem totalUnread={props.totalUnread} isActive={props.isActive ?? false} onSelect={onSelect} />
      </SidebarMenu>
    </SidebarProvider>,
  );
}

describe('UnreadsNavItem', () => {
  test('always renders the Unreads link', () => {
    renderItem({ totalUnread: 0 });
    expect(screen.queryByRole('button', { name: /unreads/i })).not.toBeNull();
  });

  test('zero unreads: dimmed "0" badge, no pulse dot', () => {
    const { container } = renderItem({ totalUnread: 0 });
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('0');
    expect(badge.className).toContain('bg-cs-bg-2');
    expect(badge.className).not.toContain('bg-cs-accent');
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  test('unreads present: accent badge with count and a pulse dot', () => {
    const { container } = renderItem({ totalUnread: 3 });
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('3');
    expect(badge.className).toContain('bg-cs-accent');
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  test('caps the badge at 99+', () => {
    renderItem({ totalUnread: 150 });
    expect(screen.getByRole('status').textContent).toBe('99+');
  });

  test('clicking the link calls onSelect', () => {
    const onSelect = vi.fn();
    renderItem({ totalUnread: 0, onSelect });
    fireEvent.click(screen.getByRole('button', { name: /unreads/i }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
