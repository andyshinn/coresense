import { beforeEach } from 'vitest';

// Polyfill localStorage for Node environment
const localStorageStore: Record<string, string> = {};

global.localStorage = {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, value: string) => {
    localStorageStore[key] = value;
  },
  removeItem: (key: string) => {
    delete localStorageStore[key];
  },
  clear: () => {
    Object.keys(localStorageStore).forEach((k) => {
      delete localStorageStore[k];
    });
  },
  key: (index: number) => Object.keys(localStorageStore)[index] ?? null,
  length: Object.keys(localStorageStore).length,
} as Storage;

// Reset localStorage before each test
beforeEach(() => {
  localStorage.clear();
});
