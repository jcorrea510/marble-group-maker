import type { CSSProperties } from 'react';
import { marbleStyle } from '../game/colors';

/** A small CSS-drawn marble matching the participant's in-race marble. */
export function MarbleSwatch({ colorIndex, size = 22 }: { colorIndex: number; size?: number }) {
  const style = marbleStyle(colorIndex);
  return (
    <span
      className={`swatch${style.twoTone ? ' two-tone' : ''}`}
      style={{ '--base': style.base, '--swirl': style.swirl, '--size': `${size}px` } as CSSProperties}
      aria-hidden="true"
    />
  );
}
