import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { assetUrl, ASSETS } from '@/assets/registry';
import type { MatchView } from '@/game/types';
import { FINAL_THUNDER_STANDARD_PRE_PRESS_MS } from '@/game/timing';
import { chairLayout } from './chair';

type Vec3 = readonly [number, number, number];
type PoseBone =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'upperChest'
  | 'neck'
  | 'head'
  | 'leftUpperArm'
  | 'leftLowerArm'
  | 'leftHand'
  | 'rightUpperArm'
  | 'rightLowerArm'
  | 'rightHand'
  | 'leftUpperLeg'
  | 'leftLowerLeg'
  | 'leftFoot'
  | 'rightUpperLeg'
  | 'rightLowerLeg'
  | 'rightFoot';

type Pose = Partial<Record<PoseBone, Vec3>>;

const POSE_BONES: readonly PoseBone[] = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
];

const ZERO: Vec3 = [0, 0, 0];

/** 台座の前に立つときの腕。VRM の正規化ボーンは T ポーズ基準。 */
const STAND: Pose = {
  leftUpperArm: [0, 0, -1.15],
  rightUpperArm: [0, 0, 1.15],
  leftLowerArm: [0, 0, -0.1],
  rightLowerArm: [0, 0, 0.1],
};

/** 椅子に座る。上腿を前へ、下腿を下へ折る。 */
const SIT: Pose = {
  ...STAND,
  leftUpperLeg: [-1.2, 0, 0.06],
  rightUpperLeg: [-1.2, 0, -0.06],
  leftLowerLeg: [1.2, 0, 0],
  rightLowerLeg: [1.2, 0, 0],
  leftUpperArm: [-0.35, 0, -1.15],
  rightUpperArm: [-0.35, 0, 1.15],
  leftLowerArm: [-0.9, 0, 0],
  rightLowerArm: [-0.9, 0, 0],
  spine: [0.06, 0, 0],
};

/** ファイナルサンダーで台座へ手を伸ばす。 */
const REACH: Pose = {
  ...STAND,
  spine: [0.15, 0, 0],
  chest: [0.08, 0, 0],
  rightUpperArm: [-1.05, 0, 1.1],
  rightLowerArm: [-0.9, 0, 0],
};

/** ボタンを叩き込む。 */
const SLAM: Pose = {
  ...STAND,
  hips: [0.05, 0, 0],
  spine: [0.28, 0, 0],
  chest: [0.12, 0, 0],
  leftUpperArm: [-0.4, 0, -1.1],
  leftLowerArm: [-0.5, 0, 0],
  rightUpperArm: [-1.35, 0, 0.9],
  rightLowerArm: [-0.4, 0, 0],
};

/** 座ったまま前屈みになり、膝の上で手を握る。 */
const BRACE: Pose = {
  ...SIT,
  spine: [0.24, 0, 0],
  chest: [0.15, 0, 0],
  head: [-0.08, 0, 0],
  leftUpperArm: [-0.25, 0, -1.08],
  rightUpperArm: [-0.25, 0, 1.08],
  leftLowerArm: [0, -0.45, -0.55],
  rightLowerArm: [0, 0.45, 0.55],
};

/** 感電した瞬間。 */
const SHOCK: Pose = {
  ...SIT,
  spine: [-0.3, 0, 0],
  chest: [-0.2, 0, 0],
  head: [0.2, 0, 0],
  leftUpperArm: [0.3, 0, -0.5],
  rightUpperArm: [0.3, 0, 0.5],
  leftLowerArm: [-0.3, 0, 0],
  rightLowerArm: [-0.3, 0, 0],
  leftUpperLeg: [-1.3, 0, 0.15],
  rightUpperLeg: [-1.3, 0, -0.15],
  leftLowerLeg: [1.4, 0, 0],
  rightLowerLeg: [1.4, 0, 0],
};

/** 回避したときの安堵。 */
const RELIEF: Pose = {
  ...SIT,
  spine: [0.12, 0, 0],
  chest: [0.08, 0, 0],
  head: [0.12, 0, 0],
};

/** 高stakesで一度手を引いて迷う。片手を腰に当てて考える。 */
const HESITATE: Pose = {
  ...STAND,
  spine: [0.06, 0, 0],
  chest: [0.02, 0, 0],
  head: [0.08, 0, 0],
  rightUpperArm: [-0.5, 0, 1.15],
  rightLowerArm: [-0.55, 0, 0],
  leftUpperArm: [-1.25, 0, -0.5],
  leftLowerArm: [0, 0, -1.6],
};

