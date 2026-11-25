import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  FINAL_THUNDER_HIGH_STAKES_PRE_PRESS_MS,
  FINAL_THUNDER_STANDARD_PRE_PRESS_MS,
} from '@/game/timing';
import {
  CinematicCamera,
  DEFAULT_CINEMATIC_BOUNDS,
  buttonShotFor,
  defenderShotFor,
  finalThunderStepsFor,
  pressShotFor,
  shockShotFor,
  type CameraShot,
  type CinematicStep,
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

function expectSameShot(actual: CameraShot, expected: CameraShot): void {
  expect(actual.position.distanceTo(expected.position)).toBeLessThan(1e-9);
  expect(actual.target.distanceTo(expected.target)).toBeLessThan(1e-9);
  expect(actual.fov).toBe(expected.fov);
}

function expectInsideBounds(position: THREE.Vector3, bounds = DEFAULT_CINEMATIC_BOUNDS): void {
  expect(position.x).toBeGreaterThanOrEqual(bounds.minX);
  expect(position.x).toBeLessThanOrEqual(bounds.maxX);
  expect(position.z).toBeGreaterThanOrEqual(bounds.minZ);
  expect(position.z).toBeLessThanOrEqual(bounds.maxZ);
}

const PEDESTAL = new THREE.Vector3(0, 0.4, 8.2);
const ATTACKER = new THREE.Vector3(1.35, 0.4, 9.35);
const STANDARD_MS = FINAL_THUNDER_STANDARD_PRE_PRESS_MS;
const HIGH_STAKES_MS = FINAL_THUNDER_HIGH_STAKES_PRE_PRESS_MS;

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

describe('defenderShotFor', () => {
  it('shockShotFor と同じ構図で、椅子の胸元を見る', () => {
    const chair = new THREE.Vector3(0, 0, 6.1);
    const defender = defenderShotFor(chair);
    const shock = shockShotFor(chair);

    expectSameShot(defender, shock);
    expect(defender.fov).toBe(42);
    expect(defender.target.y).toBeCloseTo(1.2, 6);
    expect(defender.position.y).toBeCloseTo(1.8, 6);
    expect(defender.position.distanceTo(chair)).toBeLessThan(4);
  });

  it('12脚すべてで椅子に寄り、部屋の内側に収まる', () => {
    for (let index = 0; index < 12; index += 1) {
      const angle = (index * Math.PI * 2) / 12;
      const chair = new THREE.Vector3(-Math.sin(angle) * 6.1, 0, Math.cos(angle) * 6.1);
      const shot = defenderShotFor(chair);

      expect(shot.position.distanceTo(chair)).toBeLessThan(4);
      expect(Math.hypot(shot.position.x, shot.position.z)).toBeLessThan(
        Math.hypot(chair.x, chair.z),
      );
      expectInsideBounds(shot.position);
    }
  });

  it('NaN 入力でも有限なショットを返す', () => {
    const nan = Number.NaN;
    const shot = defenderShotFor(new THREE.Vector3(nan, nan, nan));
    expectFiniteVector(shot.position);
    expectFiniteVector(shot.target);
    expect(shot.fov).toBe(42);
  });
});

describe('buttonShotFor', () => {
  it('台座の手前からボタンそのものへ寄る', () => {
    const shot = buttonShotFor(PEDESTAL);

    expect(shot.position.x).toBeCloseTo(PEDESTAL.x, 6);
    expect(shot.position.y).toBeCloseTo(PEDESTAL.y + 1.4, 6);
    expect(shot.position.z).toBeCloseTo(PEDESTAL.z + 2.2, 6);

    // ターゲットは台座のボタン上面。
    expect(shot.target.x).toBeCloseTo(PEDESTAL.x, 6);
    expect(shot.target.y).toBeCloseTo(PEDESTAL.y + 1.06, 6);
    expect(shot.target.z).toBeCloseTo(PEDESTAL.z, 6);

    expect(shot.position.distanceTo(shot.target)).toBeLessThan(2.5);
    expect(shot.fov).toBe(32);
  });

  it('部屋の内側に収まる', () => {
    for (const x of [-5, 0, 5]) {
      const pedestal = new THREE.Vector3(x, 0.4, 8.2);
      expectInsideBounds(buttonShotFor(pedestal).position);
    }
  });

  it('NaN 入力でも有限なショットを返す', () => {
    const nan = Number.NaN;
    const shot = buttonShotFor(new THREE.Vector3(nan, nan, nan));
    expectFiniteVector(shot.position);
    expectFiniteVector(shot.target);
    expect(shot.fov).toBe(32);
  });
});

describe('finalThunderStepsFor', () => {
  const chair = new THREE.Vector3(0, 0, 6.1);
  const options = { pedestal: PEDESTAL, avatar: ATTACKER, chair, durationMs: STANDARD_MS };

  it('4 ショットで合計が durationMs と一致する', () => {
    const steps = finalThunderStepsFor(options);

    expect(steps).toHaveLength(4);
    expect(steps.reduce((sum, step) => sum + step.durationMs, 0)).toBeCloseTo(STANDARD_MS, 6);
    expect(steps.map((step) => step.durationMs)).toEqual([700, 800, 900, 800]);
  });

  it('標準尺の区間が 0-700 / 700-1500 / 1500-2400 / 2400-3200', () => {
    const steps = finalThunderStepsFor(options);
    const starts: number[] = [];
    let elapsed = 0;
    for (const step of steps) {
      starts.push(elapsed);
      elapsed += step.durationMs;
    }

    expect(starts).toEqual([0, 700, 1500, 2400]);
    expect(elapsed).toBe(STANDARD_MS);
  });

  it('高stakes は守備側・ボタン・最後のホールドを長く取る', () => {
    const standard = finalThunderStepsFor(options);
    const high = finalThunderStepsFor({ ...options, durationMs: HIGH_STAKES_MS });

    expect(high).toHaveLength(4);
    expect(high.reduce((sum, step) => sum + step.durationMs, 0)).toBeCloseTo(HIGH_STAKES_MS, 6);
    expect(high.map((step) => step.durationMs)).toEqual([700, 1200, 1200, 2100]);

    expect(high[1]?.durationMs).toBeGreaterThan(standard[1]?.durationMs ?? 0);
    expect(high[2]?.durationMs).toBeGreaterThan(standard[2]?.durationMs ?? 0);
    expect(high[3]?.durationMs).toBeGreaterThan(standard[3]?.durationMs ?? 0);
  });

  it('各ステップがプレス / 守備側 / ボタン / プレスの順に並ぶ', () => {
    const steps = finalThunderStepsFor(options);
    const press = pressShotFor(PEDESTAL, ATTACKER);

    expectSameShot(steps[0]!.shot, press);
    expectSameShot(steps[1]!.shot, defenderShotFor(chair));
    expectSameShot(steps[2]!.shot, buttonShotFor(PEDESTAL));
    expectSameShot(steps[3]!.shot, press);
  });

  it('すべてのショットが部屋の内側に収まる', () => {
    for (const step of finalThunderStepsFor({ ...options, durationMs: HIGH_STAKES_MS })) {
      expectInsideBounds(step.shot.position);
    }
  });

  it('短い / 非有限の duration でも合計を保ち、有限値を返す', () => {
    for (const durationMs of [0, 1000, 2400, 4000, 9000, Number.NaN]) {
      const steps = finalThunderStepsFor({ ...options, durationMs });
      expect(steps).toHaveLength(4);
      const total = steps.reduce((sum, step) => sum + step.durationMs, 0);
      expect(Number.isFinite(total)).toBe(true);
      if (Number.isFinite(durationMs)) expect(total).toBeCloseTo(durationMs, 6);
      for (const step of steps) {
        expect(Number.isFinite(step.durationMs)).toBe(true);
        expect(step.durationMs).toBeGreaterThanOrEqual(0);
        expectFiniteVector(step.shot.position);
        expectFiniteVector(step.shot.target);
      }
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

describe('CinematicCamera.playSequence', () => {
  const chair = new THREE.Vector3(0, 0, 6.1);
  const options = { pedestal: PEDESTAL, avatar: ATTACKER, chair, durationMs: STANDARD_MS };
  const steps = finalThunderStepsFor(options);

  function makeCinematic(): {
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    cinematic: CinematicCamera;
    originalPosition: THREE.Vector3;
    originalTarget: THREE.Vector3;
    originalFov: number;
  } {
    const camera = makeCamera();
    const controls = makeControls();
    const originalPosition = camera.position.clone();
    const originalTarget = controls.target.clone();
    const originalFov = camera.fov;
    const cinematic = new CinematicCamera({ camera, controls });
    return { camera, controls, cinematic, originalPosition, originalTarget, originalFov };
  }

  it('最初の update は現在位置を保ち、controls を止めて active になる', () => {
    const { camera, controls, cinematic, originalPosition } = makeCinematic();

    cinematic.playSequence(steps);
    expect(cinematic.active).toBe(true);
    expect(controls.enabled).toBe(false);

    cinematic.update(1000);
    expect(camera.position.distanceTo(originalPosition)).toBeLessThan(1e-6);
  });

  it('各ステップの duration でショットを切り替え、最後はホールドする', () => {
    const { camera, controls, cinematic, originalPosition } = makeCinematic();
    const [pressStep, defenderStep, buttonStep, holdStep] = steps;
    const press = pressStep!.shot;
    const defender = defenderStep!.shot;
    const button = buttonStep!.shot;

    cinematic.playSequence(steps);
    cinematic.update(1000); // 開始時刻

    // 0〜700: 現在位置からプレスショットへ。
    cinematic.update(1350);
    expect(camera.position.x).toBeCloseTo(1.2, 6);
    expect(camera.fov).toBeCloseTo(53, 6);
    expect(camera.position.distanceTo(press.position)).toBeGreaterThan(0);

    cinematic.update(1700); // step 0 終了
    expect(camera.position.distanceTo(press.position)).toBeLessThan(1e-6);
    expect(controls.target.distanceTo(press.target)).toBeLessThan(1e-6);
    expect(camera.fov).toBe(46);

    // 700〜1500: 守備側。移動は 300ms だけ。
    cinematic.update(1850); // 移動の 150/300
    expect(camera.fov).toBeCloseTo(44, 6);
    cinematic.update(2000); // 700 + 300
    expect(camera.position.distanceTo(defender.position)).toBeLessThan(1e-6);
    expect(controls.target.distanceTo(defender.target)).toBeLessThan(1e-6);
    expect(camera.fov).toBe(42);

    // 1500〜2400: ボタンアップ。
    cinematic.update(2700); // 1500 + 200/300
    expect(camera.fov).toBeCloseTo(42 - (10 * 200) / 300, 6);
    cinematic.update(2800); // 1500 + 300
    expect(camera.position.distanceTo(button.position)).toBeLessThan(1e-6);
    expect(controls.target.distanceTo(button.target)).toBeLessThan(1e-6);
    expect(camera.fov).toBe(32);

    // 2400〜3200: プレスへ戻してホールド。
    cinematic.update(3700); // 2400 + 300
    expect(camera.position.distanceTo(press.position)).toBeLessThan(1e-6);
    expect(camera.fov).toBe(46);
    expect(cinematic.active).toBe(true);
    expect(controls.enabled).toBe(false);

    // タイムライン終了後もホールドし続ける。
    cinematic.update(8000);
    expect(camera.position.distanceTo(press.position)).toBeLessThan(1e-6);
    expect(controls.target.distanceTo(holdStep!.shot.target)).toBeLessThan(1e-6);
    expect(camera.position.distanceTo(originalPosition)).toBeGreaterThan(0);
    expect(cinematic.active).toBe(true);

    // カメラは controls.target を向いている。
    const direction = camera.getWorldDirection(new THREE.Vector3());
    const expected = controls.target.clone().sub(camera.position).normalize();
    expect(direction.dot(expected)).toBeCloseTo(1, 6);
  });

  it('restore で保存視点へ戻し、controls を再有効化する', () => {
    const { camera, controls, cinematic, originalPosition, originalTarget, originalFov } =
      makeCinematic();

    cinematic.playSequence(steps);
    cinematic.update(1000);
    cinematic.update(3200);
    expect(cinematic.active).toBe(true);

    cinematic.restore();
    expect(cinematic.active).toBe(true);
    expect(controls.enabled).toBe(false);

    cinematic.update(3300);
    expect(camera.fov).toBe(32); // ボタンショットのホールド中
    cinematic.update(3550); // 500ms の半分。32 から保存値 60 へ向かう。
    expect(camera.fov).toBeCloseTo(46, 6);
    cinematic.update(3800);

    expect(cinematic.active).toBe(false);
    expect(controls.enabled).toBe(true);
    expect(camera.position.distanceTo(originalPosition)).toBeLessThan(1e-6);
    expect(controls.target.distanceTo(originalTarget)).toBeLessThan(1e-6);
    expect(camera.fov).toBeCloseTo(originalFov, 6);
  });

  it('finalThunderSequence は finalThunderStepsFor と同じタイムラインを再生する', () => {
    const { camera, controls, cinematic } = makeCinematic();

    cinematic.finalThunderSequence(options);
    cinematic.update(0);
    cinematic.update(700 + 300); // 守備側へ移動完了

    const defender = defenderShotFor(chair);
    expect(camera.position.distanceTo(defender.position)).toBeLessThan(1e-6);
    expect(controls.target.distanceTo(defender.target)).toBeLessThan(1e-6);
    expect(camera.fov).toBe(42);
  });

  it('シーケンス中でも shockShot へ切り替えられる', () => {
    const { camera, controls, cinematic } = makeCinematic();
    const shock = shockShotFor(chair);

    cinematic.playSequence(steps);
    cinematic.update(0);
    cinematic.update(700);
    expect(camera.position.distanceTo(pressShotFor(PEDESTAL, ATTACKER).position)).toBeLessThan(
      1e-6,
    );

    cinematic.shockShot(chair);
    cinematic.update(800);
    cinematic.update(1020); // 220ms 完了
    expect(camera.position.distanceTo(shock.position)).toBeLessThan(1e-6);
    expect(controls.target.distanceTo(shock.target)).toBeLessThan(1e-6);
    expect(camera.fov).toBe(42);
    expect(cinematic.active).toBe(true);
  });

  it('bounds を渡すとシーケンスの全ショットを clamp する', () => {
    const camera = makeCamera();
    const controls = makeControls();
    const bounds = { minX: -2, maxX: 2, minZ: 0, maxZ: 10 };
    const cinematic = new CinematicCamera({ camera, controls, bounds });

    cinematic.playSequence(steps);
    cinematic.update(0);
    cinematic.update(700);
    expect(camera.position.z).toBeCloseTo(9.6, 6);
    expect(camera.position.x).toBeCloseTo(1.6, 6);

    cinematic.update(1100); // 守備側（クランプ不要）
    expect(camera.position.distanceTo(defenderShotFor(chair).position)).toBeLessThan(1e-6);

    cinematic.update(1600); // ボタン開始。終了まで待つ。
    cinematic.update(1800);
    expect(camera.position.z).toBeCloseTo(9.6, 6);
    expect(camera.position.x).toBeCloseTo(0, 6);
  });

  it('空 / 不正なシーケンスは何もしない', () => {
    const { camera, controls, cinematic, originalPosition } = makeCinematic();
    const invalid: CinematicStep[] = [
      {
        shot: pressShotFor(PEDESTAL, ATTACKER),
        durationMs: Number.NaN,
      },
      {
        shot: pressShotFor(PEDESTAL, ATTACKER),
        durationMs: -100,
      },
      {
        shot: pressShotFor(PEDESTAL, ATTACKER),
        durationMs: 0,
      },
    ];

    cinematic.playSequence([]);
    cinematic.playSequence(invalid);
    cinematic.update(1000);

    expect(cinematic.active).toBe(false);
    expect(controls.enabled).toBe(true);
    expect(camera.position.distanceTo(originalPosition)).toBeLessThan(1e-6);
  });

  it('reset はシーケンス途中でも即座に元の視点へ戻す', () => {
    const { camera, controls, cinematic, originalPosition } = makeCinematic();

    cinematic.playSequence(steps);
    cinematic.update(0);
    cinematic.update(900);
    expect(cinematic.active).toBe(true);

    cinematic.reset();
    expect(cinematic.active).toBe(false);
    expect(controls.enabled).toBe(true);
    expect(camera.position.distanceTo(originalPosition)).toBeLessThan(1e-6);
  });
});
