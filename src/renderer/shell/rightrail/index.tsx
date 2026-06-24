import { Box, Flex, Heading, IconButton } from '@radix-ui/themes';
import { PanelRightClose } from 'lucide-react';
import { useMemo } from 'react';
import { Collapsible } from '../../components/Collapsible';
import type { ApiClient } from '../../lib/api';
import { resolveNeighbourPublicKey } from '../../lib/neighbours';
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
  const discovered = useStore((s) => s.discovered);
  const neighbours = useStore((s) => s.neighbours);

  const data: RailData = useMemo(() => {
    const channel = activeKey.startsWith('ch:') ? (channels.find((c) => c.key === activeKey) ?? null) : null;
    const contact = activeKey.startsWith('c:') ? (contacts.find((c) => c.key === activeKey) ?? null) : null;
    const selectedMessage =
      selectedMessageId != null ? ((messagesByKey[activeKey] ?? []).find((m) => m.id === selectedMessageId) ?? null) : null;
    const mentionedContact = selectedContactKey ? (contacts.find((c) => c.key === selectedContactKey) ?? null) : null;
    const repeaters = contacts.filter((c) => c.kind === 'repeater');
    // On a repeater's Neighbours tab with a neighbour selected, the contact card
    // targets that neighbour's resolved contact; otherwise the focal contact.
    const selectedNeighbourPk =
      contact?.kind === 'repeater' &&
      repeaterAdminActiveTab === 'neighbours' &&
      neighbours.forKey === activeKey &&
      neighbours.selectedId
        ? resolveNeighbourPublicKey(neighbours.selectedId, contacts, discovered)
        : null;
    const cardPublicKeyHex = selectedNeighbourPk ?? (activeKey.startsWith('c:') ? activeKey.slice(2) : null);
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
    neighbours,
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
    <Flex
      asChild
      direction="column"
      position="relative"
      flexShrink="0"
      style={{
        width: `${rightWidth}px`,
        height: '100%',
        borderLeft: '1px solid var(--cs-border)',
        backgroundColor: 'var(--cs-bg-2)',
      }}
    >
      <aside aria-label="Detail rail">
        <ResizeHandle width={rightWidth} onChange={setRightWidth} />

        <Flex
          asChild
          align="center"
          justify="between"
          px="3"
          py="2"
          flexShrink="0"
          style={{ borderBottom: '1px solid var(--cs-border)' }}
        >
          <header>
            <Heading
              as="h2"
              size="1"
              style={{
                fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--cs-text-dim)',
              }}
            >
              {railTitle(activeKey)}
            </Heading>
            <IconButton
              variant="ghost"
              color="gray"
              size="1"
              onClick={toggleRightRail}
              title="Collapse rail (⌘.)"
              aria-label="Collapse rail"
            >
              <PanelRightClose size={12} />
            </IconButton>
          </header>
        </Flex>

        <Box flexGrow="1" overflow="hidden">
          {activeKey === 'tool:map' ? (
            // The Map view's right pane is a fully custom layout (search,
            // filters, last-heard slider, layer toggles, legend, or a node /
            // site card on selection) — bypass the standard Collapsible
            // sections so it matches the design's spec sheet.
            <MapDetailsRail client={client} />
          ) : (
            <Box overflow="auto" py="1" style={{ height: '100%' }}>
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
                    <Box px="3" py="2">
                      {section.body()}
                    </Box>
                  </Collapsible>
                );
              })}
            </Box>
          )}
        </Box>
      </aside>
    </Flex>
  );
}
