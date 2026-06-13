import { Cog, Radio, Settings, ShieldOff, Wrench, Zap } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ApiKeySection } from '../../components/settings/ApiKeySection';
import { MapKeySection } from '../../components/settings/MapKeySection';
import type { ApiClient } from '../../lib/api';
import { type SettingsSectionMeta, type SettingsTab, useStore } from '../../lib/store';
import {
  AppearanceSection,
  BehaviorSection,
  ComposerSection,
  LoggingSection,
  NotificationsSection,
  ProxySection,
  ToastsSection,
} from './app';
import { BlockedSection } from './blocked';
import { DangerZoneSection, ImportExportSection, MaintenanceSection } from './ExtraSections';
import { type PillTab, PillTabs } from './PillTabs';
import { QuickActionsTab } from './quick-actions/QuickActionsTab';
import {
  BluetoothSection,
  ContactSettingsSection,
  DeviceInfoSection,
  ExperimentalSection,
  IdentityKeySection,
  MessageSection,
  PositionSection,
  PublicInfoSection,
  RadioSection,
  TelemetrySection,
} from './radio';
import { StatusPill } from './StatusPill';
import { UnsavedChangesDialog } from './UnsavedChangesDialog';

// Ordered section metadata per tab — drives section registration (for the
// RightRail jump list) and the IntersectionObserver scroll-spy.
const TAB_SECTIONS: Record<SettingsTab, SettingsSectionMeta[]> = {
  quickActions: [{ id: 'quickActions-actions', title: 'Owner Card Quick Actions', tab: 'quickActions' }],
  app: [
    { id: 'app-appearance', title: 'Appearance', tab: 'app' },
    { id: 'app-composer', title: 'Composer', tab: 'app' },
    { id: 'app-notifications', title: 'Notifications', tab: 'app' },
    { id: 'app-toasts', title: 'Toasts', tab: 'app' },
    { id: 'app-proxy', title: 'TCP / WS Proxy', tab: 'app' },
    { id: 'app-api-key', title: 'API Access', tab: 'app' },
    { id: 'app-behavior', title: 'Behavior', tab: 'app' },
    { id: 'app-logs', title: 'Logs', tab: 'app' },
    { id: 'app-map', title: 'Map Tiles', tab: 'app' },
  ],
  radio: [
    { id: 'radio-public-info', title: 'Public Info', tab: 'radio' },
    { id: 'radio-radio', title: 'Radio', tab: 'radio' },
    { id: 'radio-experimental', title: 'Experimental', tab: 'radio' },
    { id: 'radio-identity-key', title: 'Identity Key', tab: 'radio' },
    { id: 'radio-bluetooth', title: 'Bluetooth', tab: 'radio' },
    { id: 'radio-contacts', title: 'Contacts · Auto-add', tab: 'radio' },
    { id: 'radio-messages', title: 'Messages', tab: 'radio' },
    { id: 'radio-position', title: 'Position', tab: 'radio' },
    { id: 'radio-telemetry', title: 'Telemetry', tab: 'radio' },
    { id: 'radio-device-info', title: 'Device Info', tab: 'radio' },
  ],
  blocked: [{ id: 'blocked-rules', title: 'Blocked Senders', tab: 'blocked' }],
  extra: [
    { id: 'extra-maintenance', title: 'Maintenance', tab: 'extra' },
    { id: 'extra-import-export', title: 'Import / Export', tab: 'extra' },
    { id: 'extra-danger', title: 'Danger Zone', tab: 'extra' },
  ],
};

interface Props {
  client: ApiClient | null;
  initialTab?: SettingsTab;
  initialSection?: string;
}

