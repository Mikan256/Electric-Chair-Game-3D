import * as THREE from 'three';
import type { MatchView } from '@/game/types';

export interface MatchMonitorOptions {
  readonly pixelWidth?: number;
  readonly pixelHeight?: number;
  readonly worldWidth?: number;
  readonly worldHeight?: number;
}

/** 描画は常にこの仮想解像度で行い、Canvas の実サイズへ拡大縮小する。 */
const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 640;

const FONT_STACK = '"Zekton", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif';

const COLORS = {
  gold: '#ffcf5c',
  goldDim: '#b8912f',
  red: '#e5343f',
  redBright: '#ff5a63',
  cyan: '#5ad1ff',
  orange: '#ffa94d',
  shock: '#ff4d5a',
  safe: '#46e08a',
  text: '#f4f6fb',
  textSoft: '#dfe5f2',
  textDim: '#8d97ad',
  textFaint: '#5b6478',
} as const;

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

/** ステージ後方モニターの大きな見出し（Canvas 非依存の純粋関数）。 */
export function monitorHeadline(view: MatchView): string {
  switch (view.phase) {
    case 'press':
      return 'FINAL THUNDER';
    case 'result':
      if (!view.lastResult) return 'RESULT';
      return view.lastResult.hit ? 'SHOCK' : 'SAFE';
    case 'finished':
      return 'FINISHED';
    default:
      return 'MATCH LOG';
  }
}

/** フェーズの表示ラベル（例: `SET / 仕掛け中`）。 */
export function monitorPhaseLabel(view: MatchView): string {
  const style = PHASE_STYLES[view.phase];
  return `${style.en} / ${style.jp}`;
}

/**
 * モニターに出す椅子ラベル。
 * press 中は仕掛けられた椅子を絶対に公開しないため常に `CHAIR ??`。
 * result 以降は公開済みの lastResult.sittingChair だけを使う。
 */
