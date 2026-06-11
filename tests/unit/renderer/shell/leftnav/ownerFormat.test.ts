import { describe, expect, it } from 'vitest';
import {
  fmtBandwidth,
  fmtFreq,
  fmtFreqMhz,
  fmtGpsInterval,
  fmtStorageKb,
} from '../../../../../src/renderer/shell/leftnav/ownerFormat';

describe('ownerFormat', () => {
  it('formats frequency with and without unit', () => {
    expect(fmtFreqMhz(910_525_000)).toBe('910.525');
    expect(fmtFreq(910_525_000)).toBe('910.525 MHz');
  });
  it('formats bandwidth in kHz', () => {
    expect(fmtBandwidth(62_500)).toBe('62.5 kHz');
  });
  it('formats storage, switching to MB past 1024 KB', () => {
    expect(fmtStorageKb(412)).toBe('412 KB');
    expect(fmtStorageKb(1536)).toBe('1.5 MB');
  });
  it('formats gps interval as minutes on even minutes', () => {
    expect(fmtGpsInterval(300)).toBe('5 min');
    expect(fmtGpsInterval(45)).toBe('45s');
  });
});
