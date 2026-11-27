// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchLogPanel } from '@/ui/match-log-panel';
import type { MatchView, MatchViewPlayer, TurnResult } from '@/game/types';

function player(name: string, points = 0, shocksDealt = 0): MatchViewPlayer {
  return { id: name.toLowerCase(), name, points, shocksDealt };
}

const ALL_CHAIRS = Array.from({ length: 12 }, (_, index) => index + 1);

function makeView(overrides: Partial<MatchView> = {}): MatchView {
  const turn = overrides.turn ?? 1;
  const base: MatchView = {
    matchId: 'match-log-panel-test',
    config: { maxTurns: 16, targetPoints: 40, shocksToWin: 3, chairCount: 12 },
    players: [player('Alice'), player('Bob')],
    phase: 'set',
    turn,
    // 攻撃→守備の 1 組で 1 ラウンド。
    round: Math.ceil(turn / 2),
    maxRounds: 8,
    attacker: 0,
    wiredCommitted: false,
    sittingChair: null,
    previewChair: null,
    retiredChairs: [],
    availableChairs: ALL_CHAIRS,
    history: [],
    lastResult: null,
    outcome: null,
    revision: 1,
    you: 0,
  };
  return { ...base, ...overrides };
}

function makeResult(turn: number, overrides: Partial<Omit<TurnResult, 'turn'>> = {}): TurnResult {
  return {
    turn,
    attacker: 0,
    defender: 1,
    wiredChair: 7,
    sittingChair: 4,
    hit: false,
    pointsAwarded: 4,
    pointsLost: 0,
    retiredChair: 4,
    pointsAfter: [0, 4],
    shocksAfter: [0, 0],
    ...overrides,
  };
}

let host: HTMLElement;
let panel: MatchLogPanel | null = null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  panel?.destroy();
  panel = null;
  document.body.innerHTML = '';
});

function createPanel(options: ConstructorParameters<typeof MatchLogPanel>[0] = {}): MatchLogPanel {
  panel = new MatchLogPanel({ host, ...options });
  return panel;
}

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element;
}

