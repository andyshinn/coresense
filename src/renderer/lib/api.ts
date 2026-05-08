import type { Capabilities, ServerStatus } from '../../shared/types';

export interface ApiClient {
  baseUrl: string;
  apiKey: string;
}

async function request<T>(client: ApiClient, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${client.baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${client.apiKey}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${message}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchCapabilities(baseUrl: string): Promise<Capabilities> {
  const res = await fetch(`${baseUrl}/api/capabilities`);
  if (!res.ok) throw new Error(`Capabilities probe failed: ${res.status}`);
  return res.json() as Promise<Capabilities>;
}

export const api = {
  status: (c: ApiClient) => request<ServerStatus>(c, '/api/status'),
  scan: (c: ApiClient) => request<{ ok: true }>(c, '/api/transport/scan', { method: 'POST' }),
  connect: (c: ApiClient, deviceId: string) =>
    request<{ ok: true }>(c, '/api/transport/connect', {
      method: 'POST',
      body: JSON.stringify({ deviceId }),
    }),
  disconnect: (c: ApiClient) =>
    request<{ ok: true }>(c, '/api/transport/disconnect', { method: 'POST' }),
};
