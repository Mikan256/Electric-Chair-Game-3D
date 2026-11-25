import type * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** 部屋の内側を表す軸平行境界。y を省略した場合は y 方向を制限しない。 */
export interface RoomBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly minY?: number;
  readonly maxY?: number;
}

export interface RoomOrbitConfig {
  readonly fov: number;
  readonly target: readonly [number, number, number];
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly minPolarAngle: number;
  readonly maxPolarAngle: number;
  readonly bounds: RoomBounds;
  readonly margin?: number;
  /** reset 時の初期方位角・極角（省略時は現在値/正面） */
  readonly defaultAzimuth?: number;
  readonly defaultPolar?: number;
}

export interface OrbitDistanceLimits {
  readonly min: number;
  readonly max: number;
}

export interface CameraPosition {
  x: number;
  y: number;
  z: number;
}

const EPSILON = 1e-6;
/** カメラがターゲットに重なった場合の最小の基準距離。 */
const MIN_MIN_DISTANCE = 2;
/** max が必ず正になるための下限。 */
const MIN_MAX_DISTANCE = 1e-3;
const DEFAULT_MARGIN = 0;

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalFinite(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveMargin(config: RoomOrbitConfig): number {
  return Math.max(0, finiteOr(config.margin, DEFAULT_MARGIN));
}

interface AxisSpan {
  readonly min: number;
  readonly max: number;
  readonly center: number;
}

/** margin を内側に適用した軸範囲。範囲が潰れる場合は中心へ寄せる。 */
function effectiveSpan(minValue: number, maxValue: number, margin: number): AxisSpan {
  const rawMin = Math.min(finiteOr(minValue, 0), finiteOr(maxValue, 0));
  const rawMax = Math.max(finiteOr(minValue, 0), finiteOr(maxValue, 0));
  const center = (rawMin + rawMax) / 2;
  const innerMin = rawMin + margin;
  const innerMax = rawMax - margin;
  if (innerMin <= innerMax) return { min: innerMin, max: innerMax, center };
  return { min: center, max: center, center };
}

function targetAt(config: RoomOrbitConfig, axis: 0 | 1 | 2): number {
  return finiteOr(config.target[axis], 0);
}

/**
 * origin から direction 方向へ進んだとき、[min, max] の内側に留まれる距離。
 * direction が 0 の軸は、origin が範囲内なら制約なし (Infinity) を返す。
 */
function axisTravel(origin: number, direction: number, span: AxisSpan): number {
  if (Math.abs(direction) < EPSILON) {
    return origin >= span.min && origin <= span.max ? Number.POSITIVE_INFINITY : 0;
  }
  const limit = direction > 0 ? (span.max - origin) / direction : (span.min - origin) / direction;
  return Math.max(0, limit);
}

/**
 * 指定した方位角で部屋の内側に収まるカメラ距離の範囲。
 *
 * 角度は OrbitControls と同じく `atan2(x - target.x, z - target.z)`。
 * max は水平方向の部屋半径をそのまま距離上限として使う保守的な値で、
 * 真上・真下から見る場合でも壁を越えない。min は常に 2 以上、
 * max は常に min 以上かつ正になる。
 */
export function orbitDistanceLimits(azimuth: number, config: RoomOrbitConfig): OrbitDistanceLimits {
  const margin = resolveMargin(config);
  const xSpan = effectiveSpan(config.bounds.minX, config.bounds.maxX, margin);
  const zSpan = effectiveSpan(config.bounds.minZ, config.bounds.maxZ, margin);

  const angle = finiteOr(azimuth, 0);
  const targetX = targetAt(config, 0);
  const targetZ = targetAt(config, 2);

  const horizontalLimit = Math.min(
    axisTravel(targetX, Math.sin(angle), xSpan),
    axisTravel(targetZ, Math.cos(angle), zSpan),
  );

  const min = Math.max(MIN_MIN_DISTANCE, finiteOr(config.minDistance, MIN_MIN_DISTANCE));
  const configuredMax = Math.max(min, finiteOr(config.maxDistance, min));
  const roomMax = Number.isFinite(horizontalLimit)
    ? Math.max(MIN_MAX_DISTANCE, horizontalLimit)
    : configuredMax;

  return { min, max: Math.max(min, Math.min(configuredMax, roomMax)) };
}

/**
 * カメラ位置を部屋の内側（margin 込み）へ収める。
 * 入力は変更せず、常に有限な新しい座標を返す。
 */
export function clampCameraToRoom(
  position: Readonly<CameraPosition>,
  config: RoomOrbitConfig,
): CameraPosition {
  const margin = resolveMargin(config);
  const xSpan = effectiveSpan(config.bounds.minX, config.bounds.maxX, margin);
  const zSpan = effectiveSpan(config.bounds.minZ, config.bounds.maxZ, margin);

  const x = clamp(finiteOr(position.x, targetAt(config, 0)), xSpan.min, xSpan.max);
  const z = clamp(finiteOr(position.z, targetAt(config, 2)), zSpan.min, zSpan.max);

  let y = finiteOr(position.y, targetAt(config, 1));
  const minY = optionalFinite(config.bounds.minY);
  const maxY = optionalFinite(config.bounds.maxY);
  if (minY !== undefined && maxY !== undefined) {
    const ySpan = effectiveSpan(minY, maxY, margin);
    y = clamp(y, ySpan.min, ySpan.max);
  } else if (minY !== undefined) {
    y = Math.max(y, minY + margin);
  } else if (maxY !== undefined) {
    y = Math.min(y, maxY - margin);
  }

  return { x, y, z };
}

interface OrbitState {
  readonly azimuth: number;
  readonly polar: number;
  readonly distance: number;
}

/**
 * 部屋の内側で 360° 回せるオービットカメラ。
 *
 * - 方位角は制限しない
 * - パン無効・ダンピング有効・タッチ/ピンチは OrbitControls の既定
 * - update() ごとに方位角から距離上限を再計算して壁の外へ出ないようにする
 */
export class RoomOrbitCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private config: RoomOrbitConfig;
  private disposed = false;

  constructor(camera: THREE.PerspectiveCamera, element: HTMLElement, config: RoomOrbitConfig) {
    this.camera = camera;
    this.config = config;

    this.controls = new OrbitControls(camera, element);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    // 360° 回転を許可する。OrbitControls は min < max のときだけ角度を clamp する。
    this.controls.minAzimuthAngle = Number.NEGATIVE_INFINITY;
    this.controls.maxAzimuthAngle = Number.POSITIVE_INFINITY;

    this.applyConfig(config, true);
  }

  get azimuth(): number {
    return this.readOrbit().azimuth;
  }

  get polar(): number {
    return this.readOrbit().polar;
  }

  get distance(): number {
    return this.readOrbit().distance;
  }

  setAutoRotate(enabled: boolean, speed?: number): void {
    this.controls.autoRotate = enabled;
    if (speed !== undefined && Number.isFinite(speed)) {
      this.controls.autoRotateSpeed = speed;
    }
  }

  /**
   * 毎フレーム呼ぶ。方位角から動的な距離上限を求めてから OrbitControls を更新し、
   * 最後にカメラ位置を部屋の内側へ clamp する。
   */
  update(): void {
    if (this.disposed) return;

    const limits = orbitDistanceLimits(this.azimuth, this.config);
    this.controls.minDistance = limits.min;
    this.controls.maxDistance = limits.max;
    this.controls.update();

    const clamped = clampCameraToRoom(this.camera.position, this.config);
    this.camera.position.set(clamped.x, clamped.y, clamped.z);
  }

  /**
   * 画面比率変更などで設定を差し替える。
   * reset=false のときは現在の向きと距離を維持したままターゲットだけ移動する。
   */
  setConfig(config: RoomOrbitConfig, options: { reset?: boolean } = {}): void {
    if (this.disposed) return;
    this.applyConfig(config, options.reset === true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controls.dispose();
  }

  private applyConfig(config: RoomOrbitConfig, reset: boolean): void {
    const previous = this.readOrbit();
    const oldTarget = this.controls.target.clone();

    this.config = config;

    const fov = finiteOr(config.fov, this.camera.fov);
    if (fov > 0 && fov < 180 && fov !== this.camera.fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    this.controls.target.set(targetAt(config, 0), targetAt(config, 1), targetAt(config, 2));
    this.applyPolarLimits(config);

    if (reset) {
      const azimuth = finiteOr(config.defaultAzimuth, previous.azimuth);
      const polar = this.clampPolar(finiteOr(config.defaultPolar, previous.polar), config);
      const limits = orbitDistanceLimits(azimuth, config);
      const distance = clamp(limits.max * 0.88, limits.min, limits.max);
      this.positionFromSpherical(azimuth, polar, distance);
    } else {
      // ターゲット移動分だけ位置も平行移動し、現在の向き・距離を保つ。
      const offset = this.camera.position.clone().sub(oldTarget);
      this.camera.position.copy(this.controls.target).add(offset);
    }

    this.update();
  }

  private applyPolarLimits(config: RoomOrbitConfig): void {
    const rawMin = finiteOr(config.minPolarAngle, 0);
    const rawMax = finiteOr(config.maxPolarAngle, Math.PI);
    const min = clamp(Math.min(rawMin, rawMax), 0, Math.PI);
    const max = clamp(Math.max(rawMin, rawMax), 0, Math.PI);
    this.controls.minPolarAngle = min;
    this.controls.maxPolarAngle = max;
  }

  private clampPolar(polar: number, config: RoomOrbitConfig): number {
    const min = clamp(finiteOr(config.minPolarAngle, 0), 0, Math.PI);
    const max = clamp(finiteOr(config.maxPolarAngle, Math.PI), 0, Math.PI);
    return clamp(polar, Math.min(min, max), Math.max(min, max));
  }

  private positionFromSpherical(azimuth: number, polar: number, distance: number): void {
    const sinPolar = Math.sin(polar);
    this.camera.position.set(
      targetAt(this.config, 0) + distance * sinPolar * Math.sin(azimuth),
      targetAt(this.config, 1) + distance * Math.cos(polar),
      targetAt(this.config, 2) + distance * sinPolar * Math.cos(azimuth),
    );
  }

  private readOrbit(): OrbitState {
    const offsetX = finiteOr(this.camera.position.x - this.controls.target.x, 0);
    const offsetY = finiteOr(this.camera.position.y - this.controls.target.y, 0);
    const offsetZ = finiteOr(this.camera.position.z - this.controls.target.z, 0);
    const distance = Math.hypot(offsetX, offsetY, offsetZ);

    if (!Number.isFinite(distance) || distance < EPSILON) {
      return { azimuth: 0, polar: Math.PI / 2, distance: 0 };
    }

    const azimuth = Math.atan2(offsetX, offsetZ);
    const cosPolar = clamp(offsetY / distance, -1, 1);
    return {
      azimuth: Number.isFinite(azimuth) ? azimuth : 0,
      polar: Math.acos(cosPolar),
      distance,
    };
  }
}
