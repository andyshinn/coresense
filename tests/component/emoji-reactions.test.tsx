import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ReactionRow } from '@/features/message-actions/ReactionRow';
import { useStore } from '@/lib/store';
import { DEFAULT_UI_STATE } from '../../src/shared/types';

// ReactionRow's buttons are wrapped in Tooltip, which requires an ancestor
// TooltipProvider (supplied in the real app by AppShell's SidebarProvider).
// Isolated component tests need to supply that context explicitly.
function renderRow(props: { onPick: (emoji: string) => void }) {
  return render(
    <TooltipProvider>
      <ReactionRow {...props} />
    </TooltipProvider>,
  );
}

describe('ReactionRow', () => {
  beforeEach(() => useStore.setState({ ui: { ...DEFAULT_UI_STATE } }));

  test('renders the seed emoji when there is no usage and reports picks', () => {
    let picked = '';
    renderRow({
      onPick: (e) => {
        picked = e;
      },
    });
    const thumb = screen.getByRole('button', { name: 'Reply with 👍' });
    fireEvent.click(thumb);
    expect(picked).toBe('👍');
  });

  test('promotes a frequently used emoji to the front', () => {
    useStore.setState({ ui: { ...DEFAULT_UI_STATE, emojiUsage: { '🔥': { count: 9, lastUsedMs: Date.now() } } } });
    renderRow({ onPick: () => {} });
    expect(screen.getByRole('button', { name: 'Reply with 🔥' })).toBeTruthy();
  });
});
