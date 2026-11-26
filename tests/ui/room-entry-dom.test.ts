// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomEntry } from '@/ui/room-entry';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('RoomEntry long Flaxia room IDs', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('accepts a 36-character UUID with hyphens and preserves its case', () => {
    const onCreate = vi.fn();
    const onJoin = vi.fn();
    const entry = new RoomEntry({ onCreate, onJoin });
    document.body.append(entry.element);

    const input = entry.element.querySelector<HTMLInputElement>('#room-id-input');
    const join = entry.element.querySelector<HTMLButtonElement>('#btn-join-room');
    if (!input || !join) throw new Error('missing room entry controls');

    expect(input.maxLength).toBe(128);
    input.value = UUID;
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(input.value).toBe(UUID);
    expect(join.disabled).toBe(false);

    join.click();
    expect(onJoin).toHaveBeenCalledTimes(1);
    expect(onJoin).toHaveBeenCalledWith(UUID);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('does not uppercase lowercase room IDs', () => {
    const onJoin = vi.fn();
    const entry = new RoomEntry({ onCreate: vi.fn(), onJoin });
    document.body.append(entry.element);

    const input = entry.element.querySelector<HTMLInputElement>('#room-id-input');
    const join = entry.element.querySelector<HTMLButtonElement>('#btn-join-room');
    if (!input || !join) throw new Error('missing room entry controls');

    input.value = 'room-AbC-1234';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    join.click();

    expect(onJoin).toHaveBeenCalledWith('room-AbC-1234');
  });
});
