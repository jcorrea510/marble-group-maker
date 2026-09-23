import { expect, type Page } from '@playwright/test';

export interface RaceDebug {
  phase: 'intro' | 'countdown' | 'racing' | 'finished';
  seed: number;
  courseCode: string;
  sectionTypes: string[];
  trackHeight: number;
  raceTimeMs: number;
  raceWallSeconds: number;
  playbackSpeed: number;
  finished: number;
  stats: { steps: number; marbleCollisions: number; obstacleCollisions: number; nudges: number; rescues: number };
  positions: { name: string; x: number; y: number }[];
  finishOrder: string[];
}

/** Collects console errors and uncaught exceptions for a page. */
export function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  return problems;
}

export async function freshStart(page: Page, query = '') {
  await page.goto(`/${query}`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/${query}`);
  await expect(page.getByRole('heading', { name: "Who's racing?" })).toBeVisible();
}

/** Simulates pasting text into the name box (like Ctrl+V). */
export async function pasteNames(page: Page, text: string) {
  await page.getByTestId('name-input').evaluate((el, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

export function names(count: number): string[] {
  const pool = [
    'John', 'Sarah', 'Mike', 'Alex', 'Emma', 'Chris', 'Jack', 'Nicole', 'Priya', 'Omar',
    'Lena', 'Diego', 'Yuki', 'Fatima', 'Noah', 'Ava', 'Liam', 'Mia', 'Ethan', 'Zoe',
    'Lucas', 'Chloe', 'Mateo', 'Isla', 'Kai', 'Nora', 'Leo', 'Ruby', 'Finn', 'Ivy',
  ];
  return Array.from({ length: count }, (_, i) => pool[i % pool.length] + (i >= pool.length ? ` ${Math.floor(i / pool.length) + 1}` : ''));
}

export async function setGroups(page: Page, count: number) {
  const input = page.getByTestId('group-count');
  await input.fill(String(count));
  await input.blur();
  await expect(input).toHaveValue(String(count));
}

export async function getRace(page: Page): Promise<RaceDebug> {
  return page.evaluate(() => (window as unknown as { __marbleRace: RaceDebug }).__marbleRace);
}

export async function waitForPhase(page: Page, phase: RaceDebug['phase'], timeout = 60_000) {
  await page.waitForFunction(
    (p) => (window as unknown as { __marbleRace?: { phase: string } }).__marbleRace?.phase === p,
    phase,
    { timeout },
  );
}

/** Reads the group cards on the results screen: [[names in group 1], [group 2], ...]. */
export async function readGroups(page: Page): Promise<string[][]> {
  const cards = page.getByTestId('group-card');
  const count = await cards.count();
  const groups: string[][] = [];
  for (let i = 0; i < count; i++) {
    groups.push(await cards.nth(i).locator('.gc-name').allInnerTexts());
  }
  return groups;
}

export async function readFinishOrder(page: Page): Promise<string[]> {
  return page.getByTestId('finish-order').locator('.order-name').allInnerTexts();
}
