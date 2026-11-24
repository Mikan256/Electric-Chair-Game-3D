import { assetUrl, ASSETS, ROUND_VOICE } from '@/assets/registry';

export type SoundKey = 'electric' | 'chair' | 'click';

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
    this.gameBgm.volume = volume;
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

  private playRoundChime(): void {
    if (!this.unlocked || this.muted) return;
    try {
      const AudioContextClass =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      this.audioContext ??= new AudioContextClass();
      const context = this.audioContext;
      if (context.state === 'suspended') void context.resume();
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
