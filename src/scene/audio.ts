import { assetUrl, ASSETS, ROUND_VOICE } from '@/assets/registry';
import { FINAL_THUNDER_STANDARD_PRE_PRESS_MS } from '@/game/timing';

export type SoundKey = 'electric' | 'chair' | 'click';

/** FINAL THUNDER の長尺演出で使う音のパラメータ。 */
export const FINAL_THUNDER_TENSION = {
  heartbeatStartRate: 1.1,
  heartbeatEndRate: 1.35,
  heartbeatVolume: 0.4,
  riserStartHz: 48,
  riserEndHz: 210,
  tailSilenceMs: 300,
  bgmDuckVolume: 0.08,
} as const;

export interface FinalThunderTensionProfile {
  /** 0..1。演出全体に対する経過割合。 */
  readonly progress: number;
  /** 心音の playbackRate（1.1 → 1.35）。 */
  readonly heartbeatRate: number;
  /** ライザーの音量。最後の tailSilenceMs は 0。 */
  readonly riserGain: number;
  /** ライザーの周波数（Hz）。終盤に向けて上昇する。 */
  readonly riserFrequency: number;
  /** 最後の無音区間かどうか。 */
  readonly silent: boolean;
}

/**
 * 経過時間からテンション音のカーブを求める純粋関数。
 * WebAudio に依存しないのでテストやタイミング調整に使える。
 */
export function finalThunderTensionProfile(
  durationMs: number,
  elapsedMs: number,
): FinalThunderTensionProfile {
  const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const progress = duration <= 0 ? 1 : Math.min(1, elapsed / duration);
  const tailStart = Math.max(0, duration - FINAL_THUNDER_TENSION.tailSilenceMs);
  const silent = duration <= 0 || elapsed >= tailStart;
  const audibleProgress =
    tailStart <= 0 || duration <= FINAL_THUNDER_TENSION.tailSilenceMs
      ? 0
      : Math.min(1, elapsed / tailStart);
  const eased = audibleProgress * audibleProgress;
  const rateEased = Math.pow(audibleProgress, 1.25);

  return {
    progress,
    heartbeatRate:
      FINAL_THUNDER_TENSION.heartbeatStartRate +
      (FINAL_THUNDER_TENSION.heartbeatEndRate - FINAL_THUNDER_TENSION.heartbeatStartRate) *
        rateEased,
    riserGain: silent ? 0 : 0.012 + 0.11 * eased,
    riserFrequency:
      FINAL_THUNDER_TENSION.riserStartHz *
      Math.pow(FINAL_THUNDER_TENSION.riserEndHz / FINAL_THUNDER_TENSION.riserStartHz, eased),
    silent,
  };
}

/**
 * Small HTMLAudio wrapper. Files are loaded lazily so the title BGM does not
 * delay the first frame, and playback starts only after a user gesture
 * (sandbox autoplay policies).
 */
export class AudioManager {
  private readonly elements = new Map<string, HTMLAudioElement>();
  private bgm: HTMLAudioElement | null = null;
  private heartbeat: HTMLAudioElement | null = null;
  private gameBgm: HTMLAudioElement | null = null;
  private gameBgmRequested = false;
  private gameBgmVolume = 0.22;
  private audioContext: AudioContext | null = null;
  private muted = false;
  private unlocked = false;
  private roundsPreloaded = false;
  private roundVoiceTimer: number | null = null;
  private currentRoundVoice: HTMLAudioElement | null = null;
  private finalThunderVoice: HTMLAudioElement | null = null;
  private tensionRaf: number | null = null;
  private tensionStartedAt = 0;
  private tensionDurationMs = 0;
  private tensionMaster: GainNode | null = null;
  private tensionOscillators: OscillatorNode[] = [];
  private bgmDuckRestore: number | null = null;

