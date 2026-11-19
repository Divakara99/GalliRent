#!/usr/bin/env node
/**
 * Static file server for the GalliRent design preview (docs/preview).
 *
 * The preview ships as a single self-contained HTML file with every photo
 * embedded, so the live preview renders from ONE request even if a proxy
 * refuses to forward sibling asset requests. Everything is gzip-compressed
 * when the client accepts it.
 *
 *   node scripts/preview-server.mjs            # http://0.0.0.0:4173
 *   PORT=8080 node scripts/preview-server.mjs
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(process.cwd(), 'docs/preview');
const INDEX = join(ROOT, 'index.html');
const STANDALONE = join(ROOT, 'gallirent-preview.html');
const HOME = existsSync(STANDALONE) ? STANDALONE : INDEX;
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt']);

/** mtime-keyed cache: { raw, gzip } so we compress once per file version. */
const cache = new Map();

async function loadFile(path) {
  const info = await stat(path);
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === info.mtimeMs) return { ...hit, ext: extname(path).toLowerCase() };

  const raw = await readFile(path);
  const ext = extname(path).toLowerCase();
  const entry = {
    mtimeMs: info.mtimeMs,
    raw,
    gzip: COMPRESSIBLE.has(ext) && raw.length > 512 ? gzipSync(raw, { level: 6 }) : null,
  };
  cache.set(path, entry);
  return { ...entry, ext };
}

function write(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(res.req?.method === 'HEAD' ? undefined : body);
}

async function sendAsset(req, res, file) {
  const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  const entry = await loadFile(file);
  const useGzip = Boolean(entry.gzip) && acceptsGzip;
  const body = useGzip ? entry.gzip : entry.raw;

  write(res, 200, {
    'Content-Type': MIME[entry.ext] || 'application/octet-stream',
    'Content-Length': body.byteLength,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(entry.gzip ? { Vary: 'Accept-Encoding' } : {}),
    ...(useGzip ? { 'Content-Encoding': 'gzip' } : {}),
  }, body);
}

function safePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent((urlPath || '/').split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  const target = normalize(join(ROOT, decoded === '/' ? '/index.html' : decoded));
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return null;
  return target;
}

const server = createServer(async (req, res) => {
  const method = req.method || 'GET';

  // Liveness probes and any CORS preflight should succeed rather than 405.
  if (method === 'OPTIONS') {
    write(res, 204, { Allow: 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' });
    return;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    write(res, 405, { Allow: 'GET, HEAD, OPTIONS', 'Content-Type': 'text/plain; charset=utf-8' }, 'Method Not Allowed');
    return;
  }

  if (req.url === '/healthz') {
    write(res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      JSON.stringify({ ok: true, root: ROOT, home: HOME, port: PORT }));
    return;
  }

  const filePath = safePath(req.url);
  if (!filePath) {
    write(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    let resolved = info.isDirectory() ? join(filePath, 'index.html') : filePath;
    if (resolved === INDEX) resolved = HOME;
    await sendAsset(req, res, resolved);
    return;
  } catch {
    // Extensionless in-page paths (/browse, /#admin) serve the home page;
    // anything with a file extension is a genuine 404.
    if (extname(filePath) === '') {
      try {
        await sendAsset(req, res, HOME);
        return;
      } catch {
        /* fall through */
      }
    }
  }

  write(res, 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    '<!doctype html><meta charset="utf-8"><h1>404</h1><p>Not found. Open <a href="/">the GalliRent UI preview</a>.</p>');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other process or run: PORT=4174 node scripts/preview-server.mjs`);
    process.exit(1);
  }
  console.error('Preview server error:', error);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`GalliRent UI preview → http://${HOST}:${PORT}`);
  console.log(`Serving ${ROOT}`);
  console.log(`Home page: ${HOME}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`${signal} received, closing preview server.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
