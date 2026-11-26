import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** 演出カメラが向かう 1 ショット。fov を省略した場合は現在値を保つ。 */
export interface CameraShot {
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly fov?: number;
}

/** タイムラインを構成する 1 ステップ。 */
export interface CinematicStep {
  readonly shot: CameraShot;
  /** このショットを表示する時間（次のショットへの移動時間を含む） */
  readonly durationMs: number;
}

/** FINAL THUNDER のプレス前タイムラインを組み立てるための入力。 */
export interface FinalThunderSequenceOptions {
  readonly pedestal: THREE.Vector3;
  readonly avatar: THREE.Vector3;
  readonly chair: THREE.Vector3;
  /** src/game/timing.ts の 5000 / 7600 を想定 */
  readonly durationMs: number;
}

/** 演出カメラの可動域（部屋の内側）。 */
export interface CinematicBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface CinematicCameraOptions {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** 部屋の内側に収めるための境界（省略時は広めの既定値） */
  bounds?: CinematicBounds;
}

/** 部屋の内側を表す既定の可動域。stage.ts の ROOM と揃えた広めの値。 */
export const DEFAULT_CINEMATIC_BOUNDS: CinematicBounds = {
  minX: -14,
  maxX: 14,
  minZ: -13.5,
  maxZ: 35,
};

const PRESS_FOV = 46;
const SEATED_FOV = 42;
const BUTTON_FOV = 32;
const PRESS_TRANSITION_MS = 450;
const SHOCK_TRANSITION_MS = 220;
const RESTORE_TRANSITION_MS = 500;
/** タイムライン内で次のショットへ移動する時間。ゆっくり見せるため650ms。 */
const SEQUENCE_TRANSITION_MS = 650;
/** 壁際のショットを作らないための余白。 */
const BOUNDS_MARGIN = 0.4;
const EPSILON = 1e-6;

/** 台座のボタン上面の高さ（stage.ts の buildPedestal と揃える）。 */
const BUTTON_LOCAL_Y = 1.06;
/** ボタンアップのカメラ位置（台座基準）。 */
const BUTTON_CAMERA_LOCAL_Y = 1.4;
const BUTTON_CAMERA_LOCAL_Z = 2.2;

/**
 * 標準尺（5000ms）の配分。0〜1200 プレス、1200〜2600 守備側、
 * 2600〜3800 ボタン、3800〜5000 プレスホールドに分け、
 * 各カットは650msかけてイージングしながらゆっくり移動する。
 * 高stakes（7600ms）では守備側とボタンを長く取り、最後のプレスを大きく伸ばす。
 */
const FINAL_THUNDER_LEAD_MS = 1200;
const FINAL_THUNDER_DEFENDER_STANDARD_MS = 1400;
const FINAL_THUNDER_BUTTON_STANDARD_MS = 1200;
const FINAL_THUNDER_LONG_FORM_MS = 7600;
const FINAL_THUNDER_DEFENDER_LONG_MS = 1900;
const FINAL_THUNDER_BUTTON_LONG_MS = 1800;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function finiteOrZero(value: number): number {
  return finiteOr(value, 0);
}

function finiteVector(value: THREE.Vector3, fallback: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(
    finiteOr(value.x, finiteOrZero(fallback.x)),
    finiteOr(value.y, finiteOrZero(fallback.y)),
    finiteOr(value.z, finiteOrZero(fallback.z)),
  );
}

function validFov(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0 || value >= 180) {
    return fallback;
  }
  return value;
}

/**
 * FINAL THUNDER 用のショット。
 *
 * 台座と攻撃側アバターの斜め後ろ（部屋の手前 = +Z 側）へ下がり、
 * 椅子の円の中心方向を見下ろす。アバターと同じ側へ振ることで、
 * 台座・アバター・椅子が同じ画角に収まりやすくする。
 */
