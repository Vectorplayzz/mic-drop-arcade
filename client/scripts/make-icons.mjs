// Draws the app icons from the pixel grid below and writes them to public/icons.
// The art is original to this project (see ASSETS.md). Run with: npm run icons
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const PALETTE = {
  '.': [0x0b, 0x0a, 0x1f],
  d: [0x17, 0x15, 0x3b],
  c: [0x3c, 0xf2, 0xff],
  p: [0xff, 0x4f, 0xa3],
  y: [0xff, 0xd2, 0x3f],
  w: [0xf4, 0xf1, 0xff],
  m: [0x8a, 0x86, 0xc7],
};

// A microphone with sound waves on an arcade-cabinet panel, 16 x 16.
const ART = [
  'pppppppppppppppp',
  'pddddddddddddddp',
  'pdddddwwwwdddddp',
  'pddddwccccwddddp',
  'pdyddwcwccwddydp',
  'pddydwccccwdyddp',
  'pdyddwcwccwddydp',
  'pddydwccccwdyddp',
  'pdyddwccccwddydp',
  'pdddmdwwwwdmdddp',
  'pddddmddddmddddp',
  'pdddddmmmmdddddp',
  'pdddddddmddddddp',
  'pdddddmmmmmddddp',
  'pddddddddddddddp',
  'pppppppppppppppp',
];

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** `inset` (0..0.5) shrinks the art towards the centre: maskable icons need a safe zone. */
function png(size, inset = 0) {
  const background = PALETTE['.'];
  const margin = Math.round(size * inset);
  const cell = (size - 2 * margin) / ART.length;
  const row = 1 + size * 3;
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - margin) / cell);
      const gy = Math.floor((y - margin) / cell);
      const colour = PALETTE[ART[gy]?.[gx]] ?? background;
      raw.set(colour, y * row + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const [name, size, inset] of [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['icon-maskable-512.png', 512, 0.125],
  ['apple-touch-icon.png', 180, 0],
]) {
  writeFileSync(new URL(name, out), png(size, inset));
  console.log(`wrote public/icons/${name}`);
}
