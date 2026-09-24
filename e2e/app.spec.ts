import { expect, test, type Page } from '@playwright/test';
import {
  freshStart,
  getRace,
  names,
  pasteNames,
  readFinishOrder,
  readGroups,
  setGroups,
  waitForPhase,
  watchConsole,
  type RaceDebug,
} from './helpers';

let consoleProblems: string[] = [];

test.beforeEach(async ({ page }) => {
  consoleProblems = watchConsole(page);
});

test.afterEach(async () => {
  expect(consoleProblems, 'no console errors').toEqual([]);
});

/** Watches a race from the start to the results screen and checks it was real. */
async function watchRace(page: Page, expectedCount: number) {
  await expect(page.getByTestId('race-screen')).toBeVisible();
  // The course preview and countdown come first.
  await expect(page.getByTestId('intro-card')).toBeVisible();
  await waitForPhase(page, 'countdown');
  await expect(page.getByTestId('countdown')).toBeVisible();
  await waitForPhase(page, 'racing');
  const atStart = await getRace(page);
  expect(atStart.positions).toHaveLength(expectedCount);

  await page.waitForTimeout(1500);
  const soon = await getRace(page);
  const moved = soon.positions.filter((p, i) => Math.hypot(p.x - atStart.positions[i].x, p.y - atStart.positions[i].y) > 50);
  expect(moved.length, 'marbles are moving').toBe(expectedCount);

  await waitForPhase(page, 'finished', 120_000);
  const finished: RaceDebug = await getRace(page);
  expect(finished.finished).toBe(expectedCount);
  expect(finished.stats.marbleCollisions + finished.stats.obstacleCollisions, 'collisions happen').toBeGreaterThan(expectedCount);
  await expect(page.getByTestId('finish-banner')).toBeVisible();

  await expect(page.getByTestId('results-screen')).toBeVisible({ timeout: 20_000 });
  const order = await readFinishOrder(page);
  // The results are exactly the order the marbles crossed the finish line.
  expect(order).toEqual(finished.finishOrder);
  expect(new Set(order).size).toBe(expectedCount);
  return { race: finished, order };
}

function expectGroups(groups: string[][], order: string[], sizes: number[]) {
  expect(groups.map((g) => g.length)).toEqual(sizes);
  expect(groups.flat()).toEqual(order); // Group 1 = first finishers, and so on
}

test('pasting a list adds everyone, one per line', async ({ page }) => {
  await freshStart(page);
  await pasteNames(page, 'John\nSarah\nMike\nAlex\nEmma\nChris\nJack\nNicole');
  await expect(page.getByTestId('participant-count')).toContainText('8');
  await expect(page.getByTestId('participant-list').locator('.person-name')).toHaveText([
    'John', 'Sarah', 'Mike', 'Alex', 'Emma', 'Chris', 'Jack', 'Nicole',
  ]);
  // Typing a single name + Enter adds it.
  await page.getByTestId('name-input').fill('Priya');
  await page.getByTestId('name-input').press('Enter');
  await expect(page.getByTestId('participant-count')).toContainText('9');
  // Removing works (and can be undone).
  await page.getByRole('button', { name: 'Remove Mike' }).click();
  await expect(page.getByTestId('participant-count')).toContainText('8');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('participant-count')).toContainText('9');
  // Shuffle keeps the same people.
  const before = (await page.getByTestId('participant-list').locator('.person-name').allInnerTexts()).sort();
  await page.getByTestId('shuffle').click();
  const after = (await page.getByTestId('participant-list').locator('.person-name').allInnerTexts()).sort();
  expect(after).toEqual(before);
});

