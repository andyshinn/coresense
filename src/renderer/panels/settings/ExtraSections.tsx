import { AlertTriangle, FolderInput, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Row } from '../../components/settings/Field';
import { SettingsSection } from '../../components/settings/SettingsSection';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';

// The Extra Tools tab — device-level maintenance actions. Everything here is an
// action button, so there is no dirty state and no per-section Save.

interface SectionProps {
  client: ApiClient | null;
}

const disabledBtn =
  'cursor-not-allowed rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text-dim opacity-60';
const dangerBtn =
  'cursor-not-allowed rounded border border-cs-danger/40 bg-cs-danger/10 px-2 py-0.5 text-[12px] text-cs-text-dim opacity-60';

export function MaintenanceSection({ client }: SectionProps) {
  const connected = useStore((s) => s.transportState === 'connected');
  const [rebootBusy, setRebootBusy] = useState(false);

  const refresh = async () => {
    if (!client) return;
    try {
      await api.refreshDevice(client);
      notify.success('Device refresh requested');
    } catch (err) {
      notify.error(`Refresh failed: ${(err as Error).message}`, err);
    }
  };

  const reboot = async () => {
    if (!client) return;
    setRebootBusy(true);
    try {
      await api.rebootDevice(client);
      notify.success('Reboot command sent — link will drop momentarily');
    } catch (err) {
      notify.error(`Reboot failed: ${(err as Error).message}`, err);
    } finally {
      setRebootBusy(false);
    }
  };

  return (
    <SettingsSection
      id="extra-maintenance"
      icon={Wrench}
      title="Maintenance"
      description="Device-level maintenance actions."
      dirty={false}
    >
      <Row
        label="Refresh device snapshot"
        description="Issues DEVICE_QUERY + GET_BATT_AND_STORAGE + GET_AUTO_ADD_CONFIG + GPS custom vars."
        control={
          <button
            type="button"
            disabled={!client || !connected}
            onClick={refresh}
            className="rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Refresh
          </button>
        }
      />
      <Row
        label="Reboot"
        description="Restart the radio. The BLE link will drop and reconnect."
        control={
          <button
            type="button"
            disabled={!client || !connected || rebootBusy}
            onClick={reboot}
            className="rounded border border-cs-danger bg-cs-danger/20 px-2 py-0.5 text-[12px] text-cs-danger hover:bg-cs-danger/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {rebootBusy ? 'Rebooting…' : 'Reboot'}
          </button>
        }
      />
    </SettingsSection>
  );
}

export function ImportExportSection() {
  return (
    <SettingsSection
      id="extra-import-export"
      icon={FolderInput}
      title="Import / Export"
      description="Bulk configuration transfer — pending protocol support."
      dirty={false}
    >
      <Row
        label="Import Config"
        description="Not yet supported — the open-source protocol doesn't expose a bulk import opcode."
        control={
          <button type="button" disabled className={disabledBtn}>
            Import
          </button>
        }
      />
      <Row
        label="Export Config"
        description="Not yet supported — coming in a future phase (parity with the mobile app's selectable export)."
        control={
          <button type="button" disabled className={disabledBtn}>
            Export
          </button>
        }
      />
      <Row
        label="Export App Database"
        description="Not yet supported."
        control={
          <button type="button" disabled className={disabledBtn}>
            Export
          </button>
        }
      />
    </SettingsSection>
  );
}

export function DangerZoneSection() {
  return (
    <SettingsSection
      id="extra-danger"
      icon={AlertTriangle}
      title="Danger Zone"
      description="Destructive operations — not exposed over BLE in the open-source firmware."
      dirty={false}
    >
      <Row
        label="Purge Data"
        description="Not exposed over BLE in the open-source firmware. Use a USB CLI session or the official mobile app."
        control={
          <button type="button" disabled className={dangerBtn}>
            Purge
          </button>
        }
      />
      <Row
        label="Factory Reset"
        description="Not exposed over BLE in the open-source firmware."
        control={
          <button type="button" disabled className={dangerBtn}>
            Factory Reset
          </button>
        }
      />
    </SettingsSection>
  );
}
