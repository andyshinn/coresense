import { KeyRound } from 'lucide-react';
import { Row } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { useStore } from '../../../lib/store';

export function IdentityKeySection() {
  const caps = useStore((s) => s.deviceCapabilities);
  return (
    <SettingsSection
      id="radio-identity-key"
      icon={KeyRound}
      title="Identity Key"
      description="Export/import the device's Ed25519 private key for migration."
      dirty={false}
    >
      <div className="mb-2 rounded border border-cs-warn/40 bg-cs-warn/10 px-3 py-2 text-[11px] text-cs-text">
        WARNING: Your private identity key should be kept secret. It's used to encrypt and decrypt the messages you send and
        receive.
      </div>
      <Row
        label="Export"
        description="Reveals and copies the device's private key to the clipboard."
        control={
          <button
            type="button"
            disabled
            title="Pending firmware ≥ 1.7.0 capability check + CLI plumbing"
            className="cursor-not-allowed rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text-dim opacity-60"
          >
            Export Private Key
          </button>
        }
      />
      <Row
        label="Import"
        description="Paste a 64-character hex private key to replace the device's identity."
        control={
          <button
            type="button"
            disabled
            title="Pending firmware ≥ 1.7.0 capability check + CLI plumbing"
            className="cursor-not-allowed rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text-dim opacity-60"
          >
            Import Private Key
          </button>
        }
      />
      {!caps.identityKeyIO && (
        <p className="px-2 pt-1 text-[11px] italic text-cs-text-dim">
          Companion firmware v1.7.0+ is required to import and export your identity key. This radio reports an older
          firmware.
        </p>
      )}
    </SettingsSection>
  );
}
