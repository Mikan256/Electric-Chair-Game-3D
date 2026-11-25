export const ROOM_ID_MIN_LENGTH = 4;
export const ROOM_ID_MAX_LENGTH = 16;

/** 表示・入力で許可する文字（大文字化後の英数字 + ハイフン + アンダースコア）。 */
const ROOM_ID_CHARS = /^[A-Z0-9_-]+$/;
const ROOM_ID_STRIP = /[^A-Z0-9_-]/g;

/**
 * 入力されたルームIDを正規化する。
 * 前後の空白を除去し、大文字化したうえで 4〜16 文字の
 * `[A-Z0-9_-]` のみを許可する。不正なら null。
 */
export function normalizeRoomId(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  if (normalized.length < ROOM_ID_MIN_LENGTH || normalized.length > ROOM_ID_MAX_LENGTH) {
    return null;
  }
  if (!ROOM_ID_CHARS.test(normalized)) return null;
  return normalized;
}

/**
 * 入力欄のための補正。大文字化し、許可されない文字を取り除き、
 * 最大長で切り詰める（バリデーションではなく入力のサニタイズ）。
 */
export function sanitizeRoomIdInput(value: string): string {
  return value.toUpperCase().replace(ROOM_ID_STRIP, '').slice(0, ROOM_ID_MAX_LENGTH);
}
