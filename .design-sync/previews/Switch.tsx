import { Switch } from 'coresense';

// Dark "Field Console" surface, sized like a settings card. Each switch is
// paired with a label row the way the app's settings panels render them.
function Surface({ children }) {
  return (
    <div className="w-72 space-y-3 rounded-lg border border-cs-border bg-cs-bg-2 p-4 text-cs-text">
      {children}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-cs-text">{label}</span>
      {children}
    </div>
  );
}

export function Settings() {
  return (
    <Surface>
      <Row label="Notifications">
        <Switch defaultChecked />
      </Row>
      <Row label="Auto-add contacts">
        <Switch />
      </Row>
      <Row label="Dark map tiles">
        <Switch defaultChecked />
      </Row>
    </Surface>
  );
}

export function CheckedAndUnchecked() {
  return (
    <Surface>
      <Row label="Auto-reconnect">
        <Switch checked />
      </Row>
      <Row label="Share location">
        <Switch checked={false} />
      </Row>
    </Surface>
  );
}

export function Disabled() {
  return (
    <Surface>
      <Row label="Mesh proxy">
        <Switch checked disabled />
      </Row>
      <Row label="Bind all interfaces">
        <Switch checked={false} disabled />
      </Row>
    </Surface>
  );
}

export function Sizes() {
  return (
    <Surface>
      <Row label="Show names on map (sm)">
        <Switch size="sm" defaultChecked />
      </Row>
      <Row label="Show names on map (default)">
        <Switch size="default" defaultChecked />
      </Row>
    </Surface>
  );
}
