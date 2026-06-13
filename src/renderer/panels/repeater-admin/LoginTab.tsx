import { useState } from 'react';
import type { Contact, RepeaterAdminSession } from '../../../shared/types';
import { RelativeTime } from '../../components/RelativeTime';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';

interface Props {
  contact: Contact;
  client: ApiClient | null;
  session: RepeaterAdminSession | null;
  onSession: (s: RepeaterAdminSession | null) => void;
}

/** Compute the live login-button label from the contact's path state. Matches
 *  the official client's "Log In · Direct / Flood / N hops" suffix. */
function deriveLoginLabel(contact: Contact): string {
  if (contact.preferDirect) return 'Log In · Direct';
  const path = contact.outPathHex ?? '';
  const hashSize = contact.outPathHashSize ?? 2;
  if (!path || path.length === 0) return 'Log In · Flood';
  const hops = Math.max(1, Math.floor(path.length / 2 / hashSize));
  return `Log In · ${hops} hop${hops === 1 ? '' : 's'}`;
}

export function LoginTab({ contact, client, session, onSession }: Props) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client || busy) return;
    setBusy(true);
    try {
      const result = await api.repeaterLogin(client, contact.key, password);
      onSession(result.session);
      const via =
        result.login.effective === 'direct'
          ? 'direct'
          : result.login.effective === 'path'
            ? `${Math.max(1, Math.floor((contact.outPathHex ?? '').length / 2 / (contact.outPathHashSize ?? 2)))} hop`
            : 'flood';
      notify.success(`Logged in as ${result.session?.role ?? 'guest'} · ${via}`);
      setPassword('');
    } catch (err) {
      notify.error(`Login failed: ${(err as Error).message}`, err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4">
      {session && (
        <section className="rounded border border-cs-border bg-cs-bg-2 p-3 text-[12px]">
          <header className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-cs-text-muted">
            Active session
          </header>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
            <dt className="text-cs-text-muted">Role</dt>
            <dd className="font-mono text-cs-text">{session.role}</dd>
            <dt className="text-cs-text-muted">Mode</dt>
            <dd className="font-mono text-cs-text">{session.mode}</dd>
            <dt className="text-cs-text-muted">Permissions</dt>
            <dd className="font-mono text-cs-text">0x{session.permissionsBits.toString(16).padStart(2, '0')}</dd>
            {session.aclPermissionsBits !== null && (
              <>
                <dt className="text-cs-text-muted">ACL perms</dt>
                <dd className="font-mono text-cs-text">0x{session.aclPermissionsBits.toString(16).padStart(2, '0')}</dd>
              </>
            )}
            {session.firmwareVerLevel !== null && (
              <>
                <dt className="text-cs-text-muted">Firmware ver</dt>
                <dd className="font-mono text-cs-text">{session.firmwareVerLevel}</dd>
              </>
            )}
            <dt className="text-cs-text-muted">Since</dt>
            <dd className="font-mono text-cs-text">
              <RelativeTime ts={session.loggedInAt} />
            </dd>
          </dl>
        </section>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-cs-text-muted">
          {session ? 'Re-authenticate' : 'Login'}
        </h3>

        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="rounded border border-cs-border bg-cs-bg-2 px-2 py-1 font-mono text-[12px] text-cs-text"
        />

        <button
          type="submit"
          disabled={!client || busy || password.length === 0}
          className="self-start rounded border border-cs-border bg-cs-accent-soft/30 px-3 py-1 text-[12px] text-cs-text transition-colors hover:bg-cs-accent-soft/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Logging in…' : deriveLoginLabel(contact)}
        </button>
      </form>

      <p className="max-w-prose text-[11px] text-cs-text-dim">
        The wire mode is derived from this contact's Path settings: Direct uses the companion-side CMD_SEND_LOGIN (no mesh
        routing); Flood and N-hop both wrap the password in a CMD_SEND_ANON_REQ that the radio routes per the contact's
        current out_path. Admin grants ACL editing + setperm; guest grants status/telemetry/neighbours only.
      </p>
    </div>
  );
}
