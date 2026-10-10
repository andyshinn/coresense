import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/lib/api', () => ({
  api: { putAppSettings: vi.fn(async () => ({ ok: true })) },
}));

import { NotificationsSection } from '../../src/renderer/panels/settings/app/Notifications';
import { TEST_CLIENT } from '../support/apiClient';

describe('NotificationsSection', () => {
  it('renders the backlog-summary toggle row', () => {
    render(<NotificationsSection client={TEST_CLIENT} />);
    expect(screen.getByText('Summarize while away')).toBeTruthy();
  });
});
