import './match-log-panel.css';
import { buildMatchLogRows, type MatchLogResult, type MatchLogRow } from '@/game/match-log';
import type { MatchView } from '@/game/types';

export interface MatchLogPanelOptions {
  /** 省略時は document.body。 */
  host?: HTMLElement;
  onClose?: () => void;
}

const PHASE_INFO: Record<
  MatchView['phase'],
  { readonly jp: string; readonly en: string; readonly hint: string }
> = {
  set: { jp: '仕掛け中', en: 'SET', hint: '攻撃側が電気イスを仕掛けています' },
  sit: { jp: '着席待ち', en: 'SIT', hint: '守備側が座る椅子を選んでいます' },
  press: { jp: 'ボタン待ち', en: 'PRESS', hint: '攻撃側が前方のボタンを押すのを待っています' },
  result: { jp: '判定', en: 'RESULT', hint: '判定結果を表示しています' },
  finished: { jp: '終了', en: 'FINISHED', hint: '試合は終了しました' },
};

const REASON_LABEL: Record<string, string> = {
  points: '40ポイント先取',
  shocks: '3回感電させた',
  'turn-limit': 'ターン終了時のポイント勝負',
  draw: '引き分け',
  forfeit: '相手の退出・応答なし',
  abandoned: '両者の応答なし',
};

const RESULT_CLASS: Record<MatchLogResult, string> = {
  SHOCK: 'match-log-panel__result--shock',
  SAFE: 'match-log-panel__result--safe',
  '—': 'match-log-panel__result--pending',
};

let instanceCount = 0;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`[match-log-panel] missing element: ${selector}`);
  return element;
}

