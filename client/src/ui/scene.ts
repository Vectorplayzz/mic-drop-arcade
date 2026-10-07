/**
 * The full-screen painted background behind every screen. Menus sit on the wizard's library
 * (the scene from the layout reference); a game swaps in its quest's scene. A dark wash keeps
 * menu text readable and lifts during play so the scene shows through.
 */
import type { Scene } from '../protocol/messages';
import { sceneUrl } from './art';

export const MENU_SCENE: Scene = 'library-a';

let img: HTMLImageElement | null = null;
let root: HTMLElement | null = null;

function mount(): void {
  root = document.getElementById('scene');
  if (!root) {
    root = document.createElement('div');
    root.id = 'scene';
    document.body.prepend(root);
  }
  root.setAttribute('aria-hidden', 'true');
  img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  root.replaceChildren(img);
}

export function setScene(scene: Scene, mode: 'menu' | 'game'): void {
  if (!img || !root) mount();
  const src = sceneUrl(scene);
  if (img!.getAttribute('src') !== src) img!.src = src;
  root!.dataset.mode = mode;
}
