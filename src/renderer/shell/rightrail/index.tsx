import { PanelRightClose } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import { isChannelKey, isContactKey, pubkeyFromKey } from '../../../shared/conversationKey';
import { Collapsible } from '../../components/Collapsible';
import { PacketDetailsRail } from '../../components/packet/PacketDetailsRail';
import type { ApiClient } from '../../lib/api';
import { resolveNeighbourPublicKey } from '../../lib/neighbours';
import { useStore } from '../../lib/store';
import { MapDetailsRail } from '../../panels/map/MapDetailsRail';
import { railTitle } from './helpers';
import { MacroReferenceRail } from './MacroReferenceRail';
import { ResizeHandle } from './ResizeHandle';
import { type RailData, sectionsFor } from './sectionsFor';

/** Views whose rail is a fully custom pane rather than the Collapsible section
 *  stack. One lookup both renders the pane and skips building the sections. */
const CUSTOM_RAILS: Readonly<Record<string, (client: ApiClient | null) => ReactNode>> = {
  // The Map view's right pane is a fully custom layout (search,
  // filters, last-heard slider, layer toggles, legend, or a node /
  // site card on selection) — bypass the standard Collapsible
  // sections so it matches the design's spec sheet.
  'tool:map': (client) => <MapDetailsRail client={client} />,
  // Same rationale as the map bypass above: the packet log's right
  // pane is a fully custom byte-level breakdown, not a stack of
  // collapsible label/value sections.
  'tool:packetlog': (client) => (
    <div className="h-full overflow-y-auto">
      <PacketDetailsRail client={client} />
    </div>
  ),
  // The Macros tool's right pane is the authoring Reference (variables
  // & filters) for the open studio — a full-height panel, not sections.
  'tool:macros': () => <MacroReferenceRail />,
};

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
  // snapshot equality check doesn't trip the infinite-update guard. None select
  // a whole map or slice the rail only partly reads: `messagesByKey` changes on
  // every message anywhere and `neighbours` on every row hover, and most section
  // bodies have no memo boundary, so either would re-render all of them.
  const channels = useStore((s) => s.channels);
  const contacts = useStore((s) => s.contacts);
  const selectedMessage = useStore((s) =>
    s.selectedMessageId == null
      ? null
      : (s.messagesByKey[s.ui.activeKey]?.find((m) => m.id === s.selectedMessageId) ?? null),
  );
  const selectedContactKey = useStore((s) => s.ui.selectedContactKey);
  const setSelectedContact = useStore((s) => s.setSelectedContact);
  const repeaterAdminActiveTab = useStore((s) => s.repeaterAdminActiveTab);
  const discovered = useStore((s) => s.discovered);
  const neighboursForKey = useStore((s) => s.neighbours.forKey);
  const neighbourSelectedId = useStore((s) => s.neighbours.selectedId);

  const repeaters = useMemo(() => contacts.filter((c) => c.kind === 'repeater'), [contacts]);

  const data: RailData = useMemo(() => {
    const channel = isChannelKey(activeKey) ? (channels.find((c) => c.key === activeKey) ?? null) : null;
    const contact = isContactKey(activeKey) ? (contacts.find((c) => c.key === activeKey) ?? null) : null;
    const mentionedContact = selectedContactKey ? (contacts.find((c) => c.key === selectedContactKey) ?? null) : null;
    // On a repeater's Neighbours tab with a neighbour selected, the contact card
    // targets that neighbour's resolved contact; otherwise the focal contact.
    const selectedNeighbourPk =
      contact?.kind === 'repeater' &&
      repeaterAdminActiveTab === 'neighbours' &&
      neighboursForKey === activeKey &&
      neighbourSelectedId
        ? resolveNeighbourPublicKey(neighbourSelectedId, contacts, discovered)
        : null;
    const cardPublicKeyHex = selectedNeighbourPk ?? (isContactKey(activeKey) ? pubkeyFromKey(activeKey) : null);
    return {
      channel,
      contact,
      selectedMessage,
      mentionedContact,
      repeaters,
      repeaterAdminActiveTab,
      cardPublicKeyHex,
    };
  }, [
    activeKey,
    channels,
    contacts,
    discovered,
    neighboursForKey,
    neighbourSelectedId,
    repeaters,
    selectedMessage,
    selectedContactKey,
    repeaterAdminActiveTab,
  ]);

  const customRail = Object.hasOwn(CUSTOM_RAILS, activeKey) ? CUSTOM_RAILS[activeKey] : undefined;

  const sections = useMemo(
    () =>
      // Custom-pane views never render the section stack, so don't build one.
      customRail
        ? []
        : sectionsFor(activeKey, data, {
            clearMentionedContact: () => setSelectedContact(null),
            client,
          }),
    [activeKey, customRail, data, setSelectedContact, client],
  );

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-l border-cs-border bg-cs-bg-2"
      style={{ width: `${rightWidth}px` }}
      aria-label="Detail rail"
    >
      <ResizeHandle width={rightWidth} onChange={setRightWidth} />

      <header className="flex items-center justify-between border-b border-cs-border px-3 py-2">
        <h2 className="font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">{railTitle(activeKey)}</h2>
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
        {customRail ? (
          customRail(client)
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
                  trailing={section.trailing?.()}
                  className="border-b border-cs-border last:border-b-0"
                >
                  <div className={section.bare ? 'text-xs text-cs-text-muted' : 'px-3 py-2 text-xs text-cs-text-muted'}>
                    {section.body()}
                  </div>
                </Collapsible>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
