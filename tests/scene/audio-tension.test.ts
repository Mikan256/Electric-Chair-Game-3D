import { describe, expect, it } from 'vitest';
import { FINAL_THUNDER_HIGH_STAKES_PRE_PRESS_MS } from '@/game/timing';
import { FINAL_THUNDER_TENSION, finalThunderTensionProfile } from '@/scene/audio';

const DURATION = FINAL_THUNDER_HIGH_STAKES_PRE_PRESS_MS;

describe('finalThunderTensionProfile', () => {
  it('開始時は心音 1.1 倍・低いライザーから始まる', () => {
    const profile = finalThunderTensionProfile(DURATION, 0);

    expect(profile.progress).toBe(0);
    expect(profile.heartbeatRate).toBeCloseTo(FINAL_THUNDER_TENSION.heartbeatStartRate, 6);
    expect(profile.riserFrequency).toBeCloseTo(FINAL_THUNDER_TENSION.riserStartHz, 6);
    expect(profile.riserGain).toBeGreaterThan(0);
    expect(profile.silent).toBe(false);
  });

  it('無音区間の直前で心音 1.35 倍・ライザー最高潮になる', () => {
    const tailStart = DURATION - FINAL_THUNDER_TENSION.tailSilenceMs;
    const profile = finalThunderTensionProfile(DURATION, tailStart - 1);

    expect(profile.heartbeatRate).toBeCloseTo(FINAL_THUNDER_TENSION.heartbeatEndRate, 2);
    expect(profile.riserFrequency).toBeGreaterThan(FINAL_THUNDER_TENSION.riserEndHz * 0.99);
    expect(profile.riserGain).toBeGreaterThan(0.1);
    expect(profile.silent).toBe(false);
  });

  it('最後の 300ms は無音になる', () => {
    const tailStart = DURATION - FINAL_THUNDER_TENSION.tailSilenceMs;
    for (const elapsed of [tailStart, tailStart + 100, DURATION, DURATION + 500]) {
      const profile = finalThunderTensionProfile(DURATION, elapsed);
      expect(profile.silent).toBe(true);
      expect(profile.riserGain).toBe(0);
    }
  });

  it('無音区間より前は心音とライザーが単調に上がる', () => {
    const tailStart = DURATION - FINAL_THUNDER_TENSION.tailSilenceMs;
    let previousRate = 0;
    let previousFrequency = 0;
    let previousGain = 0;
    for (let step = 0; step < 20; step += 1) {
      const profile = finalThunderTensionProfile(DURATION, (tailStart * step) / 20);
      expect(profile.heartbeatRate).toBeGreaterThanOrEqual(previousRate);
      expect(profile.riserFrequency).toBeGreaterThanOrEqual(previousFrequency);
      expect(profile.riserGain).toBeGreaterThanOrEqual(previousGain);
      previousRate = profile.heartbeatRate;
      previousFrequency = profile.riserFrequency;
      previousGain = profile.riserGain;
    }
    expect(previousRate).toBeGreaterThan(FINAL_THUNDER_TENSION.heartbeatStartRate);
    expect(previousFrequency).toBeGreaterThan(FINAL_THUNDER_TENSION.riserStartHz);
  });

  it('無音区間より短い duration でも全編無音で NaN を出さない', () => {
    const profile = finalThunderTensionProfile(200, 0);
    expect(profile.silent).toBe(true);
    expect(profile.riserGain).toBe(0);
    expect(Number.isFinite(profile.heartbeatRate)).toBe(true);
    expect(Number.isFinite(profile.riserFrequency)).toBe(true);
  });

  it('NaN duration / 負の elapsed でも安全な値を返す', () => {
    const profile = finalThunderTensionProfile(Number.NaN, -100);
    expect(profile.progress).toBe(1);
    expect(profile.silent).toBe(true);
    expect(Number.isFinite(profile.heartbeatRate)).toBe(true);
    expect(Number.isFinite(profile.riserFrequency)).toBe(true);
    expect(Number.isFinite(profile.riserGain)).toBe(true);
  });
});
