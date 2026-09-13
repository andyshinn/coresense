import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PathViewer } from '@/components/path/PathViewer';
import type { MessagePath } from '../../src/shared/types';

const path = (id: string): MessagePath => ({
  id,
  hashMode: 1,
  finalSnr: 5,
  hops: [
    { kind: 'origin', shortId: 'al', name: 'Alice', pk: null },
    { kind: 'hop', shortId: id, name: null, pk: null, unnamed: true },
    { kind: 'sink', shortId: 'me', name: 'My radio', pk: null },
  ],
});

const expanded = () => screen.getAllByRole('button').map((b) => b.getAttribute('aria-expanded'));

describe('PathViewer default open path', () => {
  it('opens the first path when no default is given (channel message paths)', () => {
    render(<PathViewer paths={[path('aa'), path('bb')]} timesHeard={2} knownRepeaters={[]} />);
    expect(expanded()).toEqual(['true', 'false']);
  });

  it('opens the named path', () => {
    render(<PathViewer paths={[path('aa'), path('bb')]} timesHeard={2} knownRepeaters={[]} defaultOpenPathId="bb" />);
    expect(expanded()).toEqual(['false', 'true']);
  });

  it('starts every path collapsed when the default is null (packet log)', () => {
    render(<PathViewer paths={[path('aa'), path('bb')]} timesHeard={2} knownRepeaters={[]} defaultOpenPathId={null} />);
    expect(expanded()).toEqual(['false', 'false']);
  });
});
