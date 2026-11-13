import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/utils.js', ['utils.js', 'text/javascript; charset=utf-8']],
]);
const root = new URL('./', import.meta.url);
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src http: https:; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }); res.end('Method not allowed'); return;
  }
  let entry;
  try { entry = files.get(new URL(req.url, 'http://localhost').pathname); } catch { /* Return 404. */ }
  if (!entry) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const data = await readFile(fileURLToPath(new URL(entry[0], root)));
    res.writeHead(200, { 'Content-Type': entry[1], 'Content-Length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(500); res.end('Could not read frontend file');
  }
});
server.on('error', error => { console.error(`Frontend server failed: ${error.code || error.name}. Check whether port ${port} is already in use.`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Secure Notes frontend: http://localhost:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); });
