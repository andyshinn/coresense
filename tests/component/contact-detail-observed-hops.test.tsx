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

function makeRow(publicKeyHex: string, over: Partial<DiscoveredContact> = {}): DiscoveredContact {
  return {
    key: `c:${publicKeyHex}`,
    publicKeyHex,
    name: 'Erin',
    kind: 'chat',
    firstHeardMs: 1_750_000_000_000,
    onRadio: true,
    favourite: false,
    blocked: false,
    ...over,
  };
}

function seed(over: Partial<DiscoveredContact> = {}): void {
  useStore.setState({ discovered: [makeRow(PK, over)], contacts: [] });
}

/** Both contacts in the pool, so the rail resolves either focus. */
function seedPair(other: string): void {
  useStore.setState({ discovered: [makeRow(PK), makeRow(other, { name: 'Frank' })], contacts: [] });
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

  // The radio's other empty answer: it holds an entry for this node and cached
  // no path for it. Before meshcore-ts 0.8.1 made the sentinel visible this
  // toasted "Heard direct — 0 hops"; calling it a miss would be only slightly
  // less wrong, because the same reply can move the row's Last heard.
  it('separates "no path cached" from "nothing cached"', async () => {
    seed();
    getAdvertPath.mockResolvedValue({ cached: false, reason: 'noPath', recvTimestampUnix: 1_760_000_000 });
    render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);

    fireEvent.click(button());

    await waitFor(() =>
      expect(notify.info).toHaveBeenCalledWith('Radio heard this node but cached no path for it — hop count unknown'),
    );
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
    // A miss the radio itself reported: that is an answer, and it spends the
    // attempt.
    getAdvertPath.mockResolvedValue({ cached: false, fromCache: false });
    const first = render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);
    vi.advanceTimersByTime(600);
    await waitFor(() => expect(getAdvertPath).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);
    vi.advanceTimersByTime(600);

    expect(getAdvertPath).toHaveBeenCalledTimes(1);
  });
});

