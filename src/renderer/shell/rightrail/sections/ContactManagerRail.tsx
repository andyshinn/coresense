import {
  ChevronLeftIcon,
  DownloadIcon,
  GearIcon,
  MinusIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  UploadIcon,
} from '@radix-ui/react-icons';
import { AlertDialog, Box, Button, DataList, Flex, Grid, Text } from '@radix-ui/themes';
import { Ban } from 'lucide-react';
import { useState } from 'react';
import { BlockSenderDialog } from '../../../components/BlockSenderDialog';
import { KeyValueRow } from '../../../components/ui/KeyValueRow';
import { type ApiClient, api } from '../../../lib/api';
import { deriveContactView } from '../../../lib/contactManagerView';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { ContactDetail } from './ContactDetail';

type Tone = 'danger' | 'accent' | undefined;

type RadixIconComponent = React.FC<{ width?: number | string; height?: number | string }>;

function RailActionButton({
  icon: Icon,
  label,
  sub,
  onClick,
  tone,
  disabled,
}: {
  icon: RadixIconComponent | React.FC<{ size?: number; className?: string }>;
  label: string;
  sub?: string;
  onClick: () => void;
  tone?: Tone;
  disabled?: boolean;
}) {
  const iconColor: React.ComponentProps<typeof Text>['color'] =
    tone === 'danger' ? 'red' : tone === 'accent' ? 'amber' : 'gray';

  return (
    <Button
      variant="surface"
      size="1"
      color={tone === 'danger' ? 'red' : tone === 'accent' ? 'amber' : undefined}
      onClick={onClick}
      disabled={disabled}
      style={{ width: '100%', justifyContent: 'flex-start', height: 'auto', padding: '6px 10px' }}
    >
      <Text color={iconColor} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <Icon width={16} height={16} />
      </Text>
      <Flex direction="column" align="start" minWidth="0">
        <Text size="1">{label}</Text>
        {sub ? (
          <Text size="1" style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--cs-text-dim)' }}>
            {sub}
          </Text>
        ) : null}
      </Flex>
    </Button>
  );
}

function SubHeader({ children }: { children: React.ReactNode }) {
  return (
    <Text
      size="1"
      style={{
        fontFamily: 'var(--font-mono)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--cs-text-dim)',
        fontSize: 10,
      }}
    >
      {children}
    </Text>
  );
}

function BulkActions({ client }: { client: ApiClient | null }) {
  const selected = useStore((s) => s.contactManager.selected);
  const clearCmSelected = useStore((s) => s.clearCmSelected);
  const n = selected.length;

  async function run(fn: () => Promise<void>, successMsg: string) {
    if (!client) return;
    try {
      await fn();
      clearCmSelected();
      notify.success(successMsg);
    } catch (err) {
      notify.error(`Action failed: ${(err as Error).message}`, err);
    }
  }

  return (
    <Flex direction="column" gap="3">
      <Flex align="center" justify="between">
        <SubHeader>Selection</SubHeader>
        <Text size="1" style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--cs-text-dim)' }}>
          {n} selected
        </Text>
      </Flex>
      <Flex direction="column" gap="2">
        <RailActionButton
          icon={PlusIcon}
          label="Add to radio"
          sub={`${n} contact${n === 1 ? '' : 's'}`}
          tone="accent"
          disabled={!client}
          onClick={() =>
            run(
              async () => {
                if (!client) return;
                await Promise.all(selected.map((pk) => api.addToRadio(client, pk)));
              },
              `Added ${n} contact${n === 1 ? '' : 's'} to radio`,
            )
          }
        />
        <RailActionButton
          icon={MinusIcon}
          label="Remove from radio"
          disabled={!client}
          onClick={() =>
            run(
              async () => {
                if (!client) return;
                await Promise.all(selected.map((pk) => api.removeFromRadio(client, pk)));
              },
              `Removed ${n} contact${n === 1 ? '' : 's'} from radio`,
            )
          }
        />
        <RailActionButton
          icon={StarIcon}
          label="Favourite"
          sub="never auto-pruned"
          disabled={!client}
          onClick={() =>
            run(
              async () => {
                if (!client) return;
                await Promise.all(selected.map((pk) => api.setFavourite(client, pk, true)));
              },
              `Favourited ${n} contact${n === 1 ? '' : 's'}`,
            )
          }
        />
        <RailActionButton
          icon={Ban}
          label="Block selected"
          tone="danger"
          disabled={!client}
          onClick={() =>
            run(
              async () => {
                if (!client) return;
                const rules = selected.map((pk) => ({
                  type: 'pubkey' as const,
                  pattern: pk,
                  tsFrom: 0,
                  enabled: true,
                }));
                await api.addBlockRules(client, rules);
              },
              `Blocked ${n} contact${n === 1 ? '' : 's'}`,
            )
          }
        />
      </Flex>
      <Button variant="ghost" size="1" color="gray" onClick={clearCmSelected} style={{ alignSelf: 'flex-start' }}>
        Clear selection
      </Button>
    </Flex>
  );
}

