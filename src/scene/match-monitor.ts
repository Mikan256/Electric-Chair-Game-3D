import * as THREE from 'three';
import type { MatchView } from '@/game/types';

export type MonitorResult = 'SHOCK' | 'SAFE' | '—';

export interface MonitorRow {
  readonly turn: number;
  readonly attacker: string;
  readonly sittingChair: number | null;
  readonly wiredChair: number | null;
  readonly result: MonitorResult;
  readonly points: readonly [number, number];
  readonly current: boolean;
}

export interface MatchMonitorOptions {
  readonly pixelWidth?: number;
  readonly pixelHeight?: number;
  readonly worldWidth?: number;
  readonly worldHeight?: number;
}

/** 描画は常にこの仮想解像度で行い、Canvas の実サイズへ拡大縮小する。 */
const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 640;
const MAX_ROWS = 5;

const FONT_STACK = '"Zekton", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif';

const COLORS = {
  gold: '#ffcf5c',
  goldDim: '#b8912f',
  red: '#e5343f',
  redBright: '#ff5a63',
  blue: '#4d9dff',
  cyan: '#5ad1ff',
  orange: '#ffa94d',
  shock: '#ff4d5a',
  safe: '#46e08a',
  pending: '#7b8496',
  text: '#f4f6fb',
  textSoft: '#dfe5f2',
  textDim: '#8d97ad',
  textFaint: '#5b6478',
} as const;

const PLAYER_COLORS = [COLORS.cyan, COLORS.orange] as const;

interface PhaseStyle {
  readonly jp: string;
  readonly en: string;
  readonly color: string;
  readonly hint: string;
}

const PHASE_STYLES: Record<MatchView['phase'], PhaseStyle> = {
  set: {
    jp: '仕掛け中',
    en: 'SET',
    color: COLORS.orange,
    hint: '攻撃側が電気イスを仕掛けています',
  },
  sit: { jp: '着席待ち', en: 'SIT', color: COLORS.cyan, hint: '守備側が座る椅子を選んでいます' },
  press: {
    jp: 'ボタン待ち',
    en: 'PRESS',
    color: COLORS.redBright,
    hint: '攻撃側が前方のボタンを押すのを待っています',
  },
  result: { jp: '判定', en: 'RESULT', color: COLORS.gold, hint: '判定結果を表示しています' },
  finished: { jp: '終了', en: 'FINISHED', color: '#9aa4b8', hint: '試合終了' },
};

/** レイアウト定数（デザイン座標）。 */
const CARD_Y = 104;
const CARD_H = 96;
const CARD_W = 598;
const TABLE_Y = 204;
const TABLE_HEADER_H = 36;
const ROW_H = 64;
const ROWS_TOP = TABLE_Y + TABLE_HEADER_H;
const TABLE_X = 28;
const TABLE_W = 1224;
const RIGHT_X = TABLE_X + TABLE_W;

interface Column {
  readonly label: string;
  readonly x: number;
  readonly width: number;
}

const COLUMNS = [
  { label: '#', x: 28, width: 84 },
  { label: '攻撃', x: 112, width: 316 },
  { label: '着席', x: 428, width: 164 },
  { label: '電流', x: 592, width: 164 },
  { label: '判定', x: 756, width: 220 },
  { label: 'PTS', x: 976, width: 276 },
] as const satisfies readonly Column[];

/**
 * 公開済みの history と、進行中の現在ターンからモニターの行を作る。
 * 現在行は電気イス（wiredChair）を絶対に含めない。
 */
