import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ByteStrip } from '@/components/packet/ByteStrip';
import type { InspectField } from '@/lib/packetInspect';

const fields: InspectField[] = [
  { key: 'header', name: 'Header', start: 0, end: 0, colorIdx: 0, value: '15' },
  { key: 'payload', name: 'Payload', start: 1, end: 2, colorIdx: 1, value: '012A' },
];

function Harness() {
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <div>
      <span data-testid="hovered">{hovered ?? 'none'}</span>
      <ByteStrip bytes={[0x15, 0x01, 0x2a]} fields={fields} scope="pk" hovered={hovered} setHovered={setHovered} />
    </div>
  );
}

describe('ByteStrip', () => {
  it('renders one cell per byte as uppercase hex pairs', () => {
    render(<Harness />);
    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.getByText('2A')).toBeTruthy();
  });

  it('sets scoped hovered id on mouse enter', () => {
    render(<Harness />);
    fireEvent.mouseEnter(screen.getByText('15'));
    expect(screen.getByTestId('hovered').textContent).toBe('pk:header');
  });

  it('updates the hovered id as the pointer moves between cells (no null in between)', () => {
    render(<Harness />);
    fireEvent.mouseEnter(screen.getByText('15')); // byte 0 → header
    expect(screen.getByTestId('hovered').textContent).toBe('pk:header');
    fireEvent.mouseEnter(screen.getByText('2A')); // byte 2 → payload
    // Moving straight to another cell swaps the id; it never blinks to 'none'.
    expect(screen.getByTestId('hovered').textContent).toBe('pk:payload');
  });

  it('clears the hovered id only when the pointer leaves the whole strip', () => {
    render(<Harness />);
    fireEvent.mouseEnter(screen.getByText('15'));
    const strip = screen.getByText('15').closest('div');
    expect(strip).toBeTruthy();
    if (strip) fireEvent.mouseLeave(strip);
    expect(screen.getByTestId('hovered').textContent).toBe('none');
  });
});
