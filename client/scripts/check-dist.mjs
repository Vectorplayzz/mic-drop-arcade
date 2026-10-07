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
const MAX_TOTAL_BYTES = 400 * 1024;

const problems = [];
let total = 0;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

for (const path of walk(DIST)) {
  const name = relative(DIST, path).replaceAll('\\', '/');
  total += statSync(path).size;
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

if (total > MAX_TOTAL_BYTES) {
  problems.push(`dist is ${Math.round(total / 1024)} KB, over the ${MAX_TOTAL_BYTES / 1024} KB budget`);
}

if (problems.length > 0) {
  console.error(`dist/ check failed:\n  ${[...new Set(problems)].join('\n  ')}`);
  process.exit(1);
}
console.log(`dist/ check passed: ${Math.round(total / 1024)} KB total, nothing the CSP would block.`);
