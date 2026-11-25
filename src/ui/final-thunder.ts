import './final-thunder.css';

export type FinalThunderChoice = 'keep' | 'change';

export interface FinalThunderRequest {
  chair: number;
  playerName?: string;
}

export interface FinalThunderPromptOptions {
  host?: HTMLElement; // 省略時 document.body
  onOpen?: () => void;
  onClose?: (choice: FinalThunderChoice) => void;
}

/** UI の選択をゲーム進行の意味に変換する純粋関数。 */
export function resolveFinalThunderChoice(choice: FinalThunderChoice): 'advance' | 'reselect' {
  return choice === 'keep' ? 'advance' : 'reselect';
}

let instanceCount = 0;

function formatChair(chair: number): string {
  const value = Number.isFinite(chair) ? Math.trunc(chair) : 0;
  return String(Math.max(0, value)).padStart(2, '0');
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`[final-thunder] missing element: ${selector}`);
  return element;
}

/**
 * 守備側が椅子を確定する直前の「FINAL THUNDER?」確認ダイアログ。
 *
 * 表示と選択だけを担当し、ゲーム状態・ネットワークには触れない。
 * `ask()` は「このまま行く」で `'keep'`、「席を変える」/Escape/背景クリック/
 * `cancel()`/`destroy()` で `'change'`（席を確定しない安全側）を返す。
 */
export class FinalThunderPrompt {
  readonly element: HTMLElement;

  private readonly options: FinalThunderPromptOptions;
  private readonly panel: HTMLElement;
  private readonly chairNumber: HTMLElement;
  private readonly chairContainer: HTMLElement;
  private readonly playerLine: HTMLElement;
  private readonly changeButton: HTMLButtonElement;
  private readonly keepButton: HTMLButtonElement;
  private pendingResolve: ((choice: FinalThunderChoice) => void) | null = null;
  private isOpenState = false;
  private destroyed = false;
  private previousFocus: Element | null = null;

  constructor(options: FinalThunderPromptOptions = {}) {
    this.options = options;
    const id = `final-thunder-${++instanceCount}`;

    this.element = document.createElement('div');
    this.element.className = 'final-thunder';
    this.element.hidden = true;
    this.element.innerHTML = `
      <div class="final-thunder__backdrop" data-final-thunder-backdrop aria-hidden="true"></div>
      <div class="final-thunder__panel" role="dialog" aria-modal="true" aria-labelledby="${id}-title" aria-describedby="${id}-desc">
        <p class="final-thunder__kicker">ELECTRIC CHAIR GAME</p>
        <h2 class="final-thunder__title" id="${id}-title">FINAL THUNDER?</h2>
        <p class="final-thunder__lead" id="${id}-desc">この椅子で決定しますか？</p>
        <div class="final-thunder__chair" data-final-thunder-chair aria-label="CHAIR --">
          <span class="final-thunder__chair-label">CHAIR</span>
          <span class="final-thunder__chair-number">--</span>
        </div>
        <p class="final-thunder__player" hidden></p>
        <div class="final-thunder__actions">
          <button type="button" class="final-thunder__btn final-thunder__btn--change" id="${id}-change" data-choice="change">
            <span class="final-thunder__btn-label">席を変える</span>
            <span class="final-thunder__btn-sub">選び直す</span>
          </button>
          <button type="button" class="final-thunder__btn final-thunder__btn--keep" id="${id}-keep" data-choice="keep">
            <span class="final-thunder__btn-label">このまま行く</span>
            <span class="final-thunder__btn-sub">FINAL THUNDER / 確定</span>
          </button>
        </div>
        <p class="final-thunder__note">席を変えると、もう一度椅子を選べます</p>
      </div>
    `;

    this.panel = requireElement<HTMLElement>(this.element, '.final-thunder__panel');
    this.chairContainer = requireElement<HTMLElement>(this.element, '[data-final-thunder-chair]');
    this.chairNumber = requireElement<HTMLElement>(this.element, '.final-thunder__chair-number');
    this.playerLine = requireElement<HTMLElement>(this.element, '.final-thunder__player');
    this.changeButton = requireElement<HTMLButtonElement>(this.element, '[data-choice="change"]');
    this.keepButton = requireElement<HTMLButtonElement>(this.element, '[data-choice="keep"]');

    requireElement<HTMLElement>(this.element, '[data-final-thunder-backdrop]').addEventListener(
      'click',
      () => this.cancel(),
    );
    this.changeButton.addEventListener('click', () => this.choose('change'));
    this.keepButton.addEventListener('click', () => this.choose('keep'));

    (options.host ?? document.body ?? document.documentElement).append(this.element);
  }

  get isOpen(): boolean {
    return this.isOpenState;
  }

  ask(request: FinalThunderRequest): Promise<FinalThunderChoice> {
    if (this.destroyed) return Promise.resolve('change');

    // 同じプロンプトが開いていれば、前の Promise を安全側の 'change' で解決する。
    if (this.isOpenState) this.settle('change', true);

    const formattedChair = formatChair(request.chair);
    this.chairNumber.textContent = formattedChair;
    this.chairContainer.setAttribute('aria-label', `CHAIR ${formattedChair}`);

    const playerName = request.playerName?.trim();
    if (playerName) {
      this.playerLine.textContent = `PLAYER / ${playerName}`;
      this.playerLine.hidden = false;
    } else {
      this.playerLine.textContent = '';
      this.playerLine.hidden = true;
    }

    return new Promise<FinalThunderChoice>((resolve) => {
      this.pendingResolve = resolve;
      this.show();
    });
  }

  /** 開いていれば隠し、Promise を 'change'（席を確定しない）で解決する。 */
  cancel(): void {
    this.settle('change', true);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.settle('change', false);
    this.destroyed = true;
    this.element.remove();
  }

  private choose(choice: FinalThunderChoice): void {
    this.settle(choice, true);
  }

  private show(): void {
    this.isOpenState = true;
    this.previousFocus = document.activeElement;
    this.element.hidden = false;
    this.element.classList.add('is-open');
    document.addEventListener('keydown', this.handleKeyDown);
    this.changeButton.focus({ preventScroll: true });
    this.options.onOpen?.();
  }

  private settle(choice: FinalThunderChoice, notify: boolean): void {
    if (!this.isOpenState) return;
    this.isOpenState = false;

    const resolve = this.pendingResolve;
    this.pendingResolve = null;

    this.element.classList.remove('is-open');
    this.element.hidden = true;
    document.removeEventListener('keydown', this.handleKeyDown);
    this.restoreFocus();

    resolve?.(choice);
    if (notify) this.options.onClose?.(choice);
  }

  private restoreFocus(): void {
    const target = this.previousFocus;
    this.previousFocus = null;
    if (target instanceof HTMLElement && target.isConnected && !this.element.contains(target)) {
      target.focus({ preventScroll: true });
    }
  }

  private focusableElements(): HTMLButtonElement[] {
    return Array.from(this.panel.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpenState) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusables = this.focusableElements();
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;

    const active = document.activeElement;
    const index =
      active instanceof HTMLElement ? focusables.indexOf(active as HTMLButtonElement) : -1;

    if (index === -1) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && index === 0) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && index === focusables.length - 1) {
      event.preventDefault();
      first.focus();
    }
  };
}
