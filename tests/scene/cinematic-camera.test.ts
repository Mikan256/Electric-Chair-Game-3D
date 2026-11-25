import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CinematicCamera,
  DEFAULT_CINEMATIC_BOUNDS,
  pressShotFor,
  shockShotFor,
} from '@/scene/cinematic-camera';

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 180);
  camera.position.set(0, 3.2, 12);
  return camera;
}

function makeControls(): OrbitControls {
  const controls = { enabled: true, target: new THREE.Vector3(0, 0.55, 0.7) };
  return controls as unknown as OrbitControls;
}

function expectFiniteVector(vector: THREE.Vector3): void {
  expect(Number.isFinite(vector.x)).toBe(true);
  expect(Number.isFinite(vector.y)).toBe(true);
  expect(Number.isFinite(vector.z)).toBe(true);
}

const PEDESTAL = new THREE.Vector3(0, 0.4, 8.2);
const ATTACKER = new THREE.Vector3(1.35, 0.4, 9.35);

describe('pressShotFor', () => {
  it('台座とアバターの斜め後ろから椅子の円を見る', () => {
    const shot = pressShotFor(PEDESTAL, ATTACKER);

    expect(shot.position.z).toBeGreaterThan(PEDESTAL.z);
    expect(shot.position.z).toBeGreaterThan(ATTACKER.z);
    expect(shot.position.y).toBeGreaterThan(ATTACKER.y);
    expect(shot.position.x).toBeGreaterThan(ATTACKER.x);
    expect(shot.target.z).toBeLessThan(PEDESTAL.z);
    expect(shot.fov).toBeGreaterThanOrEqual(44);
    expect(shot.fov).toBeLessThanOrEqual(48);
  });

  it('例示された座標を返す', () => {
    const shot = pressShotFor(PEDESTAL, ATTACKER);

    expect(shot.position.x).toBeCloseTo(2.4, 6);
    expect(shot.position.y).toBeCloseTo(2.7, 6);
    expect(shot.position.z).toBeCloseTo(13.0, 6);
    expect(shot.target.x).toBeCloseTo(0, 6);
    expect(shot.target.y).toBeCloseTo(1.0, 6);
    expect(shot.target.z).toBeCloseTo(3.8, 6);
    expect(shot.fov).toBe(46);
  });

  it('アバターが台座の左側ならカメラも左へ振る', () => {
    const shot = pressShotFor(PEDESTAL, new THREE.Vector3(-1.35, 0.4, 9.35));
    expect(shot.position.x).toBeLessThan(PEDESTAL.x);
  });

  it('NaN 入力でも有限なショットを返す', () => {
    const nan = Number.NaN;
    const shot = pressShotFor(new THREE.Vector3(nan, nan, nan), new THREE.Vector3(nan, nan, nan));
    expectFiniteVector(shot.position);
    expectFiniteVector(shot.target);
    expect(Number.isFinite(shot.fov ?? Number.NaN)).toBe(true);
  });
});

describe('shockShotFor', () => {
  it('椅子の内側へ寄り、横へずれたアップになる', () => {
    const chair = new THREE.Vector3(0, 0, 6.1);
    const shot = shockShotFor(chair);

    const inward = chair.clone().setY(0).negate().normalize();
    const side = new THREE.Vector3(-inward.z, 0, inward.x);
    const offset = shot.position.clone().sub(chair);

    expect(offset.dot(inward)).toBeCloseTo(2.0, 6);
    expect(offset.dot(side)).toBeCloseTo(1.25, 6);
    expect(shot.position.y).toBeCloseTo(1.8, 6);
    expect(shot.target.x).toBeCloseTo(chair.x, 6);
    expect(shot.target.y).toBeCloseTo(1.2, 6);
    expect(shot.target.z).toBeCloseTo(chair.z, 6);
    expect(shot.fov).toBeGreaterThanOrEqual(40);
    expect(shot.fov).toBeLessThanOrEqual(44);
    expect(shot.fov).toBe(42);
  });

  it('カメラが椅子より中心側にある', () => {
    for (let index = 0; index < 12; index += 1) {
      const angle = (index * Math.PI * 2) / 12;
      const chair = new THREE.Vector3(-Math.sin(angle) * 6.1, 0, Math.cos(angle) * 6.1);
      const shot = shockShotFor(chair);
      expect(Math.hypot(shot.position.x, shot.position.z)).toBeLessThan(
        Math.hypot(chair.x, chair.z),
      );
    }
  });

  it('原点の椅子でもゼロ除算しない', () => {
    const shot = shockShotFor(new THREE.Vector3(0, 0, 0));
    expectFiniteVector(shot.position);
    expectFiniteVector(shot.target);
  });

  it('NaN 入力でも有限なショットを返す', () => {
    const nan = Number.NaN;
    const shot = shockShotFor(new THREE.Vector3(nan, nan, nan));
    expectFiniteVector(shot.position);
    expectFiniteVector(shot.target);
    expect(Number.isFinite(shot.fov ?? Number.NaN)).toBe(true);
  });
});