export function monitorChairLabel(view: MatchView): string | null {
  if (view.phase === 'press') return 'CHAIR ??';
  if (view.phase === 'result' || view.phase === 'finished') {
    return view.lastResult ? `CHAIR #${view.lastResult.sittingChair}` : null;
  }
  return view.sittingChair === null ? null : `CHAIR #${view.sittingChair}`;
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

/**
 * ステージ後方モニター。試合の詳細表は持たず、ロゴとフェーズの要約だけを
 * 表示する装飾スクリーン。詳細は通常 UI の「試合経過」パネルが担当する。
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

  /** null でスタンバイ画面、同じ revision の再送はスキップする。 */
  update(view: MatchView | null): void {
    if (view === null) {
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
    context.fillText('ELECTRIC CHAIR GAME', DESIGN_WIDTH / 2, 218);

    context.fillStyle = 'rgba(255, 207, 92, 0.35)';
    context.fillRect(DESIGN_WIDTH / 2 - 180, 242, 360, 2);

    setFont(context, 82, '800');
    context.fillStyle = COLORS.text;
    context.fillText('MATCH LOG', DESIGN_WIDTH / 2, 306);

    setFont(context, 24, '800');
    context.fillStyle = COLORS.textDim;
    context.fillText('S T A N D B Y', DESIGN_WIDTH / 2, 382);

    setFont(context, 20, '600');
    context.fillStyle = COLORS.textFaint;
    context.fillText('試合開始を待っています', DESIGN_WIDTH / 2, 424);

    this.drawDetailsHint(context);
  }

  private drawView(context: CanvasRenderingContext2D, view: MatchView): void {
    this.drawBackdrop(context);
    this.drawFrame(context);
    this.drawHeader(context, view);
    this.drawHero(context, view);
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
    context.fillText('TURN', DESIGN_WIDTH - 28, 30);

    setFont(context, 44, '800');
    context.fillStyle = COLORS.gold;
    context.fillText(`${pad2(view.turn)} / ${pad2(view.config.maxTurns)}`, DESIGN_WIDTH - 28, 71);

    const chipText = `${phase.jp}  ${phase.en}`;
    setFont(context, 21, '800');
    const chipWidth = context.measureText(chipText).width + 36;
    const chipHeight = 42;
    const chipX = 1030 - chipWidth;
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

  private drawHero(context: CanvasRenderingContext2D, view: MatchView): void {
    const phase = PHASE_STYLES[view.phase];
    const headline = monitorHeadline(view);
    const centerX = DESIGN_WIDTH / 2;

    if (view.phase === 'press') {
      this.drawFinalThunder(context, view);
      return;
    }

    if (view.phase === 'result') {
      const hit = view.lastResult?.hit ?? false;
      const color = view.lastResult ? (hit ? COLORS.shock : COLORS.safe) : COLORS.gold;
      this.drawGlowText(context, headline, centerX, 300, color, 46);
      setFont(context, 36, '800');
      context.fillStyle = color;
      context.fillText(view.lastResult ? (hit ? '感電' : '回避') : '判定中', centerX, 402);

      const chairLabel = monitorChairLabel(view);
      if (chairLabel) {
        setFont(context, 26, '700');
        context.fillStyle = COLORS.textDim;
        context.fillText(chairLabel, centerX, 456);
      }
      return;
    }

    if (view.phase === 'finished') {
      context.textAlign = 'center';
      this.drawGlowText(context, headline, centerX, 292, COLORS.gold, 34);

      const outcome = view.outcome;
      const outcomeText =
        outcome?.kind === 'win' && outcome.winner !== null
          ? `${view.players[outcome.winner].name} WIN`
          : outcome?.kind === 'draw'
            ? 'DRAW'
            : '';
      if (outcomeText) {
        setFont(context, 40, '800');
        context.fillStyle = COLORS.text;
        context.fillText(outcomeText, centerX, 386);
      }

      setFont(context, 22, '600');
      context.fillStyle = COLORS.textDim;
      context.fillText(phase.hint, centerX, 442);
      return;
    }

    // set / sit: ロゴとフェーズの要約だけ。
    context.textAlign = 'center';

    setFont(context, 22, '800');
    context.fillStyle = COLORS.gold;
    context.fillText('ELECTRIC CHAIR GAME', centerX, 206);

    context.fillStyle = 'rgba(255, 207, 92, 0.35)';
    context.fillRect(centerX - 160, 230, 320, 2);

    setFont(context, 82, '800');
    context.fillStyle = COLORS.text;
    context.fillText(headline, centerX, 296);

    setFont(context, 96, '800');
    context.fillStyle = phase.color;
    context.fillText(phase.en, centerX, 400);

    setFont(context, 28, '700');
    context.fillStyle = COLORS.textSoft;
    context.fillText(phase.jp, centerX, 464);

    setFont(context, 20, '600');
    context.fillStyle = COLORS.textDim;
    context.fillText(phase.hint, centerX, 508);

    const chairLabel = monitorChairLabel(view);
    if (chairLabel) {
      setFont(context, 24, '700');
      context.fillStyle = COLORS.goldDim;
      context.fillText(chairLabel, centerX, 548);
    }
  }

  private drawFinalThunder(context: CanvasRenderingContext2D, view: MatchView): void {
    const centerX = DESIGN_WIDTH / 2;

    context.textAlign = 'center';

    const gradient = context.createLinearGradient(centerX - 420, 0, centerX + 420, 0);
    gradient.addColorStop(0, COLORS.red);
    gradient.addColorStop(0.5, COLORS.gold);
    gradient.addColorStop(1, COLORS.red);

    context.save();
    context.shadowColor = rgba(COLORS.redBright, 0.75);
    context.shadowBlur = 40;
    setFont(context, 108, '900');
    context.fillStyle = gradient;
    context.fillText('FINAL THUNDER', centerX, 280);
    context.restore();

    this.drawGlowText(context, 'CHAIR ??', centerX, 398, COLORS.gold, 30, 110);

    setFont(context, 26, '700');
    context.fillStyle = COLORS.textDim;
    const seated = view.sittingChair === null ? '着席 —' : `着席 #${view.sittingChair}`;
    context.fillText(seated, centerX, 470);

    setFont(context, 20, '800');
    context.fillStyle = COLORS.redBright;
    context.fillText('PRESS THE BUTTON', centerX, 516);
  }

  private drawFooter(context: CanvasRenderingContext2D, view: MatchView): void {
    const phase = PHASE_STYLES[view.phase];

    context.strokeStyle = 'rgba(255, 207, 92, 0.18)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(28, 568);
    context.lineTo(DESIGN_WIDTH - 28, 568);
    context.stroke();

    this.drawDetailsHint(context);

    context.textAlign = 'right';
    setFont(context, 18, '700');
    context.fillStyle = COLORS.textDim;
    context.fillText(`${phase.jp} — ${phase.hint}`, DESIGN_WIDTH - 32, 606);
  }

  private drawDetailsHint(context: CanvasRenderingContext2D): void {
    context.textAlign = 'left';
    setFont(context, 15, '800');
    context.fillStyle = COLORS.goldDim;
    context.fillText('MATCH DETAILS / 試合詳細', 32, 587);

    setFont(context, 20, '600');
    context.fillStyle = COLORS.textFaint;
    context.fillText('画面下の「試合経過」ボタンで全ターンの詳細を表示', 32, 612);
  }

  private drawGlowText(
    context: CanvasRenderingContext2D,
    text: string,
    centerX: number,
    y: number,
    color: string,
    blur: number,
    size = 150,
  ): void {
    context.save();
    context.textAlign = 'center';
    context.shadowColor = rgba(color, 0.8);
    context.shadowBlur = blur;
    setFont(context, size, '900');
    context.fillStyle = color;
    context.fillText(text, centerX, y);
    context.restore();
  }
}
