import { useEffect, useRef, useState } from 'react';
import { type ApiClient, api } from '../../lib/api';
import { createPoller, initialPollState, type Poller, type PollState } from './poll';

const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

/**
 * Bind My Node's live poll (poll.ts) to the page: mounted while this hook is,
 * visible per `document.visibilityState`, connected per `connected`. Returns
 * the latest telemetry and stats reads.
 */
export function useNodePoll(client: ApiClient | null, connected: boolean): PollState {
  const [state, setState] = useState<PollState>(initialPollState);
  const poller = useRef<Poller | null>(null);
  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  useEffect(() => {
    if (!client) return;
    const p = createPoller({
      readTelemetry: () => api.readSelfTelemetryLive(client),
      readStats: () => api.getDeviceStats(client),
      onChange: setState,
    });
    poller.current = p;
    p.setConditions({ mounted: true, visible: isVisible(), connected: connectedRef.current });
    const onVisibility = () => p.setConditions({ visible: isVisible() });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      p.dispose();
      poller.current = null;
    };
  }, [client]);

  useEffect(() => {
    poller.current?.setConditions({ connected });
  }, [connected]);

  return state;
}
