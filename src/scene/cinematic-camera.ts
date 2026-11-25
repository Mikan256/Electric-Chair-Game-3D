import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** 演出カメラが向かう 1 ショット。fov を省略した場合は現在値を保つ。 */
export interface CameraShot {
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly fov?: number;
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
const SHOCK_FOV = 42;
const PRESS_TRANSITION_MS = 450;
const SHOCK_TRANSITION_MS = 220;
const RESTORE_TRANSITION_MS = 500;
/** 壁際のショットを作らないための余白。 */
const BOUNDS_MARGIN = 0.4;
const EPSILON = 1e-6;

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
 * 感電時のアップショット。
 *
 * 椅子から円の内側へ 1.6、横方向へ 1.2 寄った位置から、
 * 座っているアバターの胸元（椅子 + 1.1）を見上げる。
 * 椅子は半径 6.1 にあるため、カメラは必ず円の内側に収まる。
 */
export function shockShotFor(chair: THREE.Vector3): CameraShot {
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
    fov: SHOCK_FOV,
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

interface SavedView {
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly fov: number;
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
 * `pressShot` / `shockShot` でショットへ移動し、`restore` で最初のショット前に
 * 保存したユーザー視点へ戻す。演出中は `controls.enabled = false` にして
 * ユーザー操作と競合しないようにする。
 *
 * トゥイーンの開始時刻は最初の `update(now)` 呼び出しで確定する。
 * そのため呼び出し側は `performance.now()` をそのまま渡せばよい。
 */
export class CinematicCamera {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly bounds: CinematicBounds;

  private tween: Tween | null = null;
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

  /** 台座と攻撃側アバターの斜め後ろから椅子を見るショット。 */
  pressShot(pedestal: THREE.Vector3, avatar: THREE.Vector3): void {
    this.beginShot(pressShotFor(pedestal, avatar), PRESS_TRANSITION_MS);
  }

  /** 感電した椅子のアップショット。 */
  shockShot(chair: THREE.Vector3): void {
    this.beginShot(shockShotFor(chair), SHOCK_TRANSITION_MS);
  }

  /** 保存しておいたユーザー視点へ戻す。 */
  restore(): void {
    const saved = this.saved;
    if (!saved || !this.activeValue) return;
    // 毎フレーム呼ばれてもトゥイーンを巻き戻さない。
    if (this.tween?.mode === 'restore') return;

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

  /** 退室・破棄用。トゥイーンを待たずに元の視点へ戻す。 */
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
    this.saved = null;
    this.activeValue = false;
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