export function buildMonitorRows(view: MatchView): MonitorRow[] {
  const rows: MonitorRow[] = view.history.map((result) => ({
    turn: result.turn,
    attacker: view.players[result.attacker].name,
    sittingChair: result.sittingChair,
    wiredChair: result.wiredChair,
    result: result.hit ? 'SHOCK' : 'SAFE',
    points: result.pointsAfter,
    current: false,
  }));

  if (view.phase !== 'finished' && !view.history.some((result) => result.turn === view.turn)) {
    rows.push({
      turn: view.turn,
      attacker: view.players[view.attacker].name,
      sittingChair: view.sittingChair,
      wiredChair: null,
      result: '—',
      points: [view.players[0].points, view.players[1].points],
      current: true,
    });
  }

  return rows.slice(-MAX_ROWS);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function setFont(
  context: CanvasRenderingContext2D,
  size: number,
  weight: '400' | '600' | '700' | '800' | '900' = '700',
): void {
  context.font = `${weight} ${size}px ${FONT_STACK}`;
}

/** #rrggbb を alpha 付き rgba() に変換する（内部の固定色専用）。 */
function rgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function truncateText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text;
  const ellipsis = '…';
  let result = text;
  while (result.length > 0 && context.measureText(`${result}${ellipsis}`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return result.length > 0 ? `${result}${ellipsis}` : ellipsis;
}

/**
 * ステージ後方モニター用の試合経過表。
 * Canvas 2D で描いた内容を CanvasTexture として PlaneGeometry に貼る。
 */
export class MatchMonitor {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly texture: THREE.CanvasTexture;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshBasicMaterial;

  private lastRevision: number | null = null;
  private lastMatchId: string | null = null;
  private lastRows: MonitorRow[] = [];
  private standby = true;

  constructor(options: MatchMonitorOptions = {}) {
    const pixelWidth = Math.max(64, Math.round(options.pixelWidth ?? 1280));
    const pixelHeight = Math.max(64, Math.round(options.pixelHeight ?? 640));
    const worldWidth = Math.max(0.1, options.worldWidth ?? 11.0);
    const worldHeight = Math.max(0.1, options.worldHeight ?? 5.5);

    this.canvas = document.createElement('canvas');
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    this.context = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    this.geometry = new THREE.PlaneGeometry(worldWidth, worldHeight);
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      toneMapped: false,
      fog: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'match-monitor';

    this.paint((context) => this.drawStandby(context));
  }

  /** 直近に描画した表の行（テスト・デバッグ用）。 */
  get rows(): readonly MonitorRow[] {
    return this.lastRows;
  }

  /** null でスタンバイ画面、同じ revision の再送はスキップする。 */
  update(view: MatchView | null): void {
    if (view === null) {
      this.lastRows = [];
      if (!this.standby) {
        this.standby = true;
        this.lastRevision = null;
        this.lastMatchId = null;
        this.paint((context) => this.drawStandby(context));
      }
      return;
    }

    if (!this.standby && this.lastRevision === view.revision && this.lastMatchId === view.matchId) {
      return;
    }

    this.standby = false;
    this.lastRevision = view.revision;
    this.lastMatchId = view.matchId;
    this.lastRows = buildMonitorRows(view);
    this.paint((context) => this.drawView(context, view));
  }

  dispose(): void {
    this.texture.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }

  private paint(render: (context: CanvasRenderingContext2D) => void): void {
    const context = this.context;
    if (!context) return;

    context.save();
    context.setTransform(
      this.canvas.width / DESIGN_WIDTH,
      0,
      0,
      this.canvas.height / DESIGN_HEIGHT,
      0,
      0,
    );
    context.clearRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    context.textBaseline = 'middle';
    render(context);
    context.restore();

    this.texture.needsUpdate = true;
  }

  private drawStandby(context: CanvasRenderingContext2D): void {
    this.drawBackdrop(context);
    this.drawFrame(context);

    context.textAlign = 'center';

    setFont(context, 22, '800');
    context.fillStyle = COLORS.gold;
    context.fillText('ELECTRIC CHAIR GAME', DESIGN_WIDTH / 2, 238);

    context.fillStyle = 'rgba(255, 207, 92, 0.35)';
    context.fillRect(DESIGN_WIDTH / 2 - 180, 260, 360, 2);

    setFont(context, 66, '800');
    context.fillStyle = COLORS.text;
    context.fillText('MATCH LOG', DESIGN_WIDTH / 2, 314);

    setFont(context, 24, '800');
    context.fillStyle = COLORS.textDim;
    context.fillText('S T A N D B Y', DESIGN_WIDTH / 2, 386);

    setFont(context, 18, '600');
    context.fillStyle = COLORS.textFaint;
    context.fillText('試合開始を待っています', DESIGN_WIDTH / 2, 424);
  }

  private drawView(context: CanvasRenderingContext2D, view: MatchView): void {
    this.drawBackdrop(context);
    this.drawFrame(context);
    this.drawHeader(context, view);
    this.drawPlayer(context, view, 0);
    this.drawPlayer(context, view, 1);
    this.drawTable(context, view);
    this.drawFooter(context, view);
  }

  private drawBackdrop(context: CanvasRenderingContext2D): void {
    const background = context.createLinearGradient(0, 0, 0, DESIGN_HEIGHT);
    background.addColorStop(0, '#0a1022');
    background.addColorStop(0.45, '#05070f');
    background.addColorStop(1, '#0b1024');
    context.fillStyle = background;
    context.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

    const glow = context.createRadialGradient(
      DESIGN_WIDTH / 2,
      -40,
      20,
      DESIGN_WIDTH / 2,
      -40,
      900,
    );
    glow.addColorStop(0, 'rgba(255, 170, 70, 0.16)');
    glow.addColorStop(0.55, 'rgba(90, 130, 255, 0.06)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

    context.strokeStyle = 'rgba(120, 150, 220, 0.05)';
    context.lineWidth = 1;
    context.beginPath();
    for (let x = 0; x <= DESIGN_WIDTH; x += 80) {
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, DESIGN_HEIGHT);
    }
    for (let y = 0; y <= DESIGN_HEIGHT; y += 40) {
      context.moveTo(0, y + 0.5);
      context.lineTo(DESIGN_WIDTH, y + 0.5);
    }
    context.stroke();

    const vignette = context.createRadialGradient(
      DESIGN_WIDTH / 2,
      DESIGN_HEIGHT / 2,
      260,
      DESIGN_WIDTH / 2,
      DESIGN_HEIGHT / 2,
      820,
    );
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    context.fillStyle = vignette;
    context.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
  }

  private drawFrame(context: CanvasRenderingContext2D): void {
    context.strokeStyle = COLORS.gold;
    context.lineWidth = 4;
    context.strokeRect(10, 10, DESIGN_WIDTH - 20, DESIGN_HEIGHT - 20);

    context.strokeStyle = rgba(COLORS.red, 0.7);
    context.lineWidth = 1;
    context.strokeRect(18, 18, DESIGN_WIDTH - 36, DESIGN_HEIGHT - 36);

    context.strokeStyle = COLORS.gold;
    context.lineWidth = 6;
    context.beginPath();
    context.moveTo(10, 58);
    context.lineTo(10, 10);
    context.lineTo(58, 10);
    context.moveTo(DESIGN_WIDTH - 58, 10);
    context.lineTo(DESIGN_WIDTH - 10, 10);
    context.lineTo(DESIGN_WIDTH - 10, 58);
    context.moveTo(10, DESIGN_HEIGHT - 58);
    context.lineTo(10, DESIGN_HEIGHT - 10);
    context.lineTo(58, DESIGN_HEIGHT - 10);
    context.moveTo(DESIGN_WIDTH - 58, DESIGN_HEIGHT - 10);
    context.lineTo(DESIGN_WIDTH - 10, DESIGN_HEIGHT - 10);
    context.lineTo(DESIGN_WIDTH - 10, DESIGN_HEIGHT - 58);
    context.stroke();
  }

  private drawHeader(context: CanvasRenderingContext2D, view: MatchView): void {
    setFont(context, 20, '800');
    context.textAlign = 'left';
    context.fillStyle = COLORS.gold;
    context.fillText('ELECTRIC CHAIR GAME', 44, 31);

    context.fillStyle = 'rgba(255, 207, 92, 0.35)';
    context.fillRect(44, 45, 250, 2);

    setFont(context, 46, '800');
    context.fillStyle = COLORS.text;
    context.fillText('MATCH LOG', 44, 73);

    const phase = PHASE_STYLES[view.phase];

    context.textAlign = 'right';
    setFont(context, 17, '700');
    context.fillStyle = COLORS.textDim;
    context.fillText('TURN', RIGHT_X, 30);

    setFont(context, 44, '800');
    context.fillStyle = COLORS.gold;
    context.fillText(`${pad2(view.turn)} / ${pad2(view.config.maxTurns)}`, RIGHT_X, 71);

    const chipText = `${phase.jp}  ${phase.en}`;
    setFont(context, 22, '800');
    const chipWidth = context.measureText(chipText).width + 38;
    const chipHeight = 44;
    const chipX = 1080 - chipWidth;
    const chipY = 26;

    roundedRect(context, chipX, chipY, chipWidth, chipHeight, 8);
    context.fillStyle = rgba(phase.color, 0.16);
    context.fill();
    context.strokeStyle = rgba(phase.color, 0.7);
    context.lineWidth = 1.5;
    context.stroke();

    context.textAlign = 'center';
    context.fillStyle = phase.color;
    context.fillText(chipText, chipX + chipWidth / 2, chipY + chipHeight / 2 + 1);
  }

  private drawPlayer(context: CanvasRenderingContext2D, view: MatchView, index: 0 | 1): void {
    const cardX = index === 0 ? TABLE_X : TABLE_X + CARD_W + 28;
    const color = index === 0 ? PLAYER_COLORS[0] : PLAYER_COLORS[1];
    const player = view.players[index];
    const attacking = view.attacker === index;

    const cardGradient = context.createLinearGradient(
      cardX,
      CARD_Y,
      cardX + CARD_W,
      CARD_Y + CARD_H,
    );
    cardGradient.addColorStop(0, rgba(color, 0.18));
    cardGradient.addColorStop(1, rgba(color, 0.03));

    roundedRect(context, cardX, CARD_Y, CARD_W, CARD_H, 10);
    context.fillStyle = cardGradient;
    context.fill();
    context.strokeStyle = rgba(color, attacking ? 0.85 : 0.35);
    context.lineWidth = attacking ? 2 : 1;
    context.stroke();

    context.fillStyle = color;
    context.fillRect(cardX, CARD_Y + 10, 4, CARD_H - 20);

    setFont(context, 26, '800');
    context.textAlign = 'left';
    context.fillStyle = COLORS.text;
    context.fillText(truncateText(context, player.name, CARD_W - 190), cardX + 22, CARD_Y + 32);

    const badge = attacking ? 'ATTACK' : 'DEFEND';
    const badgeColor = attacking ? COLORS.redBright : COLORS.blue;
    setFont(context, 15, '800');
    const badgeWidth = context.measureText(badge).width + 26;
    const badgeX = cardX + CARD_W - badgeWidth - 18;
    const badgeY = CARD_Y + 12;

    roundedRect(context, badgeX, badgeY, badgeWidth, 24, 6);
    context.fillStyle = rgba(badgeColor, 0.18);
    context.fill();
    context.strokeStyle = rgba(badgeColor, 0.75);
    context.lineWidth = 1.2;
    context.stroke();

    context.textAlign = 'center';
    context.fillStyle = badgeColor;
    context.fillText(badge, badgeX + badgeWidth / 2, badgeY + 13);

    setFont(context, 14, '700');
    context.textAlign = 'left';
    context.fillStyle = COLORS.textDim;
    context.fillText('PTS', cardX + 22, CARD_Y + 58);

    setFont(context, 40, '800');
    context.fillStyle = color;
    context.fillText(String(player.points), cardX + 58, CARD_Y + 76);

    context.fillStyle = 'rgba(255, 255, 255, 0.10)';
    context.fillRect(cardX + 190, CARD_Y + 48, 1, 34);

    setFont(context, 14, '700');
    context.textAlign = 'right';
    context.fillStyle = COLORS.textDim;
    context.fillText('SHOCKS / 感電させた', cardX + CARD_W - 20, CARD_Y + 58);

    setFont(context, 34, '800');
    context.fillStyle = attacking ? COLORS.gold : COLORS.text;
    context.fillText(
      `${player.shocksDealt} / ${view.config.shocksToWin}`,
      cardX + CARD_W - 20,
      CARD_Y + 80,
    );
  }

  private drawTable(context: CanvasRenderingContext2D, view: MatchView): void {
    const [turnColumn, attackerColumn, sitColumn, wireColumn, judgeColumn, pointsColumn] = COLUMNS;
    const rows = buildMonitorRows(view);
    const headerCenterY = TABLE_Y + TABLE_HEADER_H / 2 + 1;

    roundedRect(context, TABLE_X, TABLE_Y, TABLE_W, TABLE_HEADER_H, 6);
    context.fillStyle = 'rgba(255, 207, 92, 0.09)';
    context.fill();
    context.strokeStyle = 'rgba(255, 207, 92, 0.22)';
    context.lineWidth = 1;
    context.stroke();

    setFont(context, 22, '800');
    context.fillStyle = COLORS.goldDim;
    context.textAlign = 'center';
    for (const column of [turnColumn, sitColumn, wireColumn, judgeColumn, pointsColumn]) {
      context.fillText(column.label, column.x + column.width / 2, headerCenterY);
    }
    context.textAlign = 'left';
    context.fillText(attackerColumn.label, attackerColumn.x + 16, headerCenterY);

    context.fillStyle = 'rgba(5, 8, 18, 0.55)';
    context.fillRect(TABLE_X, ROWS_TOP, TABLE_W, ROW_H * MAX_ROWS);

    for (const [index, row] of rows.entries()) {
      const attackerColor =
        row.attacker === view.players[0].name ? PLAYER_COLORS[0] : PLAYER_COLORS[1];
      this.drawRow(context, row, index, attackerColor);
    }
  }

  private drawRow(
    context: CanvasRenderingContext2D,
    row: MonitorRow,
    index: number,
    attackerColor: string,
  ): void {
    const [turnColumn, attackerColumn, sitColumn, wireColumn, judgeColumn, pointsColumn] = COLUMNS;
    const y = ROWS_TOP + index * ROW_H;
    const centerY = y + ROW_H / 2 + 1;

    if (row.current) {
      const highlight = context.createLinearGradient(TABLE_X, y, RIGHT_X, y);
      highlight.addColorStop(0, 'rgba(255, 207, 92, 0.26)');
      highlight.addColorStop(0.55, 'rgba(255, 207, 92, 0.10)');
      highlight.addColorStop(1, 'rgba(255, 90, 99, 0.10)');
      context.fillStyle = highlight;
      context.fillRect(TABLE_X, y, TABLE_W, ROW_H);

      context.fillStyle = COLORS.gold;
      context.fillRect(TABLE_X, y + 4, 5, ROW_H - 8);

      context.strokeStyle = 'rgba(255, 207, 92, 0.45)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(TABLE_X, y + 0.5);
      context.lineTo(RIGHT_X, y + 0.5);
      context.stroke();
    } else if (index % 2 === 1) {
      context.fillStyle = 'rgba(255, 255, 255, 0.025)';
      context.fillRect(TABLE_X, y, TABLE_W, ROW_H);
    }

    context.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(TABLE_X, y + ROW_H - 0.5);
    context.lineTo(RIGHT_X, y + ROW_H - 0.5);
    context.stroke();

    setFont(context, 44, row.current ? '800' : '700');
    context.textAlign = 'center';
    context.fillStyle = row.current ? COLORS.gold : COLORS.textDim;
    context.fillText(pad2(row.turn), turnColumn.x + turnColumn.width / 2, centerY);

    context.fillStyle = attackerColor;
    context.beginPath();
    context.arc(attackerColumn.x + 14, centerY, 5, 0, Math.PI * 2);
    context.fill();

    setFont(context, 44, row.current ? '800' : '700');
    context.textAlign = 'left';
    context.fillStyle = row.current ? COLORS.text : COLORS.textSoft;
    context.fillText(
      truncateText(context, row.attacker, attackerColumn.width - 40),
      attackerColumn.x + 30,
      centerY,
    );

    setFont(context, 46, '800');
    context.textAlign = 'center';
    if (row.sittingChair === null) {
      context.fillStyle = COLORS.textFaint;
      context.fillText('—', sitColumn.x + sitColumn.width / 2, centerY);
    } else {
      context.fillStyle = row.current ? COLORS.text : COLORS.textSoft;
      context.fillText(`#${row.sittingChair}`, sitColumn.x + sitColumn.width / 2, centerY);
    }

    if (row.wiredChair === null) {
      context.fillStyle = rgba(COLORS.gold, 0.75);
      context.fillText('???', wireColumn.x + wireColumn.width / 2, centerY);
    } else {
      context.fillStyle = COLORS.orange;
      context.fillText(`#${row.wiredChair}`, wireColumn.x + wireColumn.width / 2, centerY);
    }

    const resultColor =
      row.result === 'SHOCK' ? COLORS.shock : row.result === 'SAFE' ? COLORS.safe : COLORS.pending;
    const chipWidth = 144;
    const chipHeight = 44;
    const chipX = judgeColumn.x + (judgeColumn.width - chipWidth) / 2;
    const chipY = y + (ROW_H - chipHeight) / 2;

    roundedRect(context, chipX, chipY, chipWidth, chipHeight, 6);
    context.fillStyle = rgba(resultColor, row.current ? 0.22 : 0.12);
    context.fill();
    context.strokeStyle = rgba(resultColor, row.current ? 0.7 : 0.4);
    context.lineWidth = 1;
    context.stroke();

    setFont(context, 32, '800');
    context.fillStyle = resultColor;
    context.fillText(row.result, chipX + chipWidth / 2, centerY);

    this.drawPoints(context, row.points, pointsColumn.x + pointsColumn.width / 2, centerY);
  }

  private drawPoints(
    context: CanvasRenderingContext2D,
    points: readonly [number, number],
    centerX: number,
    centerY: number,
  ): void {
    const separator = ' / ';
    setFont(context, 44, '800');

    const first = String(points[0]);
    const second = String(points[1]);
    const firstWidth = context.measureText(first).width;
    const secondWidth = context.measureText(second).width;
    const separatorWidth = context.measureText(separator).width;
    const totalWidth = firstWidth + separatorWidth + secondWidth;

    let x = centerX - totalWidth / 2;
    context.textAlign = 'left';

    context.fillStyle = PLAYER_COLORS[0];
    context.fillText(first, x, centerY);
    x += firstWidth;

    context.fillStyle = COLORS.textFaint;
    context.fillText(separator, x, centerY);
    x += separatorWidth;

    context.fillStyle = PLAYER_COLORS[1];
    context.fillText(second, x, centerY);
  }

  private drawFooter(context: CanvasRenderingContext2D, view: MatchView): void {
    const phase = PHASE_STYLES[view.phase];

    context.strokeStyle = 'rgba(255, 207, 92, 0.18)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(TABLE_X, 568);
    context.lineTo(RIGHT_X, 568);
    context.stroke();

    context.textAlign = 'left';
    setFont(context, 15, '800');
    context.fillStyle = COLORS.goldDim;
    context.fillText('RETIRED CHAIRS / 使用不可', TABLE_X, 587);

    if (view.retiredChairs.length > 0) {
      setFont(context, 30, '800');
      context.fillStyle = COLORS.gold;
      const list = view.retiredChairs.map((chair) => `#${chair}`).join('   ');
      context.fillText(truncateText(context, list, 610), TABLE_X, 616);
    } else {
      setFont(context, 24, '700');
      context.fillStyle = COLORS.textFaint;
      context.fillText('なし / NONE', TABLE_X, 616);
    }

    context.textAlign = 'right';
    setFont(context, 15, '800');
    context.fillStyle = COLORS.goldDim;
    context.fillText('STATUS / 状況', RIGHT_X, 587);

    setFont(context, 22, '700');
    context.fillStyle = COLORS.textSoft;
    context.fillText(`${phase.jp} — ${phase.hint}`, RIGHT_X, 616);
  }
}
