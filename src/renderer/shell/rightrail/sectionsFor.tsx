import type { Channel, Contact, Message } from '../../../shared/types';
import { SetPathEditor } from '../../components/path/SetPathEditor';
import type { ApiClient } from '../../lib/api';
import { SettingsJumpRail } from '../SettingsJumpRail';
import { Placeholder } from './atoms';
import { viewKindFor } from './helpers';
import { ChannelInfoSection } from './sections/ChannelInfo';
import { ContactCardSection } from './sections/ContactCard';
import { ContactManagerRailBody } from './sections/ContactManagerRail';
import { HeardViaSection } from './sections/HeardVia';
import {
  LogsActionsSection,
  LogsLevelSection,
  LogsLoggerSection,
  LogsSearchSection,
  LogsSourceSection,
} from './sections/LogsFilters';
import { MentionedContactSection } from './sections/MentionedContact';
import { MessageInfoSection } from './sections/MessageInfo';
import { VersionSection } from './sections/VersionSection';

export interface RailSection {
  id: string; // persisted key e.g. 'rail.channel.members'
  label: string;
  body: () => React.ReactNode;
  defaultOpen?: boolean;
}

export interface RailData {
  channel: Channel | null;
  contact: Contact | null;
  selectedMessage: Message | null;
  mentionedContact: Contact | null;
  repeaters: Contact[];
}

/** Build the ordered list of rail sections for the active view + selection state. */
export function sectionsFor(
  activeKey: string,
  data: RailData,
  actions: { clearMentionedContact: () => void; client: ApiClient | null },
): RailSection[] {
  // The Logs panel uses the rail for filter controls and actions.
  if (activeKey === 'tool:logs') {
    return [
      {
        id: 'rail.logs.level',
        label: 'Minimum level',
        defaultOpen: true,
        body: () => <LogsLevelSection />,
      },
      {
        id: 'rail.logs.source',
        label: 'Source',
        defaultOpen: true,
        body: () => <LogsSourceSection />,
      },
      {
        id: 'rail.logs.logger',
        label: 'Logger',
        defaultOpen: false,
        body: () => <LogsLoggerSection />,
      },
      {
        id: 'rail.logs.search',
        label: 'Search',
        defaultOpen: false,
        body: () => <LogsSearchSection />,
      },
      {
        id: 'rail.logs.actions',
        label: 'Actions',
        defaultOpen: true,
        body: () => <LogsActionsSection />,
      },
    ];
  }

  // The Contact Manager panel uses the rail for contextual bulk + list actions.
  if (activeKey === 'tool:contacts') {
    return [
      {
        id: 'rail.cm.actions',
        label: 'Actions',
        defaultOpen: true,
        body: () => <ContactManagerRailBody client={actions.client} />,
      },
    ];
  }

  // The Settings panel uses the rail as its section jump list — no message or
  // contact sections apply here.
  if (activeKey.startsWith('tool:settings')) {
    return [
      {
        id: 'rail.settings.jump',
        label: 'On this page',
        defaultOpen: true,
        body: () => <SettingsJumpRail />,
      },
      {
        id: 'rail.settings.version',
        label: 'Version',
        defaultOpen: true,
        body: () => <VersionSection />,
      },
    ];
  }

  // A selected message always promotes a "Message info" + "Heard via" pair at
  // the top of whichever view it belongs to.
  const sel = data.selectedMessage;
  const messageSections: RailSection[] = sel
    ? [
        {
          id: 'rail.message.info',
          label: 'Message info',
          defaultOpen: true,
          body: () => <MessageInfoSection message={sel} />,
        },
        {
          id: 'rail.message.heard',
          label: 'Heard via',
          body: () => <HeardViaSection message={sel} repeaters={data.repeaters} />,
        },
      ]
    : [];

  // A clicked @mention surfaces the mentioned contact above everything else.
  const mentioned = data.mentionedContact;
  const mentionedSections: RailSection[] = mentioned
    ? [
        {
          id: 'rail.mentioned.contact',
          label: `@${mentioned.name}`,
          defaultOpen: true,
          body: () => (
            <MentionedContactSection contact={mentioned} onClear={actions.clearMentionedContact} />
          ),
        },
      ]
    : [];

  const baseDefaultOpen = messageSections.length === 0 && mentionedSections.length === 0;
  switch (viewKindFor(activeKey)) {
    case 'channel':
      return [
        ...mentionedSections,
        ...messageSections,
        {
          id: 'rail.channel.info',
          label: 'Channel info',
          defaultOpen: baseDefaultOpen,
          body: () => <ChannelInfoSection channel={data.channel} />,
        },
        {
          id: 'rail.channel.members',
          label: 'Members',
          body: () => <Placeholder label="contacts heard in this channel" />,
        },
        {
          id: 'rail.channel.pinned',
          label: 'Pinned messages',
          body: () => <Placeholder label="pinned messages — coming in Phase 11" />,
        },
      ];
    case 'dm':
    case 'repeater':
      return [
        ...mentionedSections,
        ...messageSections,
        {
          id: 'rail.contact.card',
          label: 'Contact card',
          defaultOpen: baseDefaultOpen,
          body: () => <ContactCardSection contact={data.contact} />,
        },
        {
          id: 'rail.contact.path',
          label: 'Path',
          body: () =>
            data.contact && data.contact.publicKeyHex.length >= 64 ? (
              <SetPathEditor contact={data.contact} client={actions.client} />
            ) : (
              <Placeholder label="path editor needs a full public key (waiting on advert)" />
            ),
        },
        {
          id: 'rail.contact.advert',
          label: 'Last advert',
          body: () => <Placeholder label="advertised position, settings, hops" />,
        },
        {
          id: 'rail.contact.shared',
          label: 'Shared channels',
          body: () => <Placeholder label="channels this contact also sends to" />,
        },
      ];
    case 'packetlog':
      return [
        ...mentionedSections,
        {
          id: 'rail.packet.filter',
          label: 'Filter',
          defaultOpen: baseDefaultOpen,
          body: () => <Placeholder label="filter by kind, hex, RSSI" />,
        },
        {
          id: 'rail.packet.decoder',
          label: 'Decoder details',
          body: () => <Placeholder label="decoded fields of the selected packet" />,
        },
      ];
    default:
      return [
        ...mentionedSections,
        {
          id: 'rail.tool.placeholder',
          label: 'Details',
          defaultOpen: baseDefaultOpen,
          body: () => <Placeholder label="select a channel, contact, or message" />,
        },
      ];
  }
}
