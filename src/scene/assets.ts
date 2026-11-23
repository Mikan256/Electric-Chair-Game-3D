import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { chairModelUrl, assetUrl, ASSETS } from '@/assets/registry';

export interface LoadProgress {
  loaded: number;
  total: number;
  label: string;
}

type ProgressCallback = (progress: LoadProgress) => void;

/** Loads and caches shared scene assets. Failures fall back to placeholders. */
export class AssetLibrary {
  private readonly fbx = new FBXLoader();
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly chairCache = new Map<number, Promise<THREE.Group>>();
  private readonly textureCache = new Map<string, Promise<THREE.Texture>>();
  private pedestalPromise: Promise<THREE.Group | null> | null = null;
  private progress: ProgressCallback | null = null;
  private loaded = 0;
  private total = 1;

  readonly chairFrameMaterial = new THREE.MeshStandardMaterial({
    color: 0x17171d,
    metalness: 0.85,
    roughness: 0.36,
  });

  readonly cushionMaterial = new THREE.MeshStandardMaterial({
    color: 0x5a0710,
    metalness: 0.15,
    roughness: 0.72,
    emissive: 0x220004,
  });

  setProgressCallback(callback: ProgressCallback | null): void {
    this.progress = callback;
    if (callback) callback({ loaded: this.loaded, total: this.total, label: '準備中' });
  }

  private report(label: string): void {
    this.loaded += 1;
    this.progress?.({ loaded: this.loaded, total: this.total, label });
  }

  private markTotal(count: number): void {
    this.total = Math.max(this.total, this.loaded + count);
  }

  loadTexture(path: string, options: { srgb?: boolean } = {}): Promise<THREE.Texture> {
    const key = `${path}:${options.srgb ? 'srgb' : 'linear'}`;
    const cached = this.textureCache.get(key);
    if (cached) return cached;
    const promise = new Promise<THREE.Texture>((resolve, reject) => {
      this.textureLoader.load(
        assetUrl(path),
        (texture) => {
          texture.colorSpace = options.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
          texture.anisotropy = 4;
          resolve(texture);
        },
        undefined,
        reject,
      );
    });
    this.textureCache.set(key, promise);
    return promise;
  }

  async loadChair(chair: number): Promise<THREE.Group> {
    const cached = this.chairCache.get(chair);
    if (cached) return cached;
    this.markTotal(1);
    const promise = new Promise<THREE.Group>((resolve) => {
      this.fbx.load(
        chairModelUrl(chair),
        (object) => {
          this.report(`椅子 ${chair} を読み込み中`);
          resolve(prepareChairModel(object, this.chairFrameMaterial, this.cushionMaterial));
        },
        undefined,
        () => {
          this.report(`椅子 ${chair} の代替モデル`);
          resolve(createFallbackChair(chair, this.chairFrameMaterial, this.cushionMaterial));
        },
      );
    });
    this.chairCache.set(chair, promise);
    return promise;
  }

  loadPedestal(): Promise<THREE.Group | null> {
    if (this.pedestalPromise) return this.pedestalPromise;
    this.markTotal(1);
    this.pedestalPromise = new Promise((resolve) => {
      this.fbx.load(
        assetUrl(ASSETS.pedestal),
        (object) => {
          this.report('台座を読み込み中');
          stripSceneHelpers(object);
          object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0x0b0b10,
                metalness: 0.2,
                roughness: 0.6,
              });
            }
          });
          resolve(object);
        },
        undefined,
        () => {
          this.report('台座の代替モデル');
          resolve(null);
        },
      );
    });
    return this.pedestalPromise;
  }

  /** Preload the models that the stage needs before the first frame. */
  async loadStage(onProgress?: ProgressCallback): Promise<void> {
    this.setProgressCallback(onProgress ?? null);
    await Promise.all(Array.from({ length: 12 }, (_, index) => this.loadChair(index + 1)));
    this.setProgressCallback(null);
  }

  async loadLightningTexture(): Promise<THREE.Texture | null> {
    try {
      return await this.loadTexture(ASSETS.lightningBolt);
    } catch {
      return null;
    }
  }
}

function stripAndCenter(object: THREE.Object3D, targetHeight: number): THREE.Group {
  const wrapper = new THREE.Group();
  wrapper.add(object);
  object.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const height = Math.max(size.y, 0.0001);
  const scale = targetHeight / height;
  object.scale.multiplyScalar(scale);
  object.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(object);
  const center = scaledBox.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= scaledBox.min.y;
  return wrapper;
}

/** FBX exports from Unity can contain lights/cameras; never let them leak in. */
function stripSceneHelpers(object: THREE.Object3D): void {
  const helpers: THREE.Object3D[] = [];
  object.traverse((child) => {
    if ((child as THREE.Light).isLight || (child as THREE.Camera).isCamera) helpers.push(child);
  });
  for (const helper of helpers) helper.removeFromParent();
}

function prepareChairModel(
  object: THREE.Group,
  frameMaterial: THREE.Material,
  cushionMaterial: THREE.Material,
): THREE.Group {
  stripSceneHelpers(object);
  const wrapper = stripAndCenter(object, 0.92);
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = false;
    child.receiveShadow = false;
    child.material = frameMaterial;
    child.frustumCulled = true;
  });

  // 元モデルはブロック状の座面。背もたれ・肘掛けを足して椅子にする。
  const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.12, 0.86), cushionMaterial);
  cushion.position.y = 0.98;
  cushion.position.z = 0.02;
  wrapper.add(cushion);

  const back = new THREE.Mesh(new THREE.BoxGeometry(1.16, 1.12, 0.14), frameMaterial);
  back.position.set(0, 1.5, -0.49);
  back.rotation.x = -0.1;
  wrapper.add(back);

  const backPad = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.9, 0.06), cushionMaterial);
  backPad.position.set(0, 1.5, -0.4);
  backPad.rotation.x = -0.1;
  wrapper.add(backPad);

  for (const x of [-0.62, 0.62] as const) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.9), frameMaterial);
    arm.position.set(x, 1.12, -0.02);
    wrapper.add(arm);
    const armPost = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.08), frameMaterial);
    armPost.position.set(x, 0.99, 0.36);
    wrapper.add(armPost);
  }

  const trim = new THREE.Mesh(
    new THREE.TorusGeometry(0.76, 0.025, 8, 36),
    new THREE.MeshBasicMaterial({ color: 0xd21f35 }),
  );
  trim.rotation.x = Math.PI / 2;
  trim.position.y = 0.04;
  wrapper.add(trim);

  return wrapper;
}

function createFallbackChair(
  chair: number,
  frameMaterial: THREE.Material,
  cushionMaterial: THREE.Material,
): THREE.Group {
  const group = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 1.1), frameMaterial);
  seat.position.y = 1.0;
  group.add(seat);

  const cushion = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 1.0), cushionMaterial);
  cushion.position.y = 1.12;
  group.add(cushion);

  const back = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.3, 0.12), frameMaterial);
  back.position.set(0, 1.7, -0.5);
  group.add(back);

  for (const [x, z] of [
    [-0.5, -0.42],
    [0.5, -0.42],
    [-0.5, 0.42],
    [0.5, 0.42],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.1), frameMaterial);
    leg.position.set(x, 0.5, z);
    group.add(leg);
  }

  group.userData.fallbackChair = chair;
  return group;
}
