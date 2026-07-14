import { ToggleGroup, ToggleGroupItem } from 'coresense';
import { List, Map, MessageSquare, Radio, Users } from 'lucide-react';

// Dark "Field Console" surface — segmented controls switch panel views and
// filter search results, so render them centered on the app background.
function Surface({ children }) {
  return <div className="flex flex-wrap items-center gap-4 rounded-lg bg-cs-bg p-6 text-cs-text">{children}</div>;
}

export function ViewSwitch() {
  return (
    <Surface>
      <ToggleGroup type="single" variant="outline" defaultValue="list">
        <ToggleGroupItem value="list" aria-label="List view">
          <List /> List
        </ToggleGroupItem>
        <ToggleGroupItem value="map" aria-label="Map view">
          <Map /> Map
        </ToggleGroupItem>
      </ToggleGroup>
    </Surface>
  );
}

export function SearchFilters() {
  return (
    <Surface>
      <ToggleGroup type="multiple" variant="outline" size="sm" defaultValue={['channel', 'contact']}>
        <ToggleGroupItem value="channel" aria-label="Filter channels">
          <Radio /> Channels
        </ToggleGroupItem>
        <ToggleGroupItem value="dm" aria-label="Filter direct messages">
          <MessageSquare /> DMs
        </ToggleGroupItem>
        <ToggleGroupItem value="contact" aria-label="Filter contacts">
          <Users /> Contacts
        </ToggleGroupItem>
      </ToggleGroup>
    </Surface>
  );
}

export function Compact() {
  return (
    <Surface>
      <ToggleGroup type="single" size="sm" defaultValue="map">
        <ToggleGroupItem value="list" aria-label="List view">
          <List />
        </ToggleGroupItem>
        <ToggleGroupItem value="map" aria-label="Map view">
          <Map />
        </ToggleGroupItem>
      </ToggleGroup>
    </Surface>
  );
}
