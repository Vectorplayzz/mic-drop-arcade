import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import type { Connect, Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { attachMock } from './dev/mock.ts';

const API_TARGET = process.env.MAATA_API ?? 'http://127.0.0.1:8000';

/**
 * The CSP that nginx sends in production (deploy/nginx/maata-security-headers.conf), with the
 * socket origin swapped for localhost. `vite preview` serves the built files under it, so a
 * build that would be blocked in production is blocked here first.
 */
const PREVIEW_CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  'frame-src https://challenges.cloudflare.com',
  "connect-src 'self' ws://localhost:4173 ws://127.0.0.1:4173",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "style-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const productionHeaders: Connect.NextHandleFunction = (_req, res, next) => {
  res.setHeader('Content-Security-Policy', PREVIEW_CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'microphone=(self), camera=(), geolocation=(), payment=(), usb=()',
  );
  next();
};

function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory()
      ? listFiles(path, base)
      : [relative(base, path).split(sep).join(posix.sep)];
  });
}

/** Fills the service worker's precache list and version once the bundle's file names exist. */
function serviceWorkerManifest(): Plugin {
  return {
    name: 'maata:sw-manifest',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const worker = bundle['sw.js'];
      if (!worker || worker.type !== 'chunk') throw new Error('sw.js missing from the bundle');
      const hash = createHash('sha256');
      const urls = ['/index.html'];
      for (const [name, file] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        if (name === 'sw.js' || name.endsWith('.map')) continue;
        hash.update(name).update(file.type === 'chunk' ? file.code : file.source);
        if (name !== 'index.html') urls.push(`/${name}`);
      }
      for (const name of listFiles('public').sort()) {
        hash.update(name);
        urls.push(`/${name}`);
      }
      const fill = (placeholder: string, value: string): void => {
        const pattern = new RegExp(`(["'\`])${placeholder}\\1`);
        if (!pattern.test(worker.code)) throw new Error(`${placeholder} not found in sw.js`);
        worker.code = worker.code.replace(pattern, () => JSON.stringify(value));
      };
      fill('__MAATA_SW_VERSION__', hash.digest('hex').slice(0, 16));
      fill('__MAATA_SW_PRECACHE__', JSON.stringify(urls));
    },
  };
}

/** `--mode mock` serves a stand-in for the game server, so the client runs with no backend. */
function mockServer(enabled: boolean): Plugin {
  return {
    name: 'maata:mock-server',
    configureServer(server) {
      if (enabled && server.httpServer) attachMock(server.middlewares, server.httpServer);
    },
    configurePreviewServer(server) {
      server.middlewares.use(productionHeaders);
      if (enabled) attachMock(server.middlewares, server.httpServer);
    },
  };
}

export default defineConfig(({ mode }) => {
  const mock = mode === 'mock';
  const proxy = mock
    ? undefined
    : {
        // Same origin as in production: the browser only ever talks to this dev server.
        '/api': { target: API_TARGET },
        '/ws': { target: API_TARGET, ws: true },
      };
  return {
    plugins: [serviceWorkerManifest(), mockServer(mock)],
    server: { port: 5173, strictPort: true, proxy },
    preview: { port: 4173, strictPort: true, proxy },
    build: {
      target: 'es2022',
      // The production CSP has no `data:` for fonts or scripts, so nothing may be inlined.
      assetsInlineLimit: 0,
      sourcemap: false,
      rollupOptions: {
        input: { main: 'index.html', sw: 'src/sw.ts' },
        output: {
          entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
        },
      },
    },
    worker: { format: 'iife' },
    test: { include: ['tests/**/*.test.ts'], environment: 'node' },
  };
});
