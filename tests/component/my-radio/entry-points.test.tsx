import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The ways into My radio: the owner card's battery row and popover link, the
// command palette's tool entry, MainPane's route, and the Settings › Radio ›
// Telemetry link row that replaced the old draft + Save section.

const { api } = vi.hoisted(() => ({
  api: {
    listTelemetry: vi.fn(async () => []),
    getSensorSettings: vi.fn(async () => ({})),
  },
}));
vi.mock('../../../src/renderer/lib/api', async (orig) => ({
  ...(await orig<typeof import('../../../src/renderer/lib/api')>()),
  api,
}));

import { TOOL_ITEMS } from '../../../src/renderer/features/command-palette/items/tools';
import { useStore } from '../../../src/renderer/lib/store';
import { policySummary, TelemetrySection } from '../../../src/renderer/panels/settings/radio/Telemetry';
import { sectionFromActiveKey, tabFromActiveKey } from '../../../src/renderer/panels/settings/routing';
import { OwnerCard } from '../../../src/renderer/shell/leftnav/OwnerCard';
import { OwnerCardPopover } from '../../../src/renderer/shell/leftnav/OwnerCardPopover';
import { MainPane } from '../../../src/renderer/shell/MainPane';
import { client, seedRadio } from './helpers';

beforeEach(() => {
  seedRadio();
  useStore.getState().setActiveKey('ch:0');
});

describe('My radio entry points', () => {
  it('the owner card’s battery row opens My radio', () => {
    const owner = useStore.getState().owner;
    render(<OwnerCard owner={owner} client={client} />);
    const button = screen.getByText('Battery').closest('button') as HTMLElement;
    // Named for what it does, not only the readout.
    expect(button.getAttribute('aria-label')).toMatch(/^Battery .*, open My radio$/);
    fireEvent.click(button);
    expect(useStore.getState().ui.activeKey).toBe('tool:myradio');
  });

  it('the owner card popover links to My radio', () => {
    const onOpen = vi.fn();
    render(<OwnerCardPopover onOpenMyRadio={onOpen} />);
    fireEvent.click(screen.getByText('Telemetry and sensors'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('the popover has no link when no handler is given', () => {
    render(<OwnerCardPopover />);
    expect(screen.queryByText('Telemetry and sensors')).toBeNull();
  });

  it('the command palette lists My radio as a tool', () => {
    expect(TOOL_ITEMS.find((t) => t.key === 'tool:myradio')?.label).toBe('My radio');
  });

  it('MainPane routes tool:myradio to the panel', async () => {
    useStore.getState().setActiveKey('tool:myradio');
    render(
      <MainPane
        client={client}
        onScan={() => {}}
        onConnect={() => {}}
        onDisconnect={() => {}}
        renderPacketLog={() => null}
      />,
    );
    expect(await screen.findByText('My telemetry')).toBeTruthy();
    expect(screen.getByText('My radio')).toBeTruthy();
  });
});

describe('Settings › Radio › Telemetry link row', () => {
  it('summarises the radio’s modes and opens My radio', () => {
    seedRadio({ policy: { base: 2, loc: 1, env: 0 } });
    render(<TelemetrySection />);
    expect(screen.getByText('Base Everyone · Location Per contact · Environment Deny')).toBeTruthy();
    // No draft + Save any more: the modes write from My radio.
    expect(screen.queryByText('Save')).toBeNull();
    expect(document.querySelector('[data-section="radio-telemetry"]')).toBeTruthy();
    fireEvent.click(screen.getByText('Open My radio'));
    expect(useStore.getState().ui.activeKey).toBe('tool:myradio');
  });

  it('keeps the tool:settings:telemetry deep link, landing on the section', () => {
    expect(tabFromActiveKey('tool:settings:telemetry')).toBe('radio');
    expect(sectionFromActiveKey('tool:settings:telemetry')).toBe('radio-telemetry');
    expect(sectionFromActiveKey('tool:settings:position')).toBe('radio-position');
    expect(sectionFromActiveKey('tool:settings:app')).toBeUndefined();
    expect(sectionFromActiveKey('tool:settings')).toBeUndefined();
  });

  it('policySummary names every mode', () => {
    expect(policySummary({ base: 0, loc: 2, env: 1 })).toBe('Base Deny · Location Everyone · Environment Per contact');
  });
});
