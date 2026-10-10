import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '@/lib/store';
import { SettingsPanel } from '@/panels/settings/SettingsPanel';
import { DEFAULT_UI_STATE } from '../../src/shared/types';

// jsdom has no IntersectionObserver; the panel's scroll-spy only needs the
// constructor + observe/disconnect to exist.
beforeAll(() => {
  if (typeof globalThis.IntersectionObserver === 'undefined') {
    globalThis.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof IntersectionObserver;
  }
});

const initial = useStore.getState();

beforeEach(() => {
  useStore.setState({ ui: structuredClone(DEFAULT_UI_STATE), settingsUi: initial.settingsUi });
});

const extraPill = () => screen.getByRole('tab', { name: /Extra Tools/ });
const hasDirtyDot = (el: HTMLElement) => el.querySelector('.bg-cs-warn') !== null;

describe('SettingsPanel tab pills', () => {
  it('marks the Extra Tools pill dirty while the Packet Log section has an unsaved edit', () => {
    render(<SettingsPanel client={null} initialTab="extra" />);
    expect(hasDirtyDot(extraPill())).toBe(false);

    // Live buffer is the Extra tab's first spinbutton (see packet-log-settings.test).
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '500' } });

    expect(useStore.getState().settingsUi.dirtyById['extra-packetlog']).toBe(true);
    expect(hasDirtyDot(extraPill())).toBe(true);
  });
});
