// Fails the build if dist/ contains anything the production CSP would block, or anything that
// should never ship: inline scripts or styles, eval, data: URLs for code or fonts, third-party
// origins other than Turnstile, or the mock server. Run after `npm run build`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const ALLOWED_ORIGINS = new Set(['https://challenges.cloudflare.com']);
// Namespace URIs and the like are identifiers, not network requests.
const HARMLESS_URLS = [/^https?:\/\/www\.w3\.org\//];
// The app shell (HTML, JS, CSS, font, icons) is what a first visit must download: keep it small.
// Painted art and music load as they are needed and get their own caps.
const MAX_SHELL_BYTES = 400 * 1024;
const MEDIA = /^assets\/.+\.(png|mp3)$/;
const MAX_IMAGE_BYTES = 80 * 1024;
const MAX_TRACK_BYTES = 1300 * 1024;
const MAX_MEDIA_BYTES = 9 * 1024 * 1024;

const problems = [];
let total = 0;
let media = 0;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

for (const path of walk(DIST)) {
  const name = relative(DIST, path).replaceAll('\\', '/');
  const size = statSync(path).size;
  if (MEDIA.test(name)) {
    media += size;
    const cap = name.endsWith('.mp3') ? MAX_TRACK_BYTES : MAX_IMAGE_BYTES;
    if (size > cap) problems.push(`${name}: ${Math.round(size / 1024)} KB, over ${cap / 1024} KB`);
    continue;
  }
  total += size;
  if (!/\.(html|js|css|webmanifest)$/.test(name)) continue;
  const text = readFileSync(path, 'utf8');

  if (name.endsWith('.html')) {
    if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(text)) problems.push(`${name}: inline <script>`);
    if (/<style[\s>]/i.test(text)) problems.push(`${name}: inline <style>`);
    if (/\sstyle\s*=/i.test(text)) problems.push(`${name}: style attribute`);
    if (/\son[a-z]+\s*=/i.test(text)) problems.push(`${name}: inline event handler`);
  }
  if (name.endsWith('.js')) {
    if (/\beval\s*\(|new Function\s*\(/.test(text)) problems.push(`${name}: eval or new Function`);
    if (/setAttribute\(\s*["'`]style["'`]/.test(text)) problems.push(`${name}: sets a style attribute`);
    if (/\.innerHTML\s*=|insertAdjacentHTML|document\.write/.test(text)) {
      problems.push(`${name}: writes HTML strings`);
    }
    if (/mock-session-|Mock game server/.test(text)) problems.push(`${name}: mock server code`);
  }
  if (/url\(\s*["']?data:/i.test(text) && name.endsWith('.css')) {
    problems.push(`${name}: data: URL in CSS`);
  }
  for (const [url] of text.matchAll(/https?:\/\/[^\s"'`)\\<>]+/g)) {
    const origin = new URL(url).origin;
    if (ALLOWED_ORIGINS.has(origin) || HARMLESS_URLS.some((ok) => ok.test(url))) continue;
    problems.push(`${name}: reference to ${origin}`);
  }
}

if (total > MAX_SHELL_BYTES) {
  problems.push(`app shell is ${Math.round(total / 1024)} KB, over the ${MAX_SHELL_BYTES / 1024} KB budget`);
}
if (media > MAX_MEDIA_BYTES) {
  problems.push(`media is ${Math.round(media / 1024)} KB, over the ${MAX_MEDIA_BYTES / 1024} KB budget`);
}

if (problems.length > 0) {
  console.error(`dist/ check failed:\n  ${[...new Set(problems)].join('\n  ')}`);
  process.exit(1);
}
console.log(
  `dist/ check passed: app shell ${Math.round(total / 1024)} KB, media ${Math.round(media / 1024)} KB, nothing the CSP would block.`,
);
