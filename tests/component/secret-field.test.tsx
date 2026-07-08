import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SecretField } from '@/components/SecretField';

const SECRET = 'deadbeefdeadbeefdeadbeefdeadbeef';

describe('SecretField', () => {
  it('masks the secret by default and reveals on click', () => {
    render(<SecretField secretHex={SECRET} />);
    expect(screen.queryByText(SECRET)).toBeNull();
    fireEvent.click(screen.getByLabelText('Reveal secret'));
    const revealedElement = screen.getByText(SECRET);
    expect(revealedElement).toBeTruthy();
    expect(revealedElement.className).toContain('whitespace-normal');
  });

  it('offers a copy control', () => {
    render(<SecretField secretHex={SECRET} />);
    expect(screen.getByTitle('Copy secret')).toBeTruthy();
  });
});
