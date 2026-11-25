// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FinalThunderPrompt,
  resolveFinalThunderChoice,
  type FinalThunderPromptOptions,
} from '@/ui/final-thunder';

let prompt: FinalThunderPrompt | null = null;

afterEach(() => {
  prompt?.destroy();
  prompt = null;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function createPrompt(options: FinalThunderPromptOptions = {}): FinalThunderPrompt {
  prompt = new FinalThunderPrompt(options);
  return prompt;
}

function button(root: HTMLElement, choice: 'keep' | 'change'): HTMLButtonElement {
  const element = root.querySelector<HTMLButtonElement>(`[data-choice="${choice}"]`);
  if (!element) throw new Error(`missing ${choice} button`);
  return element;
}

/** 閉じるスライドアウト後に hidden になることを確認する（fake timers 前提）。 */
function finishCloseAnimation(): void {
  vi.advanceTimersByTime(400);
}

describe('resolveFinalThunderChoice', () => {
  it('keep はゲーム進行の advance になる', () => {
    expect(resolveFinalThunderChoice('keep')).toBe('advance');
  });

  it('change は選び直しの reselect になる', () => {
    expect(resolveFinalThunderChoice('change')).toBe('reselect');
  });
});

describe('FinalThunderPrompt', () => {
  it('ask でカットインを開き、椅子番号とプレイヤー名を表示して「席を変える」にフォーカスする', () => {
    const ui = createPrompt();
    void ui.ask({ chair: 5, playerName: 'Bob' });

    expect(ui.isOpen).toBe(true);
    expect(ui.element.hidden).toBe(false);
    expect(ui.element.classList.contains('is-open')).toBe(true);

    // 中央モーダルではなく、バンド + 下部パネル + 透明バックドロップで構成する。
    const dialog = ui.element.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(ui.element.querySelector('.final-thunder__band')).not.toBeNull();
    expect(ui.element.querySelector('.final-thunder__panel')).not.toBeNull();
    expect(ui.element.querySelector('[data-final-thunder-backdrop]')).not.toBeNull();

    expect(ui.element.querySelector('.final-thunder__title')?.textContent).toBe('FINAL THUNDER?');
    expect(ui.element.querySelector('.final-thunder__chair-number')?.textContent).toBe('05');
    expect(ui.element.querySelector('.final-thunder__player')?.textContent).toBe('PLAYER / Bob');
    expect(document.activeElement).toBe(button(ui.element, 'change'));
  });

  it('プレイヤー名がなければ player 行を隠す', () => {
    const ui = createPrompt();
    void ui.ask({ chair: 2 });

    expect(ui.element.querySelector<HTMLElement>('.final-thunder__player')?.hidden).toBe(true);
  });

  it('「このまま行く」で keep を返し、スライドアウト後に閉じる', async () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const ui = createPrompt({ onOpen, onClose });
    const result = ui.ask({ chair: 12 });

    button(ui.element, 'keep').click();

    // Promise とゲーム進行は即時、見た目だけ閉じるアニメーションを待つ。
    await expect(result).resolves.toBe('keep');
    expect(ui.isOpen).toBe(false);
    expect(ui.element.hidden).toBe(false);
    expect(ui.element.classList.contains('is-closing')).toBe(true);

    finishCloseAnimation();

    expect(ui.element.hidden).toBe(true);
    expect(ui.element.classList.contains('is-closing')).toBe(false);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('keep');
  });

  it('「席を変える」で change を返して閉じる', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const ui = createPrompt({ onClose });
    const result = ui.ask({ chair: 3 });

    button(ui.element, 'change').click();

    await expect(result).resolves.toBe('change');
    expect(ui.isOpen).toBe(false);
    finishCloseAnimation();
    expect(ui.element.hidden).toBe(true);
    expect(onClose).toHaveBeenCalledWith('change');
  });

  it('cancel は開いているプロンプトを change で解決する', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const ui = createPrompt({ onClose });
    const result = ui.ask({ chair: 7 });

    ui.cancel();

    await expect(result).resolves.toBe('change');
    expect(ui.isOpen).toBe(false);
    finishCloseAnimation();
    expect(ui.element.hidden).toBe(true);
    expect(onClose).toHaveBeenCalledWith('change');
  });

  it('cancel は閉じているときは何もしない', () => {
    const onClose = vi.fn();
    const ui = createPrompt({ onClose });

    ui.cancel();

    expect(ui.isOpen).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape と背景クリックは cancel と同じく change を返す', async () => {
    vi.useFakeTimers();
    const ui = createPrompt();
    const viaEscape = ui.ask({ chair: 2 });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(viaEscape).resolves.toBe('change');

    const viaBackdrop = ui.ask({ chair: 2 });
    const backdrop = ui.element.querySelector<HTMLElement>('[data-final-thunder-backdrop]');
    backdrop?.click();
    await expect(viaBackdrop).resolves.toBe('change');

    // 背景クリック後もバックドロップは残り、退場アニメーションだけが進む。
    expect(ui.element.hidden).toBe(false);
    finishCloseAnimation();
    expect(ui.element.hidden).toBe(true);
  });

  it('Tab はバンド/パネル内のボタンにフォーカスを閉じ込める', () => {
    const ui = createPrompt();
    void ui.ask({ chair: 1 });

    const change = button(ui.element, 'change');
    const keep = button(ui.element, 'keep');
    change.focus();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }));
    expect(document.activeElement).toBe(keep);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(document.activeElement).toBe(change);
  });

  it('開いたまま ask すると前の Promise を change で解決し、新しい椅子で表示する', async () => {
    const ui = createPrompt();
    const first = ui.ask({ chair: 4 });
    const second = ui.ask({ chair: 9 });

    await expect(first).resolves.toBe('change');
    expect(ui.isOpen).toBe(true);
    expect(ui.element.hidden).toBe(false);
    expect(ui.element.querySelector('.final-thunder__chair-number')?.textContent).toBe('09');

    button(ui.element, 'keep').click();
    await expect(second).resolves.toBe('keep');
  });

  it('閉じるアニメーション中に ask し直しても、タイマーで隠されない', async () => {
    vi.useFakeTimers();
    const ui = createPrompt();
    const first = ui.ask({ chair: 4 });
    button(ui.element, 'change').click();
    await expect(first).resolves.toBe('change');

    const second = ui.ask({ chair: 8 });
    finishCloseAnimation();

    expect(ui.isOpen).toBe(true);
    expect(ui.element.hidden).toBe(false);
    expect(ui.element.classList.contains('is-open')).toBe(true);
    expect(ui.element.classList.contains('is-closing')).toBe(false);
    expect(ui.element.querySelector('.final-thunder__chair-number')?.textContent).toBe('08');

    button(ui.element, 'keep').click();
    await expect(second).resolves.toBe('keep');
  });

  it('destroy は開いている Promise を change で解決し、要素を除去する', async () => {
    const onClose = vi.fn();
    const ui = createPrompt({ onClose });
    const result = ui.ask({ chair: 1 });

    ui.destroy();

    await expect(result).resolves.toBe('change');
    expect(ui.isOpen).toBe(false);
    expect(ui.element.isConnected).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    await expect(ui.ask({ chair: 1 })).resolves.toBe('change');
  });
});
