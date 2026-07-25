import { describe, expect, it } from 'vitest';
import { buildCatalog } from '@/panels/macros/lib/catalog';
import { getManifest } from '../../../../../src/shared/macros';

describe('buildCatalog', () => {
  const catalog = buildCatalog(getManifest());

  it('includes every manifest variable as a known name', () => {
    expect(catalog.variableNames.has('my_name')).toBe(true);
    expect(catalog.variableNames.has('sender_name')).toBe(true);
  });

  it('marks reply-only variables and excludes always-available ones', () => {
    expect(catalog.replyOnlyNames.has('sender_name')).toBe(true);
    expect(catalog.replyOnlyNames.has('snr')).toBe(true);
    expect(catalog.replyOnlyNames.has('my_name')).toBe(false);
    expect(catalog.replyOnlyNames.has('peer_name')).toBe(false);
  });

  it('lists the MeshCore custom filters', () => {
    expect(catalog.customFilterNames.has('distance')).toBe(true);
    expect(catalog.customFilterNames.has('bearing')).toBe(true);
    expect(catalog.customFilterNames.has('unit')).toBe(true);
  });
});