/** 感電させた側ののけぞり。 */
const ATTACKER_RECOIL: Pose = {
  ...STAND,
  hips: [-0.04, 0, 0],
  spine: [-0.24, 0, 0],
  chest: [-0.12, 0, 0],
  head: [-0.2, 0, 0],
  leftUpperArm: [-0.45, 0, -1.45],
  rightUpperArm: [-0.45, 0, 1.45],
  leftLowerArm: [-0.3, 0, 0],
  rightLowerArm: [-0.3, 0, 0],
};

/** 回避された側の安堵。肩を落として息を吐く。 */
const ATTACKER_RELIEF: Pose = {
  ...STAND,
  spine: [0.18, 0, 0],
  chest: [0.1, 0, 0],
  head: [0.16, 0, 0],
  leftUpperArm: [-0.15, 0, -1.0],
  rightUpperArm: [-0.2, 0, 1.0],
  leftLowerArm: [-0.3, 0, 0],
  rightLowerArm: [-0.35, 0, 0],
};

export type DuelistAction =
  | 'stand'
  | 'sit'
  | 'reach'
  | 'hold'
  | 'withdraw'
  | 'brace'
  | 'slam'
  | 'recoil'
  | 'relief'
  | 'shock';

export interface DuelistBlinkDebug {
  readonly supported: boolean;
  readonly value: number;
  readonly count: number;
}

export interface DuelistDebugState {
  readonly mode: 'primitive' | 'vrm';
  readonly cutsceneActive: boolean;
  readonly pressHold: boolean;
  readonly pressElapsedMs: number;
  readonly attackerAction: DuelistAction;
  readonly defenderAction: DuelistAction;
  readonly attackerBlink: DuelistBlinkDebug;
  readonly defenderBlink: DuelistBlinkDebug;
}

/** 台座へ手を伸ばし切るまでの時間。プレス前演出の最短尺でも必ず確保する。 */
const REACH_MS = 800;

/** 押下後の演技（SLAM → のけぞり/安堵、SHOCK/RELIEF）の長さ。 */
const RESULT_MS = 1600;

/** ホールド中の手の震え・上体の揺れ・深呼吸。 */
function holdOffsets(seconds: number, intensity: number): Pose {
  const tremor = Math.sin(seconds * Math.PI * 2 * 5.5) * 0.05 * intensity;
  const tremorAlt = Math.sin(seconds * Math.PI * 2 * 7.3 + 1.1) * 0.032 * intensity;
  const breath = Math.sin(seconds * Math.PI * 2 * 0.32) * 0.022;
  const sway = Math.sin(seconds * Math.PI * 2 * 0.43 + 0.7) * 0.03 * intensity;
  return {
    spine: [breath, 0, sway],
    chest: [breath * 0.7, 0, -sway * 0.5],
    neck: [tremorAlt * 0.4, 0, 0],
    rightUpperArm: [tremor, 0, tremorAlt],
    rightLowerArm: [tremorAlt, 0, 0],
    rightHand: [tremor * 1.2, 0, tremorAlt * 1.2],
  };
}

/** 座ったまま膝を握って震える。 */
function braceOffsets(seconds: number, intensity: number): Pose {
  const shake = Math.sin(seconds * Math.PI * 2 * 6.1) * 0.018 * intensity;
  const breath = Math.sin(seconds * Math.PI * 2 * 0.3 + 0.4) * 0.02;
  return {
    spine: [shake * 0.6, 0, breath],
    chest: [shake, 0, 0],
    leftUpperArm: [shake, 0, 0],
    rightUpperArm: [-shake, 0, 0],
    leftHand: [shake * 1.2, 0, 0],
    rightHand: [-shake * 1.2, 0, 0],
  };
}

/** 立ち/座り中の呼吸。spine と chest の微振動だけを足す。 */
function breathOffsets(seconds: number, seated: boolean): Pose {
  const rate = seated ? 0.24 : 0.3;
  const breath = Math.sin(seconds * Math.PI * 2 * rate);
  const chest = Math.sin(seconds * Math.PI * 2 * rate - 0.35);
  return {
    spine: [breath * 0.014, 0, 0],
    chest: [chest * 0.018, 0, 0],
    neck: [-breath * 0.006, 0, 0],
  };
}

