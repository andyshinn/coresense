import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PathViewer } from '@/components/path/PathViewer';
import type { Contact, MessagePath } from '../../src/shared/types';

const repeater = (publicKeyHex: string, name: string): Contact => ({
  key: `c:${publicKeyHex}`,
  publicKeyHex,
  name,
  kind: 'repeater',
});

const path: MessagePath = {
  id: 'p1',
  hashMode: 1,
  finalSnr: 5,
  hops: [
    { kind: 'origin', shortId: 'al', name: 'Alice', pk: null },
    { kind: 'hop', shortId: 'ab', name: null, pk: null, unnamed: true },
    { kind: 'sink', shortId: 'me', name: 'My radio', pk: null },
  ],
};

describe('ConflictPanel', () => {
  // Pinning a candidate was never wired up, so the panel must not offer it:
  // no clickable candidate rows, and no copy promising a resolution.
  it('lists the clashing repeaters read-only', () => {
    render(
      <PathViewer paths={[path]} timesHeard={1} knownRepeaters={[repeater('ab01', 'Hilltop'), repeater('ab02', 'Ridge')]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '2 repeaters match this prefix — click to list them' }));

    expect(screen.getByText('Ridge')).toBeTruthy();
    expect(screen.getByText('Ridge').closest('button')).toBeNull();
    expect(screen.getByText(/any of these could have relayed it/)).toBeTruthy();
    expect(screen.queryByText(/pin the resolution/)).toBeNull();
  });
});
