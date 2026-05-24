import { Bluetooth } from 'lucide-react';
import { Row, Select } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';

export function BluetoothSection() {
  return (
    <SettingsSection
      id="radio-bluetooth"
      icon={Bluetooth}
      title="Bluetooth"
      description="BLE pairing behavior."
      dirty={false}
    >
      <div className="mb-2 rounded border border-cs-border bg-cs-bg-2 px-3 py-2 text-[11px] text-cs-text-dim">
        If you forget your bluetooth pin you will need to flash the USB firmware to reset it.
      </div>
      <Row
        label="Bluetooth PIN Type"
        description="Not yet supported over BLE — set this via the official mobile app or a USB CLI session."
        control={
          <Select<string>
            value="random"
            disabled
            options={[
              { value: 'random', label: 'Random (screen required)' },
              { value: 'fixed', label: 'Fixed' },
              { value: 'none', label: 'None' },
            ]}
            onChange={() => undefined}
          />
        }
      />
    </SettingsSection>
  );
}