const PRUNE_OPTIONS: Array<{ label: string; ms: number }> = [
  { label: '7 days', ms: 604_800_000 },
  { label: '1 month', ms: 2_592_000_000 },
  { label: '3 months', ms: 7_776_000_000 },
  { label: '6 months', ms: 15_552_000_000 },
];

function ListActions({ client }: { client: ApiClient | null }) {
  const discovered = useStore((s) => s.discovered);
  const cm = useStore((s) => s.contactManager);
  const blockRulesCount = useStore((s) => s.blockRules.length);
  const [showClear, setShowClear] = useState(false);
  const [showBlock, setShowBlock] = useState(false);

  const view = deriveContactView(discovered, cm, Date.now());
  const rows = view.rows;
  const discoveredOnly = rows.filter((c) => !c.onRadio && !c.blocked);
  const onRadioRows = rows.filter((c) => c.onRadio);
  const clearCount = discovered.filter((d) => !d.onRadio).length;

  async function addAllFiltered() {
    if (!client) return;
    try {
      await Promise.all(discoveredOnly.map((c) => api.addToRadio(client, c.publicKeyHex)));
      notify.success(`Added ${discoveredOnly.length} contact${discoveredOnly.length === 1 ? '' : 's'} to radio`);
    } catch (err) {
      notify.error(`Action failed: ${(err as Error).message}`, err);
    }
  }

  async function removeAllFiltered() {
    if (!client) return;
    try {
      await Promise.all(onRadioRows.map((c) => api.removeFromRadio(client, c.publicKeyHex)));
      notify.success(`Removed ${onRadioRows.length} contact${onRadioRows.length === 1 ? '' : 's'} from radio`);
    } catch (err) {
      notify.error(`Action failed: ${(err as Error).message}`, err);
    }
  }

  async function prune(thresholdMs: number, label: string) {
    if (!client) return;
    const now = Date.now();
    const stale = discovered.filter(
      (d) => d.onRadio && !d.favourite && d.lastAdvertMs != null && now - d.lastAdvertMs > thresholdMs,
    );
    if (stale.length === 0) {
      notify.info(`No contacts older than ${label}`);
      return;
    }
    try {
      await Promise.all(stale.map((d) => api.removeFromRadio(client, d.publicKeyHex)));
      notify.success(`Pruned ${stale.length} contact${stale.length === 1 ? '' : 's'} older than ${label}`);
    } catch (err) {
      notify.error(`Prune failed: ${(err as Error).message}`, err);
    }
  }

  async function clearDiscovered() {
    if (!client) return;
    try {
      await api.clearDiscovered(client);
      notify.success(`Cleared ${clearCount} discovered contact${clearCount === 1 ? '' : 's'}`);
    } catch (err) {
      notify.error(`Clear failed: ${(err as Error).message}`, err);
    } finally {
      setShowClear(false);
    }
  }

  return (
    <Flex direction="column" gap="3">
      <Flex direction="column" gap="2">
        <Flex align="center" justify="between">
          <SubHeader>Quick actions</SubHeader>
          <Text size="1" style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--cs-text-dim)' }}>
            FILTERED · {rows.length} shown
          </Text>
        </Flex>
        <Flex direction="column" gap="2">
          <RailActionButton
            icon={PlusIcon}
            label="Add all filtered"
            sub={`${discoveredOnly.length} → radio`}
            tone="accent"
            disabled={!client}
            onClick={addAllFiltered}
          />
          <RailActionButton icon={MinusIcon} label="Remove all filtered" disabled={!client} onClick={removeAllFiltered} />
        </Flex>
      </Flex>

      <Flex direction="column" gap="2">
        <SubHeader>Prune older than</SubHeader>
        <Grid columns="2" gap="2">
          {PRUNE_OPTIONS.map((opt) => (
            <Button
              key={opt.label}
              variant="surface"
              size="1"
              color="gray"
              disabled={!client}
              onClick={() => prune(opt.ms, opt.label)}
              style={{ justifyContent: 'flex-start' }}
            >
              <TrashIcon width={14} height={14} />
              {opt.label}
            </Button>
          ))}
        </Grid>
      </Flex>

      <Box style={{ borderTop: '1px solid var(--cs-border)', paddingTop: 'var(--space-3)' }}>
        <Flex direction="column" gap="2">
          <Grid columns="2" gap="2">
            <RailActionButton icon={UploadIcon} label="Import" onClick={() => notify.info('Import JSON — coming soon')} />
            <RailActionButton icon={DownloadIcon} label="Export" onClick={() => notify.info('Export JSON — coming soon')} />
          </Grid>
          <RailActionButton
            icon={TrashIcon}
            label="Clear discovered list"
            sub="keeps on-radio contacts"
            tone="danger"
            disabled={!client}
            onClick={() => setShowClear(true)}
          />
        </Flex>
      </Box>

      <Box style={{ borderTop: '1px solid var(--cs-border)', paddingTop: 'var(--space-3)' }}>
        <RailActionButton
          icon={Ban}
          label="Add block rule"
          sub={`${blockRulesCount} active`}
          tone="danger"
          disabled={!client}
          onClick={() => setShowBlock(true)}
        />
      </Box>

      {/* Clear dialog: closes in finally{} (success + failure), so AlertDialog.Action is safe —
          Radix closes the dialog synchronously before the handler fires, and finally{} runs after. */}
      <AlertDialog.Root open={showClear} onOpenChange={(open) => !open && setShowClear(false)}>
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>Clear discovered list</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Delete {clearCount} discovered-only contact{clearCount === 1 ? '' : 's'}? On-radio contacts are kept.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" onClick={() => void clearDiscovered()}>
                Delete {clearCount}
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      {showBlock && <BlockSenderDialog client={client} open prefill={{}} onClose={() => setShowBlock(false)} />}
    </Flex>
  );
}

