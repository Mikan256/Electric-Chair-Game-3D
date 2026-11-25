import { describe, expect, it } from 'vitest';
import { clampCameraToRoom, orbitDistanceLimits, type RoomOrbitConfig } from '@/scene/orbit-camera';

function makeConfig(overrides: Partial<RoomOrbitConfig> = {}): RoomOrbitConfig {
  return {
    fov: 50,
    target: [0, 1, 0],
    minDistance: 5,
    maxDistance: 40,
    minPolarAngle: 0.15,
    maxPolarAngle: Math.PI - 0.15,
    bounds: {
      minX: -10,
      maxX: 10,
      minZ: -12,
      maxZ: 16,
      minY: 0.5,
      maxY: 9,
    },
    margin: 0.5,
    ...overrides,
  };
}

describe('orbitDistanceLimits', () => {
  it('方位角ごとに部屋の境界から max を決める', () => {
    const config = makeConfig();

    // +Z 方向は maxZ 16 - margin 0.5 = 15.5
    expect(orbitDistanceLimits(0, config).max).toBeCloseTo(15.5, 6);
    // -Z 方向は target.z 0 から minZ -12 + margin 0.5 = -11.5 まで
    expect(orbitDistanceLimits(Math.PI, config).max).toBeCloseTo(11.5, 6);
    // ±X 方向は maxX 10 - margin 0.5 = 9.5
    expect(orbitDistanceLimits(Math.PI / 2, config).max).toBeCloseTo(9.5, 6);
    expect(orbitDistanceLimits(-Math.PI / 2, config).max).toBeCloseTo(9.5, 6);
  });

  it('margin を省略すると境界そのものが上限になる', () => {
    const config = makeConfig({
      margin: undefined,
      bounds: { minX: -10, maxX: 10, minZ: -12, maxZ: 16 },
    });

    expect(orbitDistanceLimits(0, config).max).toBeCloseTo(16, 6);
    expect(orbitDistanceLimits(Math.PI, config).max).toBeCloseTo(12, 6);
    expect(orbitDistanceLimits(Math.PI / 2, config).max).toBeCloseTo(10, 6);
  });

  it('全周で max が有限かつ正、min <= max になる', () => {
    const config = makeConfig({ maxDistance: 10_000 });
    for (let index = 0; index < 128; index += 1) {
      const azimuth = (index / 128) * Math.PI * 2 - Math.PI;
      const limits = orbitDistanceLimits(azimuth, config);
      expect(Number.isFinite(limits.min)).toBe(true);
      expect(Number.isFinite(limits.max)).toBe(true);
      expect(limits.min).toBeGreaterThanOrEqual(2);
      expect(limits.max).toBeGreaterThan(0);
      expect(limits.min).toBeLessThanOrEqual(limits.max);
    }
  });

  it('90° ごとの対称性を保つ', () => {
    const config = makeConfig({
      target: [0, 1, 0],
      bounds: { minX: -12, maxX: 12, minZ: -12, maxZ: 12, minY: 0.5, maxY: 9 },
    });

    expect(orbitDistanceLimits(Math.PI / 2, config).max).toBeCloseTo(
      orbitDistanceLimits(-Math.PI / 2, config).max,
      6,
    );
    expect(orbitDistanceLimits(0, config).max).toBeCloseTo(
      orbitDistanceLimits(Math.PI, config).max,
      6,
    );
  });

  it('設定の maxDistance を超えない', () => {
    const config = makeConfig({ maxDistance: 8 });
    for (const azimuth of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      expect(orbitDistanceLimits(azimuth, config).max).toBeLessThanOrEqual(8);
    }
  });

  it('minDistance が 2 未満でも min は 2 以上になる', () => {
    const config = makeConfig({ minDistance: 0.25, maxDistance: 1 });
    const limits = orbitDistanceLimits(0, config);
    expect(limits.min).toBeGreaterThanOrEqual(2);
    expect(limits.min).toBeLessThanOrEqual(limits.max);
  });

  it('壁際の target でも NaN や負の距離にならない', () => {
    const config = makeConfig({
      target: [0, 1, 16],
      maxDistance: 40,
    });
    const limits = orbitDistanceLimits(0, config);
    expect(Number.isNaN(limits.max)).toBe(false);
    expect(limits.max).toBeGreaterThan(0);
    expect(limits.max).toBeGreaterThanOrEqual(limits.min);
  });

  it('潰れた部屋（幅 0）でも有限値を返す', () => {
    const config = makeConfig({
      margin: 0.5,
      bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0, minY: 0, maxY: 0 },
    });
    for (const azimuth of [0, Math.PI / 3, Math.PI, -Math.PI / 2]) {
      const limits = orbitDistanceLimits(azimuth, config);
      expect(Number.isFinite(limits.min)).toBe(true);
      expect(Number.isFinite(limits.max)).toBe(true);
      expect(limits.max).toBeGreaterThan(0);
      expect(limits.min).toBeLessThanOrEqual(limits.max);
    }
  });
});