export function pressShotFor(pedestal: THREE.Vector3, avatar: THREE.Vector3): CameraShot {
  const baseX = finiteOrZero(pedestal.x);
  const baseY = finiteOrZero(pedestal.y);
  const baseZ = finiteOrZero(pedestal.z);
  const avatarX = finiteOr(avatar.x, baseX);
  const avatarZ = finiteOr(avatar.z, baseZ);

  const side = avatarX >= baseX ? 1 : -1;
  // 台座の斜め後ろに下がり、攻撃側アバターを画面中央の前景に置く。
  // カメラ→ターゲット線がアバター付近を通るため、背中越しに椅子を見る画角になる。
  const cameraZ = Math.max(baseZ + 4.8, avatarZ + 3.0);

  return {
    position: new THREE.Vector3(baseX + 2.4 * side, baseY + 2.3, cameraZ),
    target: new THREE.Vector3(baseX, baseY + 0.6, baseZ - 4.4),
    fov: PRESS_FOV,
  };
}

/**
 * 椅子に座っているアバターのアップショット。
 *
 * 椅子から円の内側へ 2.0、横方向へ 1.25 寄った位置から、
 * 座っているアバターの胸元（椅子 + 1.2）を見る。
 * 椅子は半径 6.1 にあるため、カメラは必ず円の内側に収まる。
 */
function seatedShotFor(chair: THREE.Vector3, fov: number): CameraShot {
  const x = finiteOrZero(chair.x);
  const y = finiteOrZero(chair.y);
  const z = finiteOrZero(chair.z);

  const distance = Math.hypot(x, z);
  const inward =
    distance > EPSILON
      ? new THREE.Vector3(-x / distance, 0, -z / distance)
      : new THREE.Vector3(0, 0, -1);
  const side = new THREE.Vector3(-inward.z, 0, inward.x);

  return {
    position: new THREE.Vector3(
      x + inward.x * 2.0 + side.x * 1.25,
      y + 1.8,
      z + inward.z * 2.0 + side.z * 1.25,
    ),
    target: new THREE.Vector3(x, y + 1.2, z),
    fov,
  };
}

/** 守備側が座っている姿のアップ（感電前の「誰が座ったか」を見せる）。 */
export function defenderShotFor(chair: THREE.Vector3): CameraShot {
  return seatedShotFor(chair, SEATED_FOV);
}

/** 感電時のアップショット。構図は defenderShotFor と同じ。 */
export function shockShotFor(chair: THREE.Vector3): CameraShot {
  return seatedShotFor(chair, SEATED_FOV);
}

/**
 * 台座のボタン（攻撃側の手元）へ寄るショット。
 *
 * 台座の手前 +Z 側 2.2、ボタンより少し上から、ボタンそのものを見下ろす。
 * 部屋の手前方向（内側）へ下がるため、壁の外へは出ない。
 */
export function buttonShotFor(pedestal: THREE.Vector3): CameraShot {
  const x = finiteOrZero(pedestal.x);
  const y = finiteOrZero(pedestal.y);
  const z = finiteOrZero(pedestal.z);

  return {
    position: new THREE.Vector3(x, y + BUTTON_CAMERA_LOCAL_Y, z + BUTTON_CAMERA_LOCAL_Z),
    target: new THREE.Vector3(x, y + BUTTON_LOCAL_Y, z),
    fov: BUTTON_FOV,
  };
}

interface AxisRange {
  readonly min: number;
  readonly max: number;
  readonly center: number;
}

/** margin を内側に適用した軸範囲。潰れる場合は中心へ寄せる。 */
function axisRange(minValue: number, maxValue: number, margin: number): AxisRange {
  const hasMin = Number.isFinite(minValue);
  const hasMax = Number.isFinite(maxValue);
  let low = hasMin ? minValue : Number.NEGATIVE_INFINITY;
  let high = hasMax ? maxValue : Number.POSITIVE_INFINITY;
  if (low > high) {
    const swap = low;
    low = high;
    high = swap;
  }

  const center = Number.isFinite(low) && Number.isFinite(high) ? (low + high) / 2 : 0;
  const innerMin = low + margin;
  const innerMax = high - margin;
  if (innerMin <= innerMax) return { min: innerMin, max: innerMax, center };
  return { min: center, max: center, center };
}

function clampAxis(value: number, range: AxisRange): number {
  if (!Number.isFinite(value)) return range.center;
  return Math.min(range.max, Math.max(range.min, value));
}