test('invalid setups are prevented', async ({ page }) => {
  await freshStart(page);
  const start = page.getByTestId('start-race');
  const message = page.getByTestId('setup-message');

  // Zero participants.
  await expect(start).toBeDisabled();
  await expect(message).toContainText('Add some names');

  // Blank lines / spaces only add nobody.
  await page.getByTestId('name-input').fill('   \n  \n');
  await page.getByTestId('name-input').press('Enter');
  await expect(start).toBeDisabled();

  // One participant is not a race.
  await page.getByTestId('name-input').fill('Solo');
  await page.getByTestId('name-input').press('Enter');
  await expect(start).toBeDisabled();
  await expect(message).toContainText('at least 2');

  // More groups than people.
  await pasteNames(page, 'Ann\nBen');
  await setGroups(page, 4);
  await expect(start).toBeDisabled();
  await expect(message).toContainText("can't make 4 groups from 3 people");

  // Zero groups.
  await page.getByTestId('group-count').fill('0');
  await expect(start).toBeDisabled();

  // Fixing it enables the button.
  await setGroups(page, 3);
  await expect(start).toBeEnabled();

  // Duplicate names get a number so everyone stays distinguishable.
  await pasteNames(page, 'Ann\nann');
  await expect(page.getByTestId('participant-list').locator('.person-name')).toContainText(['Ann 2', 'ann 3']);
});

test('4 participants / 2 groups: full race at normal speed takes about 20 seconds', async ({ page }) => {
  await freshStart(page);
  await pasteNames(page, 'John\nSarah\nMike\nAlex');
  await setGroups(page, 2);
  await page.getByTestId('start-race').click();

  await waitForPhase(page, 'racing');
  const t0 = Date.now();
  await waitForPhase(page, 'finished', 90_000);
  const seconds = (Date.now() - t0) / 1000;
  console.log(`Race took ${seconds.toFixed(1)}s on screen`);
  expect(seconds).toBeGreaterThan(13);
  expect(seconds).toBeLessThan(28);

  await expect(page.getByTestId('results-screen')).toBeVisible({ timeout: 20_000 });
  const order = await readFinishOrder(page);
  expect(order.sort()).toEqual(['Alex', 'John', 'Mike', 'Sarah']);
  const groups = await readGroups(page);
  expectGroups(groups, await readFinishOrder(page), [2, 2]);
});

test('10 participants / 3 groups: uneven groups are 4, 3, 3', async ({ page }) => {
  await freshStart(page, '?speed=3');
  await pasteNames(page, names(10).join('\n'));
  await setGroups(page, 3);
  await expect(page.getByTestId('group-preview').locator('.group-bar-size')).toHaveText(['4', '3', '3']);
  await page.getByTestId('start-race').click();
  const { order } = await watchRace(page, 10);
  expectGroups(await readGroups(page), order, [4, 3, 3]);
});

test('24 participants / 5 groups', async ({ page }) => {
  await freshStart(page, '?speed=3');
  await pasteNames(page, names(24).join('\n'));
  await expect(page.getByTestId('participant-count')).toContainText('24');
  await setGroups(page, 5);
  await page.getByTestId('start-race').click();
  const { order } = await watchRace(page, 24);
  expectGroups(await readGroups(page), order, [5, 5, 5, 5, 4]);
});

test('race again: same people, new course every time, several races in a row', async ({ page }) => {
  await freshStart(page, '?speed=4');
  await pasteNames(page, names(7).join('\n'));
  await setGroups(page, 2);
  await page.getByTestId('start-race').click();

  const courses: string[] = [];
  const layouts: string[] = [];
  for (let race = 1; race <= 3; race++) {
    if (race > 1) await page.getByTestId('race-again').click();
    await waitForPhase(page, 'intro');
    const { race: debug, order } = await watchRace(page, 7);
    courses.push(debug.courseCode);
    layouts.push(`${debug.sectionTypes.join(',')}|${Math.round(debug.trackHeight)}`);
    expect(order.slice().sort()).toEqual(names(7).sort());
    expectGroups(await readGroups(page), order, [4, 3]);
    await expect(page.getByTestId('results-screen')).toContainText(`Race ${race}`);
  }
  expect(new Set(courses).size, 'a new course code for every race').toBe(3);
  expect(new Set(layouts).size, 'a genuinely different layout for every race').toBe(3);
});

