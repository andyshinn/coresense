import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CliReverseSearch } from '@/panels/repeater-admin/cli/CliReverseSearch';

describe('CliReverseSearch', () => {
  it('highlights the matched substring and shows the position counter', () => {
    render(<CliReverseSearch query="rad" match={{ text: 'get radio', status: 'ok' }} index={0} total={3} />);
    const radElements = screen.getAllByText('rad');
    const highlighted = radElements.find((el) => el.className.includes('text-cs-accent'));
    expect(highlighted?.className).toMatch(/text-cs-accent/);
    expect(screen.getByText('1/3')).toBeTruthy();
  });

  it('shows the status glyph for the matched entry', () => {
    render(<CliReverseSearch query="re" match={{ text: 'reboot', status: 'timeout' }} index={1} total={2} />);
    expect(screen.getByText('⧗')).toBeTruthy();
  });

  it('reads "failing reverse-i-search" and suppresses the counter when there is no match', () => {
    render(<CliReverseSearch query="zzz" match={null} index={0} total={0} />);
    expect(screen.getByText(/failing reverse-i-search/)).toBeTruthy();
    expect(screen.queryByText('0/0')).toBeNull();
  });
});
