/// <reference types="vite/client" />

// Debug surface exposed by src/main.ts and src/scene/stage.ts for Playwright smoke tests.
import type { App } from './app';
import type { Theater } from './scene/stage';

declare global {
  interface Window {
    __denkiIsu?: App;
    __stage?: Theater;
  }
}

export {};
