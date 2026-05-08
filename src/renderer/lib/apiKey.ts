const STORAGE_KEY = 'coresense.apiKey';

export function loadApiKey(): string | null {
  return sessionStorage.getItem(STORAGE_KEY);
}

export function saveApiKey(key: string): void {
  sessionStorage.setItem(STORAGE_KEY, key.trim());
}

export function clearApiKey(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}
