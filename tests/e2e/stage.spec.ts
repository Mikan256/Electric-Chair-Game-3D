import { expect, test } from '@playwright/test';

test.describe('stage camera', () => {
  test('orbits 360° inside the room and resolves a turn', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('/?attacker=0&botDelay=20&seed=e2e-stage');
    await page.locator('#btn-solo').click();
    await expect(page.locator('#hud-turn')).toHaveText('ROUND 1 / 8', { timeout: 20_000 });

    const before = await page.evaluate(() => {
      const stage = window.__stage;
      if (!stage) throw new Error('stage not exposed');
      const position = stage.camera.position;
      return {
        azimuth: stage.cameraAzimuth,
        position: { x: position.x, y: position.y, z: position.z },
      };
    });

    // 3D ビューをドラッグして 360° 回転させる。
    const box = await page.locator('#stage').boundingBox();
    if (!box) throw new Error('stage canvas not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 220, cy, { steps: 24 });
    await page.mouse.up();

    await expect
      .poll(async () => page.evaluate(() => window.__stage?.cameraAzimuth ?? 0), {
        timeout: 10_000,
      })
      .not.toBe(before.azimuth);

    const after = await page.evaluate(() => {
      const stage = window.__stage;
      if (!stage) throw new Error('stage not exposed');
      const position = stage.camera.position;
      return {
        azimuth: stage.cameraAzimuth,
        position: { x: position.x, y: position.y, z: position.z },
      };
    });

    expect(Math.abs(after.azimuth - before.azimuth)).toBeGreaterThan(0.3);
    // 部屋の内側（壁・床・天井）に収まっていること。
    expect(after.position.x).toBeGreaterThan(-13.5);
    expect(after.position.x).toBeLessThan(13.5);
    expect(after.position.z).toBeGreaterThan(-13.1);
    expect(after.position.z).toBeLessThan(34.6);
    expect(after.position.y).toBeGreaterThan(1);
    expect(after.position.y).toBeLessThan(12);

    // 仕掛け→着席→ボタン→結果まで進む。
    await page.locator('#btn-grid').click();
    await page.locator('.chair-btn[data-chair="5"]').click();
    await page.locator('#btn-confirm').click();
    await expect(page.locator('#btn-press')).toBeVisible({ timeout: 15_000 });
    await page.locator('#btn-press').click();
    await expect(page.locator('#result-overlay')).toBeVisible({ timeout: 15_000 });

    expect(errors).toEqual([]);
  });
});
