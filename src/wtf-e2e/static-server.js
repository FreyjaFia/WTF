// Serves a built Angular app (the "e2e" build) with the single-page-app fallback, for the browser tests.
//   node static-server.js <folder> <port>
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3]);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.webmanifest': 'application/manifest+json',
};
const compressible = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.svg']);
const cache = new Map();

function load(file) {
  if (!cache.has(file)) {
    const body = fs.readFileSync(file);
    cache.set(file, { body, gzip: zlib.gzipSync(body, { level: 1 }) });
  }
  return cache.get(file);
}

http
  .createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = path.join(root, pathname);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(root, 'index.html');
    }

    const ext = path.extname(file);
    const { body, gzip } = load(file);
    const useGzip = compressible.has(ext) && /\bgzip\b/.test(request.headers['accept-encoding'] ?? '');
    response.writeHead(200, {
      'Content-Type': types[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      ...(useGzip ? { 'Content-Encoding': 'gzip' } : {}),
    });
    response.end(useGzip ? gzip : body);
  })
  .listen(port, () => console.log(`Serving ${root} on ${port}`));