function clampShotPosition(position: THREE.Vector3, bounds: CinematicBounds): THREE.Vector3 {
  const xRange = axisRange(bounds.minX, bounds.maxX, BOUNDS_MARGIN);
  const zRange = axisRange(bounds.minZ, bounds.maxZ, BOUNDS_MARGIN);
  return new THREE.Vector3(
    clampAxis(position.x, xRange),
    finiteOrZero(position.y),
    clampAxis(position.z, zRange),
  );
}

/**
 * FINAL THUNDER の時間配分。
 *
 * 通常尺では「プレス → 守備側 → ボタン → プレスホールド」を
 * 1200 / 1400 / 1200 / 残り に分ける。高stakes では守備側とボタンを
 * 1900 / 1800 に伸ばし、残りを最後のプレスホールドへ回す。
 * 合計は必ず durationMs と一致する。
 */
function finalThunderDurations(durationMs: number): [number, number, number, number] {
  const total = Math.max(0, finiteOr(durationMs, 0));
  const long = total >= FINAL_THUNDER_LONG_FORM_MS;
  const lead = FINAL_THUNDER_LEAD_MS;
  const defender = long ? FINAL_THUNDER_DEFENDER_LONG_MS : FINAL_THUNDER_DEFENDER_STANDARD_MS;
  const button = long ? FINAL_THUNDER_BUTTON_LONG_MS : FINAL_THUNDER_BUTTON_STANDARD_MS;
  const baseSum = lead + defender + button;

  if (total >= baseSum) {
    return [lead, defender, button, total - baseSum];
  }

  // 極端に短い duration でも比率を保ち、最後のホールドへ残りを寄せる。
  const scale = total / baseSum;
  const scaledLead = Math.floor(lead * scale);
  const scaledDefender = Math.floor(defender * scale);
  const scaledButton = Math.floor(button * scale);
  return [
    scaledLead,
    scaledDefender,
    scaledButton,
    total - scaledLead - scaledDefender - scaledButton,
  ];
}

/**
 * FINAL THUNDER のプレス前演出を 4 ショットのタイムラインへ組み立てる。
 *
 * 1. 台座＋攻撃側の斜め後ろから椅子（プレス）
 * 2. 座っている守備側のアップ
 * 3. 台座のボタン／手元アップ
 * 4. プレスショットへ戻してホールド（攻撃側が押せる瞬間）
 */
export function finalThunderStepsFor(options: FinalThunderSequenceOptions): CinematicStep[] {
  const durations = finalThunderDurations(options.durationMs);
  return [
    { shot: pressShotFor(options.pedestal, options.avatar), durationMs: durations[0] },
    { shot: defenderShotFor(options.chair), durationMs: durations[1] },
    { shot: buttonShotFor(options.pedestal), durationMs: durations[2] },
    { shot: pressShotFor(options.pedestal, options.avatar), durationMs: durations[3] },
  ];
}

interface SavedView {
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly fov: number;
}

interface ResolvedShot {
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly fov: number;
}

interface SequenceStep {
  readonly shot: ResolvedShot;
  readonly startMs: number;
  readonly durationMs: number;
}

interface SequenceState {
  readonly steps: readonly SequenceStep[];
  readonly totalMs: number;
  /** シーケンス開始前のカメラ位置（最初のショットの補間元）。 */
  readonly from: ResolvedShot;
  startedAt: number | null;
}

type TweenMode = 'shot' | 'restore';

interface Tween {
  startedAt: number | null;
  readonly duration: number;
  readonly mode: TweenMode;
  readonly fromPosition: THREE.Vector3;
  readonly fromTarget: THREE.Vector3;
  readonly fromFov: number;
  readonly toPosition: THREE.Vector3;
  readonly toTarget: THREE.Vector3;
  readonly toFov: number;
}

/**
 * 360° オービットカメラに一時的に被せる演出カメラ。
 *
 * 単発の `pressShot` / `shockShot` と、複数ショットの `playSequence` /
 * `finalThunderSequence` を持つ。`restore` で最初のショット前に保存した
 * ユーザー視点へ戻す。演出中は `controls.enabled = false` にして
 * ユーザー操作と競合しないようにする。
 *
 * タイムラインの開始時刻は最初の `update(now)` 呼び出しで確定する。
 * そのため呼び出し側は `performance.now()` をそのまま渡せばよい。
 */
