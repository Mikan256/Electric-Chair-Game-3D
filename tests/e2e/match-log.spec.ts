import { expect, test } from '@playwright/test';

test.describe('match log panel', () => {
  test('opens from the HUD and never reveals the current wired chair before the press', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('/?attacker=0&botDelay=20&seed=e2e-match-log');
    await page.locator('#btn-solo').click();
    await expect(page.locator('#hud-turn')).toHaveText('TURN 1 / 8', { timeout: 20_000 });

    // 通常のUIボタンから開ける。
    await page.locator('#btn-log').click();
    await expect(page.locator('.match-log-panel')).toBeVisible();
    await expect(page.locator('[data-match-log-turn]')).toContainText('TURN 01 / 08');
    await expect(page.locator('[data-match-log-row]')).toHaveCount(1);
    await expect(page.locator('[data-wired="unknown"]')).toHaveText('???');
    await page.locator('.match-log-panel [data-match-log-close]').click();
    await expect(page.locator('.match-log-panel')).toBeHidden();

    // 仕掛け中も現在の電気椅子は ??? のまま。
    await page.locator('#btn-grid').click();
    await page.locator('.chair-btn[data-chair="6"]').click();
    await page.locator('#btn-confirm').click();
    await expect(page.locator('#btn-press')).toBeVisible({ timeout: 15_000 });
    await page.locator('#btn-log').click();
    await expect(page.locator('[data-wired="unknown"]')).toHaveText('???');
    await page.locator('.match-log-panel [data-match-log-close]').click();

    // プレス後は結果行に電気椅子が公開される。
    await page.locator('#btn-press').click();
    await expect(page.locator('#result-overlay')).toBeVisible({ timeout: 20_000 });
    await page.locator('#btn-result-log').click();
    await expect(page.locator('.match-log-panel')).toBeVisible();
    await expect(page.locator('[data-match-log-row]')).toHaveCount(1);
    await expect(page.locator('[data-match-log-row]')).toContainText('#6');
    await expect(page.locator('[data-match-log-row] [data-result]')).toBeVisible();

    expect(errors).toEqual([]);
  });
});