/** 感電中の痙攣。 */
function convulse(pose: Pose, seconds: number): Pose {
  const jolt = Math.sin(seconds * Math.PI * 2 * 9.5);
  const joltAlt = Math.sin(seconds * Math.PI * 2 * 13.7 + 0.8);
  return addPoseOffsets(pose, {
    spine: [jolt * 0.08, joltAlt * 0.03, joltAlt * 0.04],
    chest: [joltAlt * 0.05, 0, jolt * 0.03],
    head: [joltAlt * 0.09, jolt * 0.05, 0],
    leftUpperArm: [jolt * 0.06, 0, 0],
    rightUpperArm: [-jolt * 0.06, 0, 0],
  });
}

const PRIMITIVE_ATTACKER = 0xb51f2f;
const PRIMITIVE_DEFENDER = 0x207a9e;

/**
 * 椅子の座面（約 1.07m）に腰が乗るよう、守備側の root を浮かせる。
 * VRM の腰は約 1.02m、プリミティブの hips は 1.0m なので、
 * どちらもこの lift で太ももの付け根が座面の高さに揃う。
 */
const SIT_LIFT = 0.14;

/**
 * 座面の前寄り（ステージ中央側）へずらす量。
 *
 * この椅子は脚の空間が無いブロック型なので、中心に座ると折り曲げた膝から
 * 下の脚がブロック内部に埋まる。腰を座面の前端へ寄せると、太ももは座面に
 * 乗ったまま、すねと靴が椅子の前面より外へ出る。
 */
const SIT_SEAT_SHIFT = 0.12;

interface VrmMaterialSource {
  map?: THREE.Texture | null;
  transparent?: boolean;
  opacity?: number;
  alphaTest?: number;
  side?: THREE.Side;
  depthWrite?: boolean;
  blending?: THREE.Blending;
  color?: THREE.Color;
}

/**
 * ステージのスポットライトは白い椅子が飛ばないよう強めに設定している。
 * その光を MToon のまま受けるとアバターの白い服・肌が完全に白飛びするため、
 * VRM の各メッシュを「テクスチャをそのまま見せる無照明マテリアル」へ置き換える。
 * これでライトの強さに依存せず、顔・服の色が読める。
 */
function toBasicVrmMaterial(material: THREE.Material): THREE.Material {
  const source = material as unknown as VrmMaterialSource;
  const outline = /outline/i.test(material.name);
  const skin = /_SKIN/i.test(material.name);
  const basic = new THREE.MeshBasicMaterial({
    map: outline ? null : (source.map ?? null),
    color: outline
      ? new THREE.Color(0x111111)
      : skin
        ? new THREE.Color(0xffe4d2)
        : (source.color?.clone() ?? new THREE.Color(0xffffff)),
    transparent: source.transparent ?? false,
    opacity: source.opacity ?? 1,
    alphaTest: source.alphaTest ?? 0,
    side: source.side ?? THREE.FrontSide,
    depthWrite: source.depthWrite ?? true,
    blending: source.blending ?? THREE.NormalBlending,
    toneMapped: true,
  });
  basic.name = `${material.name} (basic)`;
  return basic;
}

/** 同じマテリアルを複数メッシュで共有していても一度だけ置き換える。 */
function flattenVrmMaterials(vrm: VRM): void {
  const cache = new Map<THREE.Material, THREE.Material>();
  vrm.scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const next = materials.map((material) => {
      const cached = cache.get(material);
      if (cached) return cached;
      const basic = toBasicVrmMaterial(material);
      cache.set(material, basic);
      return basic;
    });
    child.material = next.length === 1 ? next[0]! : next;
  });
  // Shader programs are no longer needed; the texture maps are still referenced
  // by the new basic materials, so disposing the old materials is safe.
  for (const material of cache.keys()) material.dispose();
}

function mixPose(from: Pose, to: Pose, t: number): Pose {
  const result: Partial<Record<PoseBone, Vec3>> = {};
  for (const bone of POSE_BONES) {
    const a = from[bone] ?? ZERO;
    const b = to[bone] ?? ZERO;
    result[bone] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  return result;
}

function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** ポーズの一部の骨へ相対回転を足した新しいポーズを返す。定数は書き換えない。 */
function addPoseOffsets(pose: Pose, offsets: Pose): Pose {
  const result: Pose = { ...pose };
  for (const bone of POSE_BONES) {
    const offset = offsets[bone];
    if (!offset) continue;
    const base = result[bone] ?? ZERO;
    result[bone] = [base[0] + offset[0], base[1] + offset[1], base[2] + offset[2]];
  }
  return result;
}

/** start〜end の間だけ 0→1→0 になる窓。端は fadeMs でなだらかにする。 */
function windowWeight(elapsedMs: number, startMs: number, endMs: number): number {
  if (elapsedMs <= startMs || elapsedMs >= endMs) return 0;
  const fade = Math.min(220, (endMs - startMs) / 2);
  if (elapsedMs < startMs + fade) return ease((elapsedMs - startMs) / fade);
  if (elapsedMs > endMs - fade) return ease((endMs - elapsedMs) / fade);
  return 1;
}

function disposeObject(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const list = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of list) materials.add(material);
  });
  for (const material of materials) material.dispose();
}

