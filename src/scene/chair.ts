import * as THREE from 'three';

export const STAGE_RADIUS = 6.1;

export function chairLayout(chair: number): { x: number; z: number; angle: number } {
  // 12番をカメラ正面（+Z）に置き、時計回りに 1..12 を並べる。
  const angle = ((chair % 12) * Math.PI * 2) / 12;
  return {
    x: -Math.sin(angle) * STAGE_RADIUS,
    z: Math.cos(angle) * STAGE_RADIUS,
    angle,
  };
}

export type ChairVisualState =
  'available' | 'unavailable' | 'hover' | 'selected' | 'retired' | 'wired' | 'shocked' | 'avoided';

export interface ChairActorOptions {
  chair: number;
  model: THREE.Group;
}

let shadowTexture: THREE.CanvasTexture | null = null;
let glowTexture: THREE.CanvasTexture | null = null;

function getGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
    gradient.addColorStop(0.35, 'rgba(255, 255, 255, 0.32)');
    gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.08)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

function getShadowTexture(): THREE.CanvasTexture {
  if (shadowTexture) return shadowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 8, 64, 64, 62);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
    gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.26)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  shadowTexture = new THREE.CanvasTexture(canvas);
  return shadowTexture;
}

/**
 * 1脚の白い立方体椅子。座面の凸と外側面の数字は AssetLibrary 側で付与する。
 * ここでは接地影・選択リング・状態アニメーションを管理する。
 */
export class ChairActor {
  readonly chair: number;
  readonly group = new THREE.Group();
  readonly hitbox: THREE.Mesh;
  readonly position = new THREE.Vector3();

  private readonly model: THREE.Group;
  private readonly ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private readonly glow: THREE.Sprite;
  private readonly shadow: THREE.Mesh;
  private readonly frameMaterial: THREE.MeshStandardMaterial;
  private readonly seatMaterial: THREE.MeshStandardMaterial;
  private readonly baseY = 0;
  private state: ChairVisualState = 'available';
  private retired = false;
  private hoverAmount = 0;
  private selectedPulse = 0;
  private shakeTime = 0;

