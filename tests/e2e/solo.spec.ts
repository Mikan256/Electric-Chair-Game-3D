import { expect, test } from '@playwright/test';

test.describe('solo vertical slice', () => {
  test('title → CPU match → choose chair → result → next turn', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('/');
    await expect(page.locator('#btn-solo')).toBeVisible();
    await expect(page.locator('img.logo')).toBeVisible();

    await page.locator('#btn-rules').click();
    await expect(page.getByText('12脚の椅子')).toBeVisible();
    await page.locator('#btn-back').click();
    await expect(page.locator('#btn-solo')).toBeVisible();

    // Auto-start solo directly with a deterministic attacker and fast bot.
    await page.goto('/?mode=solo&attacker=0&botDelay=20&seed=e2e-solo');
    await expect(page.locator('#hud-turn')).toHaveText('TURN 1 / 8', { timeout: 20_000 });
    await expect(page.locator('.player-card.left .role')).toContainText('攻撃側');

    await page.locator('.chair-btn[data-chair="5"]').click();
    await expect(page.locator('#btn-confirm')).toBeEnabled();
    await page.locator('#btn-confirm').click();

    await expect(page.locator('#result-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#hud-phase')).toHaveText('判定');
    await page.locator('#btn-result-next').click();
    await expect(page.locator('#hud-turn')).toHaveText('TURN 2 / 8');

    expect(errors).toEqual([]);
  });
});