export class CinematicCamera {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly bounds: CinematicBounds;

  private tween: Tween | null = null;
  private sequence: SequenceState | null = null;
  private saved: SavedView | null = null;
  private activeValue = false;

  constructor(options: CinematicCameraOptions) {
    this.camera = options.camera;
    this.controls = options.controls;
    this.bounds = options.bounds ?? DEFAULT_CINEMATIC_BOUNDS;
  }

  get active(): boolean {
    return this.activeValue;
  }

  /** 台座と攻撃側アバターの斜め後ろから椅子を見る単発ショット。 */
  pressShot(pedestal: THREE.Vector3, avatar: THREE.Vector3): void {
    this.beginShot(pressShotFor(pedestal, avatar), PRESS_TRANSITION_MS);
  }

  /** 感電した椅子のアップショット。シーケンス中でも割り込める。 */
  shockShot(chair: THREE.Vector3): void {
    this.beginShot(shockShotFor(chair), SHOCK_TRANSITION_MS);
  }

  /**
   * 複数ショットのタイムラインを開始する。
   *
   * 最初のステップは現在のカメラ位置からその duration をかけて移動し、
   * 以降は 650ms（ステップが短ければその全長）で前のショットから移動する。
   * タイムライン終了後は最後のショットをホールドしたまま active を維持する。
   */
  playSequence(steps: readonly CinematicStep[]): void {
    const resolved = this.resolveSequence(steps);
    if (resolved.length === 0) return;

    if (!this.activeValue) {
      this.saved = {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
        fov: this.camera.fov,
      };
      this.activeValue = true;
    }

    this.controls.enabled = false;
    this.tween = null;

    const last = resolved[resolved.length - 1];
    if (!last) return;

    this.sequence = {
      steps: resolved,
      totalMs: last.startMs + last.durationMs,
      from: {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
        fov: this.camera.fov,
      },
      startedAt: null,
    };
  }

  /** FINAL THUNDER の標準タイムライン（プレス前 4 ショット）を再生する。 */
  finalThunderSequence(options: FinalThunderSequenceOptions): void {
    this.playSequence(finalThunderStepsFor(options));
  }

  /** 保存しておいたユーザー視点へ戻す。 */
  restore(): void {
    const saved = this.saved;
    if (!saved || !this.activeValue) return;
    // 毎フレーム呼ばれてもトゥイーンを巻き戻さない。
    if (this.tween?.mode === 'restore') return;

    this.sequence = null;
    this.controls.enabled = false;
    this.tween = {
      startedAt: null,
      duration: RESTORE_TRANSITION_MS,
      mode: 'restore',
      fromPosition: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      fromFov: this.camera.fov,
      toPosition: saved.position.clone(),
      toTarget: saved.target.clone(),
      toFov: saved.fov,
    };
  }

  update(now: number): void {
    if (this.sequence) {
      this.updateSequence(now);
      return;
    }

    const tween = this.tween;
    if (!tween) return;

    const time = Number.isFinite(now) ? now : 0;
    if (tween.startedAt === null) tween.startedAt = time;
    const elapsed = Math.max(0, time - tween.startedAt);
    const t = tween.duration <= EPSILON ? 1 : Math.min(1, Math.max(0, elapsed / tween.duration));

    this.camera.position.lerpVectors(tween.fromPosition, tween.toPosition, t);
    this.controls.target.lerpVectors(tween.fromTarget, tween.toTarget, t);
    const fov = tween.fromFov + (tween.toFov - tween.fromFov) * t;
    if (Number.isFinite(fov)) this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    // OrbitControls は停止中なので、カメラの向きはここで明示的に更新する。
    this.camera.lookAt(this.controls.target);

    if (t < 1) return;

    if (tween.mode === 'restore') {
      const saved = this.saved;
      if (saved) {
        this.camera.position.copy(saved.position);
        this.controls.target.copy(saved.target);
        this.camera.fov = saved.fov;
        this.camera.updateProjectionMatrix();
      }
      this.controls.enabled = true;
      this.activeValue = false;
      this.tween = null;
      this.saved = null;
      return;
    }

    // 最終フレームは浮動小数の誤差を残さず、ショット座標そのものへ合わせる。
    this.camera.position.copy(tween.toPosition);
    this.controls.target.copy(tween.toTarget);
    this.camera.fov = tween.toFov;
    this.camera.updateProjectionMatrix();
    this.tween = null;
  }