interface DuelistRig {
  readonly object: THREE.Object3D;
  applyPose(pose: Pose, blend: number): void;
  update(dt: number): void;
  dispose(): void;
  expressionDebug?(): DuelistBlinkDebug;
}

class VrmRig implements DuelistRig {
  readonly object: THREE.Group;
  private readonly vrm: VRM;
  private blinkSupported: boolean | null = null;
  private blinkClock = 0;
  private blinkStartedAt = -1;
  private blinkCount = 0;
  private nextBlinkAt = 3 + Math.random() * 3;

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this.object = vrm.scene;
    // ステージの強い照明で白飛びしないよう、無照明マテリアルへ置き換える。
    flattenVrmMaterials(vrm);
  }

  applyPose(pose: Pose, blend: number): void {
    const humanoid = this.vrm.humanoid;
    for (const bone of POSE_BONES) {
      const node = humanoid.getNormalizedBoneNode(bone);
      if (!node) continue;
      const target = pose[bone] ?? ZERO;
      const amount = Math.min(1, Math.max(0, blend));
      node.rotation.x += (target[0] - node.rotation.x) * amount;
      node.rotation.y += (target[1] - node.rotation.y) * amount;
      node.rotation.z += (target[2] - node.rotation.z) * amount;
    }
  }

  update(dt: number): void {
    this.updateBlink(dt);
    this.vrm.update(dt);
  }

  expressionDebug(): DuelistBlinkDebug {
    const value = this.vrm.expressionManager?.getValue('blink') ?? 0;
    return {
      supported: this.blinkSupported === true,
      value,
      count: this.blinkCount,
    };
  }

  /**
   * 'blink' 表情があるときだけ 0.2 秒のまばたきを 3〜6 秒間隔で再生する。
   * 表情の有無は初回だけ調べ、毎フレームの検索はしない。
   */
  private updateBlink(dt: number): void {
    if (this.blinkSupported === null) {
      this.blinkSupported = Boolean(this.vrm.expressionManager?.getExpression('blink'));
    }
    const manager = this.vrm.expressionManager;
    if (!this.blinkSupported || !manager) return;

    this.blinkClock += dt;
    if (this.blinkStartedAt < 0) {
      if (this.blinkClock < this.nextBlinkAt) return;
      this.blinkStartedAt = this.blinkClock;
      this.blinkCount += 1;
    }

    const elapsed = this.blinkClock - this.blinkStartedAt;
    let value: number;
    if (elapsed < 0.06) {
      value = elapsed / 0.06;
    } else if (elapsed < 0.12) {
      value = 1;
    } else if (elapsed < 0.2) {
      value = 1 - (elapsed - 0.12) / 0.08;
    } else {
      manager.setValue('blink', 0);
      this.blinkStartedAt = -1;
      this.nextBlinkAt = this.blinkClock + 3 + Math.random() * 3;
      return;
    }
    manager.setValue('blink', value);
  }

  dispose(): void {
    disposeObject(this.object);
  }
}

/** VRM が使えないスリム版でも動く、最低限のマネキン。 */
class PrimitiveRig implements DuelistRig {
  readonly object = new THREE.Group();
  private readonly bones = new Map<PoseBone, THREE.Object3D>();

