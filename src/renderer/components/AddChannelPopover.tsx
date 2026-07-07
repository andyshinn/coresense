import { Hash, Key, Plus, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { Channel } from '../../shared/types';
import { type ApiClient, api } from '../lib/api';
import { notify } from '../lib/notify';
import { generate16ByteHex } from '../lib/randomSecret';
import { useStore } from '../lib/store';

type FormType = 'create-private' | 'join-private' | 'join-hashtag' | 'join-public';

type ViewState =
  | { kind: 'pick' }
  | {
      kind: 'form';
      type: FormType;
      name: string;
      secretHex: string;
      error: string | null;
      submitting: boolean;
    };

interface PickerRowProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  disabled?: boolean;
  disabledHint?: string;
  onClick: () => void;
}

function PickerRow({ icon, title, subtitle, disabled, disabledHint, onClick }: PickerRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      className="flex w-full items-center gap-3 rounded px-2.5 py-2 text-left transition-colors hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded border border-cs-border bg-cs-bg-3 text-cs-text">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-xs font-medium text-cs-text">{title}</span>
        <span className="truncate text-[10.5px] text-cs-text-dim">{subtitle}</span>
      </span>
    </button>
  );
}

interface Props {
  client: ApiClient | null;
  onClose: () => void;
}

const initialForm = (type: FormType): Extract<ViewState, { kind: 'form' }> => ({
  kind: 'form',
  type,
  name: '',
  secretHex: '',
  error: null,
  submitting: false,
});

// Strip whitespace and an optional 0x prefix, lowercase.
function normalizeHex(input: string): string {
  return input.replace(/\s+/g, '').replace(/^0x/i, '').toLowerCase();
}

const HEX_32 = /^[0-9a-f]{32}$/;

function validateName(name: string, channels: Channel[]): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Name is required';
  if (trimmed.length > 32) return 'Name must be 32 characters or fewer';
  const key = `ch:${trimmed}`;
  if (channels.some((c) => c.key === key)) {
    return `A channel named "${trimmed}" already exists`;
  }
  return null;
}

