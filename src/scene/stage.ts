import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { MatchView } from '@/game/types';
import { AssetLibrary, type LoadProgress } from './assets';
import { AudioManager } from './audio';
import type { AvatarInstance } from './avatar';
import { ChairActor, chairLayout, STAGE_RADIUS } from './chair';
import { Effects } from './effects';

export interface TheaterCallbacks {
  onChairHover?: (chair: number | null) => void;
  onChairPick?: (chair: number) => void;
  onFlash?: (kind: 'shock' | 'avoid' | 'win') => void;
}

export interface BuildOptions {
  onProgress?: (progress: LoadProgress) => void;
}

/**
 * カメラの可動域。部屋の外（背景の虚空）が写り込まないよう、
 * 方位角・仰角・距離をすべて部屋の内側に収まる範囲へ制限する。
 */
interface CameraRig {
  fov: number;
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  maxAzimuthAngle: number;
  /** 待機中に首振りする角度（ラジアン）。maxAzimuthAngle より小さくする。 */
  swayLimit: number;
}

// 横長画面: 客席側から少し見下ろす固定気味のカメラ。部屋の奥行きに収める。
const LANDSCAPE_CAMERA: CameraRig = {
  fov: 44,
  position: [0, 8.8, 19.6],
  target: [0, 0.15, 0],
  minDistance: 15,
  maxDistance: 24,
  minPolarAngle: 1.13,
  maxPolarAngle: 1.3,
  maxAzimuthAngle: 0.4,
  swayLimit: 0.22,
};

// 縦長画面: 12脚すべてが横幅に収まるよう引いた位置から見る。
const PORTRAIT_CAMERA: CameraRig = {
  fov: 58,
  position: [0, 9.2, 26.5],
  target: [0, 0.15, 0],
  minDistance: 23,
  maxDistance: 30,
  minPolarAngle: 1.22,
  maxPolarAngle: 1.34,
  maxAzimuthAngle: 0.3,
  swayLimit: 0.16,
};

/**
 * The 3D theatre: a clock-face stage with 12 chairs, cinematic lighting,
 * bloom and selection/result animations.
 */
export class Theater {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly audio = new AudioManager();
  readonly chairs = new Map<number, ChairActor>();

  private readonly canvas: HTMLCanvasElement;
  private readonly assets = new AssetLibrary();
  private readonly debugParams = new URLSearchParams(window.location.search);
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly effects: Effects;
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(-10, -10);
  private readonly callbacks: TheaterCallbacks;
  private readonly hitboxes: THREE.Mesh[] = [];
  private readonly floorNumbers = new Map<
    number,
    THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  >();
  private animationHandle = 0;
  private hovered: ChairActor | null = null;
  private selected: number | null = null;
  private readonly retiredChairs = new Set<number>();
  private enabled = false;
  private pressButtonMesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial> | null =
    null;
  private pressButtonLight: THREE.PointLight | null = null;
  private pressButtonActive = false;
  private shake = 0;
  private lastResultTurn = -1;
  private confettiPlayed = false;
  private disposed = false;
  private avatars: AvatarInstance[] = [];
  private avatarsVisible = true;
  private avatarsLoading: Promise<void> | null = null;
  private portrait: boolean | null = null;
  private idle = true;
  private swayDirection: 1 | -1 = 1;

  constructor(canvas: HTMLCanvasElement, callbacks: TheaterCallbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.72;

    this.camera = new THREE.PerspectiveCamera(LANDSCAPE_CAMERA.fov, 1, 0.1, 140);
    this.camera.position.set(...LANDSCAPE_CAMERA.position);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.autoRotateSpeed = 0.6;

    this.scene.fog = new THREE.FogExp2(0x04040a, 0.012);
    this.scene.background = new THREE.Color(0x030307);

    this.buildEnvironment();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // 白い椅子はライティングで HDR 値が高く、低い threshold だと椅子自体が
    // 発光しているように bloom してしまう。発光させたいボタン・雷だけが
    // 残るように threshold を高めに取る。
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.12, 0.25, 4.0);
    if (this.debugParams.get('bloom') !== 'off') this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.effects = new Effects(this.scene);

