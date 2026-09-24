import type { PendulumItem, SliderItem, SpinnerItem } from '../track/types';

/**
 * Moving obstacles follow simple formulas of time. The physics engine and
 * the renderer both use these, so what you see is exactly what marbles hit.
 */
export function spinnerAngle(item: SpinnerItem, timeSec: number): number {
  return item.phase + item.speed * timeSec;
}

export function sliderOffset(item: SliderItem, timeSec: number): number {
  return item.amplitude * Math.sin((2 * Math.PI * timeSec) / item.period + item.phase);
}

export function pendulumAngle(item: PendulumItem, timeSec: number): number {
  return item.amplitude * Math.sin((2 * Math.PI * timeSec) / item.period + item.phase);
}

/** Centre of the wrecking ball at a given swing angle. */
export function pendulumBob(item: PendulumItem, angle: number): { x: number; y: number } {
  return { x: item.pivotX + Math.sin(angle) * item.length, y: item.pivotY + Math.cos(angle) * item.length };
}
