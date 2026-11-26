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
    await expect(page.locator('.panel').getByText('12脚の椅子')).toBeVisible();
    await page.locator('#btn-back').click();
    await expect(page.locator('#btn-solo')).toBeVisible();

    // Start from the title so the browser treats the click as the audio unlock gesture.
    await page.goto('/?attacker=0&botDelay=20&seed=e2e-solo');
    await page.locator('#btn-solo').click();
    await expect(page.locator('#hud-turn')).toHaveText('TURN 1 / 8', { timeout: 20_000 });
    await expect(page.locator('.player-card.left .role')).toContainText('攻撃側');

    // ラウンドコールとゲーム BGM（Innovation）が実際に動くこと。
    await expect(page.locator('#ui-round')).toContainText('ROUND 1', { timeout: 20_000 });
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const audio = (
              window as unknown as {
                __denkiIsu?: { theater?: { audio?: { gameBgm?: HTMLAudioElement } } };
              }
            ).__denkiIsu?.theater?.audio;
            const bgm = audio?.gameBgm;
            return Boolean(bgm && bgm.src.includes('innovation.mp3') && !bgm.paused);
          }),
        { timeout: 15_000 },
      )
      .toBe(true);

    await page.locator('#btn-grid').click();
    await page.locator('.chair-btn[data-chair="5"]').click();
    await expect(page.locator('#btn-confirm')).toBeEnabled();
    await page.locator('#btn-confirm').click();

    // Solo CPU sits automatically; the human attacker must press the button.
    await expect(page.locator('#btn-press')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.ft-call')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.ft-call')).toContainText('TARGET LOCKED');
    await page.locator('#btn-press').click();

    await expect(page.locator('#result-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#hud-phase')).toHaveText('判定');
    await page.locator('#btn-result-next').click();
    await expect(page.locator('#hud-turn')).toHaveText('TURN 2 / 8');
    await expect(page.locator('#ui-round')).toContainText('ROUND 2', { timeout: 15_000 });

    expect(errors).toEqual([]);
  });
});
