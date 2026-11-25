// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FINAL_THUNDER_CALL_DEFAULT_DURATION_MS,
  FINAL_THUNDER_CALL_EXIT_ANIMATION_MS,
  FinalThunderCall,
  type FinalThunderCallOptions,
} from '@/ui/final-thunder-call';

const activeCalls: FinalThunderCall[] = [];

function createCall(host?: HTMLElement): FinalThunderCall {
  const call = new FinalThunderCall(host);
  activeCalls.push(call);
  return call;
}

function attackerOptions(
  overrides: Partial<FinalThunderCallOptions> = {},
): FinalThunderCallOptions {
  return {
    chair: 5,
    attackerName: '攻撃側',
    defenderName: '守備側',
    role: 'attacker',
    ...overrides,
  };
}

function text(call: FinalThunderCall, selector: string): string {
  const element = call.element.querySelector(selector);
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function element(call: FinalThunderCall, selector: string): HTMLElement | null {
  return call.element.querySelector<HTMLElement>(selector);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const call of activeCalls.splice(0)) call.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('FinalThunderCall', () => {
  it('初期状態は非表示', () => {
    const call = createCall();
    expect(call.isOpen).toBe(false);
    expect(call.element.hidden).toBe(true);
  });

  it('攻撃側のカットインに TARGET LOCKED / DEFENDER / CHAIR を出す', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const call = createCall(host);

    call.show(attackerOptions({ chair: 5, defenderName: 'ミカン' }));

    expect(call.isOpen).toBe(true);
    expect(call.element.hidden).toBe(false);
    expect(host.contains(call.element)).toBe(true);
    expect(call.element.dataset.role).toBe('attacker');
    expect(call.element.classList.contains('is-open')).toBe(true);

    expect(text(call, '.ft-call__title')).toBe('FINAL THUNDER');
    expect(text(call, '[data-ft-call-state]')).toBe('TARGET LOCKED');
    expect(text(call, '[data-ft-call-who]')).toBe('DEFENDER / ミカン');
    expect(text(call, '[data-ft-call-chair-line]')).toBe('CHAIR 05');
    expect(text(call, '.ft-call__sub')).toContain('ボタンを押せ');
    expect(text(call, '.ft-call__sub')).toContain('仕掛けを解放しろ');
    expect(element(call, '[data-ft-call-last-chance]')?.hidden).toBe(true);
  });

  it('守備側は確定 / 相手のボタン待ちを出す', () => {
    const call = createCall();

    call.show(attackerOptions({ role: 'defender', defenderName: '守備側' }));

    expect(call.element.dataset.role).toBe('defender');
    expect(call.element.classList.contains('ft-call--defender')).toBe(true);
    expect(text(call, '.ft-call__title')).toBe('FINAL THUNDER');
    expect(text(call, '[data-ft-call-state]')).toBe('確定');
    expect(text(call, '.ft-call__sub-main')).toBe('相手がボタンを押すのを待っている');
    expect(text(call, '[data-ft-call-who]')).toBe('DEFENDER / 守備側');
    expect(element(call, '.ft-call__sub-note')?.hidden).toBe(true);
  });

  it('highStakes は LAST CHANCE / リーチ と強調クラスを出す', () => {
    const call = createCall();

    call.show(attackerOptions({ highStakes: true }));

    expect(call.element.classList.contains('ft-call--high-stakes')).toBe(true);
    expect(call.element.dataset.highStakes).toBe('true');
    const lastChance = element(call, '[data-ft-call-last-chance]');
    expect(lastChance?.hidden).toBe(false);
    expect(lastChance?.textContent?.trim()).toBe('LAST CHANCE / リーチ');
  });

  it('durationMs 経過で退場し、アニメーション後に hidden になる', () => {
    const call = createCall();
    call.show(attackerOptions({ durationMs: 500 }));

    vi.advanceTimersByTime(499);
    expect(call.isOpen).toBe(true);
    expect(call.element.hidden).toBe(false);

    vi.advanceTimersByTime(1);
    expect(call.isOpen).toBe(false);
    expect(call.element.classList.contains('is-leaving')).toBe(true);
    expect(call.element.hidden).toBe(false);

    vi.advanceTimersByTime(FINAL_THUNDER_CALL_EXIT_ANIMATION_MS);
    expect(call.element.hidden).toBe(true);
    expect(call.element.classList.contains('is-leaving')).toBe(false);
  });

  it('durationMs 未指定は既定の 2200ms で消える', () => {
    const call = createCall();
    call.show(attackerOptions());

    vi.advanceTimersByTime(FINAL_THUNDER_CALL_DEFAULT_DURATION_MS - 1);
    expect(call.isOpen).toBe(true);

    vi.advanceTimersByTime(1);
    expect(call.isOpen).toBe(false);

    vi.advanceTimersByTime(FINAL_THUNDER_CALL_EXIT_ANIMATION_MS);
    expect(call.element.hidden).toBe(true);
  });

  it('連続 show でタイマーがリセットされ、新しい文言に変わる', () => {
    const call = createCall();
    call.show(attackerOptions({ chair: 5, durationMs: 1000 }));

    vi.advanceTimersByTime(800);
    call.show(attackerOptions({ chair: 6, durationMs: 1000 }));

    expect(call.isOpen).toBe(true);
    expect(call.element.hidden).toBe(false);
    expect(text(call, '[data-ft-call-chair-line]')).toBe('CHAIR 06');

    // 最初の show から 1000ms 経過しても、2 回目のタイマーはまだ残っている。
    vi.advanceTimersByTime(800);
    expect(call.isOpen).toBe(true);
    expect(call.element.hidden).toBe(false);

    vi.advanceTimersByTime(200);
    expect(call.isOpen).toBe(false);

    vi.advanceTimersByTime(FINAL_THUNDER_CALL_EXIT_ANIMATION_MS);
    expect(call.element.hidden).toBe(true);
  });

  it('hide は短いスライドで隠す', () => {
    const call = createCall();
    call.show(attackerOptions({ durationMs: 10_000 }));

    call.hide();
    expect(call.isOpen).toBe(false);
    expect(call.element.classList.contains('is-leaving')).toBe(true);

    vi.advanceTimersByTime(FINAL_THUNDER_CALL_EXIT_ANIMATION_MS);
    expect(call.element.hidden).toBe(true);
  });

  it('destroy で DOM を除去し、タイマーを止める', () => {
    const call = createCall();
    call.show(attackerOptions({ durationMs: 100 }));
    const element = call.element;

    call.destroy();

    expect(call.isOpen).toBe(false);
    expect(element.isConnected).toBe(false);
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();

    // 破棄後の show は何もしない。
    call.show(attackerOptions());
    expect(call.element.hidden).toBe(true);
  });
});
