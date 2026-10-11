import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { setAppInfo } from '../../../../src/main/runtime/appInfo';
import { setUserDataDir } from '../../../../src/main/runtime/userData';
import { flushSettings, settingsStore } from '../../../../src/main/storage/settings';
import { clampTelemetryRetention } from '../../../../src/main/telemetry/retention';

let dir: string;

const write = (value: unknown) => writeFileSync(join(dir, 'app-settings.json'), JSON.stringify(value), 'utf8');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coresense-app-telemetry-'));
  setUserDataDir(dir);
  setAppInfo({ isPackaged: true, appPath: process.cwd() });
});

afterEach(async () => {
  await flushSettings();
  setAppInfo(null);
  setUserDataDir(null);
  rmSync(dir, { recursive: true, force: true });
});

describe('AppSettings.telemetry.retentionPerNode on load', () => {
  test('defaults to 50 when the file predates the field', () => {
    write({ messageStyle: 'compact' });
    expect(settingsStore.loadAppSettings().telemetry).toEqual({ retentionPerNode: 50 });
  });

  test.each([
    [9999, 500],
    [0, 1],
    [-4, 1],
    [12.7, 12],
    ['20', 50],
    [null, 50],
  ])('normalises a hand-edited %p to %p', (stored, expected) => {
    write({ telemetry: { retentionPerNode: stored } });
    expect(settingsStore.loadAppSettings().telemetry.retentionPerNode).toBe(expected);
  });

  test('survives a stored `"telemetry": null`', () => {
    write({ telemetry: null });
    expect(settingsStore.loadAppSettings().telemetry).toEqual({ retentionPerNode: 50 });
  });
});

describe('clampTelemetryRetention', () => {
  test('falls back to the default for garbage rather than clamping it', () => {
    expect(clampTelemetryRetention(Number.NaN)).toBe(50);
    expect(clampTelemetryRetention(undefined)).toBe(50);
    expect(clampTelemetryRetention(Number.POSITIVE_INFINITY)).toBe(50);
    expect(clampTelemetryRetention(1)).toBe(1);
    expect(clampTelemetryRetention(500)).toBe(500);
  });
});
