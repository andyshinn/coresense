import {
  type AckPayload,
  type AdvertPayload,
  type AnonRequestPayload,
  type ControlPayload,
  ControlSubType,
  type DecodedPacket,
  type DeviceRole,
  type GroupTextPayload,
  MeshCoreDecoder,
  type PathPayload,
  PayloadType,
  type RequestPayload,
  type ResponsePayload,
  type RouteType,
  type TextMessagePayload,
  type TracePayload,
  Utils,
} from '@michaelhart/meshcore-decoder';

export interface PacketSummary {
  routeName: string;
  typeName: string;
  detail: string | null;
  isValid: boolean;
  decoded: DecodedPacket | null;
}

const short = (s: string, n = 8) => (s.length > n ? `${s.slice(0, n)}…` : s);

function detailFor(p: DecodedPacket): string | null {
  const d = p.payload.decoded;
  const hop = p.pathLength > 0 ? ` hop=${p.pathLength}` : '';

  if (!d) return null;
  switch (p.payloadType) {
    case PayloadType.Advert: {
      const a = d as AdvertPayload;
      const role = Utils.getDeviceRoleName(a.appData.deviceRole as DeviceRole);
      const who = a.appData.name ?? short(a.publicKey);
      const loc = a.appData.location
        ? ` @${a.appData.location.latitude.toFixed(2)},${a.appData.location.longitude.toFixed(2)}`
        : '';
      return `${who} (${role})${loc}`;
    }
    case PayloadType.TextMessage: {
      const m = d as TextMessagePayload;
      return `${short(m.sourceHash, 4)}→${short(m.destinationHash, 4)} ${m.ciphertextLength}B${hop}`;
    }
    case PayloadType.GroupText: {
      const g = d as GroupTextPayload;
      return `ch ${short(g.channelHash, 4)} ${g.ciphertextLength}B${hop}`;
    }
    case PayloadType.Request: {
      const r = d as RequestPayload;
      const reqType = Utils.getRequestTypeName(r.requestType);
      return `${reqType} ${short(r.sourceHash, 4)}→${short(r.destinationHash, 4)}${hop}`;
    }
    case PayloadType.Response: {
      const r = d as ResponsePayload;
      return `${short(r.sourceHash, 4)}→${short(r.destinationHash, 4)} ${r.ciphertextLength}B${hop}`;
    }
    case PayloadType.AnonRequest: {
      const a = d as AnonRequestPayload;
      return `${short(a.senderPublicKey, 4)}→${short(a.destinationHash, 4)}${hop}`;
    }
    case PayloadType.Ack: {
      const a = d as AckPayload;
      return `cs ${short(a.checksum, 8)}`;
    }
    case PayloadType.Path: {
      const pp = d as PathPayload;
      return `path len=${pp.pathLength}${pp.extraType ? ` extra=0x${pp.extraType.toString(16)}` : ''}`;
    }
    case PayloadType.Trace: {
      const t = d as TracePayload;
      return `tag ${t.traceTag} hops=${t.pathHashes.length}`;
    }
    case PayloadType.Control: {
      const c = d as ControlPayload;
      if (c.subType === ControlSubType.NodeDiscoverReq) {
        return `discover-req tag=${c.tag}`;
      }
      // NodeDiscoverResp is the only other variant.
      return `discover-resp ${c.nodeTypeName} ${short(c.publicKey, 4)} snr=${c.snr}`;
    }
    default:
      return null;
  }
}

export function summarizePacket(hex: string): PacketSummary {
  try {
    const decoded = MeshCoreDecoder.decode(hex);
    return {
      routeName: Utils.getRouteTypeName(decoded.routeType as RouteType),
      typeName: decoded.isValid
        ? Utils.getPayloadTypeName(decoded.payloadType as PayloadType)
        : 'invalid',
      detail: decoded.isValid ? detailFor(decoded) : (decoded.errors?.[0] ?? null),
      isValid: decoded.isValid,
      decoded,
    };
  } catch (err) {
    return {
      routeName: '?',
      typeName: 'invalid',
      detail: (err as Error).message,
      isValid: false,
      decoded: null,
    };
  }
}
