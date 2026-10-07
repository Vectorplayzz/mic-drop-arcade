/**
 * The animated arcade backdrop: a drifting star field over a scrolling neon floor grid, drawn
 * at a third of the screen resolution and scaled up with hard pixels. Purely decorative.
 */

const SCALE = 3;
const STAR_COUNT = 70;
const FRAME_MS = 1000 / 30;

interface Star {
  x: number;
  y: number;
  speed: number;
  colour: string;
}

export function startBackdrop(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  let stars: Star[] = [];
  let width = 0;
  let height = 0;
  let last = 0;
  let scroll = 0;
  let raf = 0;

  const resize = (): void => {
    width = Math.max(1, Math.ceil(window.innerWidth / SCALE));
    height = Math.max(1, Math.ceil(window.innerHeight / SCALE));
    canvas.width = width;
    canvas.height = height;
    stars = Array.from({ length: STAR_COUNT }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height * 0.62,
      speed: 0.004 + Math.random() * 0.012,
      colour: i % 11 === 0 ? '#ff4fa3' : i % 7 === 0 ? '#3cf2ff' : i % 2 ? '#5b5a8a' : '#a9a6d6',
    }));
    draw(0);
  };

  const draw = (dt: number): void => {
    ctx.fillStyle = '#0b0a1f';
    ctx.fillRect(0, 0, width, height);
    for (const star of stars) {
      star.x -= star.speed * dt;
      if (star.x < 0) star.x += width;
      ctx.fillStyle = star.colour;
      ctx.fillRect(Math.floor(star.x), Math.floor(star.y), 1, 1);
    }
    // Floor grid with a fake perspective: rows bunch up towards the horizon.
    const horizon = Math.floor(height * 0.66);
    const floor = height - horizon;
    ctx.fillStyle = '#12102e';
    ctx.fillRect(0, horizon, width, floor);
    ctx.fillStyle = '#3a2a7a';
    scroll = (scroll + dt * 0.0006) % 1;
    for (let i = 0; i < 9; i++) {
      const depth = (i + scroll) / 9;
      ctx.fillRect(0, horizon + Math.floor(depth * depth * floor), width, 1);
    }
    const centre = width / 2;
    for (let i = -8; i <= 8; i++) {
      const top = centre + i * (width / 26);
      const bottom = centre + i * (width / 5);
      for (let y = 0; y < floor; y += 1) {
        const x = top + ((bottom - top) * y) / floor;
        if (x >= 0 && x < width) ctx.fillRect(Math.floor(x), horizon + y, 1, 1);
      }
    }
    ctx.fillStyle = '#ff4fa3';
    ctx.fillRect(0, horizon, width, 1);
  };

  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    if (now - last < FRAME_MS) return;
    draw(Math.min(100, now - last));
    last = now;
  };

  const sync = (): void => {
    cancelAnimationFrame(raf);
    if (!still.matches && !document.hidden) raf = requestAnimationFrame(frame);
  };

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', sync);
  still.addEventListener('change', sync);
  resize();
  sync();
}
