/// <reference types="vite/client" />

// Debug surface exposed by src/main.ts for Playwright smoke tests.
import type { App } from './app';

declare global {
  interface Window {
    __denkiIsu?: App;
  }
}

export {};
