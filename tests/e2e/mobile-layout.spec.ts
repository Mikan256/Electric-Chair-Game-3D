import { expect, test, type Page } from '@playwright/test';

/** 画面内に収まっていることを、はみ出し量 1px まで許容して検証する。 */
async function expectInsideViewport(page: Page, selector: string): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('viewport is not available');

  const boxes = await page.locator(selector).evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0;
      })
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
      }),
  );

  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.top).toBeGreaterThanOrEqual(-1);
    expect(box.left).toBeGreaterThanOrEqual(-1);
    expect(box.right).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.bottom).toBeLessThanOrEqual(viewport.height + 1);
  }
}

test.describe('mobile landscape layout', () => {
  test.use({ viewport: { width: 667, height: 375 }, isMobile: true, hasTouch: true });

  test('title, rules, and HUD stay inside the landscape viewport', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-solo')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#orientation-gate')).toBeHidden();
    await expectInsideViewport(
      page,
      '.title-screen .logo, .title-screen .menu, .title-screen > .row',
    );

    await page.locator('#btn-rules').click();
    await expect(page.locator('.panel').getByText('12脚の椅子')).toBeVisible();
    await expectInsideViewport(page, '.panel, #btn-back');
    await page.locator('#btn-back').click();

    await page.goto('/?attacker=0&botDelay=20&seed=e2e-mobile-layout');
    await page.locator('#btn-solo').click();
    await expect(page.locator('.hud')).toBeVisible({ timeout: 20_000 });
    await expectInsideViewport(page, '.hud-top, .player-card, .bottom-panel');

    await page.locator('#btn-grid').click();
    await expectInsideViewport(page, '.bottom-panel, .chair-grid, .actions');
  });
});

test.describe('mobile portrait layout', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('recommends landscape and disappears after rotating', async ({ page }) => {
    await page.goto('/');
    const gate = page.locator('#orientation-gate');
    await expect(gate).toBeVisible();
    await expect(gate).toContainText('横画面でプレイしてください');

    await page.setViewportSize({ width: 667, height: 375 });
    await expect(gate).toBeHidden();
    await expect(page.locator('#btn-solo')).toBeVisible();
  });
});