describe('MatchLogPanel', () => {
  it('初期状態は hidden で host に追加される', () => {
    const ui = createPanel();

    expect(ui.element.classList.contains('match-log-panel')).toBe(true);
    expect(ui.element.hidden).toBe(true);
    expect(ui.isOpen).toBe(false);
    expect(host.contains(ui.element)).toBe(true);
  });

  it('open でタイトル・プレイヤー・表・現在行の ??? を表示し、閉じるボタンへフォーカスする', () => {
    const opener = document.createElement('button');
    opener.textContent = 'MATCH LOG';
    host.append(opener);
    opener.focus();

    const ui = createPanel();
    const history = [
      makeResult(1, {
        attacker: 0,
        wiredChair: 7,
        sittingChair: 4,
        hit: false,
        pointsAfter: [0, 4],
        retiredChair: 4,
      }),
    ];
    const view = makeView({
      phase: 'press',
      turn: 2,
      attacker: 1,
      sittingChair: 6,
      players: [player('Alice', 10, 1), player('Bob', 3, 2)],
      retiredChairs: [4],
      history,
    });

    ui.open(view);

    expect(ui.isOpen).toBe(true);
    expect(ui.element.hidden).toBe(false);
    expect(ui.element.classList.contains('is-open')).toBe(true);

    const closeButton = query<HTMLButtonElement>(ui.element, '[data-match-log-close]');
    expect(document.activeElement).toBe(closeButton);

    const title = query<HTMLElement>(ui.element, '.match-log-panel__title');
    expect(title.textContent).toContain('MATCH LOG');
    expect(title.textContent).toContain('試合経過');

    expect(query<HTMLElement>(ui.element, '[data-match-log-turn]').textContent).toBe(
      'ROUND 01 / 08',
    );
    expect(query<HTMLElement>(ui.element, '[data-match-log-phase]').textContent).toBe(
      'PRESS / ボタン待ち',
    );

    const headers = Array.from(ui.element.querySelectorAll('th')).map((th) =>
      th.textContent?.trim(),
    );
    expect(headers).toEqual(['#', '攻撃', '着席', '電流', '判定', 'PTS']);

    const cards = ui.element.querySelectorAll<HTMLElement>('[data-player-index]');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain('Alice');
    expect(cards[0]?.textContent).toContain('10');
    expect(cards[0]?.textContent).toContain('1 / 3');
    expect(cards[0]?.classList.contains('is-you')).toBe(true);
    expect(cards[1]?.textContent).toContain('Bob');
    expect(cards[1]?.textContent).toContain('3');
    expect(cards[1]?.textContent).toContain('2 / 3');
    expect(cards[1]?.classList.contains('is-attacker')).toBe(true);

    const rows = ui.element.querySelectorAll<HTMLElement>('[data-match-log-row]');
    expect(rows).toHaveLength(2);

    expect(rows[0]?.textContent).toContain('SAFE');
    expect(rows[0]?.textContent).toContain('#7');
    expect(rows[0]?.textContent).toContain('#4');
    expect(rows[0]?.querySelector('[data-result="SAFE"]')).not.toBeNull();
    expect(rows[0]?.classList.contains('is-current')).toBe(false);

    expect(rows[1]?.classList.contains('is-current')).toBe(true);
    expect(rows[1]?.getAttribute('aria-current')).toBe('true');
    expect(rows[1]?.textContent).toContain('#6');
    expect(rows[1]?.querySelector('[data-wired="unknown"]')?.textContent).toBe('???');
    expect(rows[1]?.querySelector('[data-result="—"]')).not.toBeNull();

    expect(query<HTMLElement>(ui.element, '[data-match-log-retired]').textContent).toBe('#4');
    expect(query<HTMLElement>(ui.element, '[data-match-log-status]').textContent).toContain(
      '前方のボタン',
    );
  });

  it('SHOCK 行は赤、SAFE 行は緑、現在行はグレーの判定クラスになる', () => {
    const ui = createPanel();
    ui.open(
      makeView({
        phase: 'result',
        turn: 2,
        history: [
          makeResult(1, { hit: false }),
          makeResult(2, { hit: true, wiredChair: 9, sittingChair: 9, retiredChair: null }),
        ],
      }),
    );

    const rows = ui.element.querySelectorAll<HTMLElement>('[data-match-log-row]');
    expect(rows[0]?.querySelector('.match-log-panel__result--safe')).not.toBeNull();
    expect(rows[1]?.querySelector('.match-log-panel__result--shock')).not.toBeNull();
    expect(rows[1]?.querySelector('.match-log-panel__result--shock')?.textContent).toBe('SHOCK');
    expect(rows).toHaveLength(2);
  });

  it('update は開いたまま再描画し、閉じているときは表示しない', () => {
    const ui = createPanel();
    const first = makeView({ phase: 'set', turn: 1 });
    ui.open(first);

    expect(ui.element.querySelectorAll('[data-match-log-row]')).toHaveLength(1);

    const second = makeView({
      phase: 'result',
      turn: 2,
      attacker: 1,
      history: [makeResult(1), makeResult(2, { attacker: 1, hit: true })],
    });
    ui.update(second);

    expect(ui.isOpen).toBe(true);
    expect(ui.element.hidden).toBe(false);
    expect(query<HTMLElement>(ui.element, '[data-match-log-turn]').textContent).toBe(
      'ROUND 01 / 08',
    );

    const rows = ui.element.querySelectorAll<HTMLElement>('[data-match-log-row]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('SAFE');
    expect(rows[1]?.textContent).toContain('SHOCK');
    expect(ui.element.querySelector('[data-match-log-row].is-current')).toBeNull();

    ui.close();
    ui.update(makeView({ turn: 3 }));
    expect(ui.element.hidden).toBe(true);
    expect(ui.isOpen).toBe(false);
  });

  it('閉じるボタンで閉じ、onClose を1回呼び、元のフォーカスへ戻す', () => {
    const onClose = vi.fn();
    const opener = document.createElement('button');
    host.append(opener);
    opener.focus();

    const ui = createPanel({ onClose });
    ui.open(makeView());
    query<HTMLButtonElement>(ui.element, '[data-match-log-close]').click();

    expect(ui.isOpen).toBe(false);
    expect(ui.element.hidden).toBe(true);
    expect(ui.element.classList.contains('is-open')).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
  });

  it('背景クリックで閉じる', () => {
    const onClose = vi.fn();
    const ui = createPanel({ onClose });
    ui.open(makeView());

    query<HTMLElement>(ui.element, '[data-match-log-backdrop]').click();

    expect(ui.isOpen).toBe(false);
    expect(ui.element.hidden).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape で閉じ、閉じた後のキー入力では再度 onClose を呼ばない', () => {
    const onClose = vi.fn();
    const ui = createPanel({ onClose });
    ui.open(makeView());

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(ui.isOpen).toBe(false);
    expect(ui.element.hidden).toBe(true);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('toggle で開閉し、開いたまま open を再実行しても isOpen を維持する', () => {
    const ui = createPanel();
    const view = makeView();

    ui.toggle(view);
    expect(ui.isOpen).toBe(true);

    ui.toggle(view);
    expect(ui.isOpen).toBe(false);
    expect(ui.element.hidden).toBe(true);

    ui.toggle(view);
    expect(ui.isOpen).toBe(true);

    const updated = makeView({ turn: 2, phase: 'sit', sittingChair: 8 });
    ui.open(updated);
    expect(ui.isOpen).toBe(true);
    expect(ui.element.hidden).toBe(false);

    const rows = ui.element.querySelectorAll<HTMLElement>('[data-match-log-row]');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('#8');
  });

  it('Tab はダイアログ内で循環する', () => {
    const ui = createPanel();
    ui.open(makeView());
    const closeButton = query<HTMLButtonElement>(ui.element, '[data-match-log-close]');
    closeButton.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeButton);
  });

  it('destroy で DOM とリスナーを片付け、onClose は呼ばない', () => {
    const onClose = vi.fn();
    const ui = createPanel({ onClose });
    ui.open(makeView());

    ui.destroy();

    expect(host.contains(ui.element)).toBe(false);
    expect(ui.isOpen).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    expect(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      ui.destroy();
    }).not.toThrow();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('match-log-panel.css', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/ui/match-log-panel.css'), 'utf8');

  it('350〜390px 幅で横スクロールさせず、表だけ縦スクロールにする', () => {
    expect(css).toContain('overflow-x: hidden');
    expect(css).toContain('overflow-y: auto');
    expect(css).toContain('table-layout: fixed');
    expect(css).toContain('@media (max-width: 420px)');
    expect(css).toContain('.match-log-panel[hidden]');
  });
});
