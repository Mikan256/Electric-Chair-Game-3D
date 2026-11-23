import { assetUrl, ASSETS } from '@/assets/registry';

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
  private muted = false;
  private unlocked = false;

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
    for (const element of this.elements.values()) {
      element.pause();
      element.src = '';
    }
    this.elements.clear();
    this.bgm = null;
    this.heartbeat = null;
  }
}
