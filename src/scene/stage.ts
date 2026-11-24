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
  private enabled = false;
  private shake = 0;
  private lastResultTurn = -1;
  private confettiPlayed = false;
  private disposed = false;
  private avatars: AvatarInstance[] = [];
  private avatarsVisible = true;
  private avatarsLoading: Promise<void> | null = null;
  private portrait: boolean | null = null;

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

    this.camera = new THREE.PerspectiveCamera(41, 1, 0.1, 140);
    this.camera.position.set(0, 13.2, 19.8);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, -0.2, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.minDistance = 9;
    this.controls.maxDistance = 24;
    this.controls.minPolarAngle = 0.32;
    this.controls.maxPolarAngle = 1.42;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;

    this.scene.fog = new THREE.FogExp2(0x04040a, 0.019);
    this.scene.background = new THREE.Color(0x030307);

    this.buildEnvironment();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.12, 0.25, 1.1);
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

    if (this.debugParams.get('floor') !== 'off') {
      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(9.6, 96),
        new THREE.MeshStandardMaterial({
          color: 0x0b0b10,
          metalness: 0.08,
          roughness: 0.82,
        }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.02;
      this.scene.add(floor);
    }

    const outerFloor = new THREE.Mesh(
      new THREE.RingGeometry(9.6, 15, 96),
      new THREE.MeshBasicMaterial({ color: 0x05050a }),
    );
    outerFloor.rotation.x = -Math.PI / 2;
    outerFloor.position.y = -0.03;
    this.scene.add(outerFloor);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(6.55, 0.035, 8, 128),
      new THREE.MeshBasicMaterial({
        color: 0xe6d7ae,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.025;
    this.scene.add(ring);

    const outerRing = new THREE.Mesh(
      new THREE.TorusGeometry(8.15, 0.02, 8, 128),
      new THREE.MeshBasicMaterial({
        color: 0xd9cba6,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
      }),
    );
    outerRing.rotation.x = Math.PI / 2;
    outerRing.position.y = 0.025;
    this.scene.add(outerRing);

    const starGeometry = new THREE.BufferGeometry();
    const starCount = 900;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      const radius = 42 + Math.random() * 36;
      const theta = Math.random() * Math.PI * 2;
      positions[i * 3] = Math.cos(theta) * radius;
      positions[i * 3 + 1] = 8 + Math.random() * 34;
      positions[i * 3 + 2] = Math.sin(theta) * radius;
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const starCanvas = document.createElement('canvas');
    starCanvas.width = 64;
    starCanvas.height = 64;
    const starContext = starCanvas.getContext('2d');
    if (starContext) {
      const gradient = starContext.createRadialGradient(32, 32, 0, 32, 32, 30);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.35, 'rgba(200,220,255,0.8)');
      gradient.addColorStop(1, 'rgba(140,170,255,0)');
      starContext.fillStyle = gradient;
      starContext.fillRect(0, 0, 64, 64);
    }
    const starTexture = new THREE.CanvasTexture(starCanvas);
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        map: starTexture,
        color: 0xc4cbe0,
        size: 0.3,
        transparent: true,
        opacity: 0.52,
        alphaTest: 0.02,
        depthWrite: false,
      }),
    );
    this.scene.add(stars);
  }

  private buildPedestal(): void {
    if (this.debugParams.get('pedestal') === 'off') return;
    const group = new THREE.Group();
    group.position.set(-2.2, 0, 6.55);

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
    group.add(button);

    const glow = new THREE.PointLight(0xffcf3a, 1.8, 3.0, 2);
    glow.position.set(0, 1.25, 0);
    group.add(glow);

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
    this.controls.autoRotate = idle;
  }

  setSelected(chair: number | null): void {
    if (this.selected !== null) {
      const previous = this.chairs.get(this.selected);
      if (previous) previous.setState('available');
    }
    this.selected = chair;
    if (chair !== null) {
      this.chairs.get(chair)?.setState('selected');
    }
  }

  applyView(view: MatchView): void {
    this.setFloorNumberState(view);
    for (const chair of this.chairs.values()) {
      if (view.retiredChairs.includes(chair.chair)) {
        chair.setState('retired');
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

    if (view.phase === 'commit') {
      this.confettiPlayed = false;
    }
  }

  resetInteractions(): void {
    this.selected = null;
    this.lastResultTurn = -1;
    this.confettiPlayed = false;
    for (const chair of this.chairs.values()) chair.reset();
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
      if (portrait) {
        this.camera.fov = 56;
        this.camera.position.set(0, 15.8, 24.5);
        this.controls.target.set(0, -0.55, 0);
        this.controls.minDistance = 14;
        this.controls.maxDistance = 36;
      } else {
        this.camera.fov = 41;
        this.camera.position.set(0, 13.2, 19.8);
        this.controls.target.set(0, -0.2, 0);
        this.controls.minDistance = 9;
        this.controls.maxDistance = 24;
      }
      this.controls.update();
    }

    this.camera.updateProjectionMatrix();
  };

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
    const chairNumber = hits[0]?.object.userData.chair as number | undefined;
    const next = chairNumber ? (this.chairs.get(chairNumber) ?? null) : null;
    if (next === this.hovered) return;
    if (this.hovered && this.hovered.chair !== this.selected) this.hovered.setState('available');
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
    if (this.hovered && this.hovered.chair !== this.selected) {
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

    this.controls.update();
    this.updateHover();
    this.effects.update(dt);
    for (const chair of this.chairs.values()) chair.update(dt, elapsed);

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