  constructor(color: number) {
    const body = new THREE.MeshStandardMaterial({ color, roughness: 0.58, metalness: 0.05 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xefc9a8, roughness: 0.72 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x16161e, roughness: 0.55 });

    const hips = new THREE.Group();
    hips.position.y = 1.0;
    this.object.add(hips);
    this.bones.set('hips', hips);

    const spine = new THREE.Group();
    hips.add(spine);
    this.bones.set('spine', spine);

    const chest = new THREE.Group();
    chest.position.y = 0.18;
    spine.add(chest);
    this.bones.set('chest', chest);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.3, 4, 10), body);
    torso.position.y = 0.12;
    chest.add(torso);

    const head = new THREE.Group();
    head.position.y = 0.3;
    chest.add(head);
    this.bones.set('head', head);
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), skin);
    headMesh.position.y = 0.06;
    head.add(headMesh);

    const shoulders = new THREE.Group();
    shoulders.position.y = 0.28;
    chest.add(shoulders);

    const makeArm = (side: -1 | 1): THREE.Group => {
      const upper = new THREE.Group();
      upper.position.set(side * 0.22, 0, 0);
      shoulders.add(upper);
      this.bones.set(side < 0 ? 'rightUpperArm' : 'leftUpperArm', upper);

      const upperMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.24, 4, 8), body);
      upperMesh.rotation.z = side * (Math.PI / 2);
      upperMesh.position.x = side * 0.15;
      upper.add(upperMesh);

      const lower = new THREE.Group();
      lower.position.x = side * 0.3;
      upper.add(lower);
      this.bones.set(side < 0 ? 'rightLowerArm' : 'leftLowerArm', lower);

      const lowerMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.24, 4, 8), body);
      lowerMesh.rotation.z = side * (Math.PI / 2);
      lowerMesh.position.x = side * 0.15;
      lower.add(lowerMesh);

      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), skin);
      hand.position.x = side * 0.31;
      lower.add(hand);
      return upper;
    };

    makeArm(-1);
    makeArm(1);

    const makeLeg = (side: -1 | 1): void => {
      const upper = new THREE.Group();
      upper.position.set(side * 0.1, 0, 0);
      hips.add(upper);
      this.bones.set(side < 0 ? 'rightUpperLeg' : 'leftUpperLeg', upper);

      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.36, 4, 8), dark);
      thigh.position.y = -0.25;
      upper.add(thigh);

      const lower = new THREE.Group();
      lower.position.y = -0.5;
      upper.add(lower);
      this.bones.set(side < 0 ? 'rightLowerLeg' : 'leftLowerLeg', lower);

      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.36, 4, 8), dark);
      shin.position.y = -0.25;
      lower.add(shin);

      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.23), dark);
      foot.position.set(0, -0.46, 0.04);
      lower.add(foot);
    };

    makeLeg(-1);
    makeLeg(1);
  }

  applyPose(pose: Pose, blend: number): void {
    const amount = Math.min(1, Math.max(0, blend));
    for (const [bone, node] of this.bones) {
      const target = pose[bone] ?? ZERO;
      node.rotation.x += (target[0] - node.rotation.x) * amount;
      node.rotation.y += (target[1] - node.rotation.y) * amount;
      node.rotation.z += (target[2] - node.rotation.z) * amount;
    }
  }

  update(): void {
    // The primitive rig is updated synchronously by applyPose.
  }

  dispose(): void {
    disposeObject(this.object);
  }
}

class Duelist {
  readonly root = new THREE.Group();
  private primitive: PrimitiveRig | null;
  private rig: DuelistRig;
  private lastPose: Pose = STAND;

  constructor(color: number) {
    this.primitive = new PrimitiveRig(color);
    this.rig = this.primitive;
    this.root.add(this.primitive.object);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.48, 0.018, 8, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    this.root.add(ring);
    this.root.visible = false;
  }

  setVrm(vrm: VRM): void {
    if (this.primitive) {
      this.root.remove(this.primitive.object);
      this.primitive.dispose();
      this.primitive = null;
    }
    const rig = new VrmRig(vrm);
    this.rig = rig;
    this.root.add(rig.object);
    this.rig.applyPose(this.lastPose, 1);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  setPose(pose: Pose, blend: number): void {
    this.lastPose = pose;
    this.rig.applyPose(pose, blend);
  }

  update(dt: number): void {
    this.rig.update(dt);
  }

  blinkDebug(): DuelistBlinkDebug {
    return this.rig.expressionDebug?.() ?? { supported: false, value: 0, count: 0 };
  }

  dispose(): void {
    this.root.removeFromParent();
    this.rig.dispose();
    this.primitive?.dispose();
    const ring = this.root.children.find(
      (child) => child instanceof THREE.Mesh && child.geometry instanceof THREE.TorusGeometry,
    );
    if (ring instanceof THREE.Mesh) {
      ring.geometry.dispose();
      const material = ring.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
    }
  }
}

export interface DuelistSetOptions {
  readonly scene: THREE.Scene;
  readonly pedestalPosition: THREE.Vector3;
  readonly lookAt: THREE.Vector3;
  readonly platformY: number;
}

/**
 * 攻撃側（台座の前）と守備側（椅子）のアバター。
 *
 * 起動直後は軽量なプリミティブを表示し、試合開始後に VRM が読み込めたら
 * 差し替える。スリム ZIP では VRM アセット/チャンクが無いため、
 * プリミティブのままゲームを続行する。
 */
export class DuelistSet {
  private readonly attacker = new Duelist(PRIMITIVE_ATTACKER);
  private readonly defender = new Duelist(PRIMITIVE_DEFENDER);
  private readonly pedestalPosition: THREE.Vector3;
  private readonly lookAt: THREE.Vector3;
  private readonly platformY: number;
  private modeValue: 'primitive' | 'vrm' = 'primitive';
  private loadStarted = false;
  private disposed = false;
  private hasView = false;
  private lastView: MatchView | null = null;
  private previewChairValue: number | null = null;
  private cutsceneStart = 0;
  private cutsceneDurationMs = FINAL_THUNDER_STANDARD_PRE_PRESS_MS;
  private cutsceneHighStakes = false;
  private pressStart = 0;
  private pressHold = false;
  private resultStart = 0;
  private resultHit = false;
  private lastResultAt = 0;
  private elapsedSeconds = 0;
  private lastAttackerAction: DuelistAction = 'stand';
  private lastDefenderAction: DuelistAction = 'sit';