test('edit participants goes back to setup and keeps the list', async ({ page }) => {
  await freshStart(page, '?speed=4');
  await pasteNames(page, 'Ann\nBen\nCal\nDee\nEve');
  await setGroups(page, 2);
  await page.getByTestId('start-race').click();
  await watchRace(page, 5);

  await page.getByTestId('edit-participants').click();
  await expect(page.getByTestId('participant-count')).toContainText('5');
  await expect(page.getByTestId('group-count')).toHaveValue('2');
  await page.getByRole('button', { name: 'Remove Ben' }).click();
  await pasteNames(page, 'Fay\nGus');
  await expect(page.getByTestId('participant-count')).toContainText('6');
  await setGroups(page, 3);
  await page.getByTestId('start-race').click();
  const { order } = await watchRace(page, 6);
  expect(order.slice().sort()).toEqual(['Ann', 'Cal', 'Dee', 'Eve', 'Fay', 'Gus']);
  expectGroups(await readGroups(page), order, [2, 2, 2]);
});

test('refreshing the page keeps participants and results', async ({ page }) => {
  await freshStart(page, '?speed=4');
  await pasteNames(page, 'Ann\nBen\nCal\nDee');
  await setGroups(page, 2);

  // Refresh on the setup screen.
  await page.reload();
  await expect(page.getByTestId('participant-count')).toContainText('4');
  await expect(page.getByTestId('group-count')).toHaveValue('2');

  // Refresh in the middle of a race: back to setup, nothing lost.
  await page.getByTestId('start-race').click();
  await waitForPhase(page, 'racing');
  await page.reload();
  await expect(page.getByTestId('participant-count')).toContainText('4');

  // Finish a race, then refresh on the results screen.
  await page.getByTestId('start-race').click();
  const { order } = await watchRace(page, 4);
  await page.reload();
  await expect(page.getByTestId('results-screen')).toBeVisible();
  expect(await readFinishOrder(page)).toEqual(order);

  // And the app still works after the refresh.
  await page.getByTestId('race-again').click();
  await watchRace(page, 4);
});

test('mobile: setup and results screens fit a phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  consoleProblems = watchConsole(page);
  await freshStart(page, '?speed=4');
  await pasteNames(page, names(9).join('\n'));
  await setGroups(page, 3);
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(await noSideScroll()).toBe(true);
  await expect(page.getByTestId('start-race')).toBeInViewport();
  await page.getByTestId('start-race').click();
  const { order } = await watchRace(page, 9);
  expect(await noSideScroll()).toBe(true);
  expectGroups(await readGroups(page), order, [3, 3, 3]);
  await context.close();
});

test('keyboard: Ctrl+Enter adds typed names first, then starts the race', async ({ page }) => {
  await freshStart(page, '?speed=4');
  await page.getByTestId('name-input').fill('Ann\nBen\nCal');
  await page.getByTestId('name-input').press('Control+Enter');
  await expect(page.getByTestId('participant-count')).toContainText('3');
  await expect(page.getByTestId('start-race')).toBeEnabled();
  await page.getByTestId('name-input').press('Control+Enter');
  await watchRace(page, 3);
});

test('race again re-checks the setup if the list was edited to something invalid', async ({ page }) => {
  await freshStart(page, '?speed=4');
  await pasteNames(page, 'Ann\nBen\nCal');
  await setGroups(page, 3);
  await page.getByTestId('start-race').click();
  await watchRace(page, 3);
  await page.getByTestId('edit-participants').click();
  await page.getByRole('button', { name: 'Remove Ben' }).click();
  await page.getByRole('button', { name: 'Last results' }).click();
  await page.getByTestId('race-again').click();
  // Back on setup with an explanation instead of an impossible race.
  await expect(page.getByTestId('start-race')).toBeDisabled();
  await expect(page.getByTestId('setup-message')).toContainText("can't make 3 groups from 2 people");
});

