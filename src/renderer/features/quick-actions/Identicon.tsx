import type { ReactNode } from 'react';
import { identiconCells } from './identicon-cells';

/** Amber-on-dark deterministic identicon for a radio's public key. */
export function Identicon({ hex, size = 32 }: { hex: string; size?: number }) {
  const cells = identiconCells(hex);
  const pad = 5;
  const cell = (size - pad * 2) / 5;
  const rects: ReactNode[] = [];
  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 5; row++) {
      if (!cells[col * 5 + row]) continue;
      rects.push(
        <rect
          key={`${col}-${row}`}
          x={pad + col * cell}
          y={pad + row * cell}
          width={cell + 0.5}
          height={cell + 0.5}
          rx={0.8}
          fill="currentColor"
        />,
      );
    }
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-cs-border bg-cs-bg-3 text-cs-accent"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {rects}
      </svg>
    </div>
  );
}
