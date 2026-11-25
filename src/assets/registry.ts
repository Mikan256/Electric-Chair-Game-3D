/**
 * Logical asset map. Files are copied from the legacy Unity project by
 * `pnpm assets:sync`; see public/assets/CREDITS.txt.
 */

export const GAME_ID = 'denki-isu-3d';

export const CHAIR_MODELS = Array.from(
  { length: 12 },
  (_, index) => `models/chair-${String(index + 1).padStart(2, '0')}.data`,
);

export const ASSETS = {
  pedestal: 'models/pedestal.data',
  avatar: 'models/avatar.data',
  clock: 'textures/clock.png',
  logo: 'textures/logo.png',
  logoEn: 'textures/logo-en.png',
  emblem: 'textures/emblem.png',
  studioLogo: 'textures/studio-logo.png',
  mikan: 'textures/mikan.png',
  lightningBolt: 'textures/lightning/bolt.png',
  lightningSheet: 'textures/lightning/sheet-1.png',
  uiWindow: 'textures/ui/window.png',
  uiButton: 'textures/ui/button.png',
  videoFinalThunder: 'video/final-thunder.mp4',
  videoLightning: 'video/lightning.mp4',
  bgmTitle: 'audio/bgm/title.mp3',
  bgmGame: 'audio/bgm/innovation.mp3',
  bgmHeartbeat: 'audio/bgm/heartbeat.mp3',
  seElectric: 'audio/se/electric.mp3',
  seChair: 'audio/se/chair.mp3',
  seClick: 'audio/se/click.mp3',
  voiceFinalThunder: 'audio/voice/final-thunder.mp3',
} as const;

/** ラウンドコール音声（Piper TTS で生成、最大ターン数ぶん）。 */
export const ROUND_VOICE = Array.from(
  { length: 8 },
  (_, index) => `audio/voice/round-${index + 1}.mp3`,
);

export function roundVoiceUrl(round: number): string {
  const index = Math.min(ROUND_VOICE.length, Math.max(1, Math.round(round))) - 1;
  return assetUrl(ROUND_VOICE[index] ?? ROUND_VOICE[0]!);
}

/**
 * Resolve a public asset against the document base so the build works under
 * any sandbox path (Flaxia serves games from a generated origin).
 */
export function assetUrl(path: string): string {
  return new URL(`./assets/${path}`, document.baseURI).href;
}

export function chairModelUrl(chair: number): string {
  return assetUrl(CHAIR_MODELS[chair - 1] ?? CHAIR_MODELS[0]!);
}
