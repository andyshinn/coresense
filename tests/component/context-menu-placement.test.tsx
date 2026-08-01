import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ContextMenu, menuItem, placeMenu } from '@/components/ContextMenu';

// A 1000×800 window with a 180×300 menu, so every expected number below is
// checkable by hand. EDGE_PADDING is 8.
const VW = 1000;
const VH = 800;
const W = 180;
const H = 300;

describe('placeMenu', () => {
  test('leaves a menu that fits exactly where the cursor put it', () => {
    expect(placeMenu(100, 100, W, H, VW, VH)).toMatchObject({ left: 100, top: 100 });
  });

  test('flips above the cursor when the menu would run past the bottom', () => {
    // The reported bug: right-clicking the last row in the list put the menu
    // half behind the composer. 700 + 300 overflows, so the bottom edge goes
    // to the cursor instead.
    expect(placeMenu(100, 700, W, H, VW, VH).top).toBe(400);
  });

  test('flips left when the menu would run past the right edge', () => {
    expect(placeMenu(900, 100, W, H, VW, VH).left).toBe(720);
  });

  test('keeps the edge padding when the cursor is in the very corner', () => {
    // Flipping alone lands at 820/500, both of which still overflow by less
    // than the padding — the clamp is what pulls them back to 812/492.
    expect(placeMenu(VW, VH, W, H, VW, VH)).toMatchObject({ left: 812, top: 492 });
  });

  test('clamps rather than flipping off-screen when the menu is taller than the window', () => {
    // Flipping a 900-tall menu at y=700 yields top: -200 — the clamp is the
    // only thing keeping its first item reachable, and maxHeight makes the rest
    // scrollable instead of unreachable.
    expect(placeMenu(100, 700, W, 900, VW, VH)).toMatchObject({ top: 8, maxHeight: 784 });
  });
});

describe('ContextMenu', () => {
  test('applies the measured placement to the rendered menu', () => {
    // jsdom measures every element as 0×0, so left/top stay at the cursor;
    // maxHeight is the one output that proves the layout effect ran and its
    // result reached the DOM (jsdom's window is 1024×768 ⇒ 768 - 2×8).
    render(<ContextMenu x={100} y={100} items={[menuItem('Copy text', () => {})]} onClose={() => {}} />);
    const menu = screen.getByRole('menu');
    expect(menu.style.maxHeight).toBe('752px');
  });
});
