import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ColoredUsername } from '@/components/ColoredUsername';
import { useStore } from '@/lib/store';

const contact = { key: 'c:abc', publicKeyHex: 'abc', name: 'alice', kind: 'chat' as const };

function setMode(identityColorMode: 'byKey' | 'byName') {
  useStore.setState((s) => ({ appSettings: { ...s.appSettings, identityColorMode } }));
}

beforeEach(() => {
  useStore.setState({ contacts: [], discovered: [] });
  setMode('byKey');
});

describe('ColoredUsername', () => {
  it('renders self neutrally as the selfLabel when no name/sender', () => {
    render(<ColoredUsername />);
    expect(screen.getByText('You').style.color).toBe('');
  });

  it('renders an unknown sender as "Unknown", neutral', () => {
    render(<ColoredUsername sender="unknown" />);
    expect(screen.getByText('Unknown').style.color).toBe('');
  });

  it('decodes a name-based sender', () => {
    render(<ColoredUsername sender="name:bob" />);
    expect(screen.getByText('bob')).toBeTruthy();
  });

  describe('byKey', () => {
    it('colours a poster that resolves to a saved contact', () => {
      useStore.setState({ contacts: [contact] });
      render(<ColoredUsername sender="name:alice" />);
      expect(screen.getByText('alice').style.color).toBeTruthy();
    });

    it('leaves an unresolvable poster neutral', () => {
      render(<ColoredUsername sender="name:alice" />);
      expect(screen.getByText('alice').style.color).toBe('');
    });
  });

  describe('byName', () => {
    beforeEach(() => setMode('byName'));

    it('colours a poster even with nothing saved', () => {
      render(<ColoredUsername sender="name:alice" />);
      expect(screen.getByText('alice').style.color).toBeTruthy();
    });

    it('colours a bare name prop', () => {
      render(<ColoredUsername name="carol" />);
      expect(screen.getByText('carol').style.color).toBeTruthy();
    });
  });
});
