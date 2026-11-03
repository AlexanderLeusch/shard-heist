// The page and the repository: wiring between files, pinned and integrity-checked libraries, no secrets, safe dev server
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const Core = require('../src/core.js');
const { createServer, resolvePath, ROOT } = require('../scripts/serve.js');

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('index.html');
const game = read('src/game.js');
const scripts = [...html.matchAll(/<script\b([^>]*)><\/script>/g)].map(m => m[1]);

test('every element the game looks up by id exists in index.html', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const wanted = [...game.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]);
  assert.ok(wanted.length > 20);
  // ids created at runtime inside menu cards
  const runtime = new Set(['vehDetail']);
  for (const id of new Set(wanted)) assert.ok(ids.has(id) || runtime.has(id), `#${id} is missing from index.html`);
});

test('every data-action on a card is a known action', () => {
  const actions = new Set([...game.matchAll(/data-action="([a-z-]+)"/g)].map(m => m[1]));
  // the pause card writes the action with a template
  actions.add('again'); actions.add('retry-act');
  for (const a of actions){
    const somewhere = ['menu', 'pause', 'done', 'over'].some(state => Core.actionAllowed(a, { state, story: Core.newStory() }));
    assert.ok(somewhere, `${a} is never allowed, so its button would be dead`);
  }
});

test('scripts load in the right order: error screen, libraries, rules, game', () => {
  const srcs = scripts.map(a => a.match(/src="([^"]+)"/)[1]);
  assert.equal(srcs[0], 'src/boot.js');
  assert.equal(srcs.at(-2), 'src/core.js');
  assert.equal(srcs.at(-1), 'src/game.js');
  assert.ok(srcs.slice(1, -2).every(s => s.startsWith('https://')));
  assert.ok(!/<script>\s*\S/.test(html), 'no inline scripts, so the CSP can forbid them');
  for (const f of srcs.filter(s => !s.startsWith('http'))) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
});

test('every external library is pinned to one exact version and checked with an SRI hash', () => {
  const ext = scripts.filter(a => /src="https:/.test(a));
  assert.equal(ext.length, 9);
  for (const a of ext){
    const src = a.match(/src="([^"]+)"/)[1];
    assert.match(src, /\/(r128|three@0\.128\.0)\//, `${src} must name the exact version`);
    assert.match(a, /integrity="sha384-[A-Za-z0-9+/]{64}"/, `${src} needs an integrity hash`);
    assert.match(a, /crossorigin="anonymous"/, `${src} needs crossorigin for SRI`);
    assert.ok(['cdnjs.cloudflare.com', 'cdn.jsdelivr.net'].includes(new URL(src).host));
  }
});

test('the Content Security Policy only allows this site and the two CDNs to run scripts', () => {
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const dir = Object.fromEntries(csp.split(';').map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(dir['script-src'], ["'self'", 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net']);
  assert.deepEqual(dir['object-src'], ["'none'"]);
  assert.deepEqual(dir['base-uri'], ["'none'"]);
  assert.ok(!csp.includes("'unsafe-eval'"));
});

test('no credentials or secrets anywhere in the repository', () => {
  const patterns = [/AKIA[0-9A-Z]{16}/, /gh[pousr]_[A-Za-z0-9]{30,}/, /sk-[A-Za-z0-9]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]/i];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.name.startsWith('.git') || e.name === 'node_modules' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const files = walk(ROOT).filter(f => /\.(js|html|css|json|md|yml|yaml)$/.test(f));
  assert.ok(files.length >= 8);
  for (const f of files){
    const text = fs.readFileSync(f, 'utf8');
    for (const p of patterns) assert.ok(!p.test(text), `${path.relative(ROOT, f)} matches ${p}`);
  }
});

test('the project has no npm dependencies to keep up to date', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});

test('error messages are written as text, never as HTML', () => {
  const boot = read('src/boot.js');
  assert.ok(boot.includes("$('fatalText').textContent = text"));
  assert.ok(!/innerHTML/.test(boot));
});

test('dev server: serves the game files and refuses paths outside the project', () => {
  assert.equal(resolvePath('/'), path.join(ROOT, 'index.html'));
  assert.equal(resolvePath('/src/core.js?v=2'), path.join(ROOT, 'src', 'core.js'));
  for (const hidden of ['/.git/config', '/.github/workflows/ci.yml', '/src/../.git/HEAD', '/%2e%2e/.git/config', '/....//index.html']) assert.equal(resolvePath(hidden), 403, hidden);
  // climbing out with ../ (plain, URL-encoded or with backslashes) is clamped to the project folder
  for (const p of ['/../../etc/passwd.html', '/%2e%2e/%2e%2e/secret.html', '/..%5c..%5cwindows.html']){
    const r = resolvePath(p);
    assert.ok(typeof r === 'string' && r.startsWith(ROOT + path.sep), `${p} -> ${r}`);
  }
  assert.equal(resolvePath('/%E0%A4%A'), 400, 'broken URL encoding');
  assert.equal(resolvePath('/index.html%00.js'), 400, 'null byte');
  assert.equal(resolvePath('/package-lock.exe'), 404, 'unknown file type');
});

test('dev server: answers over HTTP with the right status codes', async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;
  const get = (p, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method }, res => { res.resume(); res.on('end', () => resolve(res)); });
    req.on('error', reject); req.end();
  });
  try {
    const ok = await get('/');
    assert.equal(ok.statusCode, 200);
    assert.match(ok.headers['content-type'], /text\/html/);
    assert.equal(ok.headers['x-content-type-options'], 'nosniff');
    assert.equal((await get('/src/game.js')).statusCode, 200);
    assert.equal((await get('/missing.js')).statusCode, 404);
    assert.equal((await get('/.git/config')).statusCode, 403);
    assert.equal((await get('/', 'POST')).statusCode, 405);
    assert.equal((await get('/', 'DELETE')).statusCode, 405);
  } finally { server.close(); }
});