/** Contextual right-rail body for the Contact Manager: bulk actions when rows
 *  are selected, the focused contact's detail when a single row is focused,
 *  otherwise list-wide actions. */
export function ContactManagerRailBody({ client }: { client: ApiClient | null }) {
  const selected = useStore((s) => s.contactManager.selected);
  const focusKey = useStore((s) => s.contactManager.focusKey);
  const setCmFocus = useStore((s) => s.setCmFocus);

  if (selected.length > 0) return <BulkActions client={client} />;
  if (focusKey) {
    return (
      <Flex direction="column" gap="2">
        <Button variant="ghost" size="1" color="gray" onClick={() => setCmFocus(null)} style={{ alignSelf: 'flex-start' }}>
          <ChevronLeftIcon width={14} height={14} aria-hidden="true" />
          Back to list actions
        </Button>
        <ContactDetail publicKeyHex={focusKey} client={client} />
      </Flex>
    );
  }
  return <ListActions client={client} />;
}

const AUTO_ADD_KINDS: Array<{ key: 'chat' | 'repeater' | 'room' | 'sensor'; label: string }> = [
  { key: 'chat', label: 'Users' },
  { key: 'repeater', label: 'Repeaters' },
  { key: 'room', label: 'Rooms' },
  { key: 'sensor', label: 'Sensors' },
];

/** Read-only summary of the radio's auto-add (discovery) config, mirroring the
 *  Radio settings panel (same `autoAddConfig` store slice), plus a jump to edit
 *  it there. Shown as its own rail header so the current behaviour is visible
 *  without leaving the Contact Manager. */
export function DiscoverySettings() {
  const cfg = useStore((s) => s.autoAddConfig);
  const setActiveKey = useStore((s) => s.setActiveKey);

  const autoAddLabel =
    cfg.mode === 'all'
      ? 'All node types'
      : AUTO_ADD_KINDS.filter((k) => cfg[k.key])
          .map((k) => k.label)
          .join(', ') || 'None';

  return (
    <Flex direction="column" gap="3">
      <DataList.Root orientation="horizontal" size="1">
        <KeyValueRow label="Auto-add" value={autoAddLabel} />
        <KeyValueRow label="Overwrite oldest" value={cfg.overwriteOldest ? 'On' : 'Off'} />
        <KeyValueRow label="Max hops" value={cfg.maxHops == null ? 'No limit' : String(cfg.maxHops)} mono />
      </DataList.Root>
      <RailActionButton
        icon={GearIcon}
        label="Auto-Add settings"
        sub="edit in Radio settings"
        onClick={() => setActiveKey('tool:settings:radio')}
      />
    </Flex>
  );
}
