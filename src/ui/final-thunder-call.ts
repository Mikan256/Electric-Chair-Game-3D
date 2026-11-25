import './final-thunder-call.css';

export type FinalThunderCallRole = 'attacker' | 'defender';

export interface FinalThunderCallOptions {
  chair: number;
  attackerName: string;
  defenderName: string;
  highStakes?: boolean;
  role: FinalThunderCallRole;
  durationMs?: number;
}

/** 自動で消えるまでの既定時間。 */
export const FINAL_THUNDER_CALL_DEFAULT_DURATION_MS = 2200;
/** 退場スライドの長さ。CSS の ftc-out と合わせる。 */
export const FINAL_THUNDER_CALL_EXIT_ANIMATION_MS = 280;

function formatChair(chair: number): string {
  const value = Number.isFinite(chair) ? Math.trunc(chair) : 0;
  return String(Math.max(0, value)).padStart(2, '0');
}

function formatName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : '---';
}

function normalizeDuration(durationMs: number | undefined): number {
  if (durationMs === undefined || !Number.isFinite(durationMs)) {
    return FINAL_THUNDER_CALL_DEFAULT_DURATION_MS;
  }
  return Math.max(0, Math.trunc(durationMs));
}

/**
 * 守備側が「このまま行く」で確定したあとに出す、操作不要の FINAL THUNDER カットイン。
 *
 * 選択用の `FinalThunderPrompt` とは別物で、ボタンもフォーカス移動も持たない。
 * 右から左へ横長バンドが入り、`durationMs`（既定 2200ms）後に左へ抜けて隠れる。
 * `pointer-events: none` なので、攻撃側がプレスボタンを押す操作を妨げない。
 *
 * 同じインスタンスに連続して `show()` してもタイマーはリセットされ、
 * 新しい文言で最初からアニメーションし直す。
 */
export class FinalThunderCall {
  readonly element: HTMLElement;

  private readonly state: HTMLElement;
  private readonly who: HTMLElement;
  private readonly chairNumber: HTMLElement;
  private readonly chairLine: HTMLElement;
  private readonly subMain: HTMLElement;
  private readonly subNote: HTMLElement;
  private readonly lastChance: HTMLElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private exitTimer: ReturnType<typeof setTimeout> | null = null;
  private isOpenState = false;
  private destroyed = false;

  constructor(host?: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'ft-call';
    this.element.hidden = true;
    this.element.dataset.role = 'attacker';
    this.element.innerHTML = `
      <div class="ft-call__frame" role="status" aria-live="polite" aria-atomic="true">
        <span class="ft-call__bolt ft-call__bolt--lead" aria-hidden="true"></span>
        <span class="ft-call__bolt ft-call__bolt--trail" aria-hidden="true"></span>
        <span class="ft-call__glitch" aria-hidden="true"></span>
        <div class="ft-call__head">
          <p class="ft-call__kicker">ELECTRIC CHAIR GAME</p>
          <p class="ft-call__title">FINAL THUNDER</p>
          <p class="ft-call__state" data-ft-call-state>TARGET LOCKED</p>
        </div>
        <div class="ft-call__target">
          <p class="ft-call__who" data-ft-call-who>DEFENDER / ---</p>
          <p class="ft-call__chair" data-ft-call-chair-line aria-label="CHAIR --">
            <span class="ft-call__chair-label">CHAIR</span>
            <span class="ft-call__chair-number" data-ft-call-chair>--</span>
          </p>
        </div>
        <p class="ft-call__sub">
          <span class="ft-call__sub-main" data-ft-call-sub-main>ボタンを押せ</span>
          <span class="ft-call__sub-note" data-ft-call-sub-note>仕掛けを解放しろ</span>
        </p>
        <p class="ft-call__last-chance" data-ft-call-last-chance hidden>LAST CHANCE / リーチ</p>
      </div>
    `;

    const frame = this.element.querySelector<HTMLElement>('.ft-call__frame');
    if (!frame) throw new Error('[final-thunder-call] missing frame');
    this.state = this.require('[data-ft-call-state]');
    this.who = this.require('[data-ft-call-who]');
    this.chairLine = this.require('[data-ft-call-chair-line]');
    this.chairNumber = this.require('[data-ft-call-chair]');
    this.subMain = this.require('[data-ft-call-sub-main]');
    this.subNote = this.require('[data-ft-call-sub-note]');
    this.lastChance = this.require('[data-ft-call-last-chance]');

    (host ?? document.body ?? document.documentElement).append(this.element);
  }

