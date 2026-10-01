// Serve the production build under a project subpath, as GitHub Pages does.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve('dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain' };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') { res.writeHead(302, { Location: '/M.E./' }); res.end(); return; }
    if (!url.pathname.startsWith('/M.E./')) throw new Error('Not found');
    const relative = decodeURIComponent(url.pathname.slice(6)) || 'index.html';
    const path = resolve(root, relative);
    if (!path.startsWith(root + '/')) throw new Error('Not found');
    const content = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Production preview: http://127.0.0.1:4173/M.E./'));
