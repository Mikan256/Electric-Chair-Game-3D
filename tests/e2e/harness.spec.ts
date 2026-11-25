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
    await expect(alice.locator('.panel h2')).toHaveText('ONLINE MATCH', { timeout: 30_000 });
    await expect(bob.locator('.panel h2')).toHaveText('ONLINE MATCH', { timeout: 30_000 });

    await page.locator('#force-start').click();
    await expect(alice.locator('#hud-turn')).toHaveText('TURN 1 / 8', { timeout: 25_000 });
    await expect(bob.locator('#hud-turn')).toHaveText('TURN 1 / 8', { timeout: 25_000 });

    type View = {
      attacker: number;
      you: number;
      phase: string;
      sittingChair: number | null;
    };
    const viewOf = async (frame: Frame): Promise<View> =>
      frame.evaluate(() => {
        const view = (
          window as unknown as {
            __denkiIsu?: { session?: { view?: View } };
          }
        ).__denkiIsu?.session?.view;
        if (!view) throw new Error('no view');
        return {
          attacker: view.attacker,
          you: view.you,
          phase: view.phase,
          sittingChair: view.sittingChair,
        };
      });

    await expect
      .poll(
        async () => {
          const views = await Promise.all([viewOf(alice), viewOf(bob)]);
          return views.every((view) => view.phase === 'set');
        },
        { timeout: 20_000 },
      )
      .toBe(true);

    const aliceView = await viewOf(alice);
    const bobView = await viewOf(bob);
    const attackerFrame = aliceView.attacker === aliceView.you ? alice : bob;
    const defenderFrame = attackerFrame === alice ? bob : alice;
    expect(bobView.you).not.toBe(aliceView.you);

    await attackerFrame.locator('#btn-grid').click();
    await expect(attackerFrame.locator('.chair-btn[data-chair="3"]')).toBeEnabled({
      timeout: 15_000,
    });
    await attackerFrame.locator('.chair-btn[data-chair="3"]').click();
    await attackerFrame.locator('#btn-confirm').click();

    await expect(defenderFrame.locator('#hud-phase')).toHaveText('椅子を選ぶ', { timeout: 15_000 });
    await defenderFrame.locator('#btn-grid').click();
    await defenderFrame.locator('.chair-btn[data-chair="8"]').click();
    await expect(defenderFrame.locator('#btn-confirm')).toBeEnabled();
    await defenderFrame.locator('#btn-confirm').click();
    await expect(defenderFrame.locator('[data-choice="keep"]')).toBeVisible({ timeout: 10_000 });
    await defenderFrame.locator('[data-choice="keep"]').click();

    await expect(attackerFrame.locator('#btn-press')).toBeVisible({ timeout: 15_000 });
    await attackerFrame.locator('#btn-press').click();

    await expect(alice.locator('#result-overlay')).toBeVisible({ timeout: 20_000 });
    await expect(bob.locator('#result-overlay')).toBeVisible({ timeout: 20_000 });
    await expect(alice.locator('#hud-phase')).toHaveText('判定');
    await expect(bob.locator('#hud-phase')).toHaveText('判定');

    expect(errors).toEqual([]);
  });
});
