import {
  Activity,
  ListTree,
  LogIn,
  LogOut,
  Radio,
  ShieldCheck,
  Spline,
  TerminalSquare,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Contact, RepeaterAdminSession } from '../../../shared/types';
import { RssiChip } from '../../components/RssiChip';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { type RepeaterAdminTab, useStore } from '../../lib/store';
import { AclTab } from './AclTab';
import { CliTab } from './CliTab';
import { LoginTab } from './LoginTab';
import { NeighboursTab } from './NeighboursTab';
import { OwnerTab } from './OwnerTab';
import { PathTab } from './PathTab';
import { StatusTab } from './StatusTab';

type TabId = RepeaterAdminTab;

interface Props {
  contact: Contact;
  client: ApiClient | null;
}

const TABS: Array<{ id: TabId; label: string; icon: typeof Radio; adminOnly?: boolean }> = [
  { id: 'login', label: 'Login', icon: LogIn },
  { id: 'path', label: 'Path', icon: Spline },
  { id: 'status', label: 'Status', icon: Activity },
  { id: 'acl', label: 'ACL', icon: ShieldCheck, adminOnly: true },
  { id: 'neighbours', label: 'Neighbours', icon: Users },
  { id: 'owner', label: 'Owner', icon: ListTree },
  { id: 'cli', label: 'CLI', icon: TerminalSquare },
];

export function RepeaterAdmin({ contact, client }: Props) {
  const [tab, setTab] = useState<TabId>('login');
  const pendingTab = useStore((s) => s.repeaterAdminTab);
  const setRepeaterAdminTab = useStore((s) => s.setRepeaterAdminTab);
  const setRepeaterAdminActiveTab = useStore((s) => s.setRepeaterAdminActiveTab);

  // Publish the open tab so the right rail can show the Neighbours list section
  // when this panel is on the Neighbours tab. Clear it when the panel unmounts.
  useEffect(() => {
    setRepeaterAdminActiveTab(tab);
    return () => setRepeaterAdminActiveTab(null);
  }, [tab, setRepeaterAdminActiveTab]);

  // Apply a deep-link target requested by the contact-detail panel, then clear
  // it so a later manual tab change isn't reverted. Runs whether the panel was
  // just mounted (navigated in) or was already showing this repeater.
  useEffect(() => {
    if (pendingTab) {
      setTab(pendingTab);
      setRepeaterAdminTab(null);
    }
  }, [pendingTab, setRepeaterAdminTab]);
  const [session, setSession] = useState<RepeaterAdminSession | null>(null);

  // Fetch existing session on mount + when the contact changes — admin auth
  // can persist across panel switches as long as the radio stays connected.
  useEffect(() => {
    if (!client) {
      setSession(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.repeaterSession(client, contact.key);
        if (!cancelled) setSession(res.session);
      } catch {
        // non-fatal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, contact.key]);

  const isAdmin = session?.role === 'admin';

  const onLogout = async () => {
    if (!client) return;
    try {
      await api.repeaterLogout(client, contact.key);
      setSession(null);
      notify.success('Logged out');
    } catch (err) {
      notify.error(`Logout failed: ${(err as Error).message}`, err);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-cs-border bg-cs-bg-2 px-4 py-2.5">
        <Radio size={14} aria-hidden="true" className="text-cs-text-muted" />
        <div className="flex flex-col">
          <h2 className="font-medium leading-tight text-cs-text">{contact.name}</h2>
          <span className="font-mono text-[10px] text-cs-text-dim">
            {contact.kind}
            {session ? ` · ${session.role} (${session.mode})` : ''}
          </span>
        </div>
        {contact.rssi != null && (
          <RssiChip rssi={contact.rssi} hops={contact.hops} className="ml-3" />
        )}
        {session && (
          <button
            type="button"
            onClick={onLogout}
            className="ml-auto flex items-center gap-1 rounded border border-cs-border bg-cs-bg-3 px-2 py-0.5 text-[11px] text-cs-text-muted transition-colors hover:bg-cs-accent-soft/30 hover:text-cs-text"
            title="Logout"
          >
            <LogOut size={11} aria-hidden="true" />
            <span className="hidden md:inline">Logout</span>
          </button>
        )}
      </header>

      <nav className="flex shrink-0 gap-0.5 border-b border-cs-border bg-cs-bg-2 px-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const disabled = t.adminOnly && !isAdmin;
          const active = tab === t.id;
          return (
            <button
              type="button"
              key={t.id}
              disabled={disabled}
              onClick={() => setTab(t.id)}
              title={disabled ? `${t.label} (admin login required)` : t.label}
              className={`flex items-center gap-1 px-2 py-1.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                active
                  ? 'border-b border-cs-accent text-cs-text'
                  : 'text-cs-text-muted hover:text-cs-text'
              }`}
            >
              <Icon size={11} aria-hidden="true" />
              <span className="hidden md:inline">{t.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-hidden">
        {tab === 'login' && (
          <LoginTab contact={contact} client={client} session={session} onSession={setSession} />
        )}
        {tab === 'path' && <PathTab contact={contact} client={client} />}
        {tab === 'status' && <StatusTab contact={contact} client={client} />}
        {tab === 'acl' && <AclTab contact={contact} client={client} disabled={!isAdmin} />}
        {tab === 'neighbours' && <NeighboursTab contact={contact} client={client} />}
        {tab === 'owner' && <OwnerTab contact={contact} client={client} />}
        {tab === 'cli' && <CliTab contact={contact} client={client} />}
      </div>
    </div>
  );
}
