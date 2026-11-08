import { UserCircle } from 'lucide-react';
import { useMemo } from 'react';
import { parseCoord } from '../../../../shared/geo';
import { validateNodeName } from '../../../../shared/radio';
import type { DeviceIdentity } from '../../../../shared/types';
import { Row, TextInput, Toggle } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { api } from '../../../lib/api';
import { useApiClient } from '../../../lib/apiClientContext';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { useSettingsSection } from '../useSectionDraft';

interface PublicInfoDraft {
  name: string;
  latText: string;
  lonText: string;
  share: boolean;
}
const eqPublicInfo = (a: PublicInfoDraft, b: PublicInfoDraft) =>
  a.name === b.name && a.latText === b.latText && a.lonText === b.lonText && a.share === b.share;

export function PublicInfoSection() {
  const client = useApiClient();
  const identity = useStore((s) => s.deviceIdentity);
  const owner = useStore((s) => s.owner);
  const connected = useStore((s) => s.transportState === 'connected');

  const saved = useMemo<PublicInfoDraft>(
    () => ({
      name: identity.name || owner?.name || '',
      latText: identity.lat?.toString() ?? '',
      lonText: identity.lon?.toString() ?? '',
      share: identity.sharePositionInAdvert,
    }),
    [identity.name, identity.lat, identity.lon, identity.sharePositionInAdvert, owner?.name],
  );

  const { draft, setDraft, sectionProps } = useSettingsSection({
    id: 'radio-public-info',
    saved,
    eq: eqPublicInfo,
    onSave: async (d) => {
      if (!client) throw new Error('No server connection');
      const patch: Partial<DeviceIdentity> = { sharePositionInAdvert: d.share };
      // Only a changed name is sent, so an identity with no name yet (a radio
      // never connected) can still save its position.
      if (d.name !== saved.name) {
        const name = validateNodeName(d.name);
        if (!name.ok) throw new Error(name.error);
        patch.name = name.value;
      }
      const positionEdited = d.latText !== saved.latText || d.lonText !== saved.lonText;
      if (positionEdited && (d.latText.trim() || d.lonText.trim())) {
        // The radio keeps 6 decimal places (1e-6 degrees on the wire).
        const lat = parseCoord(d.latText, 'lat', { maxDecimals: 6 });
        if (!lat.ok) throw new Error(lat.error);
        const lon = parseCoord(d.lonText, 'lon', { maxDecimals: 6 });
        if (!lon.ok) throw new Error(lon.error);
        patch.lat = lat.value;
        patch.lon = lon.value;
      }
      await api.putDeviceIdentity(client, patch);
      notify.success(connected ? 'Public info saved to radio' : 'Public info saved app-side');
    },
  });

  const pubKey = identity.publicKeyHex || owner?.publicKeyHex || '(connect a radio to see public key)';

  return (
    <SettingsSection
      {...sectionProps}
      icon={UserCircle}
      title="Public Info"
      description="What the radio advertises about itself — name and position."
      canSave={!!client}
    >
      <Row
        label="Name"
        description="Display name peers see in adverts and messages. ≤31 bytes UTF-8."
        changed={draft.name !== saved.name}
        control={<TextInput value={draft.name} disabled={!client} onChange={(name) => setDraft((s) => ({ ...s, name }))} />}
      />
      <Row
        label="Public key"
        description="Full Ed25519 public key. Share with peers to add you as a contact."
        control={
          <span className="font-mono text-[11px] text-cs-text-dim">
            {pubKey.length > 24 ? `${pubKey.slice(0, 12)}…${pubKey.slice(-12)}` : pubKey}
          </span>
        }
      />
      <Row
        label="Latitude"
        description="Decimal degrees, WGS84."
        changed={draft.latText !== saved.latText}
        control={
          <TextInput value={draft.latText} disabled={!client} onChange={(latText) => setDraft((s) => ({ ...s, latText }))} />
        }
      />
      <Row
        label="Longitude"
        description="Decimal degrees, WGS84."
        changed={draft.lonText !== saved.lonText}
        control={
          <TextInput value={draft.lonText} disabled={!client} onChange={(lonText) => setDraft((s) => ({ ...s, lonText }))} />
        }
      />
      <Row
        label="Share position in advert"
        description="Include lat/lon in self-adverts so other nodes can place you on the map."
        changed={draft.share !== saved.share}
        control={
          <Toggle checked={draft.share} disabled={!client} onChange={(share) => setDraft((s) => ({ ...s, share }))} />
        }
      />
    </SettingsSection>
  );
}
