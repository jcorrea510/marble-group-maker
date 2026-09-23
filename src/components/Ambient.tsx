import type { CSSProperties } from 'react';
import { BASE_PALETTE } from '../game/colors';

const MARBLES = [
  { x: '6%', y: '14%', size: 26, color: 0, delay: 0 },
  { x: '92%', y: '22%', size: 18, color: 1, delay: -4 },
  { x: '84%', y: '78%', size: 30, color: 2, delay: -8 },
  { x: '10%', y: '82%', size: 16, color: 6, delay: -2 },
  { x: '48%', y: '94%', size: 12, color: 3, delay: -11 },
  { x: '70%', y: '6%', size: 10, color: 4, delay: -6 },
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
