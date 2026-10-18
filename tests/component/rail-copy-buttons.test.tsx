import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/notify', () => import('../support/notifyMock'));

import { useStore } from '@/lib/store';
import { ContactDetail } from '@/shell/rightrail/sections/ContactDetail';
import { VersionSection } from '@/shell/rightrail/sections/VersionSection';
import type { DiscoveredContact } from '../../src/shared/contacts/discovered';
import type { Capabilities } from '../../src/shared/types';
import { notify, resetNotifyMock } from '../support/notifyMock';

// The rail's copy affordances confirm with CopyButton's anchored "Copied!"
// popover, like every other inline copyable value, rather than a toast
// (ContactDetail) or a hand-rolled icon swap (VersionSection).

const PK = 'e5'.repeat(32);

const capabilities: Capabilities = {
  isElectron: true,
  version: '0.0.14',
  gitSha: 'abc1234',
  electronVersion: '44.3.0',
  chromeVersion: '140.0.0.0',
  platform: 'darwin',
  httpPort: 0,
  configPath: '/tmp/config.json',
  logsFolder: '/tmp/logs',
  logsCurrentFile: '/tmp/logs/today.log',
};

const originalClipboard = navigator.clipboard;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  resetNotifyMock();
});

afterEach(() => {
  Object.assign(navigator, { clipboard: originalClipboard });
});

describe('rail copy buttons', () => {
  it('copies the contact public key and confirms in a popover, not a toast', async () => {
    const row: DiscoveredContact = {
      key: `c:${PK}`,
      publicKeyHex: PK,
      name: 'Erin',
      kind: 'chat',
      firstHeardMs: 1_750_000_000_000,
      onRadio: true,
      favourite: false,
      blocked: false,
    };
    useStore.setState({ discovered: [row], contacts: [] });
    render(<ContactDetail publicKeyHex={PK} showPath={false} />);

    fireEvent.click(screen.getByTitle(`${PK} — click to copy`));

    expect(writeText).toHaveBeenCalledWith(PK);
    expect(await screen.findByText('Copied!')).toBeTruthy();
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('copies the build SHA and confirms in a popover', async () => {
    useStore.setState({ capabilities });
    render(<VersionSection />);

    fireEvent.click(screen.getByTitle('Click to copy'));

    expect(writeText).toHaveBeenCalledWith('abc1234');
    expect(await screen.findByText('Copied!')).toBeTruthy();
  });
});