test('people per group: 10 people in groups of 4 become 4, 3, 3', async ({ page }) => {
  await freshStart(page, '?speed=4');
  await pasteNames(page, names(10).join('\n'));
  await page.getByTestId('mode-size').click();
  await setGroups(page, 4);
  await expect(page.getByTestId('group-preview').locator('.group-bar-size')).toHaveText(['4', '3', '3']);
  await page.getByTestId('start-race').click();
  const { order } = await watchRace(page, 10);
  expectGroups(await readGroups(page), order, [4, 3, 3]);
  // The setting is remembered for Race again.
  await page.getByTestId('race-again').click();
  const second = await watchRace(page, 10);
  expectGroups(await readGroups(page), second.order, [4, 3, 3]);
});

test('class periods: separate saved lists that survive a refresh', async ({ page }) => {
  await freshStart(page, '?speed=4');
  const tabs = page.getByTestId('class-tab');
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toContainText('Period 1');
  await pasteNames(page, 'Ann\nBen\nCal\nDee');

  // A second period with its own list and setting.
  await page.getByTestId('add-class').click();
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toContainText('Period 2');
  await expect(page.getByTestId('participant-count')).toContainText('0');
  await pasteNames(page, 'Xia\nYul\nZed\nWes\nVal\nUma');
  await setGroups(page, 3);

  // Rename it.
  await tabs.nth(1).click();
  await page.getByTestId('class-name-input').fill('Period 2 Biology');
  await page.keyboard.press('Enter');
  await expect(tabs.nth(1)).toContainText('Period 2 Biology');

  // Switching shows each period's own names and group count.
  await tabs.first().click();
  await expect(page.getByTestId('participant-list').locator('.person-name')).toHaveText(['Ann', 'Ben', 'Cal', 'Dee']);
  await expect(page.getByTestId('group-count')).toHaveValue('2');
  await tabs.nth(1).click();
  await expect(page.getByTestId('participant-count')).toContainText('6');
  await expect(page.getByTestId('group-count')).toHaveValue('3');

  // Race period 2; its results are saved with it.
  await page.getByTestId('start-race').click();
  const { order } = await watchRace(page, 6);
  await expect(page.getByTestId('results-screen')).toContainText('Period 2 Biology');

  // Everything is still there after a refresh.
  await page.reload();
  await expect(page.getByTestId('results-screen')).toBeVisible();
  expect(await readFinishOrder(page)).toEqual(order);
  await page.getByTestId('edit-participants').click();
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toContainText('Period 2 Biology');
  await expect(page.getByTestId('last-results')).toBeVisible();
  await tabs.first().click();
  await expect(page.getByTestId('participant-count')).toContainText('4');
  await expect(page.getByTestId('last-results')).toHaveCount(0); // period 1 hasn't raced yet

  // Deleting can be undone.
  await tabs.nth(1).click();
  await page.getByTestId('delete-class').click();
  await expect(tabs).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(tabs).toHaveCount(2);
  await expect(page.getByTestId('participant-count')).toContainText('6');
});

test('a list saved by the previous version moves into Period 1', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      'marble-group-maker:v1',
      JSON.stringify({
        participants: [
          { id: 'a', name: 'Old One', colorIndex: 0 },
          { id: 'b', name: 'Old Two', colorIndex: 1 },
          { id: 'c', name: 'Old Three', colorIndex: 2 },
        ],
        groupCount: 3,
        lastResult: null,
        showResults: false,
        raceCount: 4,
        muted: false,
      }),
    );
  });
  await page.reload();
  await expect(page.getByTestId('class-tab').first()).toContainText('Period 1');
  await expect(page.getByTestId('participant-list').locator('.person-name')).toHaveText(['Old One', 'Old Two', 'Old Three']);
  await expect(page.getByTestId('group-count')).toHaveValue('3');
});
