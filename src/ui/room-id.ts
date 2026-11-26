export const ROOM_ID_MIN_LENGTH = 4;
export const ROOM_ID_MAX_LENGTH = 128;

/** 表示・入力で許可する文字（大小英字・数字・ハイフン・アンダースコア・ドット・コロン）。 */
const ROOM_ID_CHARS = /^[A-Za-z0-9._:-]+$/;
const ROOM_ID_STRIP = /[^A-Za-z0-9._:-]/g;

/**
 * 入力されたルームIDを正規化する。
 *
 * Flaxia の roomId は最大 128 文字で、UUID のように 16 文字を超える
 * ハイフン付き ID が使われる。大文字小文字はホスト側と完全一致させるため
 * 変換せず、前後の空白だけを除去する。
 */
export function normalizeRoomId(value: string): string | null {
  const normalized = value.trim();
  if (normalized.length < ROOM_ID_MIN_LENGTH || normalized.length > ROOM_ID_MAX_LENGTH) {
    return null;
  }
  if (!ROOM_ID_CHARS.test(normalized)) return null;
  return normalized;
}

/**
 * 入力欄のための補正。許可されない文字を取り除き、最大長で切り詰める。
 * 大文字化はしない（ルームIDは大文字小文字を区別する可能性がある）。
 */
export function sanitizeRoomIdInput(value: string): string {
  return value.replace(ROOM_ID_STRIP, '').slice(0, ROOM_ID_MAX_LENGTH);
}