describe('clampCameraToRoom', () => {
  it('部屋の外側の位置を margin 込みの内側へ収める', () => {
    const config = makeConfig();
    const clamped = clampCameraToRoom({ x: 100, y: 100, z: -100 }, config);

    expect(clamped.x).toBeCloseTo(9.5, 6);
    expect(clamped.y).toBeCloseTo(8.5, 6);
    expect(clamped.z).toBeCloseTo(-11.5, 6);
  });

  it('内側の位置は変更しない', () => {
    const config = makeConfig();
    const position = { x: 3, y: 4, z: 2 };
    expect(clampCameraToRoom(position, config)).toEqual(position);
  });

  it('y が minY/maxY の範囲を外れたら収める', () => {
    const config = makeConfig();

    expect(clampCameraToRoom({ x: 0, y: -50, z: 0 }, config).y).toBeCloseTo(1, 6);
    expect(clampCameraToRoom({ x: 0, y: 50, z: 0 }, config).y).toBeCloseTo(8.5, 6);
  });

  it('y の境界が省略されていれば y を制限しない', () => {
    const config = makeConfig({
      bounds: { minX: -10, maxX: 10, minZ: -12, maxZ: 16 },
    });
    expect(clampCameraToRoom({ x: 0, y: 123, z: 0 }, config).y).toBe(123);
  });

  it('NaN / Infinity でも有限な座標を返す', () => {
    const config = makeConfig();
    const clamped = clampCameraToRoom(
      { x: Number.NaN, y: Number.NaN, z: Number.POSITIVE_INFINITY },
      config,
    );

    expect(Number.isFinite(clamped.x)).toBe(true);
    expect(Number.isFinite(clamped.y)).toBe(true);
    expect(Number.isFinite(clamped.z)).toBe(true);
    expect(clamped.x).toBeGreaterThanOrEqual(-9.5);
    expect(clamped.x).toBeLessThanOrEqual(9.5);
    expect(clamped.z).toBeGreaterThanOrEqual(-11.5);
    expect(clamped.z).toBeLessThanOrEqual(15.5);
  });

  it('壁際でも NaN にならない', () => {
    const config = makeConfig({ target: [9.5, 1, 15.5] });
    const clamped = clampCameraToRoom({ x: 9.5, y: 1, z: 15.5 }, config);

    expect(clamped.x).toBeCloseTo(9.5, 6);
    expect(clamped.y).toBeCloseTo(1, 6);
    expect(clamped.z).toBeCloseTo(15.5, 6);
  });

  it('y の境界が NaN でも有限な座標を返す', () => {
    const config = makeConfig({
      bounds: { minX: -10, maxX: 10, minZ: -12, maxZ: 16, minY: Number.NaN, maxY: 9 },
    });
    const clamped = clampCameraToRoom({ x: 0, y: 4, z: 0 }, config);

    expect(clamped.y).toBe(4);
    expect(Number.isNaN(clamped.y)).toBe(false);
  });

  it('潰れた部屋でも中心へ収める', () => {
    const config = makeConfig({
      margin: 0,
      bounds: { minX: 4, maxX: 4, minZ: -3, maxZ: -3, minY: 2, maxY: 2 },
    });
    expect(clampCameraToRoom({ x: 0, y: 0, z: 0 }, config)).toEqual({ x: 4, y: 2, z: -3 });
  });
});
