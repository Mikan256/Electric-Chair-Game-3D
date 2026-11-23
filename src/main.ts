import './ui/styles.css';
import { assetUrl } from '@/assets/registry';
import { App } from './app';

function injectFont(): void {
  const style = document.createElement('style');
  style.textContent = `@font-face {
    font-family: 'Zekton';
    src: url('${assetUrl('fonts/zekton.ttf')}') format('truetype');
    font-display: swap;
  }`;
  document.head.append(style);
}

function showFatal(message: string): void {
  const root = document.querySelector<HTMLElement>('#ui');
  if (!root) return;
  root.innerHTML = `
    <div class="screen">
      <div class="panel">
        <h2>起動できませんでした</h2>
        <p>${message}</p>
        <p class="muted">WebGL が有効なブラウザで再読み込みしてください。</p>
      </div>
    </div>
  `;
}

async function main(): Promise<void> {
  injectFont();
  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  const uiRoot = document.querySelector<HTMLElement>('#ui');
  if (!canvas || !uiRoot) {
    showFatal('HTML の初期化に失敗しました。');
    return;
  }

  try {
    const app = new App(canvas, uiRoot);
    await app.init();
    // Expose a tiny debug handle for e2e/visual checks; harmless in production.
    (window as unknown as { __denkiIsu?: App }).__denkiIsu = app;
  } catch (error) {
    console.error(error);
    showFatal(error instanceof Error ? error.message : String(error));
  }
}

void main();