  constructor(options: DuelistSetOptions) {
    this.pedestalPosition = options.pedestalPosition.clone();
    this.lookAt = options.lookAt.clone();
    this.platformY = options.platformY;
    options.scene.add(this.attacker.root, this.defender.root);
  }

  get mode(): 'primitive' | 'vrm' {
    return this.modeValue;
  }

  /** デバッグ用: ファイナルサンダー中にプレビューしている椅子。 */
  get previewChair(): number | null {
    return this.previewChairValue;
  }

  /** E2E/デバッグ用: 現在の演技ラベルとまばたきの状態。 */
  get debugState(): DuelistDebugState {
    return {
      mode: this.modeValue,
      cutsceneActive: this.cutsceneActive,
      pressHold: this.pressHold,
      pressElapsedMs: this.pressStart > 0 ? performance.now() - this.pressStart : 0,
      attackerAction: this.lastAttackerAction,
      defenderAction: this.lastDefenderAction,
      attackerBlink: this.attacker.blinkDebug(),
      defenderBlink: this.defender.blinkDebug(),
    };
  }

  get cutsceneActive(): boolean {
    return this.cutsceneStart > 0;
  }

  setView(view: MatchView): void {
    this.ensureLoaded();
    this.hasView = true;
    this.lastView = view;

    const attacker = this.attacker;
    attacker.setVisible(view.phase !== 'finished');
    attacker.root.position.set(this.pedestalPosition.x, this.platformY, this.pedestalPosition.z);
    attacker.root.rotation.y = Math.atan2(
      this.lookAt.x - this.pedestalPosition.x,
      this.lookAt.z - this.pedestalPosition.z,
    );

    // 実データが来たらローカルのプレビューは役目を終える。残しておくと
    // 次の set フェーズ（sittingChair が null）で古い椅子に座り続けてしまう。
    if (view.sittingChair !== null) this.previewChairValue = null;

    // press 中はカットシーンの尺が終わってもボタン待ちのホールドを続ける。
    if (view.phase === 'press') {
      this.pressHold = true;
    } else if (view.phase !== 'result') {
      this.pressHold = false;
      this.pressStart = 0;
    }

    this.syncDefender();
  }

  /**
   * ファイナルサンダーの確認中、守備側のアバターを先に椅子へ座らせる。
   * `null` でプレビューを消し、view があれば実データの座り位置へ戻す。
   */
  previewSitting(chair: number | null): void {
    this.previewChairValue = chair !== null && Number.isFinite(chair) ? Math.round(chair) : null;
    if (this.previewChairValue !== null) this.ensureLoaded();
    this.syncDefender();
  }

  /**
   * プレス前演出を開始する。`durationMs` はボタンが有効になるまでの尺で、
   * 統合側は `finalThunderTiming(view).prePressMs` を渡す。
   * 尺が終わっても押下までは REACH ホールドを継続する（スラムはしない）。
   */
  playFinalThunder(durationMs: number = FINAL_THUNDER_STANDARD_PRE_PRESS_MS): void {
    const requested = Number.isFinite(durationMs)
      ? durationMs
      : FINAL_THUNDER_STANDARD_PRE_PRESS_MS;
    const total = Math.max(REACH_MS, requested);
    const now = performance.now();
    this.cutsceneStart = now;
    this.cutsceneDurationMs = total;
    this.cutsceneHighStakes = total > FINAL_THUNDER_STANDARD_PRE_PRESS_MS + 1;
    this.pressStart = now;
    this.pressHold = true;
    this.resultStart = 0;
  }

