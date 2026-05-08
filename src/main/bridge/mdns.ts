import { Bonjour, type Service } from 'bonjour-service';

export interface MdnsHandle {
  serviceName: string;
  close(): Promise<void>;
}

export interface MdnsOptions {
  serviceName: string;
  tcpPort: number | null;
  wsPort: number | null;
}

const TXT_COMMON = {
  version: '1',
  auth: 'none',
  hostapp: 'coresense',
};

const SHUTDOWN_TIMEOUT_MS = 1000;

export function startMdns(opts: MdnsOptions): MdnsHandle {
  const bonjour = new Bonjour();
  const services: Service[] = [];

  if (opts.tcpPort !== null) {
    services.push(
      bonjour.publish({
        name: opts.serviceName,
        type: 'meshcore',
        protocol: 'tcp',
        port: opts.tcpPort,
        txt: { ...TXT_COMMON, framing: 'swi3' },
      }),
    );
  }
  if (opts.wsPort !== null) {
    services.push(
      bonjour.publish({
        name: opts.serviceName,
        type: 'meshcore-ws',
        protocol: 'tcp',
        port: opts.wsPort,
        txt: { ...TXT_COMMON },
      }),
    );
  }

  return {
    serviceName: opts.serviceName,
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
