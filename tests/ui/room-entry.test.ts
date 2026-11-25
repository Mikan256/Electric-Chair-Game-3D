import { describe, expect, it } from 'vitest';
import { normalizeRoomId } from '@/ui/room-entry';

describe('normalizeRoomId', () => {
  it('前後の空白を除去して大文字化する', () => {
    expect(normalizeRoomId('  abcd  ')).toBe('ABCD');
    expect(normalizeRoomId('\troom-01\n')).toBe('ROOM-01');
  });

  it('4文字と16文字は許可する', () => {
    expect(normalizeRoomId('abcd')).toBe('ABCD');
    expect(normalizeRoomId('a'.repeat(16))).toBe('A'.repeat(16));
    expect(normalizeRoomId('  abcd  ')).toBe('ABCD');
    expect(normalizeRoomId(` ${'z'.repeat(16)} `)).toBe('Z'.repeat(16));
  });

  it('3文字と17文字は拒否する', () => {
    expect(normalizeRoomId('abc')).toBeNull();
    expect(normalizeRoomId('a'.repeat(17))).toBeNull();
    expect(normalizeRoomId('  abc  ')).toBeNull();
    expect(normalizeRoomId(` ${'a'.repeat(17)} `)).toBeNull();
  });

  it('英数字・ハイフン・アンダースコアを許可する', () => {
    expect(normalizeRoomId('room_01')).toBe('ROOM_01');
    expect(normalizeRoomId('room-01')).toBe('ROOM-01');
    expect(normalizeRoomId('a1B2-c3_d')).toBe('A1B2-C3_D');
    expect(normalizeRoomId('____')).toBe('____');
    expect(normalizeRoomId('----')).toBe('----');
  });

  it('空白・日本語・記号を拒否する', () => {
    expect(normalizeRoomId('ab cd')).toBeNull();
    expect(normalizeRoomId('ルーム01')).toBeNull();
    expect(normalizeRoomId('room 01')).toBeNull();
    expect(normalizeRoomId('room.01')).toBeNull();
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
