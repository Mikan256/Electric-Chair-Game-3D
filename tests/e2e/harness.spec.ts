import { expect, test, type Frame, type Page } from '@playwright/test';

function frameByName(page: Page, name: string): Frame {
  const frame = page.frames().find((candidate) => candidate.url().includes(`name=${name}`));
  if (!frame) throw new Error(`frame for ${name} not found`);
  return frame;
}

test.describe('local Flaxia harness', () => {
  test('two iframes join, start, and resolve a turn', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('/dev/harness.html');
    await expect(page.locator('#force-start')).toBeVisible();

    // Both game documents auto-connect and show the lobby.
    await expect
      .poll(() => page.frames().filter((frame) => frame.url().includes('mode=online')).length, {
        timeout: 20_000,
      })
      .toBe(2);

    const alice = frameByName(page, 'Alice');
    const bob = frameByName(page, 'Bob');
    await expect(alice.locator('.panel h2')).toHaveText('ONLINE MATCH');
    await expect(bob.locator('.panel h2')).toHaveText('ONLINE MATCH');

    await page.locator('#force-start').click();
    await expect(alice.locator('#hud-turn')).toHaveText('TURN 1 / 8', { timeout: 25_000 });
    await expect(bob.locator('#hud-turn')).toHaveText('TURN 1 / 8', { timeout: 25_000 });

    await alice.locator('.chair-btn[data-chair="3"]').click();
    await alice.locator('#btn-confirm').click();
    await bob.locator('.chair-btn[data-chair="8"]').click();
    await bob.locator('#btn-confirm').click();

    await expect(alice.locator('#result-overlay')).toBeVisible({ timeout: 20_000 });
    await expect(bob.locator('#result-overlay')).toBeVisible({ timeout: 20_000 });
    await expect(alice.locator('#hud-phase')).toHaveText('判定');
    await expect(bob.locator('#hud-phase')).toHaveText('判定');

    expect(errors).toEqual([]);
  });
});
