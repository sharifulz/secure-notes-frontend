import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { normalizeApiBase, parseInterests, validatePassword, validId, apiErrorMessage } from '../utils.js';

test('API settings accept local/remote bases and reject credential-bearing or executable URLs', () => {
  assert.equal(normalizeApiBase(' http://localhost:4000/api/v1/ '), 'http://localhost:4000/api/v1');
  assert.equal(normalizeApiBase('https://samiulenterprise.com:8787/api/v1'), 'https://samiulenterprise.com:8787/api/v1');
  for (const url of ['javascript:alert(1)', 'file:///api/v1', 'https://user:secret@example.com/api/v1', 'https://example.com/api/v1?token=secret', 'https://example.com/api/v1#secret', 'https://example.com/']) {
    assert.throws(() => normalizeApiBase(url));
  }
});

test('password limits account for UTF-8 bytes, including multibyte passwords', () => {
  assert.equal(validatePassword('A'.repeat(72)), 'A'.repeat(72));
  assert.equal(validatePassword('é'.repeat(36)), 'é'.repeat(36));
  for (const value of ['short', 'A'.repeat(73), 'é'.repeat(37)]) assert.throws(() => validatePassword(value));
});

test('interests are normalized and bounded before sending them to the API', () => {
  assert.deepEqual(parseInterests('Chess, reading, CHESS, , coding'), ['chess', 'reading', 'coding']);
  assert.deepEqual(parseInterests(''), []);
  assert.throws(() => parseInterests('x'.repeat(51)));
  assert.throws(() => parseInterests(Array.from({ length: 31 }, (_, index) => `interest${index}`).join(',')));
});

test('ID and error handling match API input and field-level validation', () => {
  assert.equal(validId('690000000000000000000001'), true);
  assert.equal(validId('not-an-id'), false);
  assert.match(apiErrorMessage({ message: 'Validation failed', errors: [{ path: 'password', message: 'Too short' }] }, 400), /password: Too short/);
  assert.equal(apiErrorMessage({}, 500), 'Request failed (500).');
});

test('static server serves modules but blocks private and arbitrary filesystem paths', { timeout: 20000 }, async () => {
  const portProbe = createServer();
  portProbe.listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'exit');
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Frontend server did not start')), 8000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Frontend server exited before startup')); });
      child.stdout.on('data', chunk => {
        if (chunk.toString().includes('Secure Notes frontend:')) { clearTimeout(timer); resolve(); }
      });
    });
    const base = `http://127.0.0.1:${port}`;
    const html = await fetch(base);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-security-policy'), /object-src 'none'/);
    assert.match(await html.text(), /Secure Notes/);
    for (const path of ['/app.js', '/utils.js', '/styles.css']) assert.equal((await fetch(base + path)).status, 200);
    for (const path of ['/.env', '/package.json', '/server.mjs', '/tests/frontend.test.mjs', '/%2e%2e/README.md']) assert.equal((await fetch(base + path)).status, 404);
    assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
    const head = await fetch(base + '/', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  } finally { child.kill(); await closed; }
});
