import { describe, expect, it } from 'vitest';
import { BridgeHub } from '../../../../src/main/bridge/hub';

describe('BridgeHub.setMdnsServiceName', () => {
  it('updates the mdnsServiceName surfaced by getStatus and emits statusChanged', () => {
    const hub = new BridgeHub();
    hub.setListeners({ bindAddress: '0.0.0.0', lanAddress: null, tcpPort: 5000, mdnsServiceName: null });
    expect(hub.getStatus().mdnsServiceName).toBe(null);

    let emitted = 0;
    hub.on('statusChanged', () => {
      emitted += 1;
    });
    hub.setMdnsServiceName('AndysMacStudio');
    expect(hub.getStatus().mdnsServiceName).toBe('AndysMacStudio');
    expect(emitted).toBe(1);

    hub.setMdnsServiceName(null);
    expect(hub.getStatus().mdnsServiceName).toBe(null);

    hub.close();
  });
});
