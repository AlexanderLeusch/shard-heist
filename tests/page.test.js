// ### Checks on the page and the source: security headers, pinned libraries, and that each feature is wired up in the code.
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
// Tests below read the source text. Comments are removed first: a test must not pass because of a comment.
const uncommented = t => t.replace(/^\s*\/\/.*$/gm, '').replace(/(\s)\/\/ .*$/gm, '$1');
const rawGame = read('src/game.js'), game = uncommented(rawGame);
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
  assert.deepEqual(dir['script-src'], ["'self'", 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/', 'https://cdn.jsdelivr.net/npm/three@0.128.0/']);
  assert.ok(!csp.includes("'unsafe-inline'"), 'no inline scripts or styles');
  assert.deepEqual(dir['object-src'], ["'none'"]);
  assert.deepEqual(dir['base-uri'], ["'none'"]);
  assert.ok(!csp.includes("'unsafe-eval'"));
});

test('no credentials or secrets anywhere in the repository', () => {
  const patterns = [/AKIA[0-9A-Z]{16}/, /gh[pousr]_[A-Za-z0-9]{30,}/, /sk-[A-Za-z0-9]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]/i];
  // Every file git tracks, so local folders such as plot-twist/.venv (installed packages, ignored by git) do not count
  // A downloaded ZIP has no git: then walk the folder and leave out what git would ignore
  const walk = (dir, out = []) => { for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })){ if (/^(\.git|\.venv|node_modules|__pycache__)$/.test(e.name)) continue; const p = path.posix.join(dir, e.name); if (e.isDirectory()) walk(p, out); else out.push(p); } return out; };
  let tracked;
  try { tracked = require('child_process').execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\0').filter(Boolean); } catch (e) { tracked = walk(''); }
  const files = tracked.filter(f => /\.(js|html|css|json|md|yml|yaml|py|toml|txt)$/.test(f)).map(f => path.join(ROOT, f));
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

// ---------- Room 1: the escape-room page ----------
const escHtml = read('escape-room/index.html');
const escRoom = read('escape-room/src/room.js');
const escScripts = [...escHtml.matchAll(/<script\b([^>]*)><\/script>/g)].map(m => m[1]);

test('escape room: scripts load in order, the library is pinned and SRI-checked, no inline scripts', () => {
  const srcs = escScripts.map(a => a.match(/src="([^"]+)"/)[1]);
  assert.deepEqual(srcs, ['src/boot.js', 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'src/rules.js', 'src/room.js']);
  const lib = escScripts[1];
  assert.match(lib, /integrity="sha384-[A-Za-z0-9+/]{64}"/);
  assert.match(lib, /crossorigin="anonymous"/);
  assert.equal(lib.match(/integrity="([^"]+)"/)[1], scripts.find(a => a.includes('three.min.js')).match(/integrity="([^"]+)"/)[1], 'same file, same hash as room 2');
  assert.ok(!/<script>\s*\S/.test(escHtml));
  for (const f of srcs.filter(s => !s.startsWith('http'))) assert.ok(fs.existsSync(path.join(ROOT, 'escape-room', f)), f);
});

test('escape room: the security policy only allows this site and the one CDN to run scripts', () => {
  const csp = escHtml.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const dir = Object.fromEntries(csp.split(';').map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(dir['script-src'], ["'self'", 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/']);
  assert.ok(!csp.includes("'unsafe-inline'"), 'no inline scripts or styles');
  assert.deepEqual(dir['object-src'], ["'none'"]);
  assert.ok(!csp.includes("'unsafe-eval'"));
});

test('escape room: every element the room looks up by id exists in its page', () => {
  const ids = new Set([...escHtml.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const runtime = new Set(['lockUi', 'tries']);
  const wanted = new Set([...escRoom.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]));
  assert.ok(wanted.size > 10);
  for (const id of wanted) assert.ok(ids.has(id) || runtime.has(id), `#${id} is missing from escape-room/index.html`);
});

test('escape room: the two rooms stay separate (no file of one room loads the other)', () => {
  assert.ok(!/\.\.\//.test(escHtml), 'room 1 does not load files from room 2');
  assert.ok(!/escape-room/.test(html), 'room 2 does not load files from room 1');
  assert.ok(!/ShardCore|src\/core\.js/.test(escRoom));
});

test('escape room: texts from the story are inserted as text, not as HTML', () => {
  assert.ok(escRoom.includes("b.querySelector('span').textContent = h.label"));
  assert.ok(/esc\(c\.text\)/.test(escRoom) && /esc\(E\.text\)/.test(escRoom));
});

// ---------- Both rooms: one design system ----------
test('both rooms share one design system: the same tokens and the same fonts', () => {
  const tokens = css => Object.fromEntries([...css.match(/:root\{([\s\S]*?)\}/)[1].matchAll(/--([\w-]+):([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  const a = tokens(read('styles.css')), b = tokens(read('escape-room/styles.css'));
  for (const k of ['bg', 'ink', 'muted', 'glass', 'glass-strong', 'line', 'f-display', 'f-body', 'f-mono']) assert.equal(a[k], b[k], `--${k} differs between the rooms`);
  assert.ok(a.spark && b.orange, 'each room keeps its own accent (cyan in room 2, orange in room 1)');
  const font = h => h.match(/href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/)[1];
  assert.equal(font(html), font(escHtml));
});

test('the story runs on from room 1 into room 2', () => {
  const rules = require('../escape-room/src/rules.js');
  assert.match(rules.ENDINGS.A.text, /car is waiting/, 'room 1 ends with the getaway car');
  assert.match(game, /Cell Block D/, 'room 2 starts after the escape from Cell Block D');
  assert.match(game, /inmate 4471/, 'the police hunt the same inmate');
  assert.match(game, /'hale'/, 'Officer Hale helps over the radio');
});

test('the city is Lisbon: the gate stands under the arch, and the story says so', () => {
  assert.match(game, /gp = \{ x: 0, z: 83 \}/, 'the gate is on Rua Augusta');
  assert.match(game, /arco\(80\)/, 'the arch spans z 80 to 86, around the gate');
  assert.match(game, /hidden in Lisbon’s Baixa/);
  assert.ok(!/downtown/i.test(game), 'no leftover from the old unnamed city');
  assert.match(game, /fleet: 'tram'/, 'trams are part of the traffic');
});

test('the trams have tracks: bed and rails are built on the same loop the trams drive', () => {
  assert.match(game, /strip\(trackBed, 0,/, 'a stone track bed');
  assert.match(game, /strip\(marks, side,/, 'rails on both sides');
  assert.match(game, /if \(n\.tram\) return Core\.tramNext\(/, 'trams only follow the loop');
});

test('the buildings of the city are authentic: closed blocks of low houses and the real landmarks', () => {
  const city = rawGame.slice(rawGame.indexOf('function buildCity()'), rawGame.indexOf('// ---------- City traffic'));
  assert.ok(!/'glass'|'office'|'brick'/.test(city), 'no towers, offices or brick from the old city');
  assert.match(city, /floors = o\.floors \|\| \(pickFloors < 0\.25 \? 3 : pickFloors < 0\.8 \? 4 : 5\)/, 'ground floor plus 3 to 5 floors, as in OpenStreetMap');
  assert.match(city, /rng\(\) >= 0\.12 \? 'pombal'/, 'tiled fronts stay the exception');
  for (const landmark of ['teatro(cx, cz)', 'estacao(cx, cz)', 'torreao(', 'liftTower(cx, cz)', 'arco(80)']) assert.ok(city.includes(landmark), landmark);
});

test('the engines are played from the tested model: loaded and overrun loops per rpm, with no sound files', () => {
  assert.match(game, /Core\.engineLoops\(/);
  assert.match(game, /Core\.gearFor\(/);
  assert.match(game, /Core\.engineTarget\(/);
  assert.doesNotMatch(game, /engineBuffer|GEAR_TOP/, 'the old loops are gone');
  assert.doesNotMatch(game, /\.(mp3|ogg|wav|m4a)\b/, 'no audio files');
});

test('the motorcycle and the truck are modelled like the real thing', () => {
  const part = (a, b) => rawGame.slice(rawGame.indexOf(a), rawGame.indexOf(b, rawGame.indexOf(a)));
  const bike = part('// Motorcycle: superbike', '// Truck: European'), truck = part('// Truck: European', 'Object.values(MODELS)');
  assert.match(bike, /rotors: \[0\.058, -0\.058\]/, 'twin front brake discs');
  assert.equal((truck.match(/false, 0\.26\]/g) || []).length, 4, 'twin tyres on each side of the rear axle');
});

test('the player has brake lights', () => {
  assert.match(game, /Core\.isBraking\(car\.speed, keys\.down, keys\.up, keys\.brake\)/);
  assert.match(game, /brakeLights\.mat\.color\.setHex\(braking/);
});

test('the wanted stars and the helicopter are wired up', () => {
  assert.equal((html.match(/id="stars"[^>]*>(<i><\/i>){5}/) || []).length > 0, true, 'five stars in the HUD');
  assert.equal((html.match(/id="cops">(<i><\/i>){4}/) || []).length > 0, true, 'four police slots');
  assert.match(game, /Core\.helicopterDue\(H\.runTime, stars\)/);
  assert.match(game, /Core\.copTopSpeed\(M\.police, stars, dist, heli\.spotted, /);
  assert.doesNotMatch(game, /heatLevel|heat\(\)/, 'stars replaced the old heat level');
  assert.match(game, /Core\.rotorLoop\(/, 'the rotor sound comes from the tested loop');
});

test('damage is visible and the rider is posed', () => {
  assert.match(game, /Core\.damageStage\(damage\)/);
  assert.match(game, /Core\.smokeFor\(damage\)/);
  assert.match(game, /shader\.uniforms\.uDent = dentU/, 'dents and scratches in the paint shader');
  for (const key of ['car', 'bike', 'truck']) assert.match(game, new RegExp('MODELS\\.' + key + ' = \\{.*damageParts'), key + ' has loose parts');
});

test('every world is bent over the hills once, and the car feels them', () => {
  for (const [group, key] of [['CITY', 'city'], ['HWY', 'highway'], ['CTRY', 'country']]) assert.match(game, new RegExp('laySlopes\\(' + group + '\\.group, \'' + key + '\'\\)'));
  assert.match(game, /Core\.stepSpeed\(car\.speed, keys, dt, maxNow, V, grade\)/);
  assert.match(game, /Core\.slopeTop\(/);
});

test('the menu previews come from the real models, and every map picture fills its frame', () => {
  assert.match(game, /function renderPreviews\(\)/);
  assert.match(game, /renderPreviews\(\);/);
  assert.equal((game.match(/viewBox="0 0 160 80" preserveAspectRatio="xMidYMid slice"/g) || []).length, 3);
});

test('the radio is synthesised, wired to a key and a button, and its stored choice is validated', () => {
  assert.match(game, /Core\.radioBar\(radio\.key, radio\.bar\)/);
  assert.match(game, /e\.code === 'KeyR'/);
  assert.match(game, /radio\.key = Core\.parseRadio\(key\)/);
  assert.match(html, /id="btnRadio"/);
  assert.match(html, /id="radioTag"/);
  assert.doesNotMatch(game, /new Audio\(|\.(mp3|ogg|wav|m4a)\b/, 'no audio files anywhere');
});

test('the printable rules are built from rules/*.md and are up to date', () => {
  const { buildRulesHtml, markdown } = require('../scripts/build-rules.js');
  assert.equal(fs.readFileSync(path.join(ROOT, 'docs/rules.html'), 'utf8'), buildRulesHtml(), 'run npm run docs');
  assert.match(markdown('| a | b |\n|---|---|\n| 1 | **2** |'), /<td><b>2<\/b><\/td>/);
  assert.equal(markdown('<script>'), '<p>&lt;script&gt;</p>', 'text stays text');
});

test('audit: everything placed in a run stands on the hills, and the keyboard rules hold', () => {
  assert.match(game, /const g = new THREE\.Group\(\); g\.position\.set\(s\.x, groundH\(s\.x, s\.z\), s\.z\);/, 'repair kits');
  assert.match(game, /pg\.position\.set\(gp\.x, groundH\(gp\.x, gp\.z\), gp\.z\)/, 'the finish gate');
  assert.match(game, /if \(!\$\('fatal'\)\.hidden \|\| e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey\) return;/, 'nothing behind the error screen, no browser shortcuts');
  assert.match(game, /\(e\.code === 'Enter' \|\| e\.code === 'Space'\) && onButton/, 'a focused button does its own job');
  assert.doesNotMatch(game, /radio\.next = 0; return;/, 'stopping the radio does not lose its place');
  assert.match(game, /car\.z = HW\.LEN - 0\.1/, 'the toll stops you without the clasp');
});

test('audit: no page needs inline styles, which the policy now refuses', () => {
  for (const [name, src] of [['game', game], ['page', html], ['room', read('escape-room/src/room.js')], ['room page', escHtml]]){
    assert.doesNotMatch(src, /<style|\sstyle="/, name);
    assert.doesNotMatch(src, /setAttribute\('style'/, name);
  }
});

test('the ground is one surface: the vehicle, every layer and the shadows follow it', () => {
  assert.match(game, /const hill = \(x, z\) => Core\.hillMesh\(mode, x, z\)/);
  assert.match(game, /const onGrid = tri =>/, 'ground triangles are cut on the grid');
  assert.match(game, /car\.y = land \+ car\.lift/, 'no lag on a climb');
  assert.ok(game.includes('sun.target.position.set(sx, sy, sz)') && game.includes('Core.snapShadow(car.x, car.y, car.z,'), 'the shadow box follows the height');
});

test('the picture is steady: snapped shadows, 24 bits of depth, and the resolution follows the frame rate', () => {
  assert.ok(game.includes('Core.snapShadow(car.x, car.y, car.z, SUN_OFF,'));
  assert.ok(game.includes('new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType)'));
  assert.ok(game.includes('Core.stepQuality(quality, now - lastT)'));
  assert.ok(game.includes('Core.QUALITY_SCALES[quality.level]'));
});

test('big ground planes are bent in world space, so none stays flat', () => {
  assert.ok(game.includes('o.isPoints || o.isLine'), 'wires follow the hills');
  assert.ok(game.includes('const c = b.getCenter(tmp).applyMatrix4(o.matrixWorld); o.position.y += H(c.x, c.z)'), 'small meshes move by the height under their vertices');
  assert.match(game, /o\.geometry\.clone\(\)\.applyMatrix4\(o\.matrixWorld\)/);
  assert.match(game, /o\.rotation\.set\(0, 0, 0\)/);
});

test('skid marks are drawn on the shared ground, cost no new memory, and start clean each run', () => {
  assert.match(game, /groundH\(lx, lz\) \+ SKID_LIFT/, 'on the hills');
  assert.match(game, /new Float32Array\(SKID_QUADS \* 18\)/, 'a fixed ring');
  assert.match(game, /if \(state === 'play'\) updateSkids\(\);/);
  assert.match(game, /resetSkids\(\);\n\s*eng\.gear = 1;/, 'cleared when the car is reset');
  for (const key of ['car', 'bike', 'truck']) assert.match(game, new RegExp('MODELS\\.' + key + ' = \\{ skid: '));
});

test('all three vehicles have reversing lights, and the hills are visible at night', () => {
  assert.match(game, /Core\.isReversing\(car\.speed\)/);
  assert.equal((game.match(/reverseLamps\((g|root), /g) || []).length, 3, 'one call per vehicle');
  assert.match(game, /new THREE\.MeshBasicMaterial\(\{ vertexColors: true, fog: false \}\)/, 'the hills paint their own colours');
  assert.match(game, /facade\(style, x - w \/ 2, x \+ w \/ 2, low - 3, base \+ h,/, 'houses reach below their lowest corner');
});
