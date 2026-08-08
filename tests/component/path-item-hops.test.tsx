import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PathItem } from '../../src/renderer/components/path/PathItem';
import { HASH_MODE_UNKNOWN } from '../../src/renderer/lib/hopWarmth';
import type { MessageHop, MessagePath } from '../../src/shared/types';

const hop = (kind: MessageHop['kind'], shortId = 'xx'): MessageHop => ({ kind, shortId });

function path(hashMode: number, hopCount: number): MessagePath {
  return {
    id: 'p',
    hashMode,
    finalSnr: 0,
    hops: [hop('origin'), ...Array.from({ length: hopCount }, () => hop('hop')), hop('sink')],
  };
}

function renderRow(p: MessagePath) {
  return render(<PathItem path={p} knownRepeaters={[]} open={false} onToggle={() => {}} />);
}

function badges(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('[data-slot="badge"]')).map((b) => b.textContent);
}

describe('PathItem hop count', () => {
  it('renders the hop count as a badge instead of "N hops" text', () => {
    const { container } = renderRow(path(2, 3));
    expect(badges(container)).toContain('3h');
    expect(container.textContent).not.toContain('3 hops');
  });

  it('pairs it with the path-hash badge for a known mode', () => {
    const { container } = renderRow(path(2, 3));
    expect(badges(container)).toContain('2b');
  });

  it('renders no hash badge for a synthesized path with no observed mode', () => {
    const { container } = renderRow(path(HASH_MODE_UNKNOWN, 3));
    expect(badges(container)).toContain('3h');
    expect(badges(container)).not.toContain('0b');
    expect(container.textContent).not.toContain('0b');
    // The `·` separator and the trailing "path" word belong to the hash badge
    // and moved inside its guard for exactly this case — otherwise an
    // unknown-mode row would render a dangling "· path". Assert the word is
    // gone too, not just the badge, or moving <span>path</span> back outside
    // the guard would still pass this test.
    expect(container.textContent).not.toContain('path');
  });
});
