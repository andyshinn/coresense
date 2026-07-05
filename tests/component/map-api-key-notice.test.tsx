import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MapApiKeyNotice } from '../../src/renderer/components/map/MapApiKeyNotice';
import { useStore } from '../../src/renderer/lib/store';

afterEach(() => {
  useStore.getState().applyMapTileStatus({ keyConfigured: false, keyRejected: false });
});

describe('MapApiKeyNotice', () => {
  it('renders the no-key prompt with a get-a-key link when no key is configured', () => {
    useStore.getState().applyMapTileStatus({ keyConfigured: false, keyRejected: false });
    render(<MapApiKeyNotice />);
    expect(screen.getByText(/API key/i)).toBeTruthy();
    const link = screen.getByRole('link', { name: /get a key/i }) as HTMLAnchorElement;
    expect(link.href).toContain('maps.protomaps.com/keys');
  });

  it('renders the rejected prompt when the key is rejected', () => {
    useStore.getState().applyMapTileStatus({ keyConfigured: true, keyRejected: true });
    render(<MapApiKeyNotice />);
    expect(screen.getByText(/rejected/i)).toBeTruthy();
  });

  it('renders nothing when a key is configured and accepted', () => {
    useStore.getState().applyMapTileStatus({ keyConfigured: true, keyRejected: false });
    const { container } = render(<MapApiKeyNotice />);
    expect(container.firstChild).toBeNull();
  });

  it('navigates to map settings when Open settings is clicked', () => {
    useStore.getState().applyMapTileStatus({ keyConfigured: false, keyRejected: false });
    render(<MapApiKeyNotice />);
    fireEvent.click(screen.getByRole('button', { name: /open .*settings/i }));
    expect(useStore.getState().ui.activeKey).toBe('tool:settings:app');
  });
});
