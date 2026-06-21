import { render, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it } from 'vitest';
import { Toaster } from '../../src/renderer/components/ui/sonner';

// Regression: the toast background must reference the theme tokens that actually
// exist. The project defines Tailwind v4 `@theme` tokens (`--color-popover`,
// `--color-popover-foreground`, `--color-border`) — there is no bare
// `--popover`/`--border`/`--radius`. Referencing the bare names left the toast
// with a transparent background. Sonner only renders the styled toaster list
// once a toast is present, so we raise one and inspect the container.
describe('Toaster theme variables', () => {
  afterEach(() => toast.dismiss());

  it('maps sonner background/text/border to the defined --color-* tokens', async () => {
    render(<Toaster />);
    toast('hello');
    const el = await waitFor(() => {
      const e = document.querySelector('[data-sonner-toaster]') as HTMLElement | null;
      if (!e) throw new Error('toaster list not rendered yet');
      return e;
    });
    const style = el.getAttribute('style') ?? '';
    expect(style).toContain('--normal-bg: var(--color-popover)');
    expect(style).toContain('--normal-text: var(--color-popover-foreground)');
    expect(style).toContain('--normal-border: var(--color-border)');
  });
});
