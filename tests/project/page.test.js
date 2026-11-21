// ### Checks on the page and the source: security headers, pinned libraries, and that each feature is wired up in the code.
// The page and the repository: wiring between files, pinned and integrity-checked libraries, no secrets, safe dev server
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const Core = require('../../room-2-chase/js/core.js');
const { createServer, resolvePath, ROOT } = require('../../tools/serve.js');

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('room-2-chase/index.html');
// Tests below read the source text. Comments are removed first: a test must not pass because of a comment.
const uncommented = t => t.replace(/^\s*\/\/.*$/gm, '').replace(/(\s)\/\/ .*$/gm, '$1');
const rawGame = read('room-2-chase/js/game.js'), game = uncommented(rawGame);
const scripts = [...html.matchAll(/<script\b([^>]*)><\/script>/g)].map(m => m[1]);

test('every element the game looks up by id exists in index.html', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const wanted = [...game.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]);
  assert.ok(wanted.length > 20);
  // ids created at runtime inside menu cards
  const runtime = new Set(['vehDetail', 'ovMap']);
  for (const id of new Set(wanted)) assert.ok(ids.has(id) || runtime.has(id), `#${id} is missing from index.html`);
});

test('every data-action on a card is a known action', () => {
  const actions = new Set([...game.matchAll(/data-action="([a-z-]+)"/g)].map(m => m[1]));
  // the pause card writes the action with a template
  actions.add('again'); actions.add('retry-act');
  for (const a of actions){
    const somewhere = ['menu', 'garage', 'pause', 'done', 'over'].some(state => Core.actionAllowed(a, { state, story: Core.newStory() }));
    assert.ok(somewhere, `${a} is never allowed, so its button would be dead`);
  }
});

test('scripts load in the right order: error screen, libraries, rules, online account, game', () => {
  const srcs = scripts.map(a => a.match(/src="([^"]+)"/)[1]);
  assert.equal(srcs[0], 'js/boot.js');
  assert.equal(srcs.at(-3), 'js/core.js');
  assert.equal(srcs.at(-2), 'js/online.js');
  assert.equal(srcs.at(-1), 'js/game.js');
  assert.ok(srcs.slice(1, -3).every(s => s.startsWith('https://')));
  assert.ok(!/<script>\s*\S/.test(html), 'no inline scripts, so the CSP can forbid them');
  for (const f of srcs.filter(s => !s.startsWith('http'))) assert.ok(fs.existsSync(path.join(ROOT, 'room-2-chase', f)), f);
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
  assert.deepEqual(dir['connect-src'], ["'self'", 'https://nqjeonoudywpdwivfuyp.supabase.co'], 'the page may talk only to itself and the Supabase project');
});

test('no credentials or secrets anywhere in the repository', () => {
  const patterns = [/AKIA[0-9A-Z]{16}/, /gh[pousr]_[A-Za-z0-9]{30,}/, /sk-[A-Za-z0-9]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /sb_secret_[A-Za-z0-9_-]{8,}/, /eyJ[A-Za-z0-9_-]{20,}.eyJ[A-Za-z0-9_-]{20,}./, /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]/i];
  // Every file git tracks, so local folders such as original-solo-project/.venv (installed packages, ignored by git) do not count
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
  const boot = read('room-2-chase/js/boot.js');
  assert.ok(boot.includes("$('fatalText').textContent = text"));
  assert.ok(!/innerHTML/.test(boot));
});

test('dev server: serves the game files and refuses paths outside the project', () => {
  assert.equal(resolvePath('/'), path.join(ROOT, 'index.html'));
  assert.equal(resolvePath('/room-2-chase/js/core.js?v=2'), path.join(ROOT, 'room-2-chase', 'js', 'core.js'));
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
    assert.equal((await get('/room-2-chase/js/game.js')).statusCode, 200);
    const hand = await get('/room-1-escape/models/hand-right.glb');
    assert.equal(hand.statusCode, 200, 'the escape room can load its hand models');
    assert.equal(hand.headers['content-type'], 'model/gltf-binary');
    assert.equal((await get('/missing.js')).statusCode, 404);
    assert.equal((await get('/.git/config')).statusCode, 403);
    assert.equal((await get('/', 'POST')).statusCode, 405);
    assert.equal((await get('/', 'DELETE')).statusCode, 405);
  } finally { server.close(); }
});

