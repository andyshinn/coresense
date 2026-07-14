import { Toggle } from 'coresense';
import { Bell, BellOff, Map, Pin } from 'lucide-react';

// Dark "Field Console" surface — toggles sit inline in map and channel
// controls, so lay them out in a row like the app's control bars.
function Surface({ children }) {
  return <div className="flex flex-wrap items-center gap-3 rounded-lg bg-cs-bg p-6 text-cs-text">{children}</div>;
}

export function MuteToggle() {
  return (
    <Surface>
      <Toggle aria-label="Mute channel">
        <Bell /> Muted
      </Toggle>
      <Toggle defaultPressed aria-label="Mute channel">
        <BellOff /> Muted
      </Toggle>
    </Surface>
  );
}

export function Outline() {
  return (
    <Surface>
      <Toggle variant="outline" aria-label="Pin to top">
        <Pin /> Pin
      </Toggle>
      <Toggle variant="outline" defaultPressed aria-label="Follow node on map">
        <Map /> Follow
      </Toggle>
    </Surface>
  );
}

export function Sizes() {
  return (
    <Surface>
      <Toggle size="sm" aria-label="Mute" pressed>
        <BellOff />
      </Toggle>
      <Toggle size="default" aria-label="Mute" pressed>
        <BellOff />
      </Toggle>
      <Toggle size="lg" aria-label="Mute" pressed>
        <BellOff />
      </Toggle>
    </Surface>
  );
}

export function Disabled() {
  return (
    <Surface>
      <Toggle disabled aria-label="Mute channel">
        <Bell /> Muted
      </Toggle>
      <Toggle disabled defaultPressed aria-label="Mute channel">
        <BellOff /> Muted
      </Toggle>
    </Surface>
  );
}
