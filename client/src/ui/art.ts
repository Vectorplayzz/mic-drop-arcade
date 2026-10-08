/**
 * The painted pixel art (scenes, wizards, heroes) from `src/assets/art`, generated for this game
 * in AICade Studio; prompts, seeds and licences are in /art/credits.json. Vite fingerprints
 * every file, so the long-lived cache on these URLs is safe across releases.
 */
import type { Hero, Mood, Scene, Wizard } from '../protocol/messages';

const files = import.meta.glob<string>('../assets/art/**/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

function url(path: string): string {
  const found = files[`../assets/art/${path}.png`];
  if (!found) throw new Error(`missing art: ${path}`);
  return found;
}

export const sceneUrl = (scene: Scene): string => url(`backgrounds/${scene}`);
export const wizardUrl = (wizard: Wizard, mood: Mood): string => url(`sprites/wizard/${wizard}/${mood}`);
export const heroUrl = (hero: Hero): string => url(`sprites/heroes/${hero}`);

/** Hero ids are lower-case; on screen they're names. */
export const heroName = (hero: Hero): string => hero.charAt(0).toUpperCase() + hero.slice(1);

/** A decorative pixel-art image (alt text comes from the surrounding label). */
export function artImage(src: string, className: string, alt = ''): HTMLImageElement {
  const img = document.createElement('img');
  img.className = className;
  img.src = src;
  img.alt = alt;
  img.decoding = 'async';
  img.draggable = false;
  if (!alt) img.setAttribute('aria-hidden', 'true');
  return img;
}

/** Warm the cache so mood swaps never flash an empty frame mid-game. */
export function preload(urls: string[]): void {
  for (const src of urls) {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  }
}
