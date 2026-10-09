import { test, expect, expectRoom, savedGame } from './fixtures';

test('plays a first week and opens and closes Tech on a touch viewport', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expectRoom(page);
  await page.getByRole('button', { name: 'Tech', exact: true }).tap();
  const tech = page.getByRole('region', { name: 'Tech tree' });
  await expect(tech).toBeVisible();
  await expect(tech.locator('.node')).toHaveCount(9);
  await tech.getByRole('button', { name: 'Read Cache: Available' }).tap();
  await expect(tech.getByRole('heading', { name: 'Read Cache' })).toBeVisible();
  await tech.getByRole('button', { name: /^Start/ }).tap();
  expect((await savedGame(page)).tasks.some(task => task.techId === 'caching')).toBe(true);
  await tech.getByRole('button', { name: 'Close', exact: true }).tap();
  await page.getByRole('button', { name: 'Next week', exact: true }).tap();
  expect((await savedGame(page)).turn).toBe(2);
  const viewportWidth = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth);
});

test('taps equipment to walk the engineer there on a touch viewport', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expectRoom(page);
  await page.getByRole('main').getByRole('button', { name: 'Growth', exact: true }).tap();
  await expect(page.getByRole('complementary', { name: 'Details' }).getByRole('heading', { name: 'Growth' })).toBeVisible();
  await expect(page.locator('.stage-canvas')).toHaveAttribute('data-nearby', 'growth');
});
