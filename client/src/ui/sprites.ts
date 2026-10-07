/**
 * Original pixel art, drawn for this game and stored as character grids (see ASSETS.md).
 * Each character picks a palette colour; "." is transparent.
 */

const PALETTE: Record<string, string> = {
  c: '#3cf2ff',
  p: '#ff4fa3',
  y: '#ffd23f',
  w: '#f4f1ff',
  g: '#4cff8f',
  r: '#ff5a5a',
  d: '#17153b',
  m: '#8a86c7',
};

const SPRITES = {
  mic: [
    '....wwww....',
    '...wccccw...',
    '...wcwccw...',
    '...wccccw...',
    '...wcwccw...',
    '.m.wccccw.m.',
    '.m.wccccw.m.',
    '.m..wwww..m.',
    '..m......m..',
    '...mmmmmm...',
    '.....mm.....',
    '...mmmmmm...',
  ],
  speaker: [
    '......w.....',
    '.....ww..p..',
    '....wyw...p.',
    'wwwwyyw.p.p.',
    'wyyyyyw..pp.',
    'wyyyyyw..pp.',
    'wyyyyyw..pp.',
    'wwwwyyw.p.p.',
    '....wyw...p.',
    '.....ww..p..',
    '......w.....',
    '............',
  ],
  check: [
    '............',
    '..........gg',
    '.........ggg',
    '........ggg.',
    '.......ggg..',
    'gg....ggg...',
    'ggg..ggg....',
    '.ggggggg....',
    '..ggggg.....',
    '...ggg......',
    '....g.......',
    '............',
  ],
  cross: [
    '............',
    '.rr......rr.',
    '.rrr....rrr.',
    '..rrr..rrr..',
    '...rrrrrr...',
    '....rrrr....',
    '....rrrr....',
    '...rrrrrr...',
    '..rrr..rrr..',
    '.rrr....rrr.',
    '.rr......rr.',
    '............',
  ],
  clock: [
    '.wwwwwwwwww.',
    '.wyyyyyyyyw.',
    '..wyyyyyyw..',
    '...wyyyyw...',
    '....wyyw....',
    '.....ww.....',
    '.....ww.....',
    '....w..w....',
    '...w.yy.w...',
    '..w.yyyy.w..',
    '.wyyyyyyyyw.',
    '.wwwwwwwwww.',
  ],
  dots: [
    '............',
    '............',
    '............',
    '............',
    '.cc..cc..cc.',
    '.cc..cc..cc.',
    '............',
    '............',
    '............',
    '............',
    '............',
    '............',
  ],
  trophy: [
    '..yyyyyyyy..',
    'yyyyyyyyyyyy',
    'y.yyywyyyy.y',
    'y.yyywyyyy.y',
    '.yyyywyyyyy.',
    '..yyyyyyyy..',
    '...yyyyyy...',
    '....yyyy....',
    '.....yy.....',
    '.....yy.....',
    '...yyyyyy...',
    '..yyyyyyyy..',
  ],
  plug: [
    '...w....w...',
    '...w....w...',
    '...w....w...',
    '.mmmmmmmmmm.',
    '.mccccccccm.',
    '.mccccccccm.',
    '.mccccccccm.',
    '..mccccccm..',
    '...mmmmmm...',
    '.....mm.....',
    '.....mm..r..',
    '.....mmmr.r.',
  ],
} as const;

export type SpriteName = keyof typeof SPRITES;

/** A decorative canvas showing one sprite; CSS scales it up with crisp pixels. */
export function sprite(name: SpriteName, className = ''): HTMLCanvasElement {
  const rows = SPRITES[name];
  const canvas = document.createElement('canvas');
  canvas.width = rows[0].length;
  canvas.height = rows.length;
  canvas.className = `sprite ${className}`.trim();
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (ctx) {
    rows.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        const colour = PALETTE[ch];
        if (!colour) return;
        ctx.fillStyle = colour;
        ctx.fillRect(x, y, 1, 1);
      });
    });
  }
  return canvas;
}
