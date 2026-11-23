import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ASSETS } from '@/assets/registry';
import type { MatchView } from '@/game/types';
import { AssetLibrary, type LoadProgress } from './assets';
import { AudioManager } from './audio';
import type { AvatarInstance } from './avatar';
import { ChairActor } from './chair';
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
  private animationHandle = 0;
  private hovered: ChairActor | null = null;
  private selected: number | null = null;
  private enabled = false;
  private shake = 0;
  private lastResultTurn = -1;
  private confettiPlayed = false;
  private disposed = false;
  private emblemMesh: THREE.Mesh | null = null;
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
    this.renderer.toneMappingExposure = 0.9;

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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.35, 0.95);
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
    const ambient = new THREE.AmbientLight(0x3a3a52, 0.5);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0x2a3558, 0x030305, 0.55);
    this.scene.add(hemi);

    if (this.debugParams.get('lights') !== 'off') {
      const key = new THREE.SpotLight(0xfff2e8, 900, 40, 0.6, 0.65, 1.2);
      key.position.set(0, 15, 7);
      key.target.position.set(0, 0, 0);
      this.scene.add(key, key.target);

      const red = new THREE.SpotLight(0xff1d3d, 420, 30, 0.55, 0.7, 1.5);
      red.position.set(-9, 9, -7);
      red.target.position.set(0, 0, 0);
      this.scene.add(red, red.target);

      const green = new THREE.SpotLight(0x1bff87, 280, 30, 0.55, 0.7, 1.5);
      green.position.set(9, 9, -7);
      green.target.position.set(0, 0, 0);
      this.scene.add(green, green.target);
    }

    if (this.debugParams.get('floor') !== 'off') {
      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(9.6, 96),
        new THREE.MeshStandardMaterial({
          color: 0x090912,
          metalness: 0.2,
          roughness: 0.7,
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
        color: 0xff2244,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.025;
    this.scene.add(ring);

    const outerRing = new THREE.Mesh(
      new THREE.TorusGeometry(8.15, 0.02, 8, 128),
      new THREE.MeshBasicMaterial({
        color: 0x29ff98,
        transparent: true,
        opacity: 0.45,
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
        color: 0x9ab8ff,
        size: 0.32,
        transparent: true,
        opacity: 0.7,
        alphaTest: 0.02,
        depthWrite: false,
      }),
    );
    this.scene.add(stars);

    // 12本の細い光の柱でリングを強調する。
    const poleGeometry = new THREE.CylinderGeometry(0.015, 0.015, 2.6, 6);
    for (let i = 0; i < 12; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xff2244 : 0x22ff88,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
      });
      const pole = new THREE.Mesh(poleGeometry, material);
      const angle = (i / 12) * Math.PI * 2;
      pole.position.set(Math.cos(angle) * 7.65, 1.3, Math.sin(angle) * 7.65);
      this.scene.add(pole);
    }

    // 中央の魔法陣（時計）。テクスチャは asset 読み込み時に差し替える。
    const emblemTextureCanvas = document.createElement('canvas');
    emblemTextureCanvas.width = 512;
    emblemTextureCanvas.height = 512;
    const context = emblemTextureCanvas.getContext('2d');
    if (context) {
      context.strokeStyle = 'rgba(255, 40, 70, 0.7)';
      context.lineWidth = 3;
      context.beginPath();
      context.arc(256, 256, 210, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.arc(256, 256, 140, 0, Math.PI * 2);
      context.stroke();
      for (let i = 0; i < 24; i += 1) {
        const angle = (i / 24) * Math.PI * 2;
        context.beginPath();
        context.moveTo(256 + Math.cos(angle) * 150, 256 + Math.sin(angle) * 150);
        context.lineTo(256 + Math.cos(angle) * 205, 256 + Math.sin(angle) * 205);
        context.stroke();
      }
    }
    const emblemTexture = new THREE.CanvasTexture(emblemTextureCanvas);
    emblemTexture.colorSpace = THREE.SRGBColorSpace;
    this.emblemMesh = new THREE.Mesh(
      new THREE.CircleGeometry(2.7, 96),
      new THREE.MeshBasicMaterial({
        map: emblemTexture,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    if (this.debugParams.get('emblem') !== 'off') {
      this.emblemMesh.rotation.x = -Math.PI / 2;
      this.emblemMesh.position.y = 0.01;
      this.scene.add(this.emblemMesh);
    }
  }

  private buildConsole(): void {
    if (this.debugParams.get('pedestal') === 'off') return;
    const group = new THREE.Group();
    group.position.y = 0.02;

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.05, 1.22, 0.52, 48),
      new THREE.MeshStandardMaterial({ color: 0x12121a, metalness: 0.65, roughness: 0.4 }),
    );
    base.position.y = 0.26;
    group.add(base);

    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(1.02, 1.02, 0.04, 48),
      new THREE.MeshStandardMaterial({ color: 0x1a1a24, metalness: 0.8, roughness: 0.3 }),
    );
    top.position.y = 0.55;
    group.add(top);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.04, 0.025, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0xff2244, transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.57;
    group.add(ring);

    const button = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.25, 0.1, 32),
      new THREE.MeshStandardMaterial({
        color: 0xff2442,
        emissive: 0x8a0018,
        emissiveIntensity: 1.8,
        metalness: 0.2,
        roughness: 0.35,
      }),
    );
    button.position.y = 0.62;
    group.add(button);

    const glow = new THREE.PointLight(0xff2442, 12, 4, 2);
    glow.position.set(0, 0.9, 0);
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

  async build(options: BuildOptions = {}): Promise<void> {
    await this.assets.loadStage(options.onProgress);
    const texture = await this.assets.loadLightningTexture();
    this.effects.setLightningTexture(texture);

    if (this.debugParams.get('clock') !== 'off') {
      try {
        const clockTexture = await this.assets.loadTexture(ASSETS.clock);
        const disc = new THREE.Mesh(
          new THREE.CircleGeometry(5.12, 128),
          new THREE.MeshBasicMaterial({
            map: clockTexture,
            transparent: true,
            opacity: 0.42,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        disc.rotation.set(-Math.PI / 2, 0, Math.PI);
        disc.position.y = 0.035;
        this.scene.add(disc);
      } catch {
        // 時計テクスチャなしでもステージは成立する
      }
    }

    this.buildConsole();

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
    if (this.emblemMesh) this.emblemMesh.rotation.z += dt * 0.08;

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