  /** 表示中（退場アニメーション開始まで）なら true。 */
  get isOpen(): boolean {
    return this.isOpenState && !this.destroyed;
  }

  show(options: FinalThunderCallOptions): void {
    if (this.destroyed) return;

    this.clearTimers();
    this.isOpenState = true;

    const role: FinalThunderCallRole = options.role === 'defender' ? 'defender' : 'attacker';
    const highStakes = options.highStakes === true;
    const chair = formatChair(options.chair);
    const attackerName = formatName(options.attackerName);
    const defenderName = formatName(options.defenderName);

    this.element.classList.toggle('ft-call--attacker', role === 'attacker');
    this.element.classList.toggle('ft-call--defender', role === 'defender');
    this.element.classList.toggle('ft-call--high-stakes', highStakes);
    this.element.dataset.role = role;
    this.element.dataset.highStakes = String(highStakes);
    this.element.dataset.attackerName = attackerName;
    this.element.dataset.defenderName = defenderName;

    if (role === 'attacker') {
      this.state.textContent = 'TARGET LOCKED';
      this.who.textContent = `DEFENDER / ${defenderName}`;
      this.subMain.textContent = 'ボタンを押せ';
      this.subNote.textContent = '仕掛けを解放しろ';
      this.subNote.hidden = false;
    } else {
      this.state.textContent = '確定';
      this.who.textContent = `DEFENDER / ${defenderName}`;
      this.subMain.textContent = '相手がボタンを押すのを待っている';
      this.subNote.textContent = '';
      this.subNote.hidden = true;
    }

    this.chairNumber.textContent = chair;
    this.chairLine.setAttribute('aria-label', `CHAIR ${chair}`);
    this.lastChance.hidden = !highStakes;

    this.element.hidden = false;
    this.element.classList.remove('is-leaving');
    this.element.classList.remove('is-open');
    // 連続 show でも CSS アニメーションを最初から再生する。
    void this.element.offsetWidth;
    this.element.classList.add('is-open');

    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.beginExit();
    }, normalizeDuration(options.durationMs));
  }

  /** 短いスライドで隠す。表示していなければ何もしない。 */
  hide(): void {
    if (this.destroyed || this.element.hidden) {
      this.clearTimers();
      this.isOpenState = false;
      return;
    }

    if (this.isOpenState) {
      this.isOpenState = false;
      if (this.hideTimer !== null) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
      this.element.classList.remove('is-open');
      this.element.classList.add('is-leaving');
    }

    if (this.exitTimer === null) {
      this.exitTimer = setTimeout(() => this.finishHide(), FINAL_THUNDER_CALL_EXIT_ANIMATION_MS);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.isOpenState = false;
    this.clearTimers();
    this.element.hidden = true;
    this.element.remove();
  }

  private beginExit(): void {
    if (!this.isOpenState) return;
    this.isOpenState = false;
    this.element.classList.remove('is-open');
    this.element.classList.add('is-leaving');
    this.exitTimer = setTimeout(() => this.finishHide(), FINAL_THUNDER_CALL_EXIT_ANIMATION_MS);
  }

  private finishHide(): void {
    this.exitTimer = null;
    // 退場中に show() し直された場合は、その表示を維持する。
    if (this.isOpenState || this.destroyed) return;
    this.element.classList.remove('is-leaving');
    this.element.hidden = true;
  }

  private clearTimers(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (this.exitTimer !== null) {
      clearTimeout(this.exitTimer);
      this.exitTimer = null;
    }
  }

  private require(selector: string): HTMLElement {
    const element = this.element.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`[final-thunder-call] missing element: ${selector}`);
    return element;
  }
}