function makeSpan(className: string, text?: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/**
 * 画面下のボタンから開く試合経過パネル。
 *
 * 3D モニターの表を置き換える通常の DOM UI。開いている間は `update()` の
 * たびに現在の `MatchView` で再描画し、`isOpen` を維持する。
 */
export class MatchLogPanel {
  readonly element: HTMLElement;

  private readonly options: MatchLogPanelOptions;
  private readonly dialog: HTMLElement;
  private readonly turnElement: HTMLElement;
  private readonly phaseElement: HTMLElement;
  private readonly playersElement: HTMLElement;
  private readonly rowsElement: HTMLTableSectionElement;
  private readonly retiredElement: HTMLElement;
  private readonly statusElement: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly abort = new AbortController();

  private isOpenState = false;
  private destroyed = false;
  private previousFocus: Element | null = null;

  constructor(options: MatchLogPanelOptions = {}) {
    this.options = options;
    const id = `match-log-${++instanceCount}`;

    this.element = document.createElement('div');
    this.element.className = 'match-log-panel';
    this.element.hidden = true;

    this.element.innerHTML = `
      <div class="match-log-panel__backdrop" data-match-log-backdrop aria-hidden="true"></div>
      <section
        class="match-log-panel__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="${id}-title"
      >
        <header class="match-log-panel__header">
          <div class="match-log-panel__heading">
            <p class="match-log-panel__kicker">ELECTRIC CHAIR GAME</p>
            <h2 class="match-log-panel__title" id="${id}-title">
              MATCH LOG <span class="match-log-panel__title-jp">/ 試合経過</span>
            </h2>
          </div>
          <button
            type="button"
            class="match-log-panel__close"
            data-match-log-close
            aria-label="試合経過を閉じる"
          >
            <span class="match-log-panel__close-x" aria-hidden="true">×</span>
            <span class="match-log-panel__close-label">CLOSE</span>
          </button>
        </header>
        <div class="match-log-panel__meta">
          <span class="match-log-panel__turn" data-match-log-turn>TURN 01 / 08</span>
          <span class="match-log-panel__phase" data-match-log-phase>SET / 仕掛け中</span>
        </div>
        <div class="match-log-panel__players" data-match-log-players></div>
        <div class="match-log-panel__table-wrap">
          <table class="match-log-panel__table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">攻撃</th>
                <th scope="col">着席</th>
                <th scope="col">電流</th>
                <th scope="col">判定</th>
                <th scope="col">PTS</th>
              </tr>
            </thead>
            <tbody data-match-log-rows></tbody>
          </table>
        </div>
        <footer class="match-log-panel__footer">
          <div class="match-log-panel__retired">
            <span class="match-log-panel__retired-label">RETIRED / 使用不可</span>
            <span class="match-log-panel__retired-value" data-match-log-retired>なし / NONE</span>
          </div>
          <p class="match-log-panel__status" data-match-log-status></p>
        </footer>
      </section>
    `;

    this.dialog = requireElement<HTMLElement>(this.element, '[role="dialog"]');
    this.turnElement = requireElement<HTMLElement>(this.element, '[data-match-log-turn]');
    this.phaseElement = requireElement<HTMLElement>(this.element, '[data-match-log-phase]');
    this.playersElement = requireElement<HTMLElement>(this.element, '[data-match-log-players]');
    this.rowsElement = requireElement<HTMLTableSectionElement>(
      this.element,
      '[data-match-log-rows]',
    );
    this.retiredElement = requireElement<HTMLElement>(this.element, '[data-match-log-retired]');
    this.statusElement = requireElement<HTMLElement>(this.element, '[data-match-log-status]');
    this.closeButton = requireElement<HTMLButtonElement>(this.element, '[data-match-log-close]');

    const { signal } = this.abort;
    this.closeButton.addEventListener('click', () => this.close(), { signal });
    requireElement<HTMLElement>(this.element, '[data-match-log-backdrop]').addEventListener(
      'click',
      () => this.close(),
      { signal },
    );

    (options.host ?? document.body ?? document.documentElement).append(this.element);
  }

  get isOpen(): boolean {
    return this.isOpenState;
  }

  open(view: MatchView): void {
    if (this.destroyed) return;

    const wasOpen = this.isOpenState;
    this.isOpenState = true;
    this.render(view);

    if (!wasOpen) this.previousFocus = document.activeElement;
    this.element.hidden = false;
    this.element.classList.add('is-open');

    document.addEventListener('keydown', this.handleKeyDown);
    if (!wasOpen) this.closeButton.focus({ preventScroll: true });
  }

  update(view: MatchView): void {
    if (this.destroyed || !this.isOpenState) return;
    this.render(view);
  }

  close(): void {
    if (!this.isOpenState) return;
    this.isOpenState = false;

    this.element.classList.remove('is-open');
    this.element.hidden = true;
    document.removeEventListener('keydown', this.handleKeyDown);
    this.restoreFocus();
    this.options.onClose?.();
  }

  toggle(view: MatchView): void {
    if (this.isOpenState) {
      this.close();
      return;
    }
    this.open(view);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.isOpenState = false;
    document.removeEventListener('keydown', this.handleKeyDown);
    this.abort.abort();
    this.restoreFocus();
    this.element.remove();
  }

  private render(view: MatchView): void {
    const phase = PHASE_INFO[view.phase];
    this.dialog.dataset.phase = view.phase;

    this.turnElement.textContent = `TURN ${pad2(view.turn)} / ${pad2(view.config.maxTurns)}`;
    this.phaseElement.textContent = `${phase.en} / ${phase.jp}`;

    this.renderPlayers(view);
    this.renderRows(buildMatchLogRows(view));

    this.retiredElement.textContent =
      view.retiredChairs.length > 0
        ? view.retiredChairs.map((chair) => `#${chair}`).join('  ')
        : 'なし / NONE';
    this.retiredElement.classList.toggle('is-empty', view.retiredChairs.length === 0);

    let status = phase.hint;
    if (view.outcome) {
      const { winner, reason } = view.outcome;
      const reasonLabel = REASON_LABEL[reason] ?? reason;
      status =
        winner === null
          ? `引き分け / ${reasonLabel}`
          : `${view.players[winner].name} の勝利 / ${reasonLabel}`;
    }
    this.statusElement.textContent = status;
  }

  private renderPlayers(view: MatchView): void {
    this.playersElement.replaceChildren();

    for (const index of [0, 1] as const) {
      const player = view.players[index];
      const attacking = view.attacker === index;

      const card = document.createElement('article');
      card.className = 'match-log-panel__player';
      card.dataset.playerIndex = String(index);
      card.classList.toggle('is-attacker', attacking);
      card.classList.toggle('is-you', view.you === index);

      const head = document.createElement('div');
      head.className = 'match-log-panel__player-head';
      head.append(
        makeSpan('match-log-panel__role', attacking ? 'ATTACK / 攻撃側' : 'DEFEND / 守備側'),
      );
      if (view.you === index) head.append(makeSpan('match-log-panel__you', 'YOU'));

      const name = document.createElement('div');
      name.className = 'match-log-panel__player-name';
      name.textContent = player.name;

      const stats = document.createElement('div');
      stats.className = 'match-log-panel__stats';

      const points = makeSpan('match-log-panel__points');
      points.append(
        makeSpan('match-log-panel__points-value', String(player.points)),
        makeSpan('match-log-panel__points-unit', 'pt'),
      );

      const shocks = makeSpan('match-log-panel__shocks');
      shocks.append(
        makeSpan('match-log-panel__shocks-label', 'SHOCKS / 感電させた'),
        makeSpan(
          'match-log-panel__shocks-value',
          `${player.shocksDealt} / ${view.config.shocksToWin}`,
        ),
      );

      stats.append(points, shocks);
      card.append(head, name, stats);
      this.playersElement.append(card);
    }
  }

  private renderRows(rows: readonly MatchLogRow[]): void {
    this.rowsElement.replaceChildren();

    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.className = 'match-log-panel__row';
      tr.dataset.matchLogRow = '';
      tr.dataset.turn = String(row.turn);
      if (row.current) {
        tr.classList.add('is-current');
        tr.setAttribute('aria-current', 'true');
      }

      const turnCell = document.createElement('td');
      turnCell.className = 'match-log-panel__turn-cell';
      turnCell.textContent = pad2(row.turn);

      const attackerCell = document.createElement('td');
      attackerCell.className = 'match-log-panel__attacker';
      attackerCell.textContent = row.attacker;

      const sittingCell = document.createElement('td');
      sittingCell.className = 'match-log-panel__chair';
      if (row.sittingChair === null) {
        sittingCell.textContent = '—';
        sittingCell.classList.add('is-empty');
      } else {
        sittingCell.textContent = `#${row.sittingChair}`;
      }

      const wiredCell = document.createElement('td');
      wiredCell.className = 'match-log-panel__chair';
      if (row.wiredChair === null) {
        const unknown = makeSpan('match-log-panel__wired-unknown', '???');
        unknown.dataset.wired = 'unknown';
        wiredCell.append(unknown);
      } else {
        wiredCell.textContent = `#${row.wiredChair}`;
      }

      const resultCell = document.createElement('td');
      const result = makeSpan(`match-log-panel__result ${RESULT_CLASS[row.result]}`, row.result);
      result.dataset.result = row.result;
      resultCell.append(result);

      const pointsCell = document.createElement('td');
      pointsCell.className = 'match-log-panel__points-cell';
      pointsCell.append(
        makeSpan('match-log-panel__points-value--0', String(row.points[0])),
        makeSpan('match-log-panel__points-separator', ' / '),
        makeSpan('match-log-panel__points-value--1', String(row.points[1])),
      );

      tr.append(turnCell, attackerCell, sittingCell, wiredCell, resultCell, pointsCell);
      this.rowsElement.append(tr);
    }
  }

  private restoreFocus(): void {
    const target = this.previousFocus;
    this.previousFocus = null;
    if (target instanceof HTMLElement && target.isConnected && !this.element.contains(target)) {
      target.focus({ preventScroll: true });
    }
  }

  private focusableElements(): HTMLElement[] {
    return Array.from(
      this.dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpenState) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusables = this.focusableElements();
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;

    const active = document.activeElement;
    const index = active instanceof HTMLElement ? focusables.indexOf(active) : -1;

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
