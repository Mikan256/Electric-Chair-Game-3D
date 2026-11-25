import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { assetUrl, ASSETS } from '@/assets/registry';
import type { MatchView } from '@/game/types';
import { FINAL_THUNDER_CUTSCENE_MS } from '@/game/timing';
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

/** 座ったまま身構える。 */
const BRACE: Pose = {
  ...SIT,
  spine: [-0.18, 0, 0],
  chest: [-0.1, 0, 0],
  leftUpperArm: [-0.6, 0, -1.3],
  rightUpperArm: [-0.6, 0, 1.3],
  leftLowerArm: [-0.6, 0, 0],
  rightLowerArm: [-0.6, 0, 0],
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
}

class VrmRig implements DuelistRig {
  readonly object: THREE.Group;
  private readonly vrm: VRM;

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
    this.vrm.update(dt);
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
  private resultStart = 0;
  private resultHit = false;
  private lastResultAt = 0;

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

  playFinalThunder(): void {
    this.cutsceneStart = performance.now();
    this.resultStart = 0;
  }

  playResult(hit: boolean): void {
    const now = performance.now();
    if (now - this.lastResultAt < 400) return;
    this.lastResultAt = now;
    this.cutsceneStart = 0;
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
    this.resultStart = 0;
    this.resultHit = false;
  }

  update(dt: number): void {
    if (this.disposed) return;
    if (!this.hasView && this.previewChairValue === null) return;
    const now = performance.now();
    const blend = Math.min(1, dt * 14);
    let attackerPose: Pose = STAND;
    let defenderPose: Pose = SIT;

    if (this.cutsceneStart > 0) {
      const t = (now - this.cutsceneStart) / FINAL_THUNDER_CUTSCENE_MS;
      if (t >= 1) {
        this.cutsceneStart = 0;
      } else {
        attackerPose =
          t < 0.35
            ? mixPose(STAND, REACH, ease(t / 0.35))
            : t < 0.65
              ? REACH
              : t < 0.8
                ? mixPose(REACH, SLAM, ease((t - 0.65) / 0.15))
                : mixPose(SLAM, STAND, ease((t - 0.8) / 0.2));
        defenderPose =
          t < 0.25
            ? mixPose(SIT, BRACE, ease(t / 0.25))
            : t < 0.8
              ? BRACE
              : mixPose(BRACE, SIT, ease((t - 0.8) / 0.2));
      }
    }

    if (this.resultStart > 0) {
      const t = (now - this.resultStart) / 1200;
      if (t >= 1) {
        this.resultStart = 0;
      } else if (this.resultHit) {
        defenderPose =
          t < 0.2
            ? mixPose(SIT, SHOCK, ease(t / 0.2))
            : t < 0.7
              ? SHOCK
              : mixPose(SHOCK, SIT, ease((t - 0.7) / 0.3));
      } else {
        defenderPose =
          t < 0.3
            ? mixPose(SIT, RELIEF, ease(t / 0.3))
            : t < 0.7
              ? RELIEF
              : mixPose(RELIEF, SIT, ease((t - 0.7) / 0.3));
      }
    }

    this.attacker.setPose(attackerPose, blend);
    if (this.defender.root.visible) this.defender.setPose(defenderPose, blend);
    this.attacker.update(dt);
    if (this.defender.root.visible) this.defender.update(dt);
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
