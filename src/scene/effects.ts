import * as THREE from 'three';

interface Flash {
  light: THREE.PointLight;
  ttl: number;
  max: number;
}

interface Bolt {
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  sprite: THREE.Sprite | null;
  ttl: number;
  max: number;
}

interface Floating {
  sprite: THREE.Sprite;
  ttl: number;
  max: number;
  velocity: THREE.Vector3;
}

/**
 * Procedural lightning, score popups and confetti. The old Unity project
 * shipped particle prefabs and videos; in the browser we combine the lightning
 * sprite texture with generated line bolts for a crisp, GPU-cheap effect.
 */
export class Effects {
  private readonly scene: THREE.Scene;
  private readonly bolts: Bolt[] = [];
  private readonly flashes: Flash[] = [];
  private readonly floatings: Floating[] = [];
  private readonly group = new THREE.Group();
  private lightningTexture: THREE.Texture | null = null;
  private confetti: THREE.Points | null = null;
  private confettiVelocities: Float32Array | null = null;
  private confettiLife = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group.name = 'effects';
    this.scene.add(this.group);
  }

  setLightningTexture(texture: THREE.Texture | null): void {
    this.lightningTexture = texture;
  }

  burst(position: THREE.Vector3, color = 0xbef4ff, strength = 1): void {
    const start = position.clone().add(new THREE.Vector3(0, 4.8, 0));
    const end = position.clone().add(new THREE.Vector3(0, 1.2, 0));

    for (let i = 0; i < 7; i += 1) {
      const points: THREE.Vector3[] = [];
      const segments = 12;
      const offset = new THREE.Vector3((Math.random() - 0.5) * 1.6, 0, (Math.random() - 0.5) * 1.6);
      for (let s = 0; s <= segments; s += 1) {
        const t = s / segments;
        const wobble = Math.sin(t * Math.PI) * (0.4 + Math.random() * 0.9);
        points.push(
          new THREE.Vector3()
            .lerpVectors(start, end, t)
            .add(offset.clone().multiplyScalar(wobble))
            .add(new THREE.Vector3((Math.random() - 0.5) * 0.55, 0, (Math.random() - 0.5) * 0.55)),
        );
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(geometry, material);
      line.renderOrder = 8;
      this.group.add(line);
      this.bolts.push({ line, sprite: null, ttl: 0.55, max: 0.55 });
    }

    if (this.lightningTexture) {
      for (let i = 0; i < 5; i += 1) {
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.lightningTexture,
            color,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        const scale = 3.5 + Math.random() * 3.5;
        sprite.scale.set(scale, scale, 1);
        sprite.position
          .copy(position)
          .add(
            new THREE.Vector3(
              (Math.random() - 0.5) * 1.4,
              1 + Math.random() * 2.2,
              (Math.random() - 0.5) * 1.4,
            ),
          );
        sprite.material.rotation = Math.random() * Math.PI;
        this.group.add(sprite);
        this.bolts.push({ line: null as never, sprite, ttl: 0.5, max: 0.5 });
      }
    }

    const light = new THREE.PointLight(color, 320 * strength, 16, 2);
    light.position.copy(position).add(new THREE.Vector3(0, 2.4, 0));
    this.group.add(light);
    this.flashes.push({ light, ttl: 0.45, max: 0.45 });
  }

  floatText(position: THREE.Vector3, text: string, color = '#ffd166', size = 1): void {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 192;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.font = '700 96px "Zekton", "Arial Black", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineWidth = 12;
    context.strokeStyle = 'rgba(0,0,0,0.85)';
    context.strokeText(text, 256, 96);
    context.fillStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 24;
    context.fillText(text, 256, 96);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    sprite.scale.set(4.4 * size, 1.65 * size, 1);
    sprite.position.copy(position).add(new THREE.Vector3(0, 3.9, 0));
    sprite.renderOrder = 10;
    this.group.add(sprite);
    this.floatings.push({
      sprite,
      ttl: 1.8,
      max: 1.8,
      velocity: new THREE.Vector3(0, 0.9, 0),
    });
  }

  playConfetti(origin = new THREE.Vector3(0, 4, 0)): void {
    this.clearConfetti();
    const count = 320;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const palette = [
      new THREE.Color(0xff2233),
      new THREE.Color(0x21d07a),
      new THREE.Color(0xffd166),
    ];
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = origin.x + (Math.random() - 0.5) * 8;
      positions[i * 3 + 1] = origin.y + Math.random() * 3;
      positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 8;
      const color = palette[i % palette.length]!;
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      velocities[i * 3] = (Math.random() - 0.5) * 1.6;
      velocities[i * 3 + 1] = Math.random() * 2.2 + 0.5;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 1.6;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.12,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.confetti = new THREE.Points(geometry, material);
    this.confettiVelocities = velocities;
    this.confettiLife = 4;
    this.group.add(this.confetti);
  }

  update(dt: number): void {
    for (let i = this.bolts.length - 1; i >= 0; i -= 1) {
      const bolt = this.bolts[i]!;
      bolt.ttl -= dt;
      const alpha = Math.max(0, bolt.ttl / bolt.max);
      if (bolt.line) {
        bolt.line.material.opacity = alpha;
        bolt.line.scale.setScalar(1 + (1 - alpha) * 0.15);
      }
      if (bolt.sprite) {
        bolt.sprite.material.opacity = alpha;
        bolt.sprite.scale.multiplyScalar(1 + dt * 1.4);
      }
      if (bolt.ttl <= 0) {
        if (bolt.line) {
          this.group.remove(bolt.line);
          bolt.line.geometry.dispose();
          bolt.line.material.dispose();
        }
        if (bolt.sprite) {
          this.group.remove(bolt.sprite);
          bolt.sprite.material.dispose();
        }
        this.bolts.splice(i, 1);
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i -= 1) {
      const flash = this.flashes[i]!;
      flash.ttl -= dt;
      const alpha = Math.max(0, flash.ttl / flash.max);
      flash.light.intensity = 320 * alpha * alpha;
      if (flash.ttl <= 0) {
        this.group.remove(flash.light);
        this.flashes.splice(i, 1);
      }
    }

    for (let i = this.floatings.length - 1; i >= 0; i -= 1) {
      const floating = this.floatings[i]!;
      floating.ttl -= dt;
      const alpha = Math.max(0, Math.min(1, floating.ttl / 0.4));
      floating.sprite.material.opacity = alpha;
      floating.sprite.position.addScaledVector(floating.velocity, dt);
      if (floating.ttl <= 0) {
        this.group.remove(floating.sprite);
        floating.sprite.material.map?.dispose();
        floating.sprite.material.dispose();
        this.floatings.splice(i, 1);
      }
    }

    if (this.confetti && this.confettiVelocities && this.confettiLife > 0) {
      this.confettiLife -= dt;
      const positions = this.confetti.geometry.getAttribute('position') as THREE.BufferAttribute;
      const velocities = this.confettiVelocities;
      for (let i = 0; i < positions.count; i += 1) {
        const nextVy = (velocities[i * 3 + 1] ?? 0) - 2.4 * dt;
        velocities[i * 3 + 1] = nextVy;
        positions.setXYZ(
          i,
          positions.getX(i) + (velocities[i * 3] ?? 0) * dt,
          positions.getY(i) + nextVy * dt,
          positions.getZ(i) + (velocities[i * 3 + 2] ?? 0) * dt,
        );
      }
      positions.needsUpdate = true;
      (this.confetti.material as THREE.PointsMaterial).opacity = Math.min(1, this.confettiLife);
      if (this.confettiLife <= 0) this.clearConfetti();
    }
  }

  private clearConfetti(): void {
    if (!this.confetti) return;
    this.group.remove(this.confetti);
    this.confetti.geometry.dispose();
    (this.confetti.material as THREE.Material).dispose();
    this.confetti = null;
    this.confettiVelocities = null;
    this.confettiLife = 0;
  }

  dispose(): void {
    this.clearConfetti();
    this.scene.remove(this.group);
    for (const bolt of this.bolts) {
      if (bolt.line) {
        bolt.line.geometry.dispose();
        bolt.line.material.dispose();
      }
      bolt.sprite?.material.dispose();
    }
    this.bolts.length = 0;
    this.flashes.length = 0;
    for (const floating of this.floatings) {
      floating.sprite.material.map?.dispose();
      floating.sprite.material.dispose();
    }
    this.floatings.length = 0;
  }
}
