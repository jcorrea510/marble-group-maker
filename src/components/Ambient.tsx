import type { CSSProperties } from 'react';
import { BASE_PALETTE } from '../game/colors';

// Kept in the page margins so they never sit on top of content.
const MARBLES = [
  { x: '3%', y: '16%', size: 24, color: 0, delay: 0 },
  { x: '95.5%', y: '24%', size: 16, color: 1, delay: -4 },
  { x: '95%', y: '72%', size: 28, color: 2, delay: -8 },
  { x: '2.5%', y: '80%', size: 16, color: 6, delay: -2 },
  { x: '4%', y: '48%', size: 11, color: 3, delay: -11 },
  { x: '94%', y: '48%', size: 10, color: 4, delay: -6 },
];

/** Soft glowing background with a few floating marbles. */
export function Ambient() {
  return (
    <div className="ambient" aria-hidden="true">
      {MARBLES.map((m, i) => {
        const color = BASE_PALETTE[m.color];
        const style: CSSProperties = {
          left: m.x,
          top: m.y,
          width: m.size,
          height: m.size,
          animationDelay: `${m.delay}s`,
          background: `radial-gradient(circle at 35% 30%, #fff 0 10%, ${color} 45%, #000 140%)`,
          boxShadow: `0 0 ${m.size}px ${color}66`,
        };
        return <span key={i} className="ambient-marble" style={style} />;
      })}
    </div>
  );
}