export function AddChannelPopover({ client, onClose }: Props) {
  const channels = useStore((s) => s.channels);
  const transport = useStore((s) => s.transportState);
  const setActiveKey = useStore((s) => s.setActiveKey);
  const [view, setView] = useState<ViewState>({ kind: 'pick' });

  if (transport !== 'connected') {
    return (
      <div className="flex flex-col gap-2 p-3 text-xs text-cs-text-muted">
        <span className="font-medium text-cs-text">Lost connection</span>
        <span>Reconnect a radio and try again.</span>
        <button
          type="button"
          onClick={onClose}
          className="self-start rounded border border-cs-border bg-cs-bg-3 px-2 py-1 text-cs-text hover:bg-cs-bg-2"
        >
          Close
        </button>
      </div>
    );
  }

  const publicExists = channels.some((c) => c.key === 'ch:Public');

  // PUT then push. On push failure, roll back the PUT so app and device state
  // stay in sync.
  async function submit(channel: Channel, displayName: string) {
    if (!client) return;
    try {
      await api.putChannel(client, channel);
    } catch (err) {
      throw new Error(`Couldn't save channel: ${(err as Error).message}`);
    }
    try {
      const res = await api.pushChannelToDevice(client, channel.key);
      notify.success(`Added "${displayName}" to channel slot ${res.idx}`);
      setActiveKey(channel.key);
      onClose();
    } catch (pushErr) {
      try {
        await api.deleteChannel(client, channel.key);
      } catch {
        // Rollback itself failing is non-fatal — the next radio enumeration
        // will reconcile.
      }
      throw new Error(`Couldn't push to device: ${(pushErr as Error).message}`);
    }
  }

  if (view.kind === 'pick') {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-wider text-cs-text-dim">Add channel</div>
        <PickerRow
          icon={<Plus className="size-3" />}
          title="Create private channel"
          subtitle="Generate a new shared key"
          onClick={() => setView(initialForm('create-private'))}
        />
        <PickerRow
          icon={<Key className="size-3" />}
          title="Join private channel"
          subtitle="Paste a shared key"
          onClick={() => setView(initialForm('join-private'))}
        />
        <PickerRow
          icon={<Users className="size-3" />}
          title="Join public channel"
          subtitle={publicExists ? 'Already added' : 'Anyone in range'}
          disabled={publicExists}
          disabledHint="The Public channel is already in your channel list"
          onClick={async () => {
            // One-tap: build and submit immediately. Synthesize a minimal form
            // state so a thrown error has somewhere to surface.
            const next: Extract<ViewState, { kind: 'form' }> = {
              ...initialForm('join-public'),
              name: 'Public',
              submitting: true,
            };
            setView(next);
            try {
              const channel: Channel = { key: 'ch:Public', name: 'Public', kind: 'public', createdAt: Date.now() };
              await submit(channel, 'Public');
            } catch (err) {
              setView({ ...next, submitting: false, error: (err as Error).message });
            }
          }}
        />
        <PickerRow
          icon={<Hash className="size-3" />}
          title="Join hashtag channel"
          subtitle="Open, name-keyed"
          onClick={() => setView(initialForm('join-hashtag'))}
        />
      </div>
    );
  }

  const showSecretField = view.type === 'join-private';
  const title =
    view.type === 'create-private'
      ? 'Create private channel'
      : view.type === 'join-private'
        ? 'Join private channel'
        : view.type === 'join-hashtag'
          ? 'Join hashtag channel'
          : 'Join public channel';

  // Skip duplicate-name validation while submitting: the WS channels broadcast
  // races pushChannelToDevice, so the channel we just PUT can appear in the
  // store before onClose fires, flashing a bogus "already exists" error.
  const nameError = view.name === '' || view.submitting ? null : validateName(view.name, channels);
  const trimmedName = view.name.trim();
  const normalizedSecret = normalizeHex(view.secretHex);
  const secretError =
    showSecretField && view.secretHex !== '' && !HEX_32.test(normalizedSecret)
      ? 'Shared key must be 32 hex characters (16 bytes)'
      : null;

  const canSubmit =
    !view.submitting && trimmedName.length > 0 && nameError === null && (!showSecretField || HEX_32.test(normalizedSecret));

  async function onAdd(formView: Extract<ViewState, { kind: 'form' }>) {
    if (!canSubmit) return;
    setView({ ...formView, submitting: true, error: null });

    const name = formView.name.trim();
    const key = `ch:${name}`;
    let channel: Channel;
    if (formView.type === 'create-private') {
      channel = { key, name, kind: 'private', secretHex: generate16ByteHex(), createdAt: Date.now() };
    } else if (formView.type === 'join-private') {
      channel = { key, name, kind: 'private', secretHex: normalizeHex(formView.secretHex), createdAt: Date.now() };
    } else if (formView.type === 'join-hashtag') {
      channel = { key, name, kind: 'hashtag', createdAt: Date.now() };
    } else {
      // join-public: name is fixed to 'Public', secret omitted (server derives)
      channel = { key: 'ch:Public', name: 'Public', kind: 'public', createdAt: Date.now() };
    }

    try {
      await submit(channel, name);
    } catch (err) {
      setView({ ...formView, submitting: false, error: (err as Error).message });
    }
  }

  return (
    <form
      className="flex flex-col gap-3 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (view.kind === 'form') void onAdd(view);
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-cs-text">{title}</span>
        <button
          type="button"
          onClick={() => setView({ kind: 'pick' })}
          className="text-[10px] uppercase tracking-wider text-cs-text-dim hover:text-cs-text"
          disabled={view.submitting}
        >
          Back
        </button>
      </div>

      {view.type !== 'join-public' && (
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">Name</span>
          <input
            // biome-ignore lint/a11y/noAutofocus: a popover-anchored form pulls focus on open by design
            autoFocus
            type="text"
            value={view.name}
            onChange={(e) => setView((v) => (v.kind === 'form' ? { ...v, name: e.target.value, error: null } : v))}
            maxLength={32}
            placeholder="my-channel"
            className="h-7 rounded-md border border-cs-border bg-cs-bg-3 px-2 text-xs text-cs-text outline-none focus:border-cs-accent"
          />
          {nameError && <span className="text-[10px] text-cs-danger">{nameError}</span>}
        </label>
      )}

      {showSecretField && (
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">Shared key (32 hex chars)</span>
          <input
            type="text"
            value={view.secretHex}
            onChange={(e) => setView((v) => (v.kind === 'form' ? { ...v, secretHex: e.target.value, error: null } : v))}
            placeholder="0123456789abcdef0123456789abcdef"
            spellCheck={false}
            className="h-7 rounded-md border border-cs-border bg-cs-bg-3 px-2 font-mono text-[11px] text-cs-text outline-none focus:border-cs-accent"
          />
          {secretError && <span className="text-[10px] text-cs-danger">{secretError}</span>}
        </label>
      )}

      {view.error && (
        <div className="rounded border border-cs-danger/40 bg-cs-danger/10 px-2 py-1.5 text-[11px] text-cs-danger">
          {view.error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={view.submitting}
          className="rounded border border-cs-border bg-cs-bg-3 px-3 py-1 text-xs text-cs-text-muted hover:bg-cs-bg-2 hover:text-cs-text disabled:opacity-50"
        >
          Cancel
        </button>
        {view.type !== 'join-public' && (
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded bg-cs-accent px-3 py-1 text-xs font-medium text-cs-bg disabled:cursor-not-allowed disabled:opacity-50"
          >
            {view.submitting ? 'Adding…' : 'Add'}
          </button>
        )}
      </div>
    </form>
  );
}