  /** 退室・破棄用。トゥイーン・シーケンスを待たずに元の視点へ戻す。 */
  reset(): void {
    const saved = this.saved;
    if (saved) {
      this.camera.position.copy(saved.position);
      this.controls.target.copy(saved.target);
      this.camera.fov = saved.fov;
      this.camera.updateProjectionMatrix();
      this.controls.enabled = true;
    }
    this.tween = null;
    this.sequence = null;
    this.saved = null;
    this.activeValue = false;
  }

  private updateSequence(now: number): void {
    const sequence = this.sequence;
    if (!sequence) return;

    const time = Number.isFinite(now) ? now : 0;
    if (sequence.startedAt === null) sequence.startedAt = time;
    const elapsed = Math.max(0, time - sequence.startedAt);

    const lastIndex = sequence.steps.length - 1;
    const last = sequence.steps[lastIndex];
    if (!last) return;

    if (elapsed >= sequence.totalMs) {
      this.applyResolvedShot(last.shot);
      return;
    }

    let index = 0;
    while (index < lastIndex) {
      const step = sequence.steps[index];
      if (!step) break;
      if (elapsed < step.startMs + step.durationMs) break;
      index += 1;
    }

    const step = sequence.steps[index];
    if (!step) return;

    const local = Math.max(0, elapsed - step.startMs);
    // 最初のステップだけは現在位置からステップ全長で移動する。
    const transition =
      index === 0 ? step.durationMs : Math.min(SEQUENCE_TRANSITION_MS, step.durationMs);
    const previous = index === 0 ? sequence.from : sequence.steps[index - 1]?.shot;
    if (!previous) return;

    const linear = transition <= EPSILON ? 1 : Math.min(1, Math.max(0, local / transition));
    const t = linear * linear * (3 - 2 * linear);

    if (t >= 1) {
      this.applyResolvedShot(step.shot);
      return;
    }

    this.camera.position.copy(previous.position).lerp(step.shot.position, t);
    this.controls.target.copy(previous.target).lerp(step.shot.target, t);
    const fov = previous.fov + (step.shot.fov - previous.fov) * t;
    if (Number.isFinite(fov)) this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    // OrbitControls は停止中なので、カメラの向きはここで明示的に更新する。
    this.camera.lookAt(this.controls.target);
  }

  private applyResolvedShot(shot: ResolvedShot): void {
    this.camera.position.copy(shot.position);
    this.controls.target.copy(shot.target);
    this.camera.fov = shot.fov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.controls.target);
  }

  private resolveSequence(steps: readonly CinematicStep[]): SequenceStep[] {
    const resolved: SequenceStep[] = [];
    let startMs = 0;
    let fov = this.camera.fov;

    for (const step of steps) {
      const duration = step.durationMs;
      if (!Number.isFinite(duration) || duration <= 0) continue;

      fov = validFov(step.shot.fov, fov);
      resolved.push({
        shot: {
          position: clampShotPosition(
            finiteVector(step.shot.position, this.camera.position),
            this.bounds,
          ),
          target: finiteVector(step.shot.target, this.controls.target),
          fov,
        },
        startMs,
        durationMs: duration,
      });
      startMs += duration;
    }

    return resolved;
  }

  private beginShot(shot: CameraShot, duration: number): void {
    if (!this.activeValue) {
      this.saved = {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
        fov: this.camera.fov,
      };
      this.activeValue = true;
    }

    this.sequence = null;
    this.controls.enabled = false;
    this.tween = {
      startedAt: null,
      duration: Math.max(0, duration),
      mode: 'shot',
      fromPosition: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      fromFov: this.camera.fov,
      toPosition: clampShotPosition(finiteVector(shot.position, this.camera.position), this.bounds),
      toTarget: finiteVector(shot.target, this.controls.target),
      toFov: validFov(shot.fov, this.camera.fov),
    };
  }
}
