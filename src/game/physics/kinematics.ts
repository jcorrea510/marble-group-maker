import type { SliderItem, SpinnerItem } from '../track/types';

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
