import type { SectionType } from '../track/types';

/** Each kind of section gets its own neon colour, so the course reads at a glance. */
export const SECTION_COLORS: Record<SectionType, string> = {
  start: '#8f98d6',
  pegs: '#a58cff',
  zigzag: '#22d3ee',
  mud: '#e0a84a',
  funnel: '#ff5c8a',
  bumpers: '#ff9f1c',
  spinners: '#ffd23f',
  sliders: '#1ee3cf',
  drop: '#6b8cff',
  split: '#2ed573',
  finish: '#ffc53d',
};

export const WALL_BODY = '#161a36';
export const WALL_OUTLINE = '#04050b';
export const BACKGROUND = '#070912';
export const LABEL_FONT = '"Manrope Variable", system-ui, sans-serif';
export const DISPLAY_FONT = '"Bricolage Grotesque Variable", "Manrope Variable", system-ui, sans-serif';
