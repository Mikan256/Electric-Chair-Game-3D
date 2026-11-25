import * as THREE from 'three';
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
import { CinematicCamera } from './cinematic-camera';
import { DuelistSet } from './duelists';
import { Effects } from './effects';
import { MatchMonitor, type MonitorRow } from './match-monitor';
import { RoomOrbitCamera, type RoomOrbitConfig } from './orbit-camera';

export interface TheaterCallbacks {
  onChairHover?: (chair: number | null) => void;
  onChairPick?: (chair: number) => void;
  onFlash?: (kind: 'shock' | 'avoid' | 'win') => void;
}

export interface BuildOptions {
  onProgress?: (progress: LoadProgress) => void;
}

/**
 * 部屋の内側の寸法。360° カメラで見回しても壁の外（背景の虚空）が
 * 映り込まないよう、椅子の円とカメラの可動域より十分広く取る。
 */
const ROOM = {
  halfWidth: 14,
  backZ: -13.5,
  frontZ: 35,
  wallHeight: 20,
  floorWidth: 34,
  floorDepth: 54,
  floorCenterZ: 10.75,
} as const;

/**
 * 前方の黒い平たい台。12番椅子の正面、円形フロアの外側から
 * 手前壁の手前までカメラ側へ延ばす。
 * 装飾は載せず、台座（buildPedestal）の土台としてだけ使う。
 */
const PLATFORM = {
  width: 9,
  height: 0.4,
  startZ: 7.5,
  endZ: ROOM.frontZ - 0.2,
} as const;

/** 台の奥行と中心。startZ / endZ から導出して二重管理を避ける。 */
const PLATFORM_DEPTH = PLATFORM.endZ - PLATFORM.startZ;
const PLATFORM_CENTER_Z = (PLATFORM.startZ + PLATFORM.endZ) / 2;

/** 台座の中心 z。台の上（手前寄り）に固定する。 */
const PEDESTAL_Z = 8.2;

/** 奥壁中央の横長モニター。統合側は monitorAnchor に画面を差し込む。 */
const MONITOR = {
  width: 22,
  height: 11,
  y: 6,
  frameDepth: 0.22,
} as const;

/** カメラが入ってよい部屋の内側（壁から 0.55 離す）。 */
const CAMERA_BOUNDS = {
  minX: -ROOM.halfWidth + 0.55,
  maxX: ROOM.halfWidth - 0.55,
  minZ: ROOM.backZ + 0.55,
  maxZ: ROOM.frontZ - 0.55,
  minY: 1.15,
  maxY: 11.5,
} as const;

// 横長画面: 360° 回せるが、常に部屋の内側に収まる。
// 後方モニターと前方の台座の両方が縦に収まるよう、やや広角で見下ろす。
const LANDSCAPE_CAMERA: RoomOrbitConfig = {
  fov: 60,
  target: [0, 0.55, 0.7],
  minDistance: 6.5,
  maxDistance: 15.5,
  minPolarAngle: 1.05,
  maxPolarAngle: 1.42,
  bounds: CAMERA_BOUNDS,
  margin: 0.55,
  defaultAzimuth: 0,
  defaultPolar: 1.34,
};

