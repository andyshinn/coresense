const KEY = 'coresense.lastDevice';

export interface LastDevice {
  id: string;
  name: string | null;
}

export function loadLastDevice(): LastDevice | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastDevice>;
    if (typeof parsed.id !== 'string') return null;
    return { id: parsed.id, name: typeof parsed.name === 'string' ? parsed.name : null };
  } catch {
    return null;
  }
}

export function saveLastDevice(device: LastDevice): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(device));
  } catch {
    // no-op
  }
}

export function clearLastDevice(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // no-op
  }
}
