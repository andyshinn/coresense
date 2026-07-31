import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { CliTab } from '@/panels/repeater-admin/CliTab';
import { EMPTY_REBOOT } from '@/panels/repeater-admin/cli/RebootPending';
import type { Contact } from '../../src/shared/types';
import { DEFAULT_RADIO_SETTINGS } from '../../src/shared/types';

const repeaterCli = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { repeaterCli: (...a: unknown[]) => repeaterCli(...a) },
}));

const contact: Contact = { key: 'c:abc', publicKeyHex: 'abc123', name: 'Repeater A', kind: 'repeater' } as Contact;

function renderTab(over: Partial<React.ComponentProps<typeof CliTab>> = {}) {
  return render(
    <CliTab
      contact={contact}
      client={{} as never}
      session={{ role: 'admin', mode: 'x' } as never}
      sessionChecked
      pending={EMPTY_REBOOT}
      onPending={() => {}}
      {...over}
    />,
  );
}

beforeEach(() => {
  repeaterCli.mockReset();
  useStore.setState({ radioSettings: DEFAULT_RADIO_SETTINGS });
  localStorage.clear();
});

const input = () => screen.getByRole('combobox') as HTMLInputElement;

describe('CliTab', () => {
  it('sends a command and shows the reply', async () => {
    repeaterCli.mockResolvedValue({ ok: true, reply: '869.525,250,11,5' });
    renderTab();
    fireEvent.change(input(), { target: { value: 'get radio' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(repeaterCli).toHaveBeenCalledWith(expect.anything(), 'c:abc', 'get radio'));
    expect(await screen.findByText('869.525,250,11,5')).toBeTruthy();
  });

  it('blocks the send and shows the banner when not an admin session', () => {
    renderTab({ session: null, sessionChecked: true });
    expect(screen.getByText(/only answers CLI from an admin session/)).toBeTruthy();
    fireEvent.change(input(), { target: { value: 'get radio' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(repeaterCli).not.toHaveBeenCalled();
  });

  it('blocks RebootStrip "Reboot now" for a non-admin session', () => {
    renderTab({
      session: null,
      sessionChecked: true,
      pending: { settings: [{ label: 'radio', verify: 'get radio' }], dismissed: false, rebootSentAtMs: null },
    });
    fireEvent.click(screen.getByRole('button', { name: /reboot now/i }));
    expect(repeaterCli).not.toHaveBeenCalled();
  });
});
