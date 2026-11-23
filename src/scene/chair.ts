import * as THREE from 'three';

export const STAGE_RADIUS = 6.1;
export const CHAIR_HEIGHT = 1.8;

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

/**
 * 1脚の椅子。モデルの見た目・番号ラベル・選択リング・状態アニメーションを持つ。
 */
export class ChairActor {
  readonly chair: number;
  readonly group = new THREE.Group();
  readonly hitbox: THREE.Mesh;
  readonly position = new THREE.Vector3();

  private readonly model: THREE.Group;
  private readonly ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private readonly glow: THREE.Sprite;
  private readonly label: THREE.Sprite;
  private readonly labelCanvas: HTMLCanvasElement;
  private readonly frameMaterial: THREE.MeshStandardMaterial;
  private readonly cushionMaterial: THREE.MeshStandardMaterial;
  private readonly baseY = 0;
  private state: ChairVisualState = 'available';
  private hoverAmount = 0;
  private selectedPulse = 0;
  private shakeTime = 0;

  constructor(options: ChairActorOptions) {
    this.chair = options.chair;
    const layout = chairLayout(options.chair);
    this.position.set(layout.x, 0, layout.z);
    this.group.position.copy(this.position);

    this.model = options.model;
    this.model.rotation.y = Math.atan2(-layout.x, -layout.z);
    this.group.add(this.model);

    this.frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x22222c,
      metalness: 0.5,
      roughness: 0.42,
    });
    this.cushionMaterial = new THREE.MeshStandardMaterial({
      color: 0x7a0a18,
      metalness: 0.15,
      roughness: 0.6,
      emissive: 0x2a0008,
    });
    this.model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const material = child.material;
      if (Array.isArray(material)) {
        child.material = material.map(() => this.frameMaterial);
      } else if (
        material instanceof THREE.MeshStandardMaterial &&
        material.color.getHex() === 0x5a0710
      ) {
        child.material = this.cushionMaterial;
      } else {
        child.material = this.frameMaterial;
      }
    });

    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.98, 0.035, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0x7a1020, transparent: true, opacity: 0.8 }),
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.045;
    this.group.add(this.ring);

    this.labelCanvas = createLabelCanvas(options.chair);
    this.label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(this.labelCanvas),
        transparent: true,
        depthTest: true,
        depthWrite: false,
      }),
    );
    this.label.scale.set(0.9, 0.45, 1);
    this.label.position.set(0, 2.5, 0);
    this.label.renderOrder = 5;
    this.group.add(this.label);

    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        color: 0xff2233,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.glow.scale.set(4.2, 4.2, 1);
    this.glow.position.set(0, 1.1, 0);
    this.group.add(this.glow);

    this.hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 2.7, 1.9),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    this.hitbox.position.y = 1.3;
    this.hitbox.userData.chair = options.chair;
    this.group.add(this.hitbox);
  }

  setState(state: ChairVisualState): void {
    if (this.state === state) return;
    this.state = state;
    switch (state) {
      case 'available':
        this.ring.material.color.setHex(0x7a1020);
        this.ring.material.opacity = 0.8;
        this.glow.material.opacity = 0;
        break;
      case 'hover':
        this.ring.material.color.setHex(0xff3355);
        this.ring.material.opacity = 1;
        this.glow.material.color.setHex(0xff2233);
        this.glow.material.opacity = 0.35;
        break;
      case 'selected':
        this.ring.material.color.setHex(0x3dff9c);
        this.ring.material.opacity = 1;
        this.glow.material.color.setHex(0x3dff9c);
        this.glow.material.opacity = 0.5;
        this.selectedPulse = 1;
        break;
      case 'unavailable':
        this.ring.material.color.setHex(0x2a2a2a);
        this.ring.material.opacity = 0.25;
        this.glow.material.opacity = 0;
        break;
      case 'retired':
        this.ring.material.color.setHex(0x111111);
        this.ring.material.opacity = 0.15;
        this.glow.material.opacity = 0;
        break;
      case 'wired':
        this.ring.material.color.setHex(0xff1d2e);
        this.ring.material.opacity = 1;
        this.glow.material.color.setHex(0xff1d2e);
        this.glow.material.opacity = 0.6;
        break;
      case 'shocked':
        this.ring.material.color.setHex(0xb8f4ff);
        this.ring.material.opacity = 1;
        this.glow.material.color.setHex(0x9fe8ff);
        this.glow.material.opacity = 0.9;
        this.shakeTime = 1;
        break;
      case 'avoided':
        this.ring.material.color.setHex(0x3dff9c);
        this.ring.material.opacity = 1;
        this.glow.material.color.setHex(0x3dff9c);
        this.glow.material.opacity = 0.65;
        break;
    }
    this.redrawLabel();
  }

  getState(): ChairVisualState {
    return this.state;
  }

  setNumberVisible(visible: boolean): void {
    this.label.visible = visible;
  }

  update(dt: number, elapsed: number): void {
    const targetHover = this.state === 'hover' ? 1 : 0;
    this.hoverAmount += (targetHover - this.hoverAmount) * Math.min(1, dt * 12);
    this.model.scale.setScalar(1 + this.hoverAmount * 0.05);

    const pulse = 1 + Math.sin(elapsed * 4 + this.chair) * 0.04;
    this.ring.scale.setScalar(
      (this.state === 'selected' ? 1 + this.selectedPulse * 0.25 : pulse) *
        (1 + this.hoverAmount * 0.08),
    );
    if (this.selectedPulse > 0) this.selectedPulse = Math.max(0, this.selectedPulse - dt * 1.5);

    const targetY = this.state === 'retired' ? -0.45 : 0;
    this.group.position.y += (targetY - this.group.position.y) * Math.min(1, dt * 4);

    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const strength = this.shakeTime * 0.11;
      this.model.position.x = (Math.random() - 0.5) * strength;
      this.model.position.z = (Math.random() - 0.5) * strength;
      this.model.rotation.z = (Math.random() - 0.5) * strength * 0.6;
      if (this.shakeTime === 0) {
        this.model.position.x = 0;
        this.model.position.z = 0;
        this.model.rotation.z = 0;
      }
    }

    const labelBob = Math.sin(elapsed * 1.7 + this.chair * 0.8) * 0.035;
    this.label.position.y = 2.5 + labelBob;
    this.glow.material.opacity *= 1 - Math.min(1, dt * 0.8);
  }

  reset(): void {
    this.setState('available');
    this.model.scale.setScalar(1);
    this.model.position.set(0, 0, 0);
    this.model.rotation.z = 0;
    this.group.position.y = this.baseY;
    this.redrawLabel();
  }

  private redrawLabel(): void {
    drawLabel(this.labelCanvas, this.chair, this.state);
    const material = this.label.material as THREE.SpriteMaterial;
    if (material.map) material.map.needsUpdate = true;
  }
}

function createLabelCanvas(chair: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  drawLabel(canvas, chair, 'available');
  return canvas;
}

function drawLabel(canvas: HTMLCanvasElement, chair: number, state: ChairVisualState): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);

  const dim = state === 'retired' || state === 'unavailable';
  const accent =
    state === 'selected' || state === 'avoided'
      ? '#3dff9c'
      : state === 'shocked'
        ? '#b8f4ff'
        : state === 'wired'
          ? '#ff3344'
          : '#ffd7dd';

  context.save();
  context.globalAlpha = dim ? 0.28 : 1;
  context.fillStyle = 'rgba(8, 8, 14, 0.78)';
  context.strokeStyle = accent;
  context.lineWidth = 5;
  roundRect(context, 14, 16, 228, 96, 18);
  context.fill();
  context.stroke();

  context.fillStyle = accent;
  context.font = '700 68px "Zekton", "Arial Black", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = accent;
  context.shadowBlur = 16;
  context.fillText(String(chair), 128, 68);
  context.restore();
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}