// 縦長画面: 12脚が横幅に収まるよう広角にする。
const PORTRAIT_CAMERA: RoomOrbitConfig = {
  fov: 104,
  target: [0, 0.55, 0.7],
  minDistance: 8.5,
  maxDistance: 16,
  minPolarAngle: 1.08,
  maxPolarAngle: 1.42,
  bounds: CAMERA_BOUNDS,
  margin: 0.55,
  defaultAzimuth: 0,
  defaultPolar: 1.3,
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
  /**
   * 後方モニターのスクリーン位置。統合側が CanvasTexture を貼った Plane を
   * ここへ add する。ローカル原点が画面中央、+Z が部屋の内側を向く。
   */
  readonly monitorAnchor = new THREE.Group();

  private readonly canvas: HTMLCanvasElement;
  private readonly assets = new AssetLibrary();
  private readonly debugParams = new URLSearchParams(window.location.search);
  private readonly orbit: RoomOrbitCamera;
  private readonly monitor: MatchMonitor;
  private readonly duelists: DuelistSet;
  private readonly cinematic: CinematicCamera;
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
  private pointerDown: { x: number; y: number; time: number } | null = null;
  private lastDuelistPhase: MatchView['phase'] | null = null;

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

    this.camera = new THREE.PerspectiveCamera(LANDSCAPE_CAMERA.fov, 1, 0.1, 180);
    this.orbit = new RoomOrbitCamera(this.camera, canvas, LANDSCAPE_CAMERA);

    this.scene.fog = new THREE.FogExp2(0x04040a, 0.012);
    this.scene.background = new THREE.Color(0x030307);

    this.buildEnvironment();

    this.monitor = new MatchMonitor({ worldWidth: 20.8, worldHeight: 10.4 });
    this.monitorAnchor.add(this.monitor.mesh);
    this.monitor.update(null);
    this.duelists = new DuelistSet({
      scene: this.scene,
      pedestalPosition: new THREE.Vector3(1.35, PLATFORM.height, 9.35),
      lookAt: new THREE.Vector3(0, 1.15, 8.2),
      platformY: PLATFORM.height,
    });
    this.cinematic = new CinematicCamera({
      camera: this.camera,
      controls: this.orbit.controls,
      bounds: CAMERA_BOUNDS,
    });

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
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);

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
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(ROOM.floorWidth, 0.2, ROOM.floorDepth),
        roomDark,
      );
      floor.position.set(0, -0.1, ROOM.floorCenterZ);
      this.scene.add(floor);
    }

    // 椅子の円形フロア。
    const chairFloor = new THREE.Mesh(new THREE.CircleGeometry(7.35, 96), roomDark);
    chairFloor.rotation.x = -Math.PI / 2;
    chairFloor.position.y = 0.005;
    this.scene.add(chairFloor);

    // 奥の壁と左右の壁。360° カメラで見回しても虚空が映らないよう、
    // 椅子の円とカメラの可動域の外側まで部屋を広げる。
    const wallDepth = 0.35;
    const wallHeight = ROOM.wallHeight;
    const backWall = new THREE.Mesh(
      new THREE.BoxGeometry(ROOM.halfWidth * 2 + wallDepth, wallHeight, wallDepth),
      wallMaterial,
    );
    backWall.position.set(0, wallHeight / 2, ROOM.backZ);
    this.scene.add(backWall);

    for (const x of [-ROOM.halfWidth, ROOM.halfWidth] as const) {
      const sideWall = new THREE.Mesh(
        new THREE.BoxGeometry(wallDepth, wallHeight, ROOM.frontZ - ROOM.backZ),
        wallMaterial,
      );
      sideWall.position.set(x, wallHeight / 2, (ROOM.frontZ + ROOM.backZ) / 2);
      this.scene.add(sideWall);
    }

    // カメラの背後を塞ぐ壁。可動域の外なので通常は見えないが、
    // ワイドな画面や揺れでも外側が映り込まないための保険。
    const frontWall = new THREE.Mesh(
      new THREE.BoxGeometry(ROOM.halfWidth * 2 + wallDepth, wallHeight, wallDepth),
      wallMaterial,
    );
    frontWall.position.set(0, wallHeight / 2, ROOM.frontZ);
    this.scene.add(frontWall);

    // 壁の縦ライン。奥壁のストリップはモニターの左右へ逃がし、
    // 画面を横切らない位置にだけ置く。
    const stripMaterial = new THREE.MeshBasicMaterial({
      color: 0xf3e3bf,
      transparent: true,
      opacity: 0.55,
      toneMapped: false,
    });
    const backInnerZ = ROOM.backZ + wallDepth / 2;
    const backStripGeometry = new THREE.BoxGeometry(0.04, 6.2, 0.12);
    for (const x of [-12.4, 12.4] as const) {
      const strip = new THREE.Mesh(backStripGeometry, stripMaterial);
      strip.position.set(x, MONITOR.y, backInnerZ + 0.06);
      this.scene.add(strip);
    }

    const sideStripGeometry = new THREE.BoxGeometry(0.04, 6.2, 0.3);
    for (const x of [-ROOM.halfWidth + 0.2, ROOM.halfWidth - 0.2] as const) {
      for (const z of [-11, -5, 1, 7, 13, 19, 25]) {
        const strip = new THREE.Mesh(sideStripGeometry, stripMaterial);
        strip.position.set(x, 4, z);
        this.scene.add(strip);
      }
    }

    // 奥壁中央の横長モニター。ここでは「器」だけを作り、
    // 試合内容の描画は統合側が monitorAnchor へ差し込む。
    const monitorFrame = new THREE.Mesh(
      new THREE.BoxGeometry(MONITOR.width, MONITOR.height, MONITOR.frameDepth),
      trimMaterial,
    );
    monitorFrame.position.set(0, MONITOR.y, backInnerZ + MONITOR.frameDepth / 2);
    this.scene.add(monitorFrame);

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(MONITOR.width - 0.6, MONITOR.height - 0.6),
      new THREE.MeshBasicMaterial({ color: 0x080a12 }),
    );
    screen.position.set(0, MONITOR.y, backInnerZ + MONITOR.frameDepth + 0.005);
    this.scene.add(screen);

    this.monitorAnchor.position.set(0, MONITOR.y, backInnerZ + MONITOR.frameDepth + 0.02);
    this.scene.add(this.monitorAnchor);

    // 前方の黒い平たい台。装飾は置かず、台座の土台としてだけ存在させる。
    const platformMaterial = new THREE.MeshStandardMaterial({
      color: 0x0b0b0f,
      metalness: 0.16,
      roughness: 0.74,
    });
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(PLATFORM.width, PLATFORM.height, PLATFORM_DEPTH),
      platformMaterial,
    );
    platform.position.set(0, PLATFORM.height / 2, PLATFORM_CENTER_Z);
    this.scene.add(platform);

    // 奥の照明トラス。天井は設けず、上から吊るしたバーでスタジオ感を出す。
    const trussMaterial = new THREE.MeshStandardMaterial({
      color: 0x111116,
      metalness: 0.7,
      roughness: 0.4,
    });
    for (const z of [-2.5, 4.5]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(22, 0.18, 0.18), trussMaterial);
      bar.position.set(0, 12.4, z);
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
        lamp.position.set(x, 12.15, z);
        lamp.rotation.x = Math.PI;
        this.scene.add(lamp);
        const bulb = new THREE.Mesh(
          new THREE.SphereGeometry(0.075, 10, 8),
          new THREE.MeshBasicMaterial({ color: 0xfff3d0, toneMapped: false }),
        );
        bulb.position.set(x, 12.02, z);
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
      [-12, 5.5, 2.5, 7, 15],
      [12, 5.5, 2.5, 7, 15],
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
    // 台座の底面が台の上面にぴったり乗る高さにし、z は台の手前寄りに保つ。
    group.position.set(0, PLATFORM.height, PEDESTAL_Z);

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
    this.orbit.setAutoRotate(idle, idle ? 0.45 : 0);
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
    this.monitor.update(view);
    this.duelists.setView(view);
    if (view.phase === 'press' && this.lastDuelistPhase !== 'press') {
      this.duelists.playFinalThunder();
      this.effects.floatText(new THREE.Vector3(0, 0.2, 7.0), 'FINAL THUNDER', '#ffd166', 0.45);
      this.cinematic.pressShot(
        new THREE.Vector3(0, PLATFORM.height, PEDESTAL_Z),
        new THREE.Vector3(1.35, PLATFORM.height, 9.35),
      );
    }
    if (view.phase === 'result' && view.lastResult && this.lastDuelistPhase !== 'result') {
      this.duelists.playResult(view.lastResult.hit);
      if (view.lastResult.hit && view.sittingChair !== null) {
        const layout = chairLayout(view.sittingChair);
        this.cinematic.shockShot(new THREE.Vector3(layout.x, 0, layout.z));
      }
    }
    if (this.lastDuelistPhase !== null && this.lastDuelistPhase !== 'set' && view.phase === 'set') {
      this.cinematic.restore();
    }
    if (view.phase === 'finished' && this.lastDuelistPhase !== 'finished') {
      this.cinematic.restore();
    }
    this.lastDuelistPhase = view.phase;
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
    this.monitor.update(null);
    this.duelists.reset();
    this.cinematic.reset();
    this.lastDuelistPhase = null;
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
      this.cinematic.reset();
      this.orbit.setConfig(portrait ? PORTRAIT_CAMERA : LANDSCAPE_CAMERA, { reset: true });
    }

    this.camera.updateProjectionMatrix();
  };

  private setPointer(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onPointerMove = (event: PointerEvent): void => {
    this.setPointer(event);
    this.updateHover();
  };

  private onPointerLeave = (): void => {
    this.pointer.set(-10, -10);
    this.clearHover();
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.pointerDown = {
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
    };
    this.setPointer(event);
    this.updateHover();
  };

  private onPointerUp = (event: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || event.button !== 0) return;
    // ドラッグでカメラを回したときは椅子を選ばない（クリックだけを拾う）。
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    if (moved > 7 || performance.now() - down.time > 700) return;
    this.setPointer(event);
    this.updateHover();
    if (!this.enabled || !this.hovered) return;
    if (this.hovered.getState() === 'available' || this.hovered.getState() === 'hover') {
      this.callbacks.onChairPick?.(this.hovered.chair);
    }
  };

  private onPointerCancel = (): void => {
    this.pointerDown = null;
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

  private animate = (): void => {
    if (this.disposed) return;
    this.animationHandle = requestAnimationFrame(this.animate);
    const dt = Math.min(0.05, this.clock.getDelta());
    const elapsed = this.clock.elapsedTime;

    const now = performance.now();
    this.cinematic.update(now);
    if (!this.cinematic.active) this.orbit.update();
    this.updateHover();
    this.duelists.update(dt);
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

  /** E2E/デバッグ用: 現在のカメラ方位角（ラジアン）。 */
  get cameraAzimuth(): number {
    return this.orbit.azimuth;
  }

  /** E2E/デバッグ用: 直近にモニターへ描画した行。 */
  get monitorRows(): readonly MonitorRow[] {
    return this.monitor.rows;
  }

  /** 守備側の着席プレビュー（ファイナルサンダー中）。 */
  previewSitting(chair: number | null): void {
    this.duelists.previewSitting(chair);
  }

  /** E2E/デバッグ用: アバターが VRM かプリミティブか。 */
  get avatarMode(): 'primitive' | 'vrm' {
    return this.duelists.mode;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationHandle);
    window.removeEventListener('resize', this.resize);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.monitor.mesh.removeFromParent();
    this.monitor.dispose();
    this.duelists.dispose();
    this.cinematic.reset();
    this.orbit.dispose();
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
