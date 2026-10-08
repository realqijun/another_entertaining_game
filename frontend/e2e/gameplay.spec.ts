import { test, expect, expectRoom, savedGame, seedSave } from './fixtures';
import { advanceTurn, newGame } from '../src/sim';

test('completes the first-week tutorial, purchases equipment and resumes after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expectRoom(page);
  await expect(page.getByRole('dialog', { name: /Tutorial, step 1/ })).toBeVisible();
  await page.getByRole('button', { name: 'Servers', exact: true }).click();
  await page.getByRole('button', { name: /Add server/ }).click();
  await expect(page.getByRole('dialog', { name: /Tutorial, step 2/ })).toBeVisible();
  await page.getByRole('button', { name: 'Tech', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Tech tree' }).locator('.node')).toHaveCount(9);
  await page.getByRole('button', { name: 'Scale Up: Available' }).click();
  await page.getByRole('button', { name: /^Start/ }).click();
  await expect(page.getByRole('dialog', { name: /Tutorial, step 3/ })).toBeVisible();
  await page.getByRole('button', { name: 'Growth', exact: true }).click();
  await page.getByRole('button', { name: /^Launch/ }).first().click();
  await expect(page.getByRole('dialog', { name: /Tutorial, step 4/ })).toBeVisible();
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  const before = await savedGame(page);
  expect(before.turn).toBe(2);
  expect(before.infra.appHosts).toHaveLength(2);
  expect(before.totals.promosRun).toBe(1);
  expect(before.tasks.some(task => task.techId === 'larger_servers') || before.releases.some(release => release.techId === 'larger_servers') || before.techDone.includes('larger_servers')).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Continue week 2' }).click();
  await expectRoom(page);
  expect(await savedGame(page)).toEqual(before);
  await expect(page.getByRole('dialog', { name: /Tutorial/ })).toHaveCount(0);
});

test('keeps the game playable when the furniture models cannot be downloaded', async ({ page }) => {
  await page.route('**/models/**', route => route.abort());
  const skipped = page.waitForEvent('console', message => message.text().includes('Furniture models failed to load'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await skipped;
  await expectRoom(page);
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  expect((await savedGame(page)).turn).toBe(2);
  await expectRoom(page);
});

test('sends the engineer to clicked equipment and uses it on arrival', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expectRoom(page);
  const stage = page.locator('.stage-canvas');
  // The engineer starts in the open aisle, out of reach of the servers.
  await expect(stage).toHaveAttribute('data-nearby', '');
  await page.getByRole('main').getByRole('button', { name: 'Servers', exact: true }).click();
  const details = page.getByRole('complementary', { name: 'Details' });
  await expect(details.getByRole('heading', { name: 'Servers' })).toBeVisible();
  // Selection happened because the engineer walked there, not because of a remote click.
  await expect(stage).toHaveAttribute('data-nearby', 'app');
});

test('walks with the keyboard and uses nearby equipment with F', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expectRoom(page);
  const stage = page.locator('.stage-canvas');
  const details = page.getByRole('complementary', { name: 'Details' });
  await expect(stage).toHaveAttribute('data-nearby', '');
  // F with nothing in reach does nothing.
  await page.keyboard.press('f');
  await expect(details).toHaveCount(0);
  await page.keyboard.down('a');
  await expect(stage).toHaveAttribute('data-nearby', 'deploy');
  await page.keyboard.up('a');
  await expect(page.locator('.use-prompt')).toHaveText('FInspect Deploy');
  await page.keyboard.press('f');
  await expect(details.getByRole('heading', { name: 'Deploy' })).toBeVisible();
  // Right along the glass of the server floor to the growth desk.
  await page.keyboard.down('d');
  await expect(stage).toHaveAttribute('data-nearby', 'growth');
  await page.keyboard.up('d');
  await page.keyboard.press('f');
  await expect(details.getByRole('heading', { name: 'Growth' })).toBeVisible();
  // Keys do nothing while a view covers the room.
  await page.getByRole('button', { name: 'Tech', exact: true }).click();
  await page.keyboard.down('a');
  // Let the scene render a stretch of frames with the key held.
  await page.evaluate(() => new Promise<void>(done => {
    let frames = 30;
    const next = () => (--frames > 0 ? requestAnimationFrame(next) : done());
    requestAnimationFrame(next);
  }));
  await page.keyboard.up('a');
  await expect(stage).toHaveAttribute('data-nearby', 'growth');
});

test('recovers from a corrupt save through the playable first-run flow', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nn.save.v1', '{'));
  await page.goto('/');
  await expect(page.getByRole('alert')).toHaveText('Saved run was unreadable. Started a new one.');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expectRoom(page);
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  expect((await savedGame(page)).turn).toBe(2);
});

test('confirms replacing a run and starts the supplied replay seed', async ({ page }) => {
  await seedSave(page, advanceTurn(newGame(1)));
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue week 2' }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await menu.getByRole('textbox').fill('e2e-repeatable');
  await menu.getByRole('button', { name: 'New game', exact: true }).click();
  expect((await savedGame(page)).turn).toBe(2);
  await menu.getByRole('button', { name: 'Lose this run? Press again', exact: true }).click();
  await expect(menu).toHaveCount(0);
  expect(await savedGame(page)).toEqual(newGame('e2e-repeatable'));
});

test('resumes an incident paused, investigates, fixes it and acknowledges the postmortem', async ({ page }) => {
  // Clock.runFor also renders every WebGL animation frame. The CI trace shows
  // several seconds of virtual time can take tens of seconds on SwiftShader.
  test.setTimeout(150_000);
  const incident = advanceTurn({ ...newGame(1), users: 4500, techDone: ['monitoring'] });
  expect(incident.incident?.type).toBe('app_overload');
  await seedSave(page, incident);
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue week 1' }).click();
  await expectRoom(page);
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const panel = page.getByRole('region', { name: 'Incident', exact: true });
  const clock = panel.locator('.clock-time');
  await expect(clock).toHaveText('0:00');
  await page.clock.runFor(1200);
  await expect(clock).toHaveText('0:00');
  await panel.getByRole('button', { name: 'Servers', exact: true }).click();
  await page.getByRole('button', { name: 'Resume the incident clock' }).click();
  await page.clock.runFor(3200);
  await expect(panel.locator('.evidence')).toContainText('CPU 100%');
  await expect(panel.locator('.evidence')).toContainText('of capacity');
  await page.getByRole('button', { name: 'Pause the incident clock' }).click();
  const elapsed = (await savedGame(page)).incident!.elapsed;
  const pausedClock = await clock.textContent();
  await page.clock.runFor(1000);
  await expect(clock).toHaveText(pausedClock!);
  expect((await savedGame(page)).incident!.elapsed).toBe(elapsed);
  await panel.getByRole('button', { name: /^Add (a|\d+) server/ }).click();
  await page.getByRole('button', { name: '2×', exact: true }).click();
  await page.getByRole('button', { name: 'Resume the incident clock' }).click();
  await page.clock.runFor(8000);
  const report = page.getByRole('dialog');
  await expect(report).toContainText('Fixed');
  const reviewed = await savedGame(page);
  expect(reviewed.phase).toBe('review');
  expect(reviewed.postmortems.at(-1)?.outcome).toBe('resolved');
  await report.getByRole('button', { name: 'Continue', exact: true }).click();
  expect((await savedGame(page)).phase).toBe('management');
  expect((await savedGame(page)).turn).toBe(2);
});