  constructor() {
    try {
      this.muted = localStorage.getItem('denki-isu:muted') === '1';
    } catch {
      this.muted = false;
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const element of this.elements.values()) element.muted = muted;
    if (this.bgm) this.bgm.muted = muted;
    if (this.heartbeat) this.heartbeat.muted = muted;
    if (this.gameBgm) this.gameBgm.muted = muted;
    if (this.tensionMaster) this.tensionMaster.gain.value = muted ? 0.0001 : 1;
    try {
      localStorage.setItem('denki-isu:muted', muted ? '1' : '0');
    } catch {
      // ignore
    }
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  unlock(): void {
    this.unlocked = true;
    if (this.gameBgmRequested) void this.playGameBgm(this.gameBgmVolume);
  }

  private audio(key: string, path: string, loop = false, volume = 0.6): HTMLAudioElement {
    let element = this.elements.get(key);
    if (!element) {
      element = new Audio(assetUrl(path));
      element.preload = 'auto';
      element.loop = loop;
      element.volume = volume;
      element.muted = this.muted;
      this.elements.set(key, element);
    }
    return element;
  }

  async playBgm(volume = 0.32): Promise<void> {
    if (!this.bgm) {
      this.bgm = this.audio('bgm', ASSETS.bgmTitle, true, volume);
    }
    if (!this.unlocked || this.muted) return;
    this.bgm.volume = volume;
    try {
      await this.bgm.play();
    } catch {
      // autoplay rejected; retried on the next user gesture
    }
  }

  /** ゲーム本編のBGM（旧 Unity の Innovation.wav を圧縮したもの）。 */
  async playGameBgm(volume = 0.22): Promise<void> {
    this.gameBgmVolume = volume;
    this.gameBgmRequested = true;
    if (!this.gameBgm) {
      this.gameBgm = this.audio('game-bgm', ASSETS.bgmGame, true, volume);
    }
    if (!this.unlocked || this.muted) return;
    this.gameBgm.volume =
      this.bgmDuckRestore !== null ? Math.min(volume, FINAL_THUNDER_TENSION.bgmDuckVolume) : volume;
    try {
      await this.gameBgm.play();
    } catch {
      // 次の操作で再試行
    }
  }

  stopGameBgm(fadeMs = 900): void {
    this.gameBgmRequested = false;
    if (!this.gameBgm) return;
    const element = this.gameBgm;
    if (fadeMs <= 0) {
      element.pause();
      return;
    }
    const start = performance.now();
    const initial = element.volume;
    const tick = (): void => {
      const t = Math.min(1, (performance.now() - start) / fadeMs);
      element.volume = initial * (1 - t);
      if (t < 1) requestAnimationFrame(tick);
      else element.pause();
    };
    requestAnimationFrame(tick);
  }

  /** ラウンド開始のコール（画面表示と合わせて使う）。 */
  announceRound(round: number): void {
    if (this.muted) return;
    this.playRoundChime();
    if (!this.unlocked) return;
    if (this.roundVoiceTimer !== null) window.clearTimeout(this.roundVoiceTimer);
    this.roundVoiceTimer = window.setTimeout(() => {
      this.roundVoiceTimer = null;
      if (!this.unlocked || this.muted) return;
      const index = Math.min(ROUND_VOICE.length, Math.max(1, Math.round(round))) - 1;
      const path = ROUND_VOICE[index] ?? ROUND_VOICE[0]!;
      const element = this.audio(`round:${index}`, path, false, 0.9);
      element.volume = 0.9;
      this.stopRoundVoice();
      this.currentRoundVoice = element;
      element.currentTime = 0;
      void element.play().catch(() => undefined);
    }, 240);
  }

  /** ラウンドコール音声を先読みしておく（合計 150 KB 程度）。 */
  preloadRounds(): void {
    if (this.roundsPreloaded) return;
    this.roundsPreloaded = true;
    ROUND_VOICE.forEach((path, index) => {
      this.audio(`round:${index}`, path, false, 0.9);
    });
  }

  stopRoundVoice(): void {
    if (this.roundVoiceTimer !== null) {
      window.clearTimeout(this.roundVoiceTimer);
      this.roundVoiceTimer = null;
    }
    if (this.currentRoundVoice) {
      this.currentRoundVoice.pause();
      this.currentRoundVoice.currentTime = 0;
      this.currentRoundVoice = null;
    }
  }

  /** FINAL THUNDER のコール音声。press 演出の開始時に呼ぶ。 */
  async playFinalThunderCall(volume = 0.95): Promise<void> {
    if (!this.unlocked || this.muted) return;
    try {
      const element = this.audio('voice:final-thunder', ASSETS.voiceFinalThunder, false, volume);
      if (this.finalThunderVoice && this.finalThunderVoice !== element) {
        this.finalThunderVoice.pause();
      }
      this.finalThunderVoice = element;
      element.volume = volume;
      element.currentTime = 0;
      this.playFinalThunderStinger();
      await element.play().catch(() => undefined);
    } catch {
      // 音声が出なくてもゲームは続行する
    }
  }

  /**
   * FINAL THUNDER の長尺テンション。BGM をダッキングし、心音を加速させながら
   * 低いライザーを重ねる。最後の 300ms は無音にしてプレス前の間を作る。
   */
  startFinalThunderTension(durationMs: number): void {
    try {
      const duration = Number.isFinite(durationMs)
        ? Math.max(600, durationMs)
        : FINAL_THUNDER_STANDARD_PRE_PRESS_MS;
      this.stopFinalThunderTension(true);
      if (!this.unlocked || this.muted) return;
      this.tensionStartedAt = performance.now();
      this.tensionDurationMs = duration;
      this.duckGameBgm();
      this.startFinalThunderRiser(duration);
      void this.playHeartbeat(true, FINAL_THUNDER_TENSION.heartbeatVolume).then(() => {
        if (this.heartbeat && this.tensionDurationMs > 0) {
          this.heartbeat.playbackRate = FINAL_THUNDER_TENSION.heartbeatStartRate;
        }
      });
      this.tensionRaf = requestAnimationFrame(this.tickFinalThunderTension);
    } catch {
      // 音響が使えなくても演出は止めない
    }
  }

  /** プレス結果・離脱時に呼ぶ。ライザーと心音を止め、BGM 音量を戻す。 */
  stopFinalThunderTension(restoreBgm = true): void {
    try {
      if (this.tensionRaf !== null) {
        cancelAnimationFrame(this.tensionRaf);
        this.tensionRaf = null;
      }
      this.stopFinalThunderRiser();
      this.stopHeartbeat();
      if (this.heartbeat) this.heartbeat.playbackRate = 1;
      this.tensionDurationMs = 0;
      if (restoreBgm) this.restoreGameBgmVolume();
      else this.bgmDuckRestore = null;
    } catch {
      // ignore
    }
  }

  /** 感電インパクト。既存の electric SE に低い一撃を重ねる。 */
  playFinalThunderImpact(): void {
    try {
      this.play('electric');
      if (!this.unlocked || this.muted) return;
      const context = this.ensureAudioContext();
      if (!context) return;
      const now = context.currentTime;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
      gain.connect(context.destination);
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(92, now);
      oscillator.frequency.exponentialRampToValueAtTime(32, now + 0.7);
      oscillator.connect(gain);
      oscillator.start(now);
      oscillator.stop(now + 0.95);
      oscillator.onended = () => {
        try {
          oscillator.disconnect();
          gain.disconnect();
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore
    }
  }

  /** コール音声に重ねる低いチャイム。 */
  private playFinalThunderStinger(): void {
    if (!this.unlocked || this.muted) return;
    try {
      const context = this.ensureAudioContext();
      if (!context) return;
      const now = context.currentTime;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.09, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
      gain.connect(context.destination);
      for (const frequency of [130.81, 196.0]) {
        const oscillator = context.createOscillator();
        oscillator.type = 'triangle';
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        oscillator.start(now);
        oscillator.stop(now + 1.85);
      }
      window.setTimeout(() => {
        try {
          gain.disconnect();
        } catch {
          // ignore
        }
      }, 2000);
    } catch {
      // ignore
    }
  }

  private tickFinalThunderTension = (): void => {
    this.tensionRaf = null;
    try {
      const profile = finalThunderTensionProfile(
        this.tensionDurationMs,
        performance.now() - this.tensionStartedAt,
      );
      if (this.heartbeat) {
        if (profile.silent) {
          if (!this.heartbeat.paused) this.heartbeat.pause();
        } else {
          this.heartbeat.playbackRate = profile.heartbeatRate;
        }
      }
      if (profile.progress < 1) {
        this.tensionRaf = requestAnimationFrame(this.tickFinalThunderTension);
      }
    } catch {
      this.tensionRaf = null;
    }
  };

  private startFinalThunderRiser(durationMs: number): void {
    if (!this.unlocked || this.muted) return;
    try {
      const context = this.ensureAudioContext();
      if (!context) return;
      const now = context.currentTime;
      const audibleSeconds = Math.max(
        0.2,
        (durationMs - FINAL_THUNDER_TENSION.tailSilenceMs) / 1000,
      );

      const master = context.createGain();
      master.gain.value = 1;
      master.connect(context.destination);

      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + audibleSeconds * 0.9);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + audibleSeconds);
      gain.connect(master);

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 5;
      filter.frequency.setValueAtTime(160, now);
      filter.frequency.exponentialRampToValueAtTime(1800, now + audibleSeconds);
      filter.connect(gain);

      const saw = context.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.setValueAtTime(FINAL_THUNDER_TENSION.riserStartHz, now);
      saw.frequency.exponentialRampToValueAtTime(
        FINAL_THUNDER_TENSION.riserEndHz,
        now + audibleSeconds,
      );
      saw.connect(filter);

      const sub = context.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(FINAL_THUNDER_TENSION.riserStartHz / 2, now);
      sub.frequency.exponentialRampToValueAtTime(
        FINAL_THUNDER_TENSION.riserEndHz / 2,
        now + audibleSeconds,
      );
      sub.connect(gain);

      for (const oscillator of [saw, sub]) {
        oscillator.start(now);
        oscillator.stop(now + audibleSeconds + 0.1);
        oscillator.onended = () => {
          try {
            oscillator.disconnect();
          } catch {
            // ignore
          }
        };
      }

      this.tensionMaster = master;
      this.tensionOscillators = [saw, sub];
    } catch {
      // ignore
    }
  }

  private stopFinalThunderRiser(): void {
    try {
      if (this.audioContext && this.tensionMaster) {
        const now = this.audioContext.currentTime;
        this.tensionMaster.gain.cancelScheduledValues(now);
        this.tensionMaster.gain.setTargetAtTime(0.0001, now, 0.04);
      }
      for (const oscillator of this.tensionOscillators) {
        try {
          oscillator.stop();
        } catch {
          // already stopped
        }
      }
    } catch {
      // ignore
    } finally {
      this.tensionOscillators = [];
      this.tensionMaster = null;
    }
  }

  private duckGameBgm(): void {
    if (!this.gameBgm || this.bgmDuckRestore !== null) return;
    try {
      const current = this.gameBgm.volume;
      this.bgmDuckRestore = current;
      this.gameBgm.volume = Math.min(current, FINAL_THUNDER_TENSION.bgmDuckVolume);
    } catch {
      this.bgmDuckRestore = null;
    }
  }

  private restoreGameBgmVolume(): void {
    if (this.bgmDuckRestore === null) return;
    const restore = this.bgmDuckRestore;
    this.bgmDuckRestore = null;
    if (this.gameBgm) this.gameBgm.volume = restore;
  }

  private ensureAudioContext(): AudioContext | null {
    try {
      const AudioContextClass =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return null;
      this.audioContext ??= new AudioContextClass();
      if (this.audioContext.state === 'suspended') void this.audioContext.resume();
      return this.audioContext;
    } catch {
      return null;
    }
  }

  private playRoundChime(): void {
    if (!this.unlocked || this.muted) return;
    try {
      const context = this.ensureAudioContext();
      if (!context) return;
      const now = context.currentTime;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.07, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
      gain.connect(context.destination);
      for (const [frequency, offset] of [
        [523.25, 0],
        [659.25, 0.08],
        [783.99, 0.16],
      ] as const) {
        const oscillator = context.createOscillator();
        oscillator.type = 'triangle';
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        oscillator.start(now + offset);
        oscillator.stop(now + 1.0);
      }
    } catch {
      // ignore
    }
  }

  stopBgm(fadeMs = 700): void {
    if (!this.bgm) return;
    const element = this.bgm;
    const start = performance.now();
    const initial = element.volume;
    const tick = (): void => {
      const t = Math.min(1, (performance.now() - start) / fadeMs);
      element.volume = initial * (1 - t);
      if (t < 1) requestAnimationFrame(tick);
      else element.pause();
    };
    requestAnimationFrame(tick);
  }

  async playHeartbeat(loop = false, volume = 0.36): Promise<void> {
    if (!this.heartbeat) {
      this.heartbeat = this.audio('heartbeat', ASSETS.bgmHeartbeat, loop, volume);
    }
    if (!this.unlocked || this.muted) return;
    this.heartbeat.loop = loop;
    this.heartbeat.volume = volume;
    try {
      await this.heartbeat.play();
    } catch {
      // ignore
    }
  }

  stopHeartbeat(): void {
    this.heartbeat?.pause();
    if (this.heartbeat) this.heartbeat.currentTime = 0;
  }

  play(key: SoundKey): void {
    if (!this.unlocked || this.muted) return;
    const path =
      key === 'electric' ? ASSETS.seElectric : key === 'chair' ? ASSETS.seChair : ASSETS.seClick;
    const element = this.audio(`se:${key}`, path, false, key === 'electric' ? 0.75 : 0.6);
    element.currentTime = 0;
    void element.play().catch(() => undefined);
  }

  dispose(): void {
    this.stopFinalThunderTension(true);
    this.finalThunderVoice = null;
    this.stopRoundVoice();
    for (const element of this.elements.values()) {
      element.pause();
      element.src = '';
    }
    this.elements.clear();
    this.bgm = null;
    this.heartbeat = null;
    this.gameBgm = null;
    if (this.audioContext) {
      void this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }
  }
}
