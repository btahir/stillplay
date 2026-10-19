import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = Number(portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || 4179);
const hostIndex = args.indexOf('--host');
const host = hostIndex >= 0 ? args[hostIndex + 1] : '127.0.0.1';
const root = args.includes('--dist') ? resolve(project, 'dist') : project;
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.c': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'audio/webm', '.m4a': 'audio/mp4' };
const publicPaths = new Set(['index.html', 'favicon.svg', 'robots.txt', 'manifest.webmanifest']);
async function fileFor(pathname) {
  if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').includes('..')) return null;
  let relative = pathname.replace(/^\/+/, '');
  const route = !extname(relative);
  if (!args.includes('--dist') && !route && !publicPaths.has(relative) && !['src/', 'cores/', 'scoreboard/'].some((prefix) => relative.startsWith(prefix))) relative = `public/${relative}`;
  let path = resolve(root, relative);
  if (path !== root && !path.startsWith(root + sep)) return null;
  try {
    const info = await stat(path);
    if (info.isDirectory()) path = resolve(path, 'index.html');
    if (existsSync(path)) return path;
  } catch { /* Try the static route below. */ }
  if (route) return resolve(root, 'index.html');
  return null;
}
export const server = createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const path = await fileFor(decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!path) { res.writeHead(404); res.end('Not found'); return; }
    let content = path;
    const accepted = req.headers['accept-encoding'] || '';
    const headers = { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' };
    if (accepted.includes('br') && existsSync(`${path}.br`)) { content += '.br'; headers['Content-Encoding'] = 'br'; }
    else if (accepted.includes('gzip') && existsSync(`${path}.gz`)) { content += '.gz'; headers['Content-Encoding'] = 'gzip'; }
    if (content !== path) headers.Vary = 'Accept-Encoding';
    const body = await readFile(content);
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 400);
    res.end('Not found');
  }
});
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  server.listen(port, host, () => console.log(`Stillplay ${args.includes('--dist') ? 'preview' : 'dev'}: http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