  constructor(options: ChairActorOptions) {
    this.chair = options.chair;
    const layout = chairLayout(options.chair);
    this.position.set(layout.x, 0, layout.z);
    this.group.position.copy(this.position);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.92, 32),
      new THREE.MeshBasicMaterial({
        map: getShadowTexture(),
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.012;
    this.group.add(this.shadow);

    this.model = options.model;
    this.model.rotation.y = Math.atan2(-layout.x, -layout.z);
    this.group.add(this.model);

    this.frameMaterial = new THREE.MeshStandardMaterial({
      color: 0xf2f1ec,
      metalness: 0.02,
      roughness: 0.52,
    });
    this.seatMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.4,
    });
    this.model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (child.userData.isNumberPlate) return;
      child.material = child.userData.isSeat ? this.seatMaterial : this.frameMaterial;
      child.castShadow = false;
      child.receiveShadow = false;
    });

    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.92, 0.022, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xd8c9a4, transparent: true, opacity: 0.34 }),
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.04;
    this.group.add(this.ring);

    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: 0xffe3a3,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.glow.scale.set(2.6, 2.6, 1);
    this.glow.position.set(0, 0.7, 0);
    this.group.add(this.glow);

    this.hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(1.75, 1.7, 1.75),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    this.hitbox.position.y = 0.85;
    this.hitbox.userData.chair = options.chair;
    this.group.add(this.hitbox);
  }

  setState(state: ChairVisualState): void {
    // 得点して退場した椅子は、結果演出などで状態を上書きされても戻さない。
    if (state === 'retired') {
      if (this.retired) return;
      this.retired = true;
      this.state = 'retired';
      this.applyVisualState('retired');
      return;
    }
    if (this.retired || this.state === state) return;
    this.state = state;
    this.applyVisualState(state);
  }

  /** 得点椅子をシーンから見えなくする。reset() で再び表示される。 */
  setRetired(retired: boolean): void {
    if (retired) {
      this.setState('retired');
      return;
    }
    if (!this.retired) return;
    this.reset();
  }

  getState(): ChairVisualState {
    return this.state;
  }

  isRetired(): boolean {
    return this.retired;
  }

  private applyVisualState(state: ChairVisualState): void {
    switch (state) {
      case 'available':
        this.ring.material.color.setHex(0xd8c9a4);
        this.ring.material.opacity = 0.34;
        this.glow.material.opacity = 0;
        break;
      case 'hover':
        this.ring.material.color.setHex(0xffe3a3);
        this.ring.material.opacity = 0.95;
        this.glow.material.color.setHex(0xffe3a3);
        this.glow.material.opacity = 0.18;
        break;
      case 'selected':
        this.ring.material.color.setHex(0x3dff9c);
        this.ring.material.opacity = 1;
        this.glow.material.color.setHex(0x3dff9c);
        this.glow.material.opacity = 0.24;
        this.selectedPulse = 1;
        break;
      case 'unavailable':
        this.ring.material.color.setHex(0x3a3a3a);
        this.ring.material.opacity = 0.18;
        this.glow.material.opacity = 0;
        break;
      case 'retired':
        this.ring.material.color.setHex(0x111111);
        this.ring.material.opacity = 0.12;
        this.glow.material.opacity = 0;
        break;
      case 'wired':
        this.ring.material.color.setHex(0xff2442);
        this.ring.material.opacity = 1;
        this.glow.material.color.setHex(0xff2442);
        this.glow.material.opacity = 0.3;
        break;
      case 'shocked':
        this.ring.material.color.setHex(0xb8f4ff);
        this.ring.material.opacity = 1;
        this.glow.material.color.setHex(0x9fe8ff);
        this.glow.material.opacity = 0.42;
        this.shakeTime = 1;
        break;
      case 'avoided':
        this.ring.material.color.setHex(0x3dff9c);
        this.ring.material.opacity = 1;
        this.glow.material.color.setHex(0x3dff9c);
        this.glow.material.opacity = 0.3;
        break;
    }

    const visible = state !== 'retired';
    this.group.visible = visible;
    this.hitbox.visible = visible;
    if (!visible) {
      this.hoverAmount = 0;
      this.model.scale.setScalar(1);
    }
  }

  update(dt: number, elapsed: number): void {
    const targetHover = this.state === 'hover' ? 1 : 0;
    this.hoverAmount += (targetHover - this.hoverAmount) * Math.min(1, dt * 12);
    this.model.scale.setScalar(1 + this.hoverAmount * 0.045);

    const pulse = 1 + Math.sin(elapsed * 4 + this.chair) * 0.035;
    this.ring.scale.setScalar(
      (this.state === 'selected' ? 1 + this.selectedPulse * 0.22 : pulse) *
        (1 + this.hoverAmount * 0.07),
    );
    if (this.selectedPulse > 0) this.selectedPulse = Math.max(0, this.selectedPulse - dt * 1.5);

    // 退場した椅子は完全に床下へ沈める。group.visible も false になるため
    // 通常は描画されないが、状態が戻ったときに残像が見えないようにする。
    const targetY = this.state === 'retired' ? -1.6 : 0;
    this.group.position.y += (targetY - this.group.position.y) * Math.min(1, dt * 4);

    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const strength = this.shakeTime * 0.1;
      this.model.position.x = (Math.random() - 0.5) * strength;
      this.model.position.z = (Math.random() - 0.5) * strength;
      this.model.rotation.z = (Math.random() - 0.5) * strength * 0.6;
      if (this.shakeTime === 0) {
        this.model.position.x = 0;
        this.model.position.z = 0;
        this.model.rotation.z = 0;
      }
    }

    this.glow.material.opacity *= 1 - Math.min(1, dt * 0.8);
  }

  reset(): void {
    this.retired = false;
    this.state = 'available';
    this.applyVisualState('available');
    this.selectedPulse = 0;
    this.shakeTime = 0;
    this.hoverAmount = 0;
    this.model.scale.setScalar(1);
    this.model.position.set(0, 0, 0);
    this.model.rotation.z = 0;
    this.group.position.y = this.baseY;
  }
}
