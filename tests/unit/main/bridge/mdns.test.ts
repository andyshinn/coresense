import { describe, expect, it } from 'vitest';
import { buildMdnsServices } from '../../../../src/main/bridge/mdns';

const baseInput = {
  hostname: 'AndysMacStudio.lan',
  dev: false,
  advertise: true,
  bridgeEnabled: true,
  bridgeTcpPort: 5000,
  httpPort: 7654,
} as const;

describe('buildMdnsServices', () => {
  it('derives a .local host from the hostname with the domain stripped', () => {
    expect(buildMdnsServices(baseInput).host).toBe('AndysMacStudio.local');
  });

  it('does not double-append .local when the hostname already ends in .local', () => {
    expect(buildMdnsServices({ ...baseInput, hostname: 'box.local' }).host).toBe('box.local');
  });

  it('publishes all three services when advertising with the bridge enabled', () => {
    const plan = buildMdnsServices(baseInput);
    expect(plan.services.map((s) => s.type)).toEqual(['meshcore', 'http', 'coresense-ws']);
  });

  it('shapes the meshcore record with the bridge port and framing TXT', () => {
    const m = buildMdnsServices(baseInput).services.find((s) => s.type === 'meshcore');
    expect(m).toMatchObject({
      name: 'AndysMacStudio',
      port: 5000,
      txt: { version: '1', hostapp: 'coresense', auth: 'none', framing: 'swi3' },
    });
  });

  it('shapes the http and ws records on the http port with path TXT', () => {
    const plan = buildMdnsServices(baseInput);
    expect(plan.services.find((s) => s.type === 'http')).toMatchObject({
      name: 'Coresense (AndysMacStudio)',
      port: 7654,
      txt: { version: '1', hostapp: 'coresense', path: '/' },
    });
    expect(plan.services.find((s) => s.type === 'coresense-ws')).toMatchObject({
      name: 'Coresense (AndysMacStudio)',
      port: 7654,
      txt: { version: '1', hostapp: 'coresense', path: '/ws', auth: 'apikey' },
    });
  });

  it('publishes nothing when not advertising (host still derived)', () => {
    const plan = buildMdnsServices({ ...baseInput, advertise: false });
    expect(plan.services).toEqual([]);
    expect(plan.host).toBe('AndysMacStudio.local');
  });

  it('omits meshcore when the bridge is disabled', () => {
    const plan = buildMdnsServices({ ...baseInput, bridgeEnabled: false });
    expect(plan.services.map((s) => s.type)).toEqual(['http', 'coresense-ws']);
  });

  it('omits meshcore when there is no bridge tcp port', () => {
    const plan = buildMdnsServices({ ...baseInput, bridgeTcpPort: null });
    expect(plan.services.map((s) => s.type)).toEqual(['http', 'coresense-ws']);
  });

  it('appends -dev to the instance name in dev mode but not the host', () => {
    const plan = buildMdnsServices({ ...baseInput, dev: true });
    expect(plan.serviceName).toBe('AndysMacStudio-dev');
    expect(plan.host).toBe('AndysMacStudio.local');
    expect(plan.services.find((s) => s.type === 'meshcore')?.name).toBe('AndysMacStudio-dev');
    expect(plan.services.find((s) => s.type === 'http')?.name).toBe('Coresense (AndysMacStudio-dev)');
  });

  it('uses the service-name override for instance names but keeps the host from the hostname', () => {
    const plan = buildMdnsServices({ ...baseInput, dev: true, serviceNameOverride: 'custom' });
    expect(plan.serviceName).toBe('custom');
    expect(plan.host).toBe('AndysMacStudio.local');
    expect(plan.services.find((s) => s.type === 'http')?.name).toBe('Coresense (custom)');
  });
});
