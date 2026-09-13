import { GPUInitializationError } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { isGpuInitializationError } from '../../../../../src/renderer/lib/map/gpu-error';

describe('isGpuInitializationError', () => {
  it("recognises maplibre-gl's real GPUInitializationError by name", () => {
    // Guards the upstream contract we match on: if maplibre renames the class or
    // stops setting `name`, the WebGL2 fallback copy silently stops showing.
    expect(isGpuInitializationError(new GPUInitializationError({}, null))).toBe(true);
  });

  it('rejects other errors and non-errors', () => {
    expect(isGpuInitializationError(new Error('WebGL2 is required'))).toBe(false);
    expect(isGpuInitializationError({ name: 'GPUInitializationError' })).toBe(false);
    expect(isGpuInitializationError(undefined)).toBe(false);
  });
});
