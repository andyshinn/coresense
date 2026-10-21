import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The ways into My Node and its telemetry view: the owner card's name,
// battery row and popover link, the connection footer, the command palette,
// MainPane's routes, the retired tool keys, and the Settings › Radio ›
// Telemetry link row.

const { api } = vi.hoisted(() => ({
  api: {
    listTelemetry: vi.fn(async () => []),
    getSensorSettings: vi.fn(async () => ({})),
    readSelfTelemetryLive: vi.fn(() => new Promise(() => {})),
    getDeviceStats: vi.fn(() => new Promise(() => {})),
    getAdvertLink: vi.fn(() => new Promise(() => {})),
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
import { type ActiveKey, NODE_TELEMETRY_KEY } from '../../../src/shared/keys';
import { renderWithClient } from '../../support/renderWithClient';
import { seedRadio } from './helpers';

const mainPane = () =>
  renderWithClient(<MainPane onScan={() => {}} onConnect={() => {}} onDisconnect={() => {}} renderPacketLog={() => null} />);

beforeEach(() => {
  seedRadio();
  useStore.getState().setActiveKey('ch:0');
});

describe('My node entry points', () => {
  it('the owner card’s name opens My node', () => {
    renderWithClient(<OwnerCard owner={useStore.getState().owner} />);
    fireEvent.click(screen.getByTestId('owner-name').closest('button') as HTMLElement);
    expect(useStore.getState().ui.activeKey).toBe('tool:node');
  });

  it('the owner card’s battery row opens My node', () => {
    renderWithClient(<OwnerCard owner={useStore.getState().owner} />);
    const button = screen.getByText('Battery').closest('button') as HTMLElement;
    // Named for what it does, not only the readout.
    expect(button.getAttribute('aria-label')).toMatch(/^Battery .*, open My node$/);
    fireEvent.click(button);
    expect(useStore.getState().ui.activeKey).toBe('tool:node');
  });

  it('the owner card popover links to My node', () => {
    const onOpen = vi.fn();
    render(<OwnerCardPopover onOpenMyNode={onOpen} />);
    fireEvent.click(screen.getByText('Telemetry, stats and position'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('the popover has no link when no handler is given', () => {
    render(<OwnerCardPopover />);
    expect(screen.queryByText('Telemetry, stats and position')).toBeNull();
  });

  it('the command palette lists My node once, in place of My radio and BLE Connect', () => {
    expect(TOOL_ITEMS.filter((t) => t.key === 'tool:node').map((t) => t.label)).toEqual(['My node']);
    expect(TOOL_ITEMS.some((t) => (t.key as string) === 'tool:myradio' || (t.key as string) === 'tool:bleconnect')).toBe(
      false,
    );
  });

  it('MainPane routes tool:node to the My node page', async () => {
    useStore.getState().setActiveKey('tool:node');
    mainPane();
    expect(await screen.findByText('My node')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Telemetry' })).toBeTruthy();
  });

  it('MainPane routes the telemetry view, with a way back', async () => {
    useStore.getState().setActiveKey(NODE_TELEMETRY_KEY);
    mainPane();
    expect(await screen.findByText('My telemetry')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'My node' }));
    expect(useStore.getState().ui.activeKey).toBe('tool:node');
  });

  it.each(['tool:myradio', 'tool:bleconnect'])('the retired %s key lands on My node', (key) => {
    useStore.getState().setActiveKey(key as ActiveKey);
    expect(useStore.getState().ui.activeKey).toBe('tool:node');
  });

  it('opening My node closes the right rail', () => {
    useStore.setState((s) => ({ ui: { ...s.ui, rightOpen: true } }));
    useStore.getState().setActiveKey('tool:node');
    expect(useStore.getState().ui.rightOpen).toBe(false);
  });
});

describe('Settings › Radio › Telemetry link row', () => {
  it('summarises the radio’s modes and opens My node’s telemetry view', () => {
    seedRadio({ policy: { base: 2, loc: 1, env: 0 } });
    render(<TelemetrySection />);
    expect(screen.getByText('Base Everyone · Location Per contact · Environment Deny')).toBeTruthy();
    // No draft + Save any more: the modes write from the telemetry view.
    expect(screen.queryByText('Save')).toBeNull();
    expect(document.querySelector('[data-section="radio-telemetry"]')).toBeTruthy();
    fireEvent.click(screen.getByText('Open telemetry sharing'));
    expect(useStore.getState().ui.activeKey).toBe(NODE_TELEMETRY_KEY);
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