export function SettingsPanel({ client, initialTab, initialSection }: Props) {
  const activeTab = useStore((s) => s.settingsUi.activeTab);
  const dirtyById = useStore((s) => s.settingsUi.dirtyById);
  const pendingScrollSectionId = useStore((s) => s.settingsUi.pendingScrollSectionId);
  const setSettingsTab = useStore((s) => s.setSettingsTab);
  const registerSettingsSections = useStore((s) => s.registerSettingsSections);
  const setActiveSettingsSection = useStore((s) => s.setActiveSettingsSection);
  const clearScrollRequest = useStore((s) => s.clearScrollRequest);
  const clearSettingsUi = useStore((s) => s.clearSettingsUi);

  const scrollRef = useRef<HTMLDivElement>(null);

  // On entry: apply the deep-linked tab/section, auto-open the rail so the jump
  // list is visible. On exit: reset the shared settings UI state.
  useEffect(() => {
    if (initialTab) setSettingsTab(initialTab);
    if (initialSection) useStore.getState().requestScrollToSection(initialSection);
    if (!useStore.getState().ui.rightOpen) useStore.getState().toggleRightRail();
    return () => clearSettingsUi();
  }, [initialTab, initialSection, setSettingsTab, clearSettingsUi]);

  // Keep the registered jump-list in sync with the visible tab.
  useEffect(() => {
    registerSettingsSections(TAB_SECTIONS[activeTab]);
  }, [activeTab, registerSettingsSections]);

  // Scroll-spy: report the topmost visible section so the jump rail highlights.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-section]'));
    if (els.length === 0) return;
    const visible = new Set<string>();
    const order = TAB_SECTIONS[activeTab].map((s) => s.id);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.section;
          if (!id) continue;
          if (e.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        const top = order.find((id) => visible.has(id));
        setActiveSettingsSection(top ?? order[0] ?? null);
      },
      { root, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    );
    for (const el of els) observer.observe(el);
    return () => observer.disconnect();
  }, [activeTab, setActiveSettingsSection]);

  // Jump-rail click → smooth-scroll the matching section into view.
  useEffect(() => {
    if (!pendingScrollSectionId) return;
    const el = scrollRef.current?.querySelector(`[data-section="${pendingScrollSectionId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    clearScrollRequest();
  }, [pendingScrollSectionId, clearScrollRequest]);

  const tabDirty = (tab: SettingsTab) => Object.entries(dirtyById).some(([id, v]) => v && id.startsWith(`${tab}-`));

  const pillTabs: PillTab<SettingsTab>[] = [
    { id: 'app', label: 'Application Settings', icon: Cog, dirty: tabDirty('app') },
    { id: 'quickActions', label: 'Quick Actions', icon: Zap, dirty: tabDirty('quickActions') },
    { id: 'radio', label: 'Radio Settings', icon: Radio, dirty: tabDirty('radio') },
    { id: 'blocked', label: 'Blocked', icon: ShieldOff, dirty: tabDirty('blocked') },
    { id: 'extra', label: 'Extra Tools', icon: Wrench },
  ];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-cs-bg">
      <header className="shrink-0 border-b border-cs-border px-7 py-3">
        <div className="mb-3 flex items-center gap-3">
          <h1 className="flex items-center gap-2 text-[15px] font-bold text-cs-text">
            <Settings className="size-4 text-cs-accent" aria-hidden />
            Settings
          </h1>
          <div className="flex-1" />
          <StatusPill tab={activeTab} />
        </div>
        <PillTabs tabs={pillTabs} active={activeTab} onChange={setSettingsTab} />
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-7 pb-10">
        {activeTab === 'app' && <AppTab client={client} />}
        {activeTab === 'quickActions' && <QuickActionsTab client={client} />}
        {activeTab === 'radio' && <RadioTab client={client} />}
        {activeTab === 'blocked' && <BlockedTab client={client} />}
        {activeTab === 'extra' && <ExtraTab client={client} />}
      </div>

      <UnsavedChangesDialog client={client} />
    </div>
  );
}

function AppTab({ client }: { client: ApiClient | null }) {
  return (
    <>
      <AppearanceSection client={client} />
      <ComposerSection client={client} />
      <NotificationsSection client={client} />
      <ToastsSection client={client} />
      <ProxySection client={client} />
      <ApiKeySection client={client} />
      <BehaviorSection client={client} />
      <LoggingSection client={client} />
      <MapKeySection client={client} />
    </>
  );
}

function RadioTab({ client }: { client: ApiClient | null }) {
  const connected = useStore((s) => s.transportState === 'connected');
  return (
    <>
      {!connected && (
        <div className="mt-4 rounded border border-cs-border bg-cs-bg-2 px-3 py-2 text-[11px] text-cs-text-dim">
          No radio connected — radio changes save app-side only and apply on next connect.
        </div>
      )}
      <PublicInfoSection client={client} />
      <RadioSection client={client} />
      <ExperimentalSection client={client} />
      <IdentityKeySection />
      <BluetoothSection />
      <ContactSettingsSection client={client} />
      <MessageSection client={client} />
      <PositionSection client={client} />
      <TelemetrySection client={client} />
      <DeviceInfoSection client={client} />
    </>
  );
}

function BlockedTab({ client }: { client: ApiClient | null }) {
  return <BlockedSection client={client} />;
}

function ExtraTab({ client }: { client: ApiClient | null }) {
  return (
    <>
      <MaintenanceSection client={client} />
      <ImportExportSection />
      <DangerZoneSection />
    </>
  );
}
