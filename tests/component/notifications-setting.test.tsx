import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/lib/api', () => ({
  api: { putAppSettings: vi.fn(async () => ({ ok: true })) },
}));

import { NotificationsSection } from '../../src/renderer/panels/settings/app/Notifications';

describe('NotificationsSection', () => {
  it('renders the backlog-summary toggle row', () => {
    render(<NotificationsSection client={{ baseUrl: 'http://x', apiKey: 'k' }} />);
    expect(screen.getByText('Summarize while away')).toBeTruthy();
  });
});
