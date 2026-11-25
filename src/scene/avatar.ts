import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { VRMLoaderPlugin, type VRM } from '@pixiv/three-vrm';
import { assetUrl, ASSETS } from '@/assets/registry';

export interface AvatarInstance {
  readonly scene: THREE.Group;
  readonly vrm: VRM;
}

/**
 * Loads the VRoid avatar from the legacy Unity project. The VRM is optional:
 * a failure must never prevent the game from running.
 */
export async function loadVrm(url = assetUrl(ASSETS.avatar)): Promise<VRM | null> {
  try {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) return null;
    vrm.scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.frustumCulled = false;
      }
    });
    return vrm;
  } catch (error) {
    console.warn('VRM avatar could not be loaded', error);
    return null;
  }
}

/** Clone the loaded VRM for the second player and normalise it to the stage. */
/**
 * Returns the loaded VRM scene without touching its matrices: VRM spring-bone
 * colliders can throw if updated before the model is added to a live scene.
 * VRoid models are authored in metres (about 1.5–1.7m tall), so the stage scale
 * already works.
 */
export function instantiateAvatar(vrm: VRM, clone: boolean): AvatarInstance {
  const scene = clone ? (cloneSkeleton(vrm.scene) as THREE.Group) : vrm.scene;
  return { scene, vrm };
}

function prepareVrm(vrm: VRM): VRM {
  vrm.scene.traverse((child) => {
    if (child instanceof THREE.Mesh) child.frustumCulled = false;
  });
  return vrm;
}

/**
 * Load two independent VRM instances for the attacker/defender avatars.
 *
 * A cloned VRM *scene* cannot be posed independently because the humanoid
 * helper still points at the original skeleton, so the asset is fetched once
 * and parsed twice. Returns null when the avatar asset is absent (slim ZIP).
 */
export async function loadVrmPair(url = assetUrl(ASSETS.avatar)): Promise<[VRM, VRM] | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();

    const parse = async (): Promise<VRM | null> => {
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      const gltf = await loader.parseAsync(buffer, '');
      return (gltf.userData.vrm as VRM | undefined) ?? null;
    };

    const [first, second] = await Promise.all([parse(), parse()]);
    if (!first || !second) return null;
    return [prepareVrm(first), prepareVrm(second)];
  } catch (error) {
    console.warn('VRM avatar pair could not be loaded', error);
    return null;
  }
}

export function placeAvatar(
  instance: AvatarInstance,
  position: THREE.Vector3,
  facePoint = new THREE.Vector3(0, 1, 0),
): void {
  instance.scene.position.copy(position);
  instance.scene.rotation.y = Math.atan2(facePoint.x - position.x, facePoint.z - position.z);
}