  playResult(hit: boolean): void {
    const now = performance.now();
    if (now - this.lastResultAt < 400) return;
    this.lastResultAt = now;
    this.cutsceneStart = 0;
    this.pressHold = false;
    this.pressStart = 0;
    this.resultStart = now;
    this.resultHit = hit;
  }

  reset(): void {
    this.attacker.setVisible(false);
    this.defender.setVisible(false);
    this.hasView = false;
    this.lastView = null;
    this.previewChairValue = null;
    this.cutsceneStart = 0;
    this.cutsceneDurationMs = FINAL_THUNDER_STANDARD_PRE_PRESS_MS;
    this.cutsceneHighStakes = false;
    this.pressStart = 0;
    this.pressHold = false;
    this.resultStart = 0;
    this.resultHit = false;
    this.lastAttackerAction = 'stand';
    this.lastDefenderAction = 'sit';
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.elapsedSeconds += dt;
    if (!this.hasView && this.previewChairValue === null) return;
    const now = performance.now();
    const pressElapsedMs = this.pressStart > 0 ? now - this.pressStart : 0;
    const performing = this.cutsceneStart > 0 || this.resultStart > 0 || this.pressHold;
    const blend = Math.min(1, dt * (performing ? 26 : 14));
    let attackerPose: Pose = STAND;
    let defenderPose: Pose = SIT;
    let attackerAction: DuelistAction = 'stand';
    let defenderAction: DuelistAction = 'sit';

    // カットシーンの尺は終わったが、押下まではホバーを続ける。
    if (this.cutsceneStart > 0 && pressElapsedMs >= this.cutsceneDurationMs) {
      this.cutsceneStart = 0;
    }

    if (
      this.cutsceneStart > 0 ||
      (this.pressHold && this.pressStart > 0 && this.resultStart === 0)
    ) {
      const shot = this.finalThunderPose(pressElapsedMs);
      attackerPose = shot.attacker;
      defenderPose = shot.defender;
      attackerAction = shot.attackerAction;
      defenderAction = shot.defenderAction;
    }

    if (this.resultStart > 0) {
      const elapsedMs = now - this.resultStart;
      if (elapsedMs >= RESULT_MS) {
        this.resultStart = 0;
      } else {
        const shot = this.resultPose(elapsedMs, this.resultHit);
        attackerPose = shot.attacker;
        defenderPose = shot.defender;
        attackerAction = shot.attackerAction;
        defenderAction = shot.defenderAction;
      }
    }

    if (this.cutsceneStart === 0 && this.resultStart === 0 && !this.pressHold) {
      attackerPose = addPoseOffsets(attackerPose, breathOffsets(this.elapsedSeconds, false));
      defenderPose = addPoseOffsets(defenderPose, breathOffsets(this.elapsedSeconds, true));
    }

    this.attacker.setPose(attackerPose, blend);
    if (this.defender.root.visible) this.defender.setPose(defenderPose, blend);
    this.attacker.update(dt);
    if (this.defender.root.visible) this.defender.update(dt);
    this.lastAttackerAction = attackerAction;
    this.lastDefenderAction = defenderAction;
  }

  /**
   * プレス前の演技。0〜0.8s は STAND→REACH、以降は REACH のまま
   * 手の震え・上体の揺れ・深呼吸を足す。スラムは playResult まで起こさない。
   */
  private finalThunderPose(elapsedMs: number): {
    attacker: Pose;
    defender: Pose;
    attackerAction: DuelistAction;
    defenderAction: DuelistAction;
  } {
    if (elapsedMs < REACH_MS) {
      return {
        attacker: mixPose(STAND, REACH, ease(elapsedMs / REACH_MS)),
        defender: mixPose(SIT, BRACE, ease(elapsedMs / Math.min(420, REACH_MS))),
        attackerAction: 'reach',
        defenderAction: 'brace',
      };
    }

    let base: Pose = REACH;
    let attackerAction: DuelistAction = 'hold';
    if (this.cutsceneHighStakes) {
      const holdSpan = Math.max(1, this.cutsceneDurationMs - REACH_MS);
      const width = Math.min(1100, holdSpan * 0.3);
      const center = REACH_MS + holdSpan * 0.5;
      const weight = windowWeight(elapsedMs, center - width / 2, center + width / 2);
      if (weight > 0.35) attackerAction = 'withdraw';
      if (weight > 0) base = mixPose(REACH, HESITATE, weight);
    }

    const seconds = elapsedMs / 1000;
    return {
      attacker: addPoseOffsets(base, holdOffsets(seconds, 1)),
      defender: addPoseOffsets(BRACE, braceOffsets(seconds, 1)),
      attackerAction,
      defenderAction: 'brace',
    };
  }

