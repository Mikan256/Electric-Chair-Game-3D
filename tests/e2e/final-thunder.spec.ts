import { expect, test } from '@playwright/test';

test.describe('final thunder', () => {
  test('defender can change seats or confirm the sitting chair', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('/?attacker=0&botDelay=20&seed=e2e-final-thunder');
    await page.locator('#btn-solo').click();
    await expect(page.locator('#hud-turn')).toHaveText('TURN 1 / 8', { timeout: 20_000 });
    await expect
      .poll(async () => page.evaluate(() => window.__stage?.avatarMode ?? 'none'), {
        timeout: 30_000,
      })
      .toBe('vrm');

    // Turn 1: the human is the attacker.
    await page.locator('#btn-grid').click();
    await page.locator('.chair-btn[data-chair="5"]').click();
    await page.locator('#btn-confirm').click();
    await expect(page.locator('#btn-press')).toBeVisible({ timeout: 15_000 });
    await page.locator('#btn-press').click();
    await expect(page.locator('#result-overlay')).toBeVisible({ timeout: 15_000 });
    await page.locator('#btn-result-next').click();

    // Turn 2: the human is the defender.
    await page.waitForFunction(
      () => (window as unknown as { __denkiIsu?: { session?: { view?: { phase?: string } } } })
        .__denkiIsu?.session?.view?.phase === 'sit',
      null,
      { timeout: 20_000 },
    );

    await page.locator('#btn-grid').click();
    await page.locator('.chair-btn[data-chair="8"]').click();
    await page.locator('#btn-confirm').click();
    await expect(page.locator('.final-thunder')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-final-thunder-chair]')).toHaveAttribute(
      'aria-label',
      'CHAIR 08',
    );

    // Change seats: the prompt closes and the selection phase continues.
    await page.locator('[data-choice="change"]').click();
    await expect(page.locator('.final-thunder')).toBeHidden();
    await expect(page.locator('#hud-phase')).toHaveText('椅子を選ぶ');
    await expect(page.locator('#btn-confirm')).toBeVisible();

    await page.locator('.chair-btn[data-chair="7"]').click();
    await page.locator('#btn-confirm').click();
    await expect(page.locator('.final-thunder')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-final-thunder-chair]')).toHaveAttribute(
      'aria-label',
      'CHAIR 07',
    );

    // Keep this seat: the CPU (attacker) presses and the turn resolves.
    await page.locator('[data-choice="keep"]').click();
    await expect(page.locator('#result-overlay')).toBeVisible({ timeout: 15_000 });

    expect(errors).toEqual([]);
  });
});
