import type { MenuAction, WsMessage } from '../../shared/types';
import { notify } from '../lib/notify';
import { useStore } from '../lib/store';

export interface WsMessageHandlerDeps {
  setSystemDark: (dark: boolean) => void;
  handleMenuAction: (action: MenuAction) => void;
}

/** Factory for the WebSocket message dispatcher used by App.tsx. */
export function createWsMessageHandler(deps: WsMessageHandlerDeps): (msg: WsMessage) => void {
  const { setSystemDark, handleMenuAction } = deps;
  return (msg: WsMessage) => {
    // Pull action references off the store at dispatch time. They're stable
    // function identities, so this avoids subscribing App to every store
    // mutation just to keep the callback's dep array honest.
    const s = useStore.getState();
    switch (msg.type) {
      case 'packet':
        s.applyPacket(msg.payload);
        break;
      case 'log':
        s.appendLog(msg.payload);
        break;
      case 'log:snapshot':
        s.replaceLogs(msg.payload);
        break;
      case 'transportState':
        s.applyTransportState(msg.payload.state, msg.payload.deviceId);
        break;
      case 'scanResults':
        s.applyDevices(msg.payload);
        break;
      case 'error':
        notify.error(msg.payload.message);
        break;
      case 'bridgeStatus':
        s.applyBridge(msg.payload);
        break;
      case 'wsClients':
        s.setWsClients(msg.payload.count);
        break;
      case 'theme':
        setSystemDark(msg.payload.systemDark);
        break;
      case 'menuAction':
        handleMenuAction(msg.payload);
        break;
      case 'channels':
        s.applyChannels(msg.payload);
        break;
      case 'channelPresence':
        s.applyChannelPresence(msg.payload.keys);
        break;
      case 'syncProgress':
        s.applySyncProgress(msg.payload);
        break;
      case 'contacts':
        s.applyContacts(msg.payload);
        break;
      case 'messages':
        s.applyMessages(msg.payload.key, msg.payload.messages);
        break;
      case 'messageState':
        s.applyMessageState(msg.payload.id, msg.payload.state);
        break;
      case 'messagePathHeard':
        s.appendMessagePath(msg.payload.id, msg.payload.path, msg.payload.state);
        break;
      case 'owner':
        s.applyOwner(msg.payload);
        break;
      case 'appSettings':
        s.applyAppSettings(msg.payload);
        break;
      case 'radioSettings':
        s.applyRadioSettings(msg.payload);
        break;
      case 'mapSettings':
        s.applyMapSettings(msg.payload);
        break;
      case 'mapManifest':
        s.applyMapManifest(msg.payload);
        break;
      case 'uiState':
        s.applyUiState(msg.payload);
        break;
      case 'repeaterStatus':
        s.applyRepeaterStatus(msg.payload);
        break;
      case 'repeaterTelemetry':
        s.applyRepeaterTelemetry(msg.payload);
        break;
      case 'deviceIdentity':
        s.applyDeviceIdentity(msg.payload);
        break;
      case 'autoAddConfig':
        s.applyAutoAddConfig(msg.payload);
        break;
      case 'telemetryPolicy':
        s.applyTelemetryPolicy(msg.payload);
        break;
      case 'gpsConfig':
        s.applyGpsConfig(msg.payload);
        break;
      case 'deviceInfo':
        s.applyDeviceInfo(msg.payload);
        break;
      case 'deviceCapabilities':
        s.applyDeviceCapabilities(msg.payload);
        break;
      case 'pathLearned': {
        s.applyPathLearned(msg.payload);
        if (!msg.payload.previousManual) {
          const contact = s.contacts.find((c) => c.key === msg.payload.contactKey);
          const hops = Math.max(
            1,
            Math.floor(msg.payload.newOutPathHex.length / 2 / msg.payload.newOutPathHashSize),
          );
          notify.success(
            msg.payload.newOutPathHex
              ? `Path learned: ${contact?.name ?? msg.payload.contactKey} · ${hops} hop${hops === 1 ? '' : 's'}`
              : `Path cleared: ${contact?.name ?? msg.payload.contactKey}`,
          );
        }
        break;
      }
    }
  };
}
