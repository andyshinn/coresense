import { SlidersHorizontal } from 'lucide-react';
import type { AppSettings as AppSettingsType, ContactGrouping } from '../../../../shared/types';
import { NumberInput, Row, Select, Toggle } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { useStore } from '../../../lib/store';
import type { SectionProps } from '../radio/shared';
import { useSettingsSection } from '../useSectionDraft';
import { saveApp } from './shared';

const CONTACT_GROUPING_OPTIONS = [
  { value: 'nested', label: 'Nested (under Contacts)' },
  { value: 'top-level', label: 'Top-level sections' },
] as const;

const SEARCH_SORT_OPTIONS = [
  { value: 'recency', label: 'Recency (newest first)' },
  { value: 'relevance', label: 'Relevance (BM25)' },
] as const;

const eqBehavior = (a: AppSettingsType, b: AppSettingsType) =>
  a.pinUnreadToTop === b.pinUnreadToTop &&
  a.autoReconnect === b.autoReconnect &&
  a.contactGrouping === b.contactGrouping &&
  a.hideUnsyncedChannels === b.hideUnsyncedChannels &&
  a.search.defaultSort === b.search.defaultSort &&
  a.showLeftNavSearch === b.showLeftNavSearch &&
  a.leftNavCollapseLists.enabled === b.leftNavCollapseLists.enabled &&
  a.leftNavCollapseLists.limit === b.leftNavCollapseLists.limit &&
  a.unreadsPreview.enabled === b.unreadsPreview.enabled &&
  a.unreadsPreview.limit === b.unreadsPreview.limit &&
  a.commandPalette.hintWeightPct === b.commandPalette.hintWeightPct;

