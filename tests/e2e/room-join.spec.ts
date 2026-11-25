import { expect, test, type Frame, type Page } from '@playwright/test';

interface RoomSummary {
  room: { roomId: string; status: string };
  players: unknown[];
}

interface HarnessWindow {
  __harness?: { rooms: RoomSummary[]; activeRoomId: string };
}

function frameByName(page: Page, name: string): Frame {
  const frame = page.frames().find((candidate) => candidate.url().includes(`name=${name}`));
  if (!frame) throw new Error(`frame for ${name} not found`);
  return frame;
}

function roomPlayers(page: Page, roomId: string): Promise<number> {
  return page.evaluate((id) => {
    const harness = (window as unknown as HarnessWindow).__harness;
    return harness?.rooms.find((entry) => entry.room.roomId === id)?.players.length ?? 0;
  }, roomId);
}

test.describe('harness room join', () => {
  test('creates a room, joins it by ID, and rejects unknown IDs', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('/dev/harness.html');
    await expect(page.locator('#force-start')).toBeVisible();

    // Both frames auto-connect without a roomId and share LOCAL.
    await expect
      .poll(() => page.frames().filter((frame) => frame.url().includes('mode=online')).length, {
        timeout: 20_000,
      })
      .toBe(2);
    await expect.poll(() => roomPlayers(page, 'LOCAL'), { timeout: 20_000 }).toBe(2);

    // PLAYER A creates a fresh room from the harness controls.
    await page.locator('#room-create').click();
    await expect(page.locator('#room-id')).toHaveText('ROOM2');
    await expect(page.locator('#room-input')).toHaveValue('ROOM2');
    expect(await roomPlayers(page, 'ROOM2')).toBe(1);

    const alice = frameByName(page, 'Alice');
    await expect(alice.locator('.room-code')).toHaveText('ROOM2', { timeout: 30_000 });
    await expect(alice.locator('.kv', { hasText: 'STATUS' })).toContainText('1 / 2');

    // PLAYER B joins the exact room ID shown by PLAYER A.
    await page.locator('#room-join').click();
    await expect.poll(() => roomPlayers(page, 'ROOM2'), { timeout: 30_000 }).toBe(2);
    await expect
      .poll(() => page.frames().filter((frame) => frame.url().includes('room=ROOM2')).length, {
        timeout: 30_000,
      })
      .toBe(1);

    const bob = frameByName(page, 'Bob');
    await expect(alice.locator('.kv', { hasText: 'STATUS' })).toContainText('2 / 2', {
      timeout: 30_000,
    });
    await expect(bob.locator('.kv', { hasText: 'STATUS' })).toContainText('2 / 2', {
      timeout: 30_000,
    });
    await expect(bob.locator('.room-code')).toHaveText('ROOM2');

    // An unknown (but well-formed) room ID is rejected by the harness.
    await page.locator('#room-input').fill('ZZZZ');
    await page.locator('#room-join').click();
    await expect(page.locator('#room-error')).toBeVisible();
    await expect(page.locator('#room-error')).toContainText('見つかりません');
    // PLAYER B must stay in the joined room.
    await expect(bob.locator('.room-code')).toHaveText('ROOM2');

    // An invalid format is rejected before touching the iframe.
    await page.locator('#room-input').fill('ab');
    await page.locator('#room-join').click();
    await expect(page.locator('#room-error')).toContainText('ルームIDは4〜16文字');
    await expect(bob.locator('.room-code')).toHaveText('ROOM2');

    expect(errors).toEqual([]);
  });
});
