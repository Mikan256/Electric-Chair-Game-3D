import { describe, expect, it } from 'vitest';
import { normalizeRoomId } from '@/ui/room-entry';

describe('normalizeRoomId', () => {
  it('前後の空白を除去し、大文字小文字を保持する', () => {
    expect(normalizeRoomId('  abCD  ')).toBe('abCD');
    expect(normalizeRoomId('\troom-01\n')).toBe('room-01');
  });

  it('4文字と128文字は許可する', () => {
    expect(normalizeRoomId('abcd')).toBe('abcd');
    expect(normalizeRoomId('a'.repeat(128))).toBe('a'.repeat(128));
    expect(normalizeRoomId('  abcd  ')).toBe('abcd');
    expect(normalizeRoomId(` ${'z'.repeat(128)} `)).toBe('z'.repeat(128));
  });

  it('3文字と129文字は拒否する', () => {
    expect(normalizeRoomId('abc')).toBeNull();
    expect(normalizeRoomId('a'.repeat(129))).toBeNull();
    expect(normalizeRoomId('  abc  ')).toBeNull();
    expect(normalizeRoomId(` ${'a'.repeat(129)} `)).toBeNull();
  });

  it('英数字・ハイフン・アンダースコア・ドット・コロンを許可する', () => {
    expect(normalizeRoomId('room_01')).toBe('room_01');
    expect(normalizeRoomId('room-01')).toBe('room-01');
    expect(normalizeRoomId('a1B2-c3_d')).toBe('a1B2-c3_d');
    expect(normalizeRoomId('room.01')).toBe('room.01');
    expect(normalizeRoomId('room:01')).toBe('room:01');
    expect(normalizeRoomId('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
    expect(normalizeRoomId('____')).toBe('____');
    expect(normalizeRoomId('----')).toBe('----');
  });

  it('空白・日本語・その他の記号を拒否する', () => {
    expect(normalizeRoomId('ab cd')).toBeNull();
    expect(normalizeRoomId('ルーム01')).toBeNull();
    expect(normalizeRoomId('room 01')).toBeNull();
    expect(normalizeRoomId('room@01')).toBeNull();
    expect(normalizeRoomId('room/01')).toBeNull();
    expect(normalizeRoomId('room＋01')).toBeNull();
  });

  it('空文字と空白のみを拒否する', () => {
    expect(normalizeRoomId('')).toBeNull();
    expect(normalizeRoomId('   ')).toBeNull();
    expect(normalizeRoomId('\n\t')).toBeNull();
  });
});
