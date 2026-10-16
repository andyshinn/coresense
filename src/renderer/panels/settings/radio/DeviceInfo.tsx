import { Info } from 'lucide-react';
import { Row } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { useStore } from '../../../lib/store';
import { useDeviceRefresh } from '../useDeviceRefresh';

export function DeviceInfoSection() {
  const info = useStore((s) => s.deviceInfo);
  const channels = useStore((s) => s.channels.length);
  const contacts = useStore((s) => s.contacts.length);
  const { refresh, canRefresh } = useDeviceRefresh();

  const storagePct = info.storageTotalKb > 0 ? Math.round((info.storageUsedKb / info.storageTotalKb) * 100) : 0;

  return (
    <SettingsSection
      id="radio-device-info"
      icon={Info}
      title="Device Info"
      description="Read-only snapshot of the connected radio."
      dirty={false}
    >
      <Row
        label="Device model"
        control={<span className="font-mono text-[12px] text-cs-text">{info.deviceModel || '(unknown)'}</span>}
      />
      <Row
        label="Firmware version code"
        control={<span className="font-mono text-[12px] text-cs-text">{info.firmwareVerCode || '(unknown)'}</span>}
      />
      <Row
        label="Channels"
        control={
          <span className="font-mono text-[12px] text-cs-text">
            {channels}/{info.maxChannels || '?'}
          </span>
        }
      />
      <Row
        label="Contacts"
        control={
          <span className="font-mono text-[12px] text-cs-text">
            {contacts}/{info.maxContacts || '?'}
          </span>
        }
      />
      <Row
        label="Storage"
        description={`${storagePct}% used`}
        control={
          <span className="font-mono text-[12px] text-cs-text">
            {info.storageUsedKb}kb / {info.storageTotalKb || '?'}kb
          </span>
        }
      />
      <Row
        label="Battery"
        control={
          <span className="font-mono text-[12px] text-cs-text">
            {info.batteryMv > 0 ? `${(info.batteryMv / 1000).toFixed(2)} V` : '—'}
          </span>
        }
      />
      <Row
        label="Refresh snapshot"
        description="Re-issues DEVICE_QUERY + GET_BATT_AND_STORAGE + GET_AUTO_ADD_CONFIG + GPS custom vars."
        control={
          <button
            type="button"
            onClick={refresh}
            disabled={!canRefresh}
            className="rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Refresh
          </button>
        }
      />
    </SettingsSection>
  );
}
