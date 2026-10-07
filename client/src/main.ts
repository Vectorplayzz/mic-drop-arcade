import { App } from './app';
import { MENU_SCENE, setScene } from './ui/scene';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');
setScene(MENU_SCENE, 'menu');

void new App(root).boot();

// The service worker only caches the app shell, so the game opens (and can explain itself)
// without a network. It is skipped in development, where it would fight hot reloading.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Not installable in this browser or context; the game still works online.
    });
  });
}