// ---------- Room 1: the escape-room page ----------
const escHtml = read('room-1-escape/index.html');
const escRoom = read('room-1-escape/js/room.js');
const escScripts = [...escHtml.matchAll(/<script\b([^>]*)><\/script>/g)].map(m => m[1]);

test('escape room: scripts load in order, the library is pinned and SRI-checked, no inline scripts', () => {
  const srcs = escScripts.map(a => a.match(/src="([^"]+)"/)[1]);
  assert.deepEqual(srcs, ['js/boot.js', 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'js/rules.js', 'js/minigames.js', 'js/room.js']);
  const lib = escScripts[1];
  assert.match(lib, /integrity="sha384-[A-Za-z0-9+/]{64}"/);
  assert.match(lib, /crossorigin="anonymous"/);
  assert.equal(lib.match(/integrity="([^"]+)"/)[1], scripts.find(a => a.includes('three.min.js')).match(/integrity="([^"]+)"/)[1], 'same file, same hash as room 2');
  assert.ok(!/<script>\s*\S/.test(escHtml));
  for (const f of srcs.filter(s => !s.startsWith('http'))) assert.ok(fs.existsSync(path.join(ROOT, 'room-1-escape', f)), f);
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
  for (const id of wanted) assert.ok(ids.has(id) || runtime.has(id), `#${id} is missing from room-1-escape/index.html`);
});

test('escape room: every scanned texture the room loads ships with it and is credited', () => {
  const files = [...new Set([...escRoom.matchAll(/'(?:textures\/)?([a-z-]+\.(?:jpg|png))'/g)].map(m => m[1]))];
  assert.ok(files.length >= 9, 'the floor, wall and steel scans and the vault HDRI');
  for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, 'room-1-escape/textures', f)), f + ' is missing');
  assert.match(read('README.md'), /Poly Haven.*CC0/);
});

test('escape room: the tap, air vent, ladder and band recordings ship with it, are served as audio and are credited as CC0; the API vent is allowed only from its two hosts', () => {
  const files = [...new Set([...escRoom.matchAll(/'sounds\/([a-z-]+\.mp3)'/g)].map(m => m[1]))].sort();
  assert.deepEqual(files, ['air-vent.mp3', 'ladder.mp3', 'orchestra.mp3', 'tap-water.mp3']);
  // the footsteps: every recording room.js asks for ships with it, and each kind is credited
  const steps = JSON.parse(escRoom.match(/const STEP_FILES = (\{[^}]+\})/)[1].replace(/(\w+):/g, '"$1":'));
  assert.deepEqual(Object.keys(steps).sort(), ['floor', 'rung', 'wet']);
  for (const [k, n] of Object.entries(steps)){
    for (let i = 1; i <= n; i++) assert.ok(fs.existsSync(path.join(ROOT, 'room-1-escape/sounds/steps', `${k}-${i}.mp3`)), `${k}-${i}.mp3 is missing`);
    assert.ok(!fs.existsSync(path.join(ROOT, 'room-1-escape/sounds/steps', `${k}-${n + 1}.mp3`)), `${k}: a file room.js never plays`);
    assert.match(read('room-1-escape/sounds/CREDITS.md'), new RegExp('`steps/' + k + '-1\\.mp3`.*CC0 1\\.0'), k + ' steps are credited');
  }
  const credits = read('room-1-escape/sounds/CREDITS.md');
  for (const f of files){
    assert.ok(fs.existsSync(path.join(ROOT, 'room-1-escape/sounds', f)), f + ' is missing');
    assert.match(credits, new RegExp('`' + f.replace('.', '\\.') + '`.*CC0 1\\.0'), f + ' is credited with its licence');
  }
  assert.equal(resolvePath('/room-1-escape/sounds/tap-water.mp3'), path.join(ROOT, 'room-1-escape', 'sounds', 'tap-water.mp3'), 'the dev server serves MP3');
  // the only outside hosts: the Openverse API for the air vent (searched, no key) and Freesound's server for its recording
  const csp = escHtml.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const dir = Object.fromEntries(csp.split(';').map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(dir['connect-src'], ["'self'", 'https://api.openverse.org']);
  assert.deepEqual(dir['media-src'], ["'self'", 'blob:', 'https://cdn.freesound.org']);
  const R = require('../../room-1-escape/js/rules.js');
  assert.ok(R.VENT_SEARCH.startsWith('https://api.openverse.org/'), 'the search goes to the host the policy allows');
  assert.ok(!/key=|token=|Authorization/i.test(R.VENT_SEARCH + escRoom.slice(escRoom.indexOf('function findApiVent'), escRoom.indexOf('function playApiVent'))), 'no key is sent');
});

