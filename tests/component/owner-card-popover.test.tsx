import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useStore } from '@/lib/store';
import { OwnerCardPopover } from '@/shell/leftnav/OwnerCardPopover';
import { DEFAULT_DEVICE_INFO } from '../../src/shared/types';

describe('OwnerCardPopover', () => {
  test('renders Device group with model, firmware version, and build date', () => {
    useStore.setState({
      deviceInfo: {
        ...DEFAULT_DEVICE_INFO,
        deviceModel: 'Heltec T096',
        firmwareVersion: 'v1.15.0',
        firmwareVerCode: 11,
        firmwareBuildDate: '19 Apr 2026',
      },
    });

    render(<OwnerCardPopover />);

    expect(screen.getByText('Device')).toBeTruthy();
    expect(screen.getByText('Heltec T096')).toBeTruthy();
    expect(screen.getByText('v1.15.0 (ver 11)')).toBeTruthy();
    expect(screen.getByText('19 Apr 2026')).toBeTruthy();
  });
});