describe('ショットの部屋境界', () => {
  it('press / shock とも既定の部屋の内側に収まる', () => {
    const shots = [pressShotFor(PEDESTAL, ATTACKER)];
    for (let index = 0; index < 12; index += 1) {
      const angle = (index * Math.PI * 2) / 12;
      shots.push(shockShotFor(new THREE.Vector3(-Math.sin(angle) * 6.1, 0, Math.cos(angle) * 6.1)));
    }

    for (const shot of shots) {
      expect(shot.position.x).toBeGreaterThanOrEqual(DEFAULT_CINEMATIC_BOUNDS.minX);
      expect(shot.position.x).toBeLessThanOrEqual(DEFAULT_CINEMATIC_BOUNDS.maxX);
      expect(shot.position.z).toBeGreaterThanOrEqual(DEFAULT_CINEMATIC_BOUNDS.minZ);
      expect(shot.position.z).toBeLessThanOrEqual(DEFAULT_CINEMATIC_BOUNDS.maxZ);
    }
  });
});

describe('CinematicCamera', () => {
  it('pressShot → shockShot → restore の位置・fov・controls を遷移する', () => {
    const camera = makeCamera();
    const controls = makeControls();
    const originalPosition = camera.position.clone();
    const originalTarget = controls.target.clone();
    const originalFov = camera.fov;

    const cinematic = new CinematicCamera({
      camera,
      controls,
      bounds: DEFAULT_CINEMATIC_BOUNDS,
    });
    const press = pressShotFor(PEDESTAL, ATTACKER);
    const chair = new THREE.Vector3(0, 0, 6.1);
    const shock = shockShotFor(chair);

    expect(cinematic.active).toBe(false);

    cinematic.pressShot(PEDESTAL, ATTACKER);
    expect(cinematic.active).toBe(true);
    expect(controls.enabled).toBe(false);

    // 最初の update でトゥイーン開始時刻が決まる。
    cinematic.update(1000);
    expect(camera.position.distanceTo(originalPosition)).toBeLessThan(1e-6);

    cinematic.update(1225); // 450ms の半分
    expect(camera.fov).toBeCloseTo(53, 6);
    expect(camera.position.x).toBeGreaterThan(originalPosition.x);

    cinematic.update(1450);
    expect(camera.position.distanceTo(press.position)).toBeLessThan(1e-6);
    expect(controls.target.distanceTo(press.target)).toBeLessThan(1e-6);
    expect(camera.fov).toBeCloseTo(46, 6);
    expect(cinematic.active).toBe(true);
    expect(controls.enabled).toBe(false);

    // 完了後はショットを保持する。
    cinematic.update(5000);
    expect(camera.position.distanceTo(press.position)).toBeLessThan(1e-6);

    cinematic.shockShot(chair);
    cinematic.update(5100);
    expect(camera.position.distanceTo(press.position)).toBeLessThan(1e-6);

    cinematic.update(5210); // 220ms の半分
    expect(camera.fov).toBeCloseTo(44, 6);
    cinematic.update(5320);
    expect(camera.position.distanceTo(shock.position)).toBeLessThan(1e-6);
    expect(controls.target.distanceTo(shock.target)).toBeLessThan(1e-6);
    expect(camera.fov).toBeCloseTo(42, 6);

    // 画面リサイズ等で fov が変わっても保存値へ戻す。
    camera.fov = 70;
    camera.updateProjectionMatrix();

    cinematic.restore();
    expect(cinematic.active).toBe(true);
    expect(controls.enabled).toBe(false);

    cinematic.update(6000);
    cinematic.update(6250); // 500ms の半分。現在の 70 から保存値 60 へ向かう。
    expect(camera.fov).toBeCloseTo(65, 6);
    cinematic.update(6500);

    expect(cinematic.active).toBe(false);
    expect(controls.enabled).toBe(true);
    expect(camera.position.distanceTo(originalPosition)).toBeLessThan(1e-6);
    expect(controls.target.distanceTo(originalTarget)).toBeLessThan(1e-6);
    expect(camera.fov).toBeCloseTo(originalFov, 6);
  });

  it('reset は即座に元の視点へ戻す', () => {
    const camera = makeCamera();
    const controls = makeControls();
    const originalPosition = camera.position.clone();
    const originalFov = camera.fov;
    const cinematic = new CinematicCamera({ camera, controls });

    cinematic.pressShot(PEDESTAL, ATTACKER);
    cinematic.update(0);
    cinematic.update(450);
    expect(cinematic.active).toBe(true);
    expect(controls.enabled).toBe(false);

    cinematic.reset();
    expect(cinematic.active).toBe(false);
    expect(controls.enabled).toBe(true);
    expect(camera.position.distanceTo(originalPosition)).toBeLessThan(1e-6);
    expect(camera.fov).toBeCloseTo(originalFov, 6);
  });

  it('bounds を渡すとショット位置を余白込みで clamp する', () => {
    const camera = makeCamera();
    const controls = makeControls();
    const cinematic = new CinematicCamera({
      camera,
      controls,
      bounds: { minX: -2, maxX: 2, minZ: 0, maxZ: 10 },
    });

    cinematic.pressShot(PEDESTAL, ATTACKER);
    cinematic.update(0);
    cinematic.update(450);

    expect(camera.position.x).toBeCloseTo(1.6, 6);
    expect(camera.position.z).toBeCloseTo(9.6, 6);
    expect(camera.position.y).toBeGreaterThan(0);
  });

  it('ショット前の restore は何もしない', () => {
    const camera = makeCamera();
    const controls = makeControls();
    const originalPosition = camera.position.clone();
    const cinematic = new CinematicCamera({ camera, controls });

    cinematic.restore();
    cinematic.update(1000);

    expect(cinematic.active).toBe(false);
    expect(controls.enabled).toBe(true);
    expect(camera.position.distanceTo(originalPosition)).toBeLessThan(1e-6);
  });
});