test('escape room: the two rooms stay separate (no file of one room loads the other)', () => {
  assert.ok(!/\.\.\//.test(escHtml), 'room 1 does not load files from room 2');
  assert.ok(!/room-1-escape/.test(html), 'room 2 does not load files from room 1');
  assert.ok(!/ShardCore|src\/core\.js/.test(escRoom));
});

test('escape room: texts from the story are inserted as text, not as HTML', () => {
  assert.ok(escRoom.includes("b.querySelector('span').textContent = h.label"));
  assert.ok(/esc\(c\.text\)/.test(escRoom) && /esc\(E\.text\)/.test(escRoom));
});

// ---------- Both rooms: one design system ----------
test('both rooms share one design system: the same tokens and the same fonts', () => {
  const tokens = css => Object.fromEntries([...css.match(/:root\{([\s\S]*?)\}/)[1].matchAll(/--([\w-]+):([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  const a = tokens(read('room-2-chase/styles.css')), b = tokens(read('room-1-escape/styles.css'));
  for (const k of ['bg', 'ink', 'muted', 'glass', 'glass-strong', 'line', 'f-display', 'f-body', 'f-mono']) assert.equal(a[k], b[k], `--${k} differs between the rooms`);
  assert.ok(a.spark && b.orange, 'each room keeps its own accent (cyan in room 2, orange in room 1)');
  // the same two typefaces ship with each room, with their licence, and no page asks a font service
  for (const [page, css, dir] of [[html, read('room-2-chase/styles.css'), 'room-2-chase/fonts'], [escHtml, read('room-1-escape/styles.css'), 'room-1-escape/fonts']]){
    assert.doesNotMatch(page, /fonts\.(googleapis|gstatic)\.com/, 'no font service');
    for (const [file, licence] of [['big-shoulders-display.woff2', 'OFL-BigShouldersDisplay.txt'], ['jetbrains-mono.woff2', 'OFL-JetBrainsMono.txt']]){
      assert.ok(css.includes('url("fonts/' + file + '")'), dir + ': ' + file + ' is used');
      assert.equal(fs.readFileSync(path.join(ROOT, dir, file)).subarray(0, 4).toString('latin1'), 'wOF2', dir + ': ' + file + ' is a real woff2 font');
      assert.match(read(dir + '/' + licence), /SIL Open Font License, Version 1\.1/, dir + ': the licence ships with the font');
    }
  }
  assert.deepEqual(fs.readFileSync(path.join(ROOT, 'room-2-chase/fonts/big-shoulders-display.woff2')), fs.readFileSync(path.join(ROOT, 'room-1-escape/fonts/big-shoulders-display.woff2')), 'both rooms use the very same file');
});

test('the story runs on from room 1 into room 2', () => {
  const rules = require('../../room-1-escape/js/rules.js');
  // Ending A leads into room 2 and takes the escape time along; the start page begins the heist in room 1
  const room = read('room-1-escape/js/room.js');
  assert.match(room, /writeStore\(R\.HEIST_KEY, R\.handover\(S, Date\.now\(\)\)\)/, 'Ending A hands the escape time over');
  assert.match(room, /const CHASE_URL = '\.\.\/room-2-chase\/\?heist=1#arrive';/, 'Ending A leads into room 2');
  assert.match(room, /location\.assign\(CHASE_URL\)/, 'room 2 opens by itself, with no card in between');
  assert.match(read('room-2-chase/styles.css'), /#arrive:target\{display:block\}/, 'room 2 opens in the glare room 1 ended in');
  assert.doesNotMatch(game, /data-action="heist"/, 'no card stands between the tunnel and the garage');
  // the garage's way in is the end of room 1's tunnel: the same door measures and the same scanned surfaces
  const room1 = room.match(/const TDOOR = \{ w: ([\d.]+), h: ([\d.]+), leafH: ([\d.]+)/), room2 = game.match(/const TUNNEL_DOOR = Object\.freeze\(\{ w: ([\d.]+), h: ([\d.]+), leafH: ([\d.]+), r: ([\d.]+)/);
  assert.deepEqual(room2.slice(1, 4).map(Number), room1.slice(1, 4).map(Number), 'the same door as at the end of the tunnel in room 1');
  assert.equal(Number(room2[4]), Number(room.match(/const TUN = \{[^}]*r: ([\d.]+)/)[1]), 'the same width of tunnel');
  for (const f of ['tunnel-brick-color.jpg', 'tunnel-stone-color.jpg', 'tunnel-floor-color.jpg', 'ladder-wood-color.jpg']){
    assert.ok(game.includes("'" + f + "'") && room.includes("'" + f + "'"), 'both rooms build the tunnel from ' + f);
    assert.ok(fs.existsSync(path.join(ROOT, 'room-1-escape/textures', f)), f + ' is in the folder of room 1');
  }
  assert.match(game, /Core\.parseHeist\(readStore\(Core\.HEIST\.key\), Date\.now\(\)\)/, 'room 2 reads the handover through the rules');
  assert.match(read('index.html'), /<a class="start-heist" href="heist\/">/, 'the start page starts the heist on the heist page');
  const sql = read('supabase/schema.sql');
  assert.match(sql, /total numeric\(7, 2\) generated always as \(escape \+ drive\) stored/, 'the database adds the heist time up itself');
  assert.match(sql, /grant insert \(escape, drive, veh\) on public\.heists to authenticated/, 'a player can only send the two parts');
  assert.match(rules.ENDINGS.A.text, /car is waiting/, 'room 1 ends with the getaway car');
  assert.match(game, /Cell Block D/, 'room 2 starts after the escape from Cell Block D');
  assert.match(game, /inmate 4471/, 'the police hunt the same inmate');
  assert.match(game, /'hale'/, 'Officer Hale helps over the radio');
});

test('the city is Lisbon: the gate stands at the south-west corner, towards the bridge, and the story says so', () => {
  assert.match(game, /gp = \{ x: -144, z: 144 \}/, 'the gate is where Rua do Crucifixo meets the river avenue');
  assert.equal(Core.streetAt(-144, 144, Math.PI / 2), 'Avenida Infante Dom Henrique');
  assert.match(game, /gp = \{ x: -144, z: 144 \}; gateRot = -Math\.PI \/ 2;/, 'the gate faces west, up the approach road to the bridge');
  // behind the gate the approach road starts where the gate stands; through the gate you drive it up to the deck yourself
  assert.match(game, /X0 = -144, Z0 = 144/, 'the approach road starts at the gate');
  assert.match(game, /CITY\.approach = \{ len: LEN, at, hw \}/, 'the approach road can be driven');
  assert.match(game, /if \(f\.ramp\) return updateRamp\(dt\);/, 'the finale starts on the approach road');
  // behind the gate the game drives: every key is let go, and the drive up the road reads no key, pad or tilt
  assert.match(game, /resetPolice\(\);\n  held\.clear\(\); Object\.keys\(keys\)\.forEach\(k => keys\[k\] = false\);\n  if \(finale\.ramp\)/, 'the keys are let go at the gate');
  const rampFn = game.slice(game.indexOf('function updateRamp(dt){'), game.indexOf('function onTheBridge('));
  assert.doesNotMatch(rampFn, /keys\.(up|down|left|right|brake)|TILT\.value/, 'the drive up to the bridge is not steered by the player');
  assert.match(game, /onTheBridge\(local\.x, local\.z, /, 'on the deck the drive over the bridge takes over where you are, without a cut');
  assert.match(game, /onBridge\(F\.start, F\.lane\)|onTheBridge\(F\.start, F\.lane, F\.speed\)/, 'if you do not get up there, the picture fades and the car is placed on the bridge, where it always was');
  assert.match(game, /const cine = finale\.on && finale\.placed;/, 'on the bridge the engine is heard working, not idling along on overrun');
  assert.match(game, /if \(!f\.kick\)\{ f\.kick = true; eng\.gear = Math\.max\(1, eng\.gear - 1\); f\.throttle = 1; \}/, 'with the second shot the driver changes down and puts the foot down');
  assert.match(game, /arco\(80\)/, 'the Arco da Rua Augusta still stands over Rua Augusta');
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

test('the city is bent over the hills once, and the car feels them', () => {
  assert.match(game, /laySlopes\(CITY\.group, 'city'\)/);
  assert.equal((game.match(/laySlopes\(\w+\.group, /g) || []).length, 1, 'Lisbon is the only world');
  assert.match(game, /Core\.stepSpeed\(car\.speed, keys, dt, maxNow, V, grade\)/);
  assert.match(game, /Core\.slopeTop\(/);
});

test('the menu previews come from the real models, and there is no choice of map: Lisbon is the only one', () => {
  assert.match(game, /function renderPreviews\(\)/);
  assert.match(game, /renderPreviews\(\);/);
  assert.doesNotMatch(game, /data-pick="mode"/, 'no map buttons in the menu');
  assert.doesNotMatch(game + read('room-2-chase/js/core.js'), /highway|countryside|buildCountry|buildHighway|courier|clasp/i, 'nothing is left of the highway and the countryside');
});

test('the radio is synthesised, wired to a key and a button, and its stored choice is validated', () => {
  assert.match(game, /Core\.radioBar\(radio\.key, radio\.bar\)/);
  assert.match(game, /e\.code === 'KeyR'/);
  assert.match(game, /radio\.key = Core\.parseRadio\(key\)/);
  assert.match(html, /id="btnRadio"/);
  assert.match(html, /id="radioTag"/);
  assert.doesNotMatch(game, /new Audio\(|\.(mp3|ogg|wav|m4a)\b/, 'no audio files anywhere');
});

test('the printable rules are built from docs/rules/*.md and are up to date', () => {
  const { buildRulesHtml, markdown } = require('../../tools/build-rules.js');
  assert.equal(fs.readFileSync(path.join(ROOT, 'docs/rules/rules.html'), 'utf8'), buildRulesHtml(), 'run npm run docs');
  assert.match(markdown('| a | b |\n|---|---|\n| 1 | **2** |'), /<td><b>2<\/b><\/td>/);
  assert.equal(markdown('<script>'), '<p>&lt;script&gt;</p>', 'text stays text');
});

test('audit: everything placed in a run stands on the hills, and the keyboard rules hold', () => {
  assert.match(game, /const g = new THREE\.Group\(\); g\.position\.set\(s\.x, groundH\(s\.x, s\.z\), s\.z\);/, 'repair kits');
  assert.match(game, /pg\.position\.set\(gp\.x, groundH\(gp\.x, gp\.z\), gp\.z\)/, 'the finish gate');
  assert.match(game, /if \(!\$\('fatal'\)\.hidden \|\| e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey\) return;/, 'nothing behind the error screen, no browser shortcuts');
  assert.match(game, /\(e\.code === 'Enter' \|\| e\.code === 'Space'\) && onButton/, 'a focused button does its own job');
  assert.doesNotMatch(game, /radio\.next = 0; return;/, 'stopping the radio does not lose its place');
});

test('the working rules live in the project: AGENTS.md with run and test commands, CLAUDE.md pointing to it', () => {
  const agents = read('AGENTS.md');
  for (const cmd of ['npm start', 'npm test', 'npm run test:browser']) assert.ok(agents.includes(cmd), 'AGENTS.md lists ' + cmd);
  for (const rule of [/reviews every pull request/, /Never weaken, skip, edit or delete a test/, /When `main` is red/, /Never put a key/]) assert.match(agents, rule);
  assert.ok(read('CLAUDE.md').includes('[AGENTS.md](AGENTS.md)'), 'Claude Code reads the same rules');
  assert.match(read('docs/course-guides.md'), /Open points for the team/);
  assert.ok(read('.gitignore').split(/\r?\n/).map(s => s.trim()).includes('.env'), '.env is ignored before any secret exists');
});

test('audit: no page needs inline styles, which the policy now refuses', () => {
  for (const [name, src] of [['game', game], ['page', html], ['room', read('room-1-escape/js/room.js')], ['room page', escHtml]]){
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

test('getting in: the hand opens the door by its handle, the cabin is seen from the seat, then the view draws back', () => {
  // the hand goes to the handle and the door swings with it; the left hand pulls it shut again from inside
  assert.match(game, /walker\.handTo\('r', s < N\.pull \? HAND_P : null/);
  assert.match(game, /walker\.handTo\('l', s < N\.shut - 0\.1 \? PULL_P : null/);
  // the steps in their order, and the view from the driver's eyes until the vehicle has rolled off
  assert.match(game, /for \(const k of \['reach', 'pull', 'open', 'sit', 'shut', 'wheel', 'roll', 'back'\]\)/);
  assert.match(game, /if \(garage\.on && !paused\) garageRide\(dt\);/, 'the view follows the vehicle after it has moved');
  // every vehicle has the driver's eyes; the coupe and the truck have a cabin with a wheel and dials of their own
  for (const key of ['car', 'bike', 'truck']) assert.match(game, new RegExp('MODELS\\.' + key + ' = \\{[^\\n]*eye'));
  assert.equal((game.match(/cabinDash\(g, eye, CAB, /g) || []).length, 2);
  // the coupe's doors are cut out of its body, so they are always there and no dark panel stands in for the opening
  assert.match(game, /cut: true, handle: spot\(parts\.handle\), pull: spot\(parts\.pull\)/);
});

test('the coupe\'s cabin: dials seen above the hub, a navigation screen, and a door handle that swings out when pulled', () => {
  assert.match(game, /cabinDash\(g, eye, CAB, \[0\.97, 0\.3\]\)/, 'the dials sit in the opening of the wheel above its hub');
  assert.match(game, /put\('navi', new THREE\.PlaneGeometry/, 'the navigation screen on the dash');
  assert.match(game, /navi: new THREE\.MeshBasicMaterial\(\{ color: 0x1a1a1a, map: naviTexture\(\) \}\)/);
  assert.match(game, /door\.flap\.rotation\.y = -door\.side \* 0\.45/, 'the handle swings out of its pocket');
  assert.match(game, /walker\.dropHand\('l', s < N\.pull\)/, 'the other hand is out of the way');
});

test('all three vehicles have reversing lights, and the hills are visible at night', () => {
  assert.match(game, /Core\.isReversing\(car\.speed\)/);
  assert.equal((game.match(/reverseLamps\((g|root), /g) || []).length, 3, 'one call per vehicle');
  assert.match(game, /new THREE\.MeshBasicMaterial\(\{ vertexColors: true, fog: false \}\)/, 'the hills paint their own colours');
  assert.match(game, /facade\(style, x - w \/ 2, x \+ w \/ 2, low - 3, base \+ h,/, 'houses reach below their lowest corner');
});

test('escape room: the fire extinguisher is the Poly Haven model, shipped with its licence and loaded by room.js', () => {
  const dir = path.join(ROOT, 'room-1-escape', 'models');
  const buf = fs.readFileSync(path.join(dir, 'fire-extinguisher.glb'));
  assert.equal(buf.readUInt32LE(0), 0x46546C67, 'fire-extinguisher.glb is a binary glTF file');
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString());
  assert.equal(json.meshes[0].primitives.length, 2, 'the painted body and the gauge glass, as room.js expects');
  for (const k of ['POSITION', 'NORMAL', 'TEXCOORD_0']) assert.ok(json.meshes[0].primitives.every(p => p.attributes[k] !== undefined), k);
  assert.match(fs.readFileSync(path.join(dir, 'LICENSE-fire-extinguisher.txt'), 'utf8'), /CC0/);
  const room = fs.readFileSync(path.join(ROOT, 'room-1-escape', 'js', 'room.js'), 'utf8');
  assert.match(room, /fetch\('models\/fire-extinguisher\.glb'\)/);
  for (const f of ['color', 'normal', 'arm']) assert.ok(room.includes(`'fire-extinguisher-${f}.jpg'`), f);
});

test('escape room: the cell door is dark scanned steel, with its plain grey steel as the fallback', () => {
  const room = fs.readFileSync(path.join(ROOT, 'room-1-escape', 'js', 'room.js'), 'utf8');
  for (const f of ['color', 'normal', 'rough']){
    assert.ok(room.includes(`'door-steel-${f}.jpg'`), f);
    assert.ok(fs.existsSync(path.join(ROOT, 'room-1-escape', 'textures', `door-steel-${f}.jpg`)), f);
  }
  assert.match(room, /const m = M\.door\.clone\(\)/, 'the door shows M.door until the scans arrive');
  assert.match(room, /onDoor\(steelBlock\(1\.04, 2\.14, \.1,/, 'the leaf is the scanned steel');
});

test('escape room: the fluorescent lamps are the Poly Haven fitting with a clear glass tube, shipped with its licence', () => {
  const dir = path.join(ROOT, 'room-1-escape', 'models');
  const buf = fs.readFileSync(path.join(dir, 'fluorescent-fitting.glb'));
  assert.equal(buf.readUInt32LE(0), 0x46546C67, 'fluorescent-fitting.glb is a binary glTF file');
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString());
  assert.equal(json.meshes[0].primitives.length, 1, 'only the housing: room.js builds the tube');
  for (const k of ['POSITION', 'NORMAL', 'TEXCOORD_0']) assert.ok(json.meshes[0].primitives[0].attributes[k] !== undefined, k);
  assert.match(fs.readFileSync(path.join(dir, 'LICENSE-fluorescent-fitting.txt'), 'utf8'), /CC0/);
  const room = fs.readFileSync(path.join(ROOT, 'room-1-escape', 'js', 'room.js'), 'utf8');
  assert.match(room, /fetch\('models\/fluorescent-fitting\.glb'\)/);
  for (const f of ['color', 'normal', 'arm']){
    assert.ok(room.includes(`'fluorescent-fitting-${f}.jpg'`), f);
    assert.ok(fs.existsSync(path.join(ROOT, 'room-1-escape', 'textures', `fluorescent-fitting-${f}.jpg`)), f);
  }
  assert.match(room, /MeshPhysicalMaterial\(\{[^}]*transmission/, 'the tube is physically based glass');
});

test('escape room: Officer Hale is the MakeHuman body, shipped with its licence and loaded by room.js', () => {
  const dir = path.join(ROOT, 'room-1-escape', 'models');
  const buf = fs.readFileSync(path.join(dir, 'hale.glb'));
  assert.equal(buf.readUInt32LE(0), 0x46546C67, 'hale.glb is a binary glTF file');
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString());
  const names = json.nodes.map(n => n.name);
  for (const n of ['root', 'head', 'neck02', 'spine02', 'spine03', 'upperarm01.R', 'lowerarm01.R', 'wrist.R', 'finger3-1.R', 'upperarm01.L', 'wrist.L']) assert.ok(names.includes(n), n + ' is a bone room.js turns');
  const parts = json.meshes[0].primitives.map(p => json.materials[p.material].name);
  for (const n of ['skin', 'eyes', 'cornea', 'shirt', 'trousers', 'collar', 'tie', 'belt', 'metal', 'cap', 'visor', 'boots', 'sole']) assert.ok(parts.includes(n), n);
  for (const p of json.meshes[0].primitives) for (const k of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']) assert.ok(p.attributes[k] !== undefined, k);
  assert.match(fs.readFileSync(path.join(dir, 'LICENSE-hale.txt'), 'utf8'), /CC0/);
  const room = fs.readFileSync(path.join(ROOT, 'room-1-escape', 'js', 'room.js'), 'utf8');
  assert.match(room, /fetch\('models\/hale\.glb'\)/);
  for (const f of ['hale-skin.jpg', 'hale-skin-bump.jpg', 'hale-eye.jpg']) assert.ok(fs.existsSync(path.join(dir, f)), f);
});

test('escape room: the real hand models are shipped with their licence and are what room.js loads', () => {
  const dir = path.join(ROOT, 'room-1-escape', 'models');
  for (const side of ['right', 'left']){
    const buf = fs.readFileSync(path.join(dir, `hand-${side}.glb`));
    assert.equal(buf.readUInt32LE(0), 0x46546C67, `hand-${side}.glb is a binary glTF file`);
    const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString());
    assert.equal(json.skins[0].joints.length, 25, 'one joint for the wrist and each finger bone, as room.js expects');
    for (const n of ['wrist', 'thumb-phalanx-distal', 'index-finger-phalanx-proximal', 'pinky-finger-phalanx-distal']) assert.ok(json.nodes.some(x => x.name === n), n);
  }
  assert.match(fs.readFileSync(path.join(dir, 'LICENSE-hands.txt'), 'utf8'), /MIT License/);
  assert.match(fs.readFileSync(path.join(ROOT, 'room-1-escape', 'js', 'room.js'), 'utf8'), /fetch\('models\/hand-' \+ n \+ '\.glb'\)/);
});

// ---------- The heist page: one driver name, both rooms on one page ----------
test('the heist page holds both rooms, and the rooms still load nothing of each other', () => {
  const page = read('heist/index.html'), js = read('heist/heist.js'), room = read('room-1-escape/js/room.js');
  // scripts and frames only from this site; the one other address is the online leaderboard
  const csp = page.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)[1];
  assert.match(csp, /default-src 'self'/); assert.match(csp, /script-src 'self'(;|$)/); assert.match(csp, /frame-src 'self'/); assert.match(csp, /object-src 'none'/);
  assert.match(csp, /connect-src 'self' https:\/\/nqjeonoudywpdwivfuyp\.supabase\.co(;|$)/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
  assert.doesNotMatch(page, /<script(?![^>]*\bsrc=)[^>]*>|\son\w+=|style="/i, 'no inline script, handler or style');
  assert.deepEqual([...page.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]), ['../room-2-chase/js/core.js', '../room-2-chase/js/online.js', 'heist.js'], 'the rules and the online account are room 2\'s, not a copy');
  // the driver: the same names and the same account as in room 2
  assert.match(js, /Core\.cleanName\(/); assert.match(js, /net\.playAs\(name\)/);
  assert.match(js, /writeStore\('shard-heist-driver', r\.name\)/, 'room 2 finds the driver where it looks for it');
  assert.doesNotMatch(js, /innerHTML = [^;]*\$\{(?!esc\(|state\.online|Core\.NAME_MAX|msg|dis)/, 'names and messages are escaped before they go into the page');
  // the rooms: room 1 in a frame, room 2 loaded under it in its waiting mode, and only our own frames are listened to
  assert.match(js, /ROOM1 = '\.\.\/room-1-escape\/\?heist=frame'/); assert.match(js, /ROOM2_WAIT = '\.\.\/room-2-chase\/\?heist=wait#arrive'/);
  assert.match(js, /if \(e\.origin !== location\.origin \|\| !e\.data \|\| typeof e\.data\.shardHeist !== 'string'\) return;/);
  assert.match(js, /e\.source === frame1\.contentWindow && e\.data\.shardHeist === 'leave'/);
  assert.match(js, /e\.source === frame2\.contentWindow && e\.data\.shardHeist === 'ready'/);
  // room 1 tells the page that holds it; on its own it opens room 2's page
  assert.match(room, /if \(FRAMED\) parent\.postMessage\(\{ shardHeist: 'leave' \}, location\.origin\); else location\.assign\(CHASE_URL\);/);
  // room 2 waits without drawing and begins only on the heist page's word
  assert.match(game, /if \(!HEIST_WAIT\) requestAnimationFrame\(frame\);/);
  assert.match(game, /if \(e\.origin !== location\.origin \|\| e\.source !== parent \|\| !e\.data \|\| e\.data\.shardHeist !== 'go' \|\| heist\.went\) return;/);
  // a room 2 that is still loading when room 1 is left is shown and begins when ready: it is never loaded a second time
  assert.match(js, /if \(state\.left\) frame2\.contentWindow\.postMessage\(\{ shardHeist: 'go' \}, location\.origin\);/);
  assert.doesNotMatch(js, /frame2\.remove\(\)/);
  // each room on its own page still loads no file of the other
  assert.doesNotMatch(escHtml, /\.\.\//); assert.doesNotMatch(html, /room-1-escape/);
  // the heist page goes online with the rest
  assert.match(read('.github/workflows/ci.yml'), /cp -r index\.html heist room-1-escape room-2-chase _site\//);
});
