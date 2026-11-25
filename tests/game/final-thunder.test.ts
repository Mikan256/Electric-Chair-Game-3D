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

describe('resolveFinalThunderChoice', () => {
  it('keep はゲーム進行の advance になる', () => {
    expect(resolveFinalThunderChoice('keep')).toBe('advance');
  });

  it('change は選び直しの reselect になる', () => {
    expect(resolveFinalThunderChoice('change')).toBe('reselect');
  });
});

describe('FinalThunderPrompt', () => {
  it('ask でダイアログを開き、椅子番号とプレイヤー名を表示して「席を変える」にフォーカスする', () => {
    const ui = createPrompt();
    void ui.ask({ chair: 5, playerName: 'Bob' });

    expect(ui.isOpen).toBe(true);
    expect(ui.element.hidden).toBe(false);

    const dialog = ui.element.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(ui.element.querySelector('.final-thunder__chair-number')?.textContent).toBe('05');
    expect(ui.element.querySelector('.final-thunder__player')?.textContent).toBe('PLAYER / Bob');
    expect(document.activeElement).toBe(button(ui.element, 'change'));
  });

  it('「このまま行く」で keep を返して閉じる', async () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const ui = createPrompt({ onOpen, onClose });
    const result = ui.ask({ chair: 12 });

    button(ui.element, 'keep').click();

    await expect(result).resolves.toBe('keep');
    expect(ui.isOpen).toBe(false);
    expect(ui.element.hidden).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('keep');
  });

  it('「席を変える」で change を返して閉じる', async () => {
    const onClose = vi.fn();
    const ui = createPrompt({ onClose });
    const result = ui.ask({ chair: 3 });

    button(ui.element, 'change').click();

    await expect(result).resolves.toBe('change');
    expect(ui.isOpen).toBe(false);
    expect(onClose).toHaveBeenCalledWith('change');
  });

  it('cancel は開いているプロンプトを change で解決する', async () => {
    const onClose = vi.fn();
    const ui = createPrompt({ onClose });
    const result = ui.ask({ chair: 7 });

    ui.cancel();

    await expect(result).resolves.toBe('change');
    expect(ui.isOpen).toBe(false);
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
    const ui = createPrompt();
    const viaEscape = ui.ask({ chair: 2 });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(viaEscape).resolves.toBe('change');

    const viaBackdrop = ui.ask({ chair: 2 });
    const backdrop = ui.element.querySelector<HTMLElement>('[data-final-thunder-backdrop]');
    backdrop?.click();
    await expect(viaBackdrop).resolves.toBe('change');
  });

  it('開いたまま ask すると前の Promise を change で解決し、新しい椅子で表示する', async () => {
    const ui = createPrompt();
    const first = ui.ask({ chair: 4 });
    const second = ui.ask({ chair: 9 });

    await expect(first).resolves.toBe('change');
    expect(ui.isOpen).toBe(true);
    expect(ui.element.querySelector('.final-thunder__chair-number')?.textContent).toBe('09');

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
