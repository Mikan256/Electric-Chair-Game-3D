import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { chairModelUrl, assetUrl, ASSETS } from '@/assets/registry';

export interface LoadProgress {
  loaded: number;
  total: number;
  label: string;
}

type ProgressCallback = (progress: LoadProgress) => void;

/**
 * Loads and caches shared scene assets.
 *
 * The show's chairs are white cubes with a raised seat and a black number on
 * the outside face. The legacy FBX files give us the cube shape; the seat and
 * the number plate are added in code.
 */
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
    color: 0xf2f1ec,
    metalness: 0.02,
    roughness: 0.52,
  });

  readonly seatMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.0,
    roughness: 0.4,
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
          resolve(prepareChairModel(object, chair, this.chairFrameMaterial, this.seatMaterial));
        },
        undefined,
        () => {
          this.report(`椅子 ${chair} の代替モデル`);
          resolve(createFallbackChair(chair, this.chairFrameMaterial, this.seatMaterial));
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

/**
 * The legacy Block FBX files carry a baked text mesh ("12") on the face that
 * points at the centre of the stage.  We draw the real number on the outside
 * face ourselves, so drop the inner-side text to keep that face clean.
 */
function stripBakedNumberText(object: THREE.Object3D): void {
  const baked: THREE.Object3D[] = [];
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometryName = child.geometry?.name ?? '';
    const isText = geometryName === 'テキスト' || geometryName.toLowerCase() === 'text';
    if (isText && /^\d{1,2}$/.test(child.name)) baked.push(child);
  });
  for (const mesh of baked) mesh.removeFromParent();
}

function prepareChairModel(
  object: THREE.Group,
  chair: number,
  frameMaterial: THREE.Material,
  seatMaterial: THREE.Material,
): THREE.Group {
  stripSceneHelpers(object);
  stripBakedNumberText(object);
  const wrapper = stripAndCenter(object, 0.92);

  let meshCount = 0;
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    meshCount += 1;
    child.castShadow = false;
    child.receiveShadow = false;
    child.material = frameMaterial;
    child.frustumCulled = true;
  });

  const box = new THREE.Box3().setFromObject(wrapper);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // 座面の凸。元のブロックの上面に白いクッションを載せる。
  const seatHeight = 0.16;
  const seat = new THREE.Mesh(
    new RoundedBoxGeometry(
      Math.max(0.55, size.x * 0.62),
      seatHeight,
      Math.max(0.5, size.z * 0.56),
      3,
      0.05,
    ),
    seatMaterial,
  );
  seat.position.set(center.x, size.y + seatHeight / 2 - 0.01, center.z);
  seat.userData.isSeat = true;
  wrapper.add(seat);

  // 外側の面に黒い数字。椅子は中心を向くので、ローカル -Z が外側。
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(0.45, size.x * 0.62), Math.max(0.4, size.y * 0.52)),
    new THREE.MeshBasicMaterial({
      map: createChairNumberTexture(chair),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      toneMapped: false,
    }),
  );
  plate.position.set(center.x, size.y * 0.52, box.min.z - 0.006);
  plate.rotation.y = Math.PI;
  plate.userData.isNumberPlate = true;
  wrapper.add(plate);

  if (meshCount === 0) {
    const fallback = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), frameMaterial);
    fallback.position.y = size.y / 2;
    wrapper.add(fallback);
  }

  return wrapper;
}

function createChairNumberTexture(chair: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.CanvasTexture(canvas);

  context.clearRect(0, 0, 512, 512);
  context.fillStyle = '#151515';
  context.font = '900 300px "Zekton", "Arial Black", "Hiragino Kaku Gothic ProN", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(String(chair), 256, 272);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createFallbackChair(
  chair: number,
  frameMaterial: THREE.Material,
  seatMaterial: THREE.Material,
): THREE.Group {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.92, 1.2), frameMaterial);
  base.position.y = 0.46;
  group.add(base);

  const seat = new THREE.Mesh(new RoundedBoxGeometry(0.78, 0.16, 0.7, 3, 0.05), seatMaterial);
  seat.position.y = 0.99;
  seat.userData.isSeat = true;
  group.add(seat);

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.75, 0.48),
    new THREE.MeshBasicMaterial({
      map: createChairNumberTexture(chair),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      toneMapped: false,
    }),
  );
  plate.position.set(0, 0.48, -0.606);
  plate.rotation.y = Math.PI;
  plate.userData.isNumberPlate = true;
  group.add(plate);

  return group;
}
