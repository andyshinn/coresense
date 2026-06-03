import { PanelRightClose } from 'lucide-react';
import { useMemo } from 'react';
import { Collapsible } from '../../components/Collapsible';
import type { ApiClient } from '../../lib/api';
import { useStore } from '../../lib/store';
import { MapDetailsRail } from '../../panels/map/MapDetailsRail';
import { railTitle } from './helpers';
import { ResizeHandle } from './ResizeHandle';
import { type RailData, sectionsFor } from './sectionsFor';

interface RightRailProps {
  client: ApiClient | null;
}

/** Collapsible detail rail on the right edge; orchestrates per-view section sets. */
export function RightRail({ client }: RightRailProps) {
  const activeKey = useStore((s) => s.ui.activeKey);
  const rightWidth = useStore((s) => s.ui.rightWidth);
  const openSections = useStore((s) => s.ui.openRailSections);
  const toggleRightRail = useStore((s) => s.toggleRightRail);
  const setRightWidth = useStore((s) => s.setRightWidth);
  const setRailSection = useStore((s) => s.setRailSection);

  // Each selector returns a primitive or a stable reference, so React's
  // snapshot equality check doesn't trip the infinite-update guard.
  const channels = useStore((s) => s.channels);
  const contacts = useStore((s) => s.contacts);
  const messagesByKey = useStore((s) => s.messagesByKey);
  const selectedMessageId = useStore((s) => s.selectedMessageId);
  const selectedContactKey = useStore((s) => s.ui.selectedContactKey);
  const setSelectedContact = useStore((s) => s.setSelectedContact);
  const repeaterAdminActiveTab = useStore((s) => s.repeaterAdminActiveTab);

  const data: RailData = useMemo(() => {
    const channel = activeKey.startsWith('ch:')
      ? (channels.find((c) => c.key === activeKey) ?? null)
      : null;
    const contact = activeKey.startsWith('c:')
      ? (contacts.find((c) => c.key === activeKey) ?? null)
      : null;
    const selectedMessage =
      selectedMessageId != null
        ? ((messagesByKey[activeKey] ?? []).find((m) => m.id === selectedMessageId) ?? null)
        : null;
    const mentionedContact = selectedContactKey
      ? (contacts.find((c) => c.key === selectedContactKey) ?? null)
      : null;
    const repeaters = contacts.filter((c) => c.kind === 'repeater');
    return {
      channel,
      contact,
      selectedMessage,
      mentionedContact,
      repeaters,
      repeaterAdminActiveTab,
    };
  }, [
    activeKey,
    channels,
    contacts,
    messagesByKey,
    selectedMessageId,
    selectedContactKey,
    repeaterAdminActiveTab,
  ]);

  const sections = useMemo(
    () =>
      sectionsFor(activeKey, data, {
        clearMentionedContact: () => setSelectedContact(null),
        client,
      }),
    [activeKey, data, setSelectedContact, client],
  );

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-l border-cs-border bg-cs-bg-2"
      style={{ width: `${rightWidth}px` }}
      aria-label="Detail rail"
    >
      <ResizeHandle width={rightWidth} onChange={setRightWidth} />

      <header className="flex items-center justify-between border-b border-cs-border px-3 py-2">
        <h2 className="font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">
          {railTitle(activeKey)}
        </h2>
        <button
          type="button"
          onClick={toggleRightRail}
          title="Collapse rail (⌘.)"
          aria-label="Collapse rail"
          className="rounded p-0.5 text-cs-text-dim hover:bg-cs-bg-3 hover:text-cs-text"
        >
          <PanelRightClose size={12} />
        </button>
      </header>

      <div className="flex-1 overflow-hidden">
        {activeKey === 'tool:map' ? (
          // The Map view's right pane is a fully custom layout (search,
          // filters, last-heard slider, layer toggles, legend, or a node /
          // site card on selection) — bypass the standard Collapsible
          // sections so it matches the design's spec sheet.
          <MapDetailsRail client={client} />
        ) : (
          <div className="h-full overflow-y-auto py-1">
            {sections.map((section) => {
              const open = openSections[section.id] ?? section.defaultOpen ?? true;
              return (
                <Collapsible
                  key={section.id}
                  label={section.label}
                  open={open}
                  onToggle={() => setRailSection(section.id, !open)}
                  className="border-b border-cs-border last:border-b-0"
                >
                  <div className="px-3 py-2 text-xs text-cs-text-muted">{section.body()}</div>
                </Collapsible>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
