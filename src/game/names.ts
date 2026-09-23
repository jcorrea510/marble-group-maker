export const MAX_NAME_LENGTH = 24;
export const MIN_PARTICIPANTS = 2;
export const MAX_PARTICIPANTS = 50;

/**
 * Turns pasted text into a clean list of names.
 *
 * - One name per line (the main format).
 * - A single line with commas or semicolons is split on those too,
 *   so "John, Sarah, Mike" also works.
 * - List markers like "1.", "2)", "-", "•" are stripped, so a numbered
 *   list copied from a document works.
 * - Blank lines and extra spaces are ignored.
 */
export function parseNames(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const pieces: string[] = [];
  for (const line of lines) {
    const parts = /[,;\t]/.test(line) ? line.split(/[,;\t]/) : [line];
    for (const part of parts) {
      const name = cleanName(part);
      if (name) pieces.push(name);
    }
  }
  return pieces;
}

export function cleanName(raw: string): string {
  let name = raw.replace(/\s+/g, ' ').trim();
  // Strip leading list markers: "1. ", "12) ", "- ", "* ", "• "
  name = name.replace(/^(?:\d{1,3}[.)]\s+|[-*•·]\s*)/, '').trim();
  if (name.length > MAX_NAME_LENGTH) name = name.slice(0, MAX_NAME_LENGTH).trim();
  return name;
}

/**
 * Makes a name unique among `existing` by adding a number:
 * "Alex" -> "Alex 2" -> "Alex 3". Comparison ignores upper/lower case.
 */
export function uniqueName(name: string, existing: Iterable<string>): string {
  const taken = new Set(Array.from(existing, (n) => n.toLocaleLowerCase()));
  if (!taken.has(name.toLocaleLowerCase())) return name;
  for (let i = 2; ; i++) {
    const suffix = ` ${i}`;
    const base = name.slice(0, MAX_NAME_LENGTH - suffix.length).trim();
    const candidate = `${base}${suffix}`;
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

/** Initials used on small badges, e.g. "Sarah Lee" -> "SL", "mike" -> "MI". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join('').toUpperCase();
  return (Array.from(words[0])[0] + Array.from(words[words.length - 1])[0]).toUpperCase();
}
