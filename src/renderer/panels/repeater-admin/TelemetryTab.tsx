import { useMemo } from 'react';
import { hasValidFix } from '../../../shared/geo';
import type { Contact, RepeaterAdminSession } from '../../../shared/types';
import { TelemetryPanel } from '../../features/telemetry/TelemetryPanel';
import type { ApiClient } from '../../lib/api';
import { useStore } from '../../lib/store';

interface Props {
  contact: Contact;
  client: ApiClient | null;
  session: RepeaterAdminSession | null;
}

/**
 * Telemetry tab of the repeater/sensor admin panel: the shared
 * TelemetryPanel for this node. Both kinds request as `source: 'repeater'`
 * (main infers a sensor's grants). Both drop requests from clients outside
 * their ACL (simple_repeater and simple_sensor searchPeersByHash match ACL
 * clients only), so either with no session gets the login hint and the
 * "Log in" shortcut to the Login tab.
 */
export function TelemetryTab({ contact, client, session }: Props) {
  const setRepeaterAdminTab = useStore((s) => s.setRepeaterAdminTab);
  const isRepeater = contact.kind === 'repeater';
  const fix = hasValidFix(contact);
  const lat = fix ? contact.gpsLat : null;
  const lon = fix ? contact.gpsLon : null;
  const advertPosition = useMemo(() => (lat !== null && lon !== null ? { lat, lon } : null), [lat, lon]);

  return (
    <TelemetryPanel
      source="repeater"
      nodeKey={contact.key}
      client={client}
      nodeName={contact.name}
      target={isRepeater ? 'this repeater' : 'this sensor'}
      needsLogin={!session}
      onLogIn={() => setRepeaterAdminTab('login')}
      advertPosition={advertPosition}
      canResetPath={contact.hops !== undefined}
    />
  );
}
