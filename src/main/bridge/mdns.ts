import { Bonjour } from 'bonjour-service';

export interface MdnsServiceDesc {
  name: string;
  type: string;
  port: number;
  txt: Record<string, string>;
}

export interface MdnsPlan {
  host: string;
  serviceName: string;
  services: MdnsServiceDesc[];
}

export interface BuildMdnsInput {
  hostname: string;
  dev: boolean;
  advertise: boolean;
  bridgeEnabled: boolean;
  bridgeTcpPort: number | null;
  httpPort: number;
  serviceNameOverride?: string;
}

export interface MdnsHandle {
  serviceName: string;
  close(): Promise<void>;
}

const TXT_COMMON = {
  version: '1',
  hostapp: 'coresense',
};

const SHUTDOWN_TIMEOUT_MS = 1000;

function stripDomain(h: string): string {
  return h.replace(/\..*$/, '');
}

export function buildMdnsServices(input: BuildMdnsInput): MdnsPlan {
  const base = stripDomain(input.hostname);
  const serviceName = input.serviceNameOverride ?? (input.dev ? `${base}-dev` : base);
  const host = `${base}.local`;
  const friendly = `Coresense (${serviceName})`;

  const services: MdnsServiceDesc[] = [];
  if (input.advertise) {
    if (input.bridgeEnabled && input.bridgeTcpPort !== null) {
      services.push({
        name: serviceName,
        type: 'meshcore',
        port: input.bridgeTcpPort,
        txt: { ...TXT_COMMON, auth: 'none', framing: 'swi3' },
      });
    }
    services.push({
      name: friendly,
      type: 'http',
      port: input.httpPort,
      txt: { ...TXT_COMMON, path: '/' },
    });
    services.push({
      name: friendly,
      type: 'coresense-ws',
      port: input.httpPort,
      txt: { ...TXT_COMMON, path: '/ws', auth: 'apikey' },
    });
  }

  return { host, serviceName, services };
}

export function startMdns(plan: MdnsPlan): MdnsHandle {
  const bonjour = new Bonjour();
  for (const desc of plan.services) {
    bonjour.publish({
      name: desc.name,
      type: desc.type,
      protocol: 'tcp',
      port: desc.port,
      host: plan.host,
      disableIPv6: true,
      txt: desc.txt,
    });
  }
  return {
    serviceName: plan.serviceName,
    close: () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), SHUTDOWN_TIMEOUT_MS);
        try {
          bonjour.unpublishAll(() => {
            bonjour.destroy(() => {
              clearTimeout(timer);
              resolve();
            });
          });
        } catch {
          clearTimeout(timer);
          resolve();
        }
      }),
  };
}