// The memo above is "one automatic attempt per contact per session". It used to
// be armed BEFORE the request went out, which spent that single attempt on
// things that never reached the radio at all — and left the row reading "not
// measured" for the rest of the session with only the 12px refresh icon to fix
// it. Both triggers below are ordinary, not edge cases: the rail focuses a
// contact as soon as the LOCAL api server answers, which is seconds before a
// BLE link exists, and the in-flight guard was a bare boolean on a component
// instance the rail re-uses as the focus moves.
describe('ContactDetail automatic measurement — a spent attempt must have happened', () => {
  it('re-measures after an automatic attempt the radio never answered', async () => {
    seed();
    getAdvertPath.mockRejectedValueOnce(new ApiError('no radio attached', 503, null));
    const first = render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);
    vi.advanceTimersByTime(600);
    await waitFor(() => expect(getAdvertPath).toHaveBeenCalledTimes(1));
    // Still silent: an automatic pass must not toast about a radio that is not
    // there yet.
    expect(notify.error).not.toHaveBeenCalled();
    first.unmount();

    // The radio is up now. The contact has not used its attempt.
    getAdvertPath.mockResolvedValue({ cached: true, hops: 2, pathHex: 'aabb' });
    render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);
    vi.advanceTimersByTime(600);

    await waitFor(() => expect(getAdvertPath).toHaveBeenCalledTimes(2));
  });

  // The server answers a non-forced request inside its per-contact cooldown from
  // the sqlite mirror, without a radio command, and a miss writes no row — so a
  // cooldown armed by a request that timed out (or by the advert sampler's)
  // comes back as a 200 miss the radio never said. Counting that as the
  // contact's one automatic attempt left it "not measured" for the session.
  it('re-measures after a miss the server answered from its cooldown, not the radio', async () => {
    seed();
    getAdvertPath.mockResolvedValueOnce({ cached: false, fromCache: true });
    const first = render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);
    vi.advanceTimersByTime(600);
    await waitFor(() => expect(getAdvertPath).toHaveBeenCalledTimes(1));
    first.unmount();

    getAdvertPath.mockResolvedValue({ cached: true, hops: 2, pathHex: 'aabb', fromCache: false });
    render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);
    vi.advanceTimersByTime(600);

    await waitFor(() => expect(getAdvertPath).toHaveBeenCalledTimes(2));
  });

  it('re-measures a contact that was not on the radio when we first asked', async () => {
    seed({ onRadio: false });
    getAdvertPath.mockRejectedValueOnce(new ApiError('contact is not on the radio', 422, 'NOT_ON_RADIO'));
    const first = render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);
    vi.advanceTimersByTime(600);
    await waitFor(() => expect(getAdvertPath).toHaveBeenCalledTimes(1));
    first.unmount();

    // One "Add to radio" click later it is measurable, and the attempt it never
    // really got is still available.
    seed({ onRadio: true });
    getAdvertPath.mockResolvedValue({ cached: false });
    render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);
    vi.advanceTimersByTime(600);

    await waitFor(() => expect(getAdvertPath).toHaveBeenCalledTimes(2));
  });

  it('does not let one contact in flight swallow the next one clicked', async () => {
    const OTHER = 'e5'.repeat(32);
    seed();
    // A command the radio is still chewing on — up to the lib's 5s timeout.
    let finish!: (v: unknown) => void;
    getAdvertPath.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const view = render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);
    vi.advanceTimersByTime(600);
    await waitFor(() => expect(getAdvertPath).toHaveBeenCalledTimes(1));

    // Same component instance, new focus: the rail renders ContactDetail at a
    // stable tree position and only changes the prop.
    getAdvertPath.mockResolvedValue({ cached: false });
    view.rerender(<ContactDetail publicKeyHex={OTHER} client={client} showPath={false} />);
    vi.advanceTimersByTime(600);

    await waitFor(() => expect(getAdvertPath).toHaveBeenCalledWith(client, `c:${OTHER}`, { force: false }));
    finish({ cached: true, hops: 1 });
  });

  it('still measures a contact whose turn came while another was outstanding', async () => {
    const OTHER = 'e5'.repeat(32);
    seed();
    let finish!: (v: unknown) => void;
    getAdvertPath.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const view = render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);
    vi.advanceTimersByTime(600);
    await waitFor(() => expect(getAdvertPath).toHaveBeenCalledTimes(1));

    // Focus moves to OTHER and back before the first command comes home. OTHER
    // must not have been marked measured by an attempt that never ran.
    getAdvertPath.mockResolvedValue({ cached: false });
    view.rerender(<ContactDetail publicKeyHex={OTHER} client={client} showPath={false} />);
    vi.advanceTimersByTime(600);
    await waitFor(() => expect(getAdvertPath).toHaveBeenCalledTimes(2));
    finish({ cached: true, hops: 1 });

    const calls = getAdvertPath.mock.calls.map((c) => c[1]);
    expect(calls).toContain(`c:${PK}`);
    expect(calls).toContain(`c:${OTHER}`);
  });

  it('lets the button through for a contact a previous measurement is blocking', async () => {
    const OTHER = 'e5'.repeat(32);
    seedPair(OTHER);
    let finish!: (v: unknown) => void;
    getAdvertPath.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const view = render(<ContactDetail publicKeyHex={PK} client={client} showPath={false} />);
    vi.advanceTimersByTime(600);
    await waitFor(() => expect(getAdvertPath).toHaveBeenCalledTimes(1));

    view.rerender(<ContactDetail publicKeyHex={OTHER} client={client} showPath={false} />);
    getAdvertPath.mockResolvedValue({ cached: true, hops: 3, pathHex: 'aabbcc' });
    fireEvent.click(button());

    // Forced, reported, and not silently dropped on the previous contact's
    // in-flight flag.
    await waitFor(() => expect(getAdvertPath).toHaveBeenCalledWith(client, `c:${OTHER}`, { force: true }));
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Heard 3 hops away'));
    finish({ cached: true, hops: 1 });
  });
});