    this.resize();
    window.addEventListener('resize', this.resize);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('pointerdown', this.onPointerDown);

    if (import.meta.env.DEV) {
      (window as unknown as { __stage?: Theater }).__stage = this;
    }
    this.animationHandle = requestAnimationFrame(this.animate);
  }

  private buildEnvironment(): void {
    const ambient = new THREE.AmbientLight(0x555566, 0.38);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0x4a4a62, 0x08080a, 0.38);
    this.scene.add(hemi);

    if (this.debugParams.get('lights') !== 'off') {
      // 白い椅子が白く見える中性のキーライト。色は縁だけに薄く乗せる。
      const key = new THREE.SpotLight(0xfff4e5, 330, 42, 0.68, 0.55, 1.15);
      key.position.set(0, 15.5, 7);
      key.target.position.set(0, 0, 0);
      this.scene.add(key, key.target);

      const red = new THREE.SpotLight(0xff4058, 45, 30, 0.7, 0.85, 1.5);
      red.position.set(-9, 8, -7);
      red.target.position.set(0, 0, 0);
      this.scene.add(red, red.target);

      const warm = new THREE.SpotLight(0xffcf9a, 38, 30, 0.7, 0.85, 1.5);
      warm.position.set(9, 8, -7);
      warm.target.position.set(0, 0, 0);
      this.scene.add(warm, warm.target);

      // 椅子の外側面（数字が書かれた面）を照らすための低いフィル。
      // キーライトだけだと外側面が真っ黒になり、黒数字が読めない。
      const fills: Array<[number, number, number, number, number]> = [
        [-9, 5.5, 7, 0xfff1e2, 34],
        [9, 5.5, 7, 0xfff1e2, 34],
        [-9, 5.5, -7, 0xdfe8ff, 26],
        [9, 5.5, -7, 0xdfe8ff, 26],
        [0, 7.5, 13, 0xfff1e2, 50],
      ];
      for (const [x, y, z, color, intensity] of fills) {
        const fill = new THREE.PointLight(color, intensity, 24, 1.9);
        fill.position.set(x, y, z);
        this.scene.add(fill);
      }
    }

    this.buildRoom();
  }

  private buildRoom(): void {
    const roomDark = new THREE.MeshStandardMaterial({
      color: 0x09090d,
      metalness: 0.12,
      roughness: 0.82,
    });
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x14141d,
      metalness: 0.22,
      roughness: 0.68,
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: 0x17171f,
      metalness: 0.55,
      roughness: 0.36,
    });

    // 部屋の床。カメラ側まで床を伸ばし、足元に虚空が見えないようにする。
    if (this.debugParams.get('floor') !== 'off') {
      const floor = new THREE.Mesh(new THREE.BoxGeometry(30, 0.2, 51), roomDark);
      floor.position.set(0, -0.1, 11);
      this.scene.add(floor);
    }

    // 椅子の円形フロア。
    const chairFloor = new THREE.Mesh(new THREE.CircleGeometry(7.35, 96), roomDark);
    chairFloor.rotation.x = -Math.PI / 2;
    chairFloor.position.y = 0.005;
    this.scene.add(chairFloor);

    const floorRing = new THREE.Mesh(
      new THREE.TorusGeometry(7.3, 0.028, 8, 128),
      new THREE.MeshBasicMaterial({
        color: 0xe6d7ae,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
      }),
    );
    floorRing.rotation.x = Math.PI / 2;
    floorRing.position.y = 0.035;
    this.scene.add(floorRing);

    // 奥の壁と左右の壁。カメラ側にも壁を回して完全な箱にする。
    // 壁はカメラの可動域より十分高くし、見上げても空（背景）が出ないようにする。
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(30, 20, 0.35), wallMaterial);
    backWall.position.set(0, 10, -11.3);
    this.scene.add(backWall);

    for (const x of [-12.4, 12.4] as const) {
      const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.35, 20, 48), wallMaterial);
      sideWall.position.set(x, 10, 10.9);
      this.scene.add(sideWall);
    }

    // カメラの背後を塞ぐ壁。可動域の外なので通常は見えないが、
    // ワイドな画面や揺れでも外側が映り込まないための保険。
    const frontWall = new THREE.Mesh(new THREE.BoxGeometry(30, 20, 0.35), wallMaterial);
    frontWall.position.set(0, 10, 35);
    this.scene.add(frontWall);

    // 奥壁のフレームとロゴ。
    const frame = new THREE.Mesh(new THREE.BoxGeometry(7.4, 3.6, 0.18), trimMaterial);
    frame.position.set(0, 3.9, -11.05);
    this.scene.add(frame);

    // 壁の縦ラインと床の縁を強調する。
    const stripMaterial = new THREE.MeshBasicMaterial({
      color: 0xf3e3bf,
      transparent: true,
      opacity: 0.55,
      toneMapped: false,
    });
    for (const x of [-12.18, 12.18] as const) {
      for (const z of [-9, -5, -1, 3, 7]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 6.2, 0.3), stripMaterial);
        strip.position.set(x, 4, z);
        this.scene.add(strip);
      }
    }

    // 前方ステージ（段差）を作る。椅子の円の外側、12番の正面。
    const platform = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.56, 1.6), trimMaterial);
    platform.position.set(0, 0.28, 7.7);
    this.scene.add(platform);

    const carpet = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 0.025, 2.0),
      new THREE.MeshStandardMaterial({ color: 0x3a0b12, roughness: 0.85, metalness: 0.05 }),
    );
    carpet.position.set(0, 0.575, 7.7);
    this.scene.add(carpet);

    const stepMaterial = new THREE.MeshStandardMaterial({
      color: 0x1b1b25,
      metalness: 0.55,
      roughness: 0.38,
    });
    const step1 = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.42, 0.6), stepMaterial);
    step1.position.set(0, 0.21, 8.8);
    this.scene.add(step1);

    const step2 = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.28, 0.6), stepMaterial);
    step2.position.set(0, 0.14, 9.4);
    this.scene.add(step2);

    const stepCarpetMaterial = new THREE.MeshStandardMaterial({
      color: 0x2d0a10,
      roughness: 0.9,
      metalness: 0.02,
    });
    for (const [z, width] of [
      [8.8, 9.3],
      [9.4, 10.3],
    ] as const) {
      const stepCarpet = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.015, 0.62),
        stepCarpetMaterial,
      );
      stepCarpet.position.set(0, z === 8.8 ? 0.43 : 0.29, z);
      this.scene.add(stepCarpet);
    }

    const stepLight = new THREE.PointLight(0xffd9a0, 12, 8, 2);
    stepLight.position.set(0, 1.5, 9.4);
    this.scene.add(stepLight);

    const edgeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffe2a6,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const riserFace = new THREE.Mesh(
      new THREE.BoxGeometry(8.3, 0.5, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x2a1118, metalness: 0.4, roughness: 0.5 }),
    );
    riserFace.position.set(0, 0.29, 8.52);
    this.scene.add(riserFace);

    for (const x of [-4.28, 4.28] as const) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.5, 2.25), edgeMaterial);
      side.position.set(x, 0.3, 7.7);
      this.scene.add(side);
    }

    for (const [y, z, width] of [
      [0.565, 6.92, 8.6],
      [0.425, 8.52, 9.6],
      [0.285, 9.12, 10.6],
      [0.425, 9.12, 9.6],
      [0.285, 9.72, 10.6],
    ] as const) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(width, 0.025, 0.035), edgeMaterial);
      edge.position.set(0, y, z);
      this.scene.add(edge);
    }

    // 奥壁のパネルラインとリング。暗い壁に奥行きを作る。
    for (const x of [-8, -4, 0, 4, 8]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 6.2, 0.12), stripMaterial);
      strip.position.set(x, 3.8, -11.05);
      this.scene.add(strip);
    }
    const backRing = new THREE.Mesh(
      new THREE.TorusGeometry(3.7, 0.035, 8, 96),
      new THREE.MeshBasicMaterial({
        color: 0xffd98a,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    backRing.position.set(0, 3.6, -11.02);
    this.scene.add(backRing);

    for (const x of [-4.25, 4.25] as const) {
      const riser = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.04), edgeMaterial);
      riser.position.set(x, 0.3, 6.92);
      this.scene.add(riser);
    }

    // 奥の照明トラス。天井は設けず、上から吊るしたバーでスタジオ感を出す。
    const trussMaterial = new THREE.MeshStandardMaterial({
      color: 0x111116,
      metalness: 0.7,
      roughness: 0.4,
    });
    for (const z of [-2.5, 4.5]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(20, 0.18, 0.18), trussMaterial);
      bar.position.set(0, 6.9, z);
      this.scene.add(bar);
      for (const x of [-7, -2.5, 2.5, 7]) {
        const lamp = new THREE.Mesh(
          new THREE.CylinderGeometry(0.18, 0.25, 0.35, 16),
          new THREE.MeshStandardMaterial({
            color: 0x141418,
            metalness: 0.7,
            roughness: 0.3,
          }),
        );
        lamp.position.set(x, 6.65, z);
        lamp.rotation.x = Math.PI;
        this.scene.add(lamp);
        const bulb = new THREE.Mesh(
          new THREE.SphereGeometry(0.075, 10, 8),
          new THREE.MeshBasicMaterial({ color: 0xfff3d0, toneMapped: false }),
        );
        bulb.position.set(x, 6.52, z);
        this.scene.add(bulb);
      }
    }

    const wallWash = new THREE.PointLight(0xcf9f6a, 18, 16, 2);
    wallWash.position.set(0, 4.2, -7.5);
    this.scene.add(wallWash);

    // 左右と奥の壁をうっすら照らす。暗い壁を完全な黒にせず、
    // 「部屋の内側にいる」ことが分かる程度の反射だけを残す。
    const wallWashes: Array<[number, number, number, number, number]> = [
      [0, 6.5, -7.5, 9, 18],
      [-10.6, 5.5, 2.5, 7, 15],
      [10.6, 5.5, 2.5, 7, 15],
    ];
    for (const [x, y, z, intensity, distance] of wallWashes) {
      const sideWash = new THREE.PointLight(0x8b93b0, intensity, distance, 2);
      sideWash.position.set(x, y, z);
      this.scene.add(sideWash);
    }
  }

  private buildPedestal(): void {
    if (this.debugParams.get('pedestal') === 'off') return;
    const group = new THREE.Group();
    group.position.set(-1.8, 0.56, 7.8);

    const black = new THREE.MeshStandardMaterial({
      color: 0x0a0a0e,
      metalness: 0.45,
      roughness: 0.38,
    });

    const base = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.96, 0.9, 4, 0.05), black);
    base.position.y = 0.48;
    group.add(base);

    const top = new THREE.Mesh(new RoundedBoxGeometry(1.58, 0.06, 0.98, 3, 0.03), black);
    top.position.y = 0.97;
    group.add(top);

    const buttonRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.29, 0.025, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0x15151a }),
    );
    buttonRing.rotation.x = Math.PI / 2;
    buttonRing.position.y = 1.005;
    group.add(buttonRing);

    const button = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.2, 0.1, 36),
      new THREE.MeshStandardMaterial({
        color: 0xffd200,
        emissive: 0xff9d00,
        emissiveIntensity: 0.28,
        metalness: 0.1,
        roughness: 0.3,
      }),
    );
    button.position.y = 1.06;
    button.name = 'current-button';
    group.add(button);
    this.pressButtonMesh = button;

    const glow = new THREE.PointLight(0xffcf3a, 1.8, 3.0, 2);
    glow.position.set(0, 1.25, 0);
    group.add(glow);
    this.pressButtonLight = glow;

    this.scene.add(group);
  }

  /** 旧 Unity プロジェクトの VRoid アバターをタイトル画面の賑やかしに使う。 */
  loadAvatars(): Promise<void> {
    if (this.avatarsLoading) return this.avatarsLoading;
    this.avatarsLoading = (async () => {
      try {
        const { instantiateAvatar, loadVrm, placeAvatar } = await import('./avatar');
        const vrm = await loadVrm();
        if (!vrm || this.disposed) return;
        const avatar = instantiateAvatar(vrm, false);
        placeAvatar(avatar, new THREE.Vector3(-5.35, 0, 3.25));
        avatar.scene.rotation.y = 0.55;
        avatar.scene.visible = this.avatarsVisible;
        this.avatars = [avatar];
        this.scene.add(avatar.scene);
      } catch (error) {
        console.warn('VRM avatar setup failed', error);
      }
    })();
    return this.avatarsLoading;
  }

  setAvatarsVisible(visible: boolean): void {
    this.avatarsVisible = visible;
    for (const avatar of this.avatars) avatar.scene.visible = visible;
  }

  private buildFloorNumbers(): void {
    for (let chair = 1; chair <= 12; chair += 1) {
      const { angle } = chairLayout(chair);
      const radius = STAGE_RADIUS - 2.35;
      const group = new THREE.Group();
      group.position.set(-Math.sin(angle) * radius, 0.028, Math.cos(angle) * radius);
      group.rotation.y = -angle;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.25, 0.9),
        new THREE.MeshBasicMaterial({
          map: createFloorNumberTexture(chair),
          transparent: true,
          opacity: 0.92,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      group.add(mesh);
      this.scene.add(group);
      this.floorNumbers.set(chair, mesh);
    }
  }

  private setFloorNumberState(view: MatchView): void {
    for (const [chair, mesh] of this.floorNumbers) {
      const retired = view.retiredChairs.includes(chair);
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.opacity = retired ? 0.18 : 0.92;
      material.color.setHex(retired ? 0x6a6a6a : 0xffffff);
    }
  }

  async build(options: BuildOptions = {}): Promise<void> {
    await this.assets.loadStage(options.onProgress);
    const texture = await this.assets.loadLightningTexture();
    this.effects.setLightningTexture(texture);

    this.buildPedestal();
    this.buildFloorNumbers();

    if (this.debugParams.get('chairs') !== 'off')
      await Promise.all(
        Array.from({ length: 12 }, async (_, index) => {
          const chairNumber = index + 1;
          const model = await this.assets.loadChair(chairNumber);
          const actor = new ChairActor({ chair: chairNumber, model });
          this.chairs.set(chairNumber, actor);
          this.hitboxes.push(actor.hitbox);
          this.scene.add(actor.group);
        }),
      );
  }

  // ---------------------------------------------------------------- controls

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clearHover();
  }

  setIdle(idle: boolean): void {
    this.idle = idle;
    if (!idle) this.controls.autoRotate = false;
  }

  setButtonActive(active: boolean): void {
    this.pressButtonActive = active;
    if (this.pressButtonMesh) {
      this.pressButtonMesh.material.emissiveIntensity = active ? 0.9 : 0.28;
    }
  }

  setSelected(chair: number | null): void {
    const next = chair !== null && this.retiredChairs.has(chair) ? null : chair;
    if (this.selected !== null) {
      const previous = this.chairs.get(this.selected);
      if (previous && previous.getState() === 'selected') previous.setState('available');
    }
    this.selected = next;
    if (next !== null) {
      this.chairs.get(next)?.setState('selected');
    }
  }

  applyView(view: MatchView): void {
    this.setFloorNumberState(view);
    this.retiredChairs.clear();
    for (const chair of view.retiredChairs) this.retiredChairs.add(chair);
    if (this.hovered && this.retiredChairs.has(this.hovered.chair)) this.hovered = null;
    if (this.selected !== null && this.retiredChairs.has(this.selected)) this.selected = null;

    for (const chair of this.chairs.values()) {
      const retired = this.retiredChairs.has(chair.chair);
      chair.setRetired(retired);
      if (retired) {
        // 見えなくするだけでなく、シーングラフからも外して残留させない。
        chair.group.removeFromParent();
        continue;
      }
      if (chair.group.parent !== this.scene) this.scene.add(chair.group);
      if (view.sittingChair === chair.chair) {
        chair.setState('selected');
      } else if (chair.chair === this.selected) {
        chair.setState('selected');
      } else if (view.phase === 'finished') {
        chair.setState('unavailable');
      } else {
        chair.setState('available');
      }
    }

    if (view.phase === 'result' && view.lastResult) {
      const result = view.lastResult;
      if (this.lastResultTurn !== result.turn) {
        this.lastResultTurn = result.turn;
        const wired = this.chairs.get(result.wiredChair);
        const sitting = this.chairs.get(result.sittingChair);
        if (wired) wired.setState('wired');

        if (result.hit) {
          sitting?.setState('shocked');
          const position = sitting?.position ?? new THREE.Vector3();
          this.effects.burst(position, 0xbef4ff, 1.7);
          this.effects.floatText(position, 'SHOCK!', '#b8f4ff', 1.2);
          this.audio.play('electric');
          this.shake = 0.5;
          this.callbacks.onFlash?.('shock');
        } else {
          sitting?.setState('avoided');
          const position = sitting?.position ?? new THREE.Vector3();
          this.effects.burst(position, 0x3dff9c, 0.55);
          this.audio.play('chair');
          this.callbacks.onFlash?.('avoid');
        }
      }
    }

    if (view.phase === 'finished' && view.outcome && !this.confettiPlayed) {
      this.confettiPlayed = true;
      if (view.outcome.kind === 'win') {
        this.effects.playConfetti();
        this.callbacks.onFlash?.('win');
      }
    }

    if (view.phase === 'set') {
      this.confettiPlayed = false;
    }
  }

  resetInteractions(): void {
    this.selected = null;
    this.hovered = null;
    this.retiredChairs.clear();
    this.lastResultTurn = -1;
    this.confettiPlayed = false;
    this.setButtonActive(false);
    for (const chair of this.chairs.values()) {
      chair.reset();
      if (chair.group.parent !== this.scene) this.scene.add(chair.group);
    }
    for (const mesh of this.floorNumbers.values()) {
      mesh.material.opacity = 0.92;
      mesh.material.color.setHex(0xffffff);
    }
  }

  // ---------------------------------------------------------------- internal

  private resize = (): void => {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.camera.aspect = width / Math.max(1, height);

    const portrait = this.camera.aspect < 0.9;
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      this.applyCameraRig(portrait ? PORTRAIT_CAMERA : LANDSCAPE_CAMERA);
    }

    this.camera.updateProjectionMatrix();
  };

  /** 画面比率ごとのカメラ可動域を適用する。 */
  private applyCameraRig(rig: CameraRig): void {
    this.camera.fov = rig.fov;
    this.camera.position.set(...rig.position);
    this.controls.target.set(...rig.target);
    this.controls.minDistance = rig.minDistance;
    this.controls.maxDistance = rig.maxDistance;
    this.controls.minPolarAngle = rig.minPolarAngle;
    this.controls.maxPolarAngle = rig.maxPolarAngle;
    // 部屋の正面から外れて壁の裏側を見ないよう、首振りを正面付近に固定する。
    this.controls.minAzimuthAngle = -rig.maxAzimuthAngle;
    this.controls.maxAzimuthAngle = rig.maxAzimuthAngle;
    this.controls.update();
  }

  private onPointerMove = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.updateHover();
  };

  private onPointerLeave = (): void => {
    this.pointer.set(-10, -10);
    this.clearHover();
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.updateHover();
    if (!this.enabled || !this.hovered) return;
    if (this.hovered.getState() === 'available' || this.hovered.getState() === 'hover') {
      this.callbacks.onChairPick?.(this.hovered.chair);
    }
  };

  private updateHover(): void {
    if (!this.enabled) {
      this.clearHover();
      return;
    }
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.hitboxes, false);
    // 退場済みの椅子はシーンに残っていても選択対象にしない。
    const hit = hits.find((candidate) => {
      const chairNumber = candidate.object.userData.chair as number | undefined;
      return chairNumber !== undefined && !this.retiredChairs.has(chairNumber);
    });
    const chairNumber = hit?.object.userData.chair as number | undefined;
    const next = chairNumber ? (this.chairs.get(chairNumber) ?? null) : null;
    if (next === this.hovered) return;
    if (this.hovered && this.hovered.getState() === 'hover') this.hovered.setState('available');
    this.hovered = next;
    if (next) {
      const state = next.getState();
      if (state === 'available') next.setState('hover');
      this.callbacks.onChairHover?.(next.chair);
    } else {
      this.callbacks.onChairHover?.(null);
    }
  }

  private clearHover(): void {
    if (this.hovered && this.hovered.getState() === 'hover') {
      this.hovered.setState('available');
    }
    this.hovered = null;
    this.callbacks.onChairHover?.(null);
  }

  /**
   * 待機中は 360° 回り続けず、正面の狭い範囲でゆっくり首を振る。
   * 真後ろや壁の外側を映さないための制約でもある。
   */
  private updateIdleSway(): void {
    if (!this.idle) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const theta = Math.atan2(offset.x, offset.z);
    const rig = this.portrait ? PORTRAIT_CAMERA : LANDSCAPE_CAMERA;
    if (theta > rig.swayLimit) this.swayDirection = 1;
    else if (theta < -rig.swayLimit) this.swayDirection = -1;
    this.controls.autoRotate = true;
    // OrbitControls は damping 有効時に実効速度が約 1/16 になるため、
    // 見た目で分かる程度まで数値を上げている。
    this.controls.autoRotateSpeed = 7 * this.swayDirection;
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.animationHandle = requestAnimationFrame(this.animate);
    const dt = Math.min(0.05, this.clock.getDelta());
    const elapsed = this.clock.elapsedTime;

    this.updateIdleSway();
    this.controls.update();
    this.updateHover();
    this.effects.update(dt);
    for (const chair of this.chairs.values()) chair.update(dt, elapsed);
    if (this.pressButtonMesh) {
      const pulse = this.pressButtonActive ? 0.9 + (Math.sin(elapsed * 7) * 0.5 + 0.5) * 1.1 : 0.28;
      this.pressButtonMesh.material.emissiveIntensity = pulse;
      this.pressButtonMesh.scale.setScalar(this.pressButtonActive ? 1 + (pulse - 0.9) * 0.08 : 1);
    }
    if (this.pressButtonLight) {
      this.pressButtonLight.intensity = this.pressButtonActive ? 2.4 : 1.8;
    }

    if (this.shake > 0.001) {
      this.shake *= Math.pow(0.02, dt);
    } else {
      this.shake = 0;
    }

    const shakeX = (Math.random() - 0.5) * this.shake;
    const shakeY = (Math.random() - 0.5) * this.shake * 0.6;
    const original = this.camera.position.clone();
    this.camera.position.x += shakeX;
    this.camera.position.y += shakeY;
    this.composer.render();
    this.camera.position.copy(original);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationHandle);
    window.removeEventListener('resize', this.resize);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.controls.dispose();
    this.effects.dispose();
    this.audio.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    for (const chair of this.chairs.values()) {
      chair.group.removeFromParent();
    }
    this.chairs.clear();
  }
}

function createFloorNumberTexture(chair: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 384;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, 512, 384);
    context.font = '900 300px "Zekton", "Arial Black", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = 'rgba(255,255,255,0.55)';
    context.shadowBlur = 24;
    context.fillStyle = '#ffffff';
    context.fillText(String(chair), 256, 202);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
