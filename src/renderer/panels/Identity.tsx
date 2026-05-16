import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { PanelShell, Row, Section } from '../components/settings/Field';
import { useStore } from '../lib/store';

// Read-only identity view for v1. Regenerate / import / export of the owner's
// private key are destructive operations and stay off until we have a confirm
// flow that's hard to misclick.
export function Identity() {
  const owner = useStore((s) => s.owner);

  if (!owner) {
    return (
      <PanelShell title="Identity" description="Connect a radio to see its identity.">
        <p className="px-2 py-6 text-[12px] text-cs-text-dim">
          No identity yet — connect a radio. Its owner name and public key are populated from the
          first RESP_SELF_INFO after CMD_APP_START.
        </p>
      </PanelShell>
    );
  }

  return (
    <PanelShell title="Identity" description="The connected radio's owner name and public key.">
      <Section title="Owner">
        <Row
          label="Display name"
          control={<span className="text-[12px] text-cs-text">{owner.name}</span>}
        />
        <Row
          label="Short ID"
          description="First six bytes of the public key — what other nodes see in @mentions."
          control={
            <CopyableValue value={owner.publicKeyShort} display={owner.publicKeyShort} mono />
          }
        />
        <Row
          label="Public key"
          description="Full 32-byte Ed25519 public key. Share this with peers to add you as a contact."
          control={
            <CopyableValue
              value={owner.publicKeyHex}
              display={`${owner.publicKeyHex.slice(0, 16)}…`}
              mono
            />
          }
        />
      </Section>

      <Section title="Danger zone">
        <p className="px-2 text-[11px] text-cs-text-dim">
          Regenerating your private key, importing one, or exporting it will land in a later phase
          behind a confirm dialog. The official mobile app's identity flow is the source of truth
          until then.
        </p>
      </Section>
    </PanelShell>
  );
}

interface CopyableValueProps {
  value: string;
  display: string;
  mono?: boolean;
}

function CopyableValue({ value, display, mono }: CopyableValueProps) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {
        /* clipboard denied — fall through silently */
      },
    );
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={value}
      className={`flex items-center gap-2 rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text transition-colors hover:bg-cs-bg-3 ${
        mono ? 'font-mono' : ''
      }`}
    >
      <span>{display}</span>
      {copied ? (
        <Check size={11} className="text-cs-accent" aria-label="copied" />
      ) : (
        <Copy size={11} className="text-cs-text-muted" aria-label="copy" />
      )}
    </button>
  );
}
