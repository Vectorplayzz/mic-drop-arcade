import type { Hero } from '../protocol/messages';
import { heroUrl } from '../ui/art';

/**
 * The shareable score card: drawn on a canvas in the browser and exported as a PNG. Nothing is
 * uploaded; the image goes straight to the share sheet or the downloads folder.
 */

export interface ScoreCard {
  correct: number;
  questions: number;
  score: number;
  maxScore: number;
  /** "I scored 8/10 in Telugu, beat me", already in the player's language. */
  line: string;
  packTitle: string;
  url: string;
  /** The player's hero, drawn big on the card. */
  hero: Hero;
}

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
    return img;
  } catch {
    return null; // The card still works without the sprite.
  }
}

const W = 1080;
const H = 1350;
const PIXEL_FONT = '"Press Start 2P", monospace';
const TEXT_FONT = 'system-ui, "Noto Sans", "Noto Sans Telugu", "Noto Sans Devanagari", sans-serif';
const INK = '#0b0a1f';
const PANEL = '#17153b';
const CYAN = '#3cf2ff';
const PINK = '#ff4fa3';
const YELLOW = '#ffd23f';
const WHITE = '#f4f1ff';

/** Breaks `text` into lines no wider than `maxWidth`, using the context's current font. */
export function wrapLines(
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(candidate) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function pixelFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const t = 12;
  ctx.fillStyle = INK;
  ctx.fillRect(x - t, y - t, w + 2 * t, h + 2 * t);
  ctx.fillStyle = CYAN;
  ctx.fillRect(x - t, y, t, h);
  ctx.fillRect(x + w, y, t, h);
  ctx.fillRect(x, y - t, w, t);
  ctx.fillRect(x, y + h, w, t);
  ctx.fillStyle = PANEL;
  ctx.fillRect(x, y, w, h);
}

export async function drawScoreCard(canvas: HTMLCanvasElement, card: ScoreCard): Promise<void> {
  // Canvas text falls back silently if the pixel font hasn't loaded yet.
  await document.fonts.load(`48px ${PIXEL_FONT}`).catch(() => undefined);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');

  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  // Star field: fixed pseudo-random pixels, so the card looks the same every time.
  let seed = 7;
  for (let i = 0; i < 140; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const x = seed % W;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const y = seed % H;
    ctx.fillStyle = i % 9 === 0 ? PINK : i % 5 === 0 ? CYAN : '#5b5a8a';
    ctx.fillRect(x - (x % 6), y - (y % 6), 6, 6);
  }

  pixelFrame(ctx, 72, 72, W - 144, H - 144);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = PINK;
  ctx.font = `60px ${PIXEL_FONT}`;
  ctx.fillText('MIC DROP', W / 2, 200);
  ctx.fillStyle = CYAN;
  ctx.fillText('ARCADE', W / 2, 284);

  // The hero at a whole-number scale (128 px → 384 px) keeps every pixel square.
  const hero = await loadImage(heroUrl(card.hero));
  if (hero) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(hero, (W - 384) / 2, 300, 384, 384);
  }

  ctx.fillStyle = YELLOW;
  ctx.font = `160px ${PIXEL_FONT}`;
  const tally = `${card.correct}/${card.questions}`;
  const scale = Math.min(1, (W - 260) / ctx.measureText(tally).width);
  ctx.font = `${Math.floor(160 * scale)}px ${PIXEL_FONT}`;
  ctx.fillText(tally, W / 2, 850);

  ctx.fillStyle = WHITE;
  ctx.font = `40px ${PIXEL_FONT}`;
  ctx.fillText(`${card.score} PTS`, W / 2, 930);

  ctx.font = `600 48px ${TEXT_FONT}`;
  const lines = wrapLines((t) => ctx.measureText(t).width, card.line, W - 280).slice(0, 3);
  lines.forEach((line, i) => ctx.fillText(line, W / 2, 1020 + i * 62));

  ctx.fillStyle = '#a9a6d6';
  ctx.font = `36px ${TEXT_FONT}`;
  const title = wrapLines((t) => ctx.measureText(t).width, card.packTitle, W - 280)[0] ?? '';
  ctx.fillText(title, W / 2, 1200);

  ctx.fillStyle = CYAN;
  ctx.font = `28px ${PIXEL_FONT}`;
  ctx.fillText(card.url.replace(/^https?:\/\//, ''), W / 2, 1250);
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('png failed'))), 'image/png');
  });
}

/**
 * Opens the share sheet with the PNG where the browser can share files, and downloads the PNG
 * everywhere else. Resolves to what happened; a dismissed share sheet counts as shared.
 */
export async function shareScoreCard(card: ScoreCard): Promise<'shared' | 'downloaded'> {
  const canvas = document.createElement('canvas');
  await drawScoreCard(canvas, card);
  const blob = await toBlob(canvas);
  const file = new File([blob], 'mic-drop-arcade-score.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: `${card.line} ${card.url}` });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
      // The share sheet failed for another reason: fall through to a download.
    }
  }
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return 'downloaded';
}