export function BehaviorSection({ client }: SectionProps) {
  const saved = useStore((s) => s.appSettings);
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'app-behavior',
    saved,
    eq: eqBehavior,
    onSave: (d) =>
      saveApp(
        client,
        {
          pinUnreadToTop: d.pinUnreadToTop,
          autoReconnect: d.autoReconnect,
          contactGrouping: d.contactGrouping,
          hideUnsyncedChannels: d.hideUnsyncedChannels,
          search: d.search,
          showLeftNavSearch: d.showLeftNavSearch,
          leftNavCollapseLists: d.leftNavCollapseLists,
          unreadsPreview: d.unreadsPreview,
          commandPalette: d.commandPalette,
        },
        'Behavior settings saved',
      ),
  });

  return (
    <SettingsSection
      id="app-behavior"
      icon={SlidersHorizontal}
      title="Behavior"
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <Row
        label="Pin unread to top"
        description="Sort unread channels and contacts above pinned items in the left nav."
        changed={draft.pinUnreadToTop !== saved.pinUnreadToTop}
        control={<Toggle checked={draft.pinUnreadToTop} onChange={(v) => setDraft((s) => ({ ...s, pinUnreadToTop: v }))} />}
      />
      <Row
        label="Auto-reconnect on launch"
        description="Reconnect to the last device when the app starts."
        changed={draft.autoReconnect !== saved.autoReconnect}
        control={<Toggle checked={draft.autoReconnect} onChange={(v) => setDraft((s) => ({ ...s, autoReconnect: v }))} />}
      />
      <Row
        label="Contact list grouping"
        description="Nested keeps one Contacts section with sub-groups; top-level promotes each kind to its own section."
        changed={draft.contactGrouping !== saved.contactGrouping}
        control={
          <Select
            value={draft.contactGrouping}
            options={CONTACT_GROUPING_OPTIONS}
            onChange={(grouping) => setDraft((s) => ({ ...s, contactGrouping: grouping as ContactGrouping }))}
          />
        }
      />
      <Row
        label="Hide channels not on radio"
        description="Off shows missing channels grayed-out with history preserved; on hides them entirely."
        changed={draft.hideUnsyncedChannels !== saved.hideUnsyncedChannels}
        control={
          <Toggle
            checked={draft.hideUnsyncedChannels}
            onChange={(v) => setDraft((s) => ({ ...s, hideUnsyncedChannels: v }))}
          />
        }
      />
      <Row
        label="Default search sort"
        description="Initial sort for new search sessions. The Search panel can still toggle in-session; that choice also writes back here."
        changed={draft.search.defaultSort !== saved.search.defaultSort}
        control={
          <Select
            value={draft.search.defaultSort}
            options={SEARCH_SORT_OPTIONS}
            onChange={(sort) =>
              setDraft((s) => ({
                ...s,
                search: { ...s.search, defaultSort: sort as 'recency' | 'relevance' },
              }))
            }
          />
        }
      />
      <Row
        label="Show sidebar search"
        description="Display a quick-filter field above Conversations. Cmd/Ctrl+F focuses it."
        changed={draft.showLeftNavSearch !== saved.showLeftNavSearch}
        control={
          <Toggle checked={draft.showLeftNavSearch} onChange={(v) => setDraft((s) => ({ ...s, showLeftNavSearch: v }))} />
        }
      />
      <Row
        label="Collapse long lists"
        description="Cap each LeftNav branch at a limit and add a Show-more button for the rest."
        changed={draft.leftNavCollapseLists.enabled !== saved.leftNavCollapseLists.enabled}
        control={
          <Toggle
            checked={draft.leftNavCollapseLists.enabled}
            onChange={(v) =>
              setDraft((s) => ({
                ...s,
                leftNavCollapseLists: { ...s.leftNavCollapseLists, enabled: v },
              }))
            }
          />
        }
      />
      <Row
        label="Items before Show more"
        description="Maximum rows shown under each branch before the Show-more button takes over."
        changed={draft.leftNavCollapseLists.limit !== saved.leftNavCollapseLists.limit}
        control={
          <NumberInput
            value={draft.leftNavCollapseLists.limit}
            min={1}
            max={500}
            disabled={!draft.leftNavCollapseLists.enabled}
            onChange={(v) =>
              setDraft((s) => ({
                ...s,
                leftNavCollapseLists: { ...s.leftNavCollapseLists, limit: v },
              }))
            }
          />
        }
      />
      <Row
        label="Limit Unreads previews"
        description="Cap how many unread messages each conversation card shows in the Unreads panel; the rest collapse behind a + N earlier line."
        changed={draft.unreadsPreview.enabled !== saved.unreadsPreview.enabled}
        control={
          <Toggle
            checked={draft.unreadsPreview.enabled}
            onChange={(v) =>
              setDraft((s) => ({
                ...s,
                unreadsPreview: { ...s.unreadsPreview, enabled: v },
              }))
            }
          />
        }
      />
      <Row
        label="Messages per conversation"
        description="Maximum unread messages shown per card before the rest collapse. Turn the cap off above to show every unread message."
        changed={draft.unreadsPreview.limit !== saved.unreadsPreview.limit}
        control={
          <NumberInput
            value={draft.unreadsPreview.limit}
            min={1}
            max={1000}
            disabled={!draft.unreadsPreview.enabled}
            onChange={(v) =>
              setDraft((s) => ({
                ...s,
                unreadsPreview: { ...s.unreadsPreview, limit: v },
              }))
            }
          />
        }
      />
      <Row
        label="Command palette: description weight"
        description="How strongly the palette ranks a query that matches an item's description instead of its name. 100% ranks them equally; 0% searches names only."
        changed={draft.commandPalette.hintWeightPct !== saved.commandPalette.hintWeightPct}
        control={
          <NumberInput
            value={draft.commandPalette.hintWeightPct}
            min={0}
            max={100}
            step={5}
            suffix="%"
            onChange={(v) =>
              setDraft((s) => ({
                ...s,
                commandPalette: { ...s.commandPalette, hintWeightPct: v },
              }))
            }
          />
        }
      />
    </SettingsSection>
  );
}
