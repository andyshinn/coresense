const STORAGE_KEY = 'coresense.apiKey';

export function loadApiKey(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function saveApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, key.trim());
}

export function clearApiKey(): void {
  localStorage.removeItem(STORAGE_KEY);
}
