import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above the file body, so the doubles they close
// over have to be hoisted with them.
const { getAdvertPath, notify } = vi.hoisted(() => ({
  getAdvertPath: vi.fn(),
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/notify', () => ({ notify }));
vi.mock('@/lib/api', async () => {
  // ApiError is a real class the hook instanceof-checks; only the calls are doubled.
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { getAdvertPath, addToRadio: vi.fn(), setFavourite: vi.fn(), removeFromRadio: vi.fn() },
  };
});

import { ApiError } from '@/lib/api';
import { useStore } from '@/lib/store';
import { ContactDetail } from '@/shell/rightrail/sections/ContactDetail';
import { resetAdvertPathMemo } from '../../src/renderer/hooks/useAdvertPath';
import type { DiscoveredContact } from '../../src/shared/contacts/discovered';

// #45 item 7: the rail shows two hop counts. `hops` is the LEARNED OUTBOUND
// route (out_path_len) and the new one is what the radio counted on the last
// advert it HEARD. The point of the whole change is that they are different
// questions, so the rail has to say which is which.

const PK = 'd4'.repeat(32);
const client = { baseUrl: 'http://x', apiKey: 'k' };

function seed(over: Partial<DiscoveredContact> = {}): void {
  const row: DiscoveredContact = {
    key: `c:${PK}`,
    publicKeyHex: PK,
    name: 'Erin',
    kind: 'chat',
    firstHeardMs: 1_750_000_000_000,
    onRadio: true,
    favourite: false,
    blocked: false,
    ...over,
  };
  useStore.setState({ discovered: [row], contacts: [] });
}

/** The value cell of a labelled rail row. */
function rowValue(label: string): string {
  const cell = screen.getByText(label).parentElement?.querySelector('span:last-child');
  return cell?.textContent ?? '';
}

const button = () => screen.getByRole('button', { name: 'Measure heard hops' }) as HTMLButtonElement;

beforeEach(() => {
  getAdvertPath.mockReset();
  notify.success.mockReset();
  notify.info.mockReset();
  notify.error.mockReset();
  // One automatic measurement per pubkey per session is module state.
  resetAdvertPathMemo();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ContactDetail hop rows', () => {
  it('labels the two hop counts by direction and renders both', () => {
    seed({ hops: 1, observedHops: 4 });
    render(<ContactDetail publicKeyHex={PK} client={null} showPath={false} />);

    expect(rowValue('Path hops (out)')).toBe('1 hop');
    expect(rowValue('Heard hops (in)')).toContain('4 hops');
  });

  // "Flood" is a claim about the outbound route. Saying it for an inbound value
  // nobody has measured would be inventing a fact.
  it('says "not measured" rather than reusing the outbound wording', () => {
    seed({ hops: undefined });
    render(<ContactDetail publicKeyHex={PK} client={null} showPath={false} />);

    expect(rowValue('Path hops (out)')).toBe('Flood');
    expect(rowValue('Heard hops (in)')).toContain('not measured');
  });

  // The common good case, and the one a truthiness check anywhere in the chain
  // would blank.
  it('renders a zero-hop measurement as a value, not as unmeasured', () => {
    seed({ observedHops: 0 });
    render(<ContactDetail publicKeyHex={PK} client={null} showPath={false} />);

    const value = rowValue('Heard hops (in)');
    expect(value).toContain('0 hops');
    expect(value).not.toContain('not measured');
  });

  it('does not reach for the radio when there is no client', () => {
    seed();
    render(<ContactDetail publicKeyHex={PK} client={null} showPath={false} />);

    expect(button().disabled).toBe(true);
    vi.advanceTimersByTime(5_000);
    expect(getAdvertPath).not.toHaveBeenCalled();
  });
});

describe('ContactDetail measure button', () => {
  it('asks the radio and reports the hop count', async () => {
    seed();
    getAdvertPath.mockResolvedValue({ cached: true, hops: 3, pathHex: 'aabbcc' });
    render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);

    fireEvent.click(button());

    // force: an explicit press must not be answered from the server's cooldown.
    await waitFor(() => expect(getAdvertPath).toHaveBeenCalledWith(client, `c:${PK}`, { force: true }));
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Heard 3 hops away'));
  });

  it('names a direct reception rather than reporting a bare zero', async () => {
    seed();
    getAdvertPath.mockResolvedValue({ cached: true, hops: 0, pathHex: '' });
    render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);

    fireEvent.click(button());

    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Heard direct — 0 hops'));
  });

  // The radio caches only its 16 most recently heard nodes, so this is the
  // ordinary answer — informational, never an error.
  it('explains a miss without calling it a failure', async () => {
    seed();
    getAdvertPath.mockResolvedValue({ cached: false });
    render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);

    fireEvent.click(button());

    await waitFor(() => expect(notify.info).toHaveBeenCalledWith('Radio has no recent advert path for this node'));
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('tells the user to add a discovered-only contact to the radio first', async () => {
    seed({ onRadio: false });
    getAdvertPath.mockRejectedValue(new ApiError('contact is not on the radio', 422, 'NOT_ON_RADIO'));
    render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);

    fireEvent.click(button());

    await waitFor(() =>
      expect(notify.info).toHaveBeenCalledWith('Add this contact to the radio before measuring its advert path'),
    );
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('surfaces a disconnected radio as an error', async () => {
    seed();
    getAdvertPath.mockRejectedValue(new ApiError('no radio attached', 503, null));
    render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);

    fireEvent.click(button());

    await waitFor(() => expect(notify.error).toHaveBeenCalled());
    expect(notify.error.mock.calls[0][0]).toContain('no radio attached');
  });

  it('disables itself while the command is outstanding', async () => {
    seed();
    let finish!: (v: unknown) => void;
    getAdvertPath.mockReturnValue(new Promise((r) => (finish = r)));
    render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);

    fireEvent.click(button());
    await waitFor(() => expect(button().disabled).toBe(true));
    // A second press while the first is in flight must not reach the radio.
    fireEvent.click(button());
    expect(getAdvertPath).toHaveBeenCalledTimes(1);

    finish({ cached: true, hops: 1 });
    await waitFor(() => expect(button().disabled).toBe(false));
  });
});

describe('ContactDetail automatic measurement', () => {
  it('measures once the rail has settled on a contact, silently', async () => {
    seed();
    getAdvertPath.mockResolvedValue({ cached: false });
    render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);

    expect(getAdvertPath).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);

    // Not forced: an automatic pass is happy with a recent measurement.
    await waitFor(() => expect(getAdvertPath).toHaveBeenCalledWith(client, `c:${PK}`, { force: false }));
    // And it says nothing — the user did not ask for this.
    expect(notify.info).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  // Clicking down a contact list must not be one radio command per row.
  it('does not measure a contact the rail only passed through', () => {
    seed();
    const { rerender, unmount } = render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);
    vi.advanceTimersByTime(200);
    rerender(<ContactDetail publicKeyHex={'e5'.repeat(32)} client={client} showPath={false} />);
    vi.advanceTimersByTime(200);
    unmount();
    vi.advanceTimersByTime(1_000);

    expect(getAdvertPath).not.toHaveBeenCalled();
  });

  it('does not re-measure the same contact on a later visit', async () => {
    seed();
    getAdvertPath.mockResolvedValue({ cached: false });
    const first = render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);
    vi.advanceTimersByTime(600);
    await waitFor(() => expect(getAdvertPath).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);
    vi.advanceTimersByTime(600);

    expect(getAdvertPath).toHaveBeenCalledTimes(1);
  });
});