  /** 押下の瞬間から始まる結果演技。攻撃側は必ず SLAM を挟む。 */
  private resultPose(
    elapsedMs: number,
    hit: boolean,
  ): {
    attacker: Pose;
    defender: Pose;
    attackerAction: DuelistAction;
    defenderAction: DuelistAction;
  } {
    const t = Math.min(1, elapsedMs / RESULT_MS);
    const seconds = elapsedMs / 1000;

    if (hit) {
      const attacker: Pose =
        t < 0.1
          ? mixPose(REACH, SLAM, ease(t / 0.1))
          : t < 0.28
            ? SLAM
            : t < 0.55
              ? mixPose(SLAM, ATTACKER_RECOIL, ease((t - 0.28) / 0.27))
              : ATTACKER_RECOIL;
      const shocked = convulse(SHOCK, seconds);
      const defender: Pose =
        t < 0.12
          ? mixPose(BRACE, SHOCK, ease(t / 0.12))
          : t < 0.7
            ? shocked
            : mixPose(shocked, SIT, ease((t - 0.7) / 0.3));
      return {
        attacker,
        defender,
        attackerAction: t < 0.28 ? 'slam' : 'recoil',
        defenderAction: 'shock',
      };
    }

    const attacker: Pose =
      t < 0.1
        ? mixPose(REACH, SLAM, ease(t / 0.1))
        : t < 0.26
          ? SLAM
          : t < 0.55
            ? mixPose(SLAM, ATTACKER_RELIEF, ease((t - 0.26) / 0.29))
            : ATTACKER_RELIEF;
    const defender: Pose =
      t < 0.18
        ? mixPose(BRACE, RELIEF, ease(t / 0.18))
        : t < 0.72
          ? RELIEF
          : mixPose(RELIEF, SIT, ease((t - 0.72) / 0.28));
    return {
      attacker,
      defender,
      attackerAction: t < 0.26 ? 'slam' : 'relief',
      defenderAction: 'relief',
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.attacker.dispose();
    this.defender.dispose();
  }

  /** view の実データとプレビューの優先順で守備側を配置する。 */
  private syncDefender(): void {
    const view = this.lastView;
    const chair = view?.sittingChair ?? this.previewChairValue;
    const retired = chair !== null && (view?.retiredChairs.includes(chair) ?? false);
    if (chair === null || retired) {
      this.defender.setVisible(false);
      return;
    }

    const layout = chairLayout(chair);
    const length = Math.hypot(layout.x, layout.z);
    const inwardX = length > 1e-4 ? -layout.x / length : 0;
    const inwardZ = length > 1e-4 ? -layout.z / length : -1;
    this.defender.root.position.set(
      layout.x + inwardX * SIT_SEAT_SHIFT,
      SIT_LIFT,
      layout.z + inwardZ * SIT_SEAT_SHIFT,
    );
    this.defender.root.rotation.y = Math.atan2(-layout.x, -layout.z);
    this.defender.setVisible(true);
  }

  private ensureLoaded(): void {
    if (this.loadStarted || this.disposed || this.modeValue === 'vrm') return;
    this.loadStarted = true;
    // 初回描画を邪魔しないよう、試合開始直後はプリミティブのまま少し待つ。
    window.setTimeout(() => {
      void this.load();
    }, 650);
  }

  private async avatarAssetAvailable(): Promise<boolean> {
    try {
      const response = await fetch(assetUrl('manifest.json'), { cache: 'no-cache' });
      if (!response.ok) return false;
      const manifest = (await response.json()) as {
        assets?: Record<string, unknown>;
      };
      return Boolean(manifest.assets?.[ASSETS.avatar]);
    } catch {
      return false;
    }
  }

  private async load(): Promise<void> {
    try {
      // The slim ZIP removes the avatar entry from the manifest AND the
      // corresponding Vite chunks. Check the manifest first so we neither
      // request a missing asset nor import a missing dynamic chunk.
      if (!(await this.avatarAssetAvailable())) return;
      const { loadVrmPair } = await import('./avatar');
      const pair = await loadVrmPair();
      if (!pair || this.disposed) return;
      this.attacker.setVrm(pair[0]);
      this.defender.setVrm(pair[1]);
      this.modeValue = 'vrm';
    } catch (error) {
      console.warn('Duelist VRM avatar could not be loaded', error);
    }
  }
}
