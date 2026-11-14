// End-to-end: plays the real game in headless Chrome and checks the main workflows, rejected input and the error screen.
// ### Talks to Chrome over the DevTools protocol with Node's built-in WebSocket, so it needs no npm packages. 3D runs on
// ### Chrome's software renderer (SwiftShader), so it also works on a CI machine without a graphics card. If no Chrome
// ### or Edge is installed the whole file is skipped. Set CHROME_PATH to use a specific browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { createServer } = require('../../tools/serve.js');

function findChrome(){
  const list = [process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']){
    try { list.push(execFileSync('which', [name], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch (e) {}
  }
  return list.find(p => p && fs.existsSync(p));
}

const CHROME = findChrome();
const LOAD_MS = 120000;
let chrome, server, base, ws, profile, seq = 0;
const pending = new Map(), errors = [];
// ### The escape room asks the Openverse API for its air vent and plays the answer from Freesound's server. Both hosts are
// ### answered here by stand-ins (a fixed answer, and the room's own vent recording as the "Freesound" file), so the test
// ### needs no internet, is the same every time and never counts against the API's limit.
const VENT_HOSTS = ['https://api.openverse.org/', 'https://cdn.freesound.org/'], ventCalls = { api: 0, file: 0 };
const VENT_ANSWER = { result_count: 2, results: [
  { license: 'by', url: 'https://cdn.freesound.org/previews/1/1_1-hq.mp3', duration: 60000, title: 'Ventilation (CC BY)', creator: 'not this one' },
  { license: 'cc0', url: 'https://cdn.freesound.org/previews/536/536942_1-hq.mp3', duration: 60000, title: 'Ventilation hum (test)', creator: 'stand-in',
    foreign_landing_url: 'https://freesound.org/people/stand-in/sounds/536942', tags: [{ name: 'hvac' }] }] };
function standIn(p){
  const api = p.request.url.startsWith(VENT_HOSTS[0]);
  ventCalls[api ? 'api' : 'file']++;
  const body = api ? Buffer.from(JSON.stringify(VENT_ANSWER)) : fs.readFileSync(path.join(__dirname, '../../room-1-escape/sounds/air-vent.mp3'));
  send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, body: body.toString('base64'),
    responseHeaders: [{ name: 'Content-Type', value: api ? 'application/json' : 'audio/mpeg' }, { name: 'Access-Control-Allow-Origin', value: '*' }] });
}

function send(method, params = {}){
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression){
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expression, ms = 30000, label = expression){
  const end = Date.now() + ms;
  while (Date.now() < end){
    try { if (await evaluate(expression)) return; } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('timed out waiting for: ' + label);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = (type, code) => evaluate(`window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}', bubbles: true })), true`);
const click = sel => evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) throw new Error('no ${sel.replace(/'/g, '')}'); b.click(); return true; })()`);
const text = sel => evaluate(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
const menuReady = "!document.getElementById('overlay').hidden && !!document.querySelector('[data-action=\"go\"]')";
const playing = "document.getElementById('overlay').hidden && !document.getElementById('hud').classList.contains('off')";
// A Lisbon run first shows the map of the evidence; this presses "Start driving" and waits until the car can move
async function startDriving(label){
  await waitFor("!!document.getElementById('ovMap') || (" + playing + ")", 30000, label);
  if (await evaluate("!!document.getElementById('ovMap')")) await click('[data-action="resume"]');
  await waitFor(playing, 30000, label);
}
async function load(){
  errors.length = 0;
  await send('Page.navigate', { url: base + 'room-2-chase/' });
  await waitFor(menuReady, LOAD_MS, 'main menu');
}

test('CI really runs the browser tests', { skip: !process.env.CI && 'only on the CI server' }, () => {
  assert.ok(CHROME, 'no browser on the CI server: the browser tests would be skipped and the deploy would go ahead untested');
});

test('browser workflows', { skip: !CHROME && 'no Chrome or Edge found (set CHROME_PATH)', timeout: 600000 }, async t => {
  server = createServer().listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-heist-'));
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,800', '--autoplay-policy=no-user-gesture-required',
    // Ubuntu CI machines block Chrome's sandbox; the page is our own local game, so running without it there is fine
    ...(process.env.CI ? ['--no-sandbox'] : []), 'about:blank']);
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//); if (m) resolve(m[1]); });
    chrome.once('exit', c => reject(new Error('Chrome exited with ' + c + '\n' + buf)));
  });
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(x => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)){ const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
    else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception ? msg.params.exceptionDetails.exception.description : msg.params.exceptionDetails.text);
    else if (msg.method === 'Fetch.requestPaused') standIn(msg.params);
    else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map(a => a.value || a.description).join(' '));
    // CSP violations, blocked or failed requests (the browser asks for a favicon on its own, which this game does not have)
    else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/favicon.ico/.test(msg.params.entry.url || '')) errors.push(msg.params.entry.text);
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Fetch.enable', { patterns: VENT_HOSTS.map(h => ({ urlPattern: h + '*' })) });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  // Software rendering is slow, so start in Balanced graphics unless a test sets something else on purpose
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try { if (!localStorage.getItem('shard-heist-gfx')) localStorage.setItem('shard-heist-gfx', 'balanced'); } catch (e) {}" });

  try {
    await t.test('the menu loads with all three maps, three vehicles and the story mode', async () => {
      await load();
      assert.equal(await evaluate("document.querySelectorAll('[data-pick=\"mode\"]').length"), 3);
      assert.equal(await evaluate("document.querySelectorAll('[data-pick=\"veh\"]').length"), 3);
      assert.equal(await evaluate("[...document.querySelectorAll('.vtab img')].filter(i => i.src.startsWith('data:image/png') && i.complete && i.naturalWidth > 100).length"), 3, 'the previews are pictures of the real models');
      assert.ok(await evaluate("!!document.querySelector('[data-action=\"story\"]')"));
      assert.ok(await evaluate("document.getElementById('fatal').hidden"), 'no error screen');
      assert.deepEqual(errors, []);
    });

    await t.test('the radio chips change the station and refuse nothing silently', async () => {
      assert.equal(await evaluate("document.querySelectorAll('[data-radio]').length"), 8);
      await click('[data-radio="techno"]');
      assert.equal(await evaluate("document.getElementById('radioTag').textContent"), 'Techno');
      assert.equal(await evaluate("localStorage.getItem('shard-heist-radio')"), 'techno');
      await click('[data-radio="off"]');
      assert.equal(await evaluate("document.getElementById('radioTag').hidden"), true);
      assert.deepEqual(errors, []);
    });

    await t.test('choosing a vehicle updates the stats card', async () => {
      await click('[data-pick="veh"][data-val="bike"]');
      assert.equal(await evaluate("document.querySelector('[data-pick=\"veh\"][data-val=\"bike\"]').getAttribute('aria-pressed')"), 'true');
      assert.match(await text('#vehDetail'), /Superbike/);
      await click('[data-pick="veh"][data-val="car"]');
      assert.match(await text('#vehDetail'), /Muscle coupe/);
    });

    await t.test('a run starts, the timer runs and the throttle moves the car', async () => {
      await click('[data-action="go"]');
      await waitFor("!!document.getElementById('ovMap')", 30000, 'the map of the evidence');
      assert.match(await text('#card h2'), /Where the evidence is/);
      assert.match(await evaluate("document.getElementById('ovMap').getAttribute('aria-label')"), /Photos.*Fingerprints.*Torch.*Lockpick.*Clothes.*Balaclava/);
      const clock0 = await text('#time'); await sleep(1500);
      assert.equal(await text('#time'), clock0, 'the clock waits while the map is open');
      await click('[data-action="resume"]');
      await waitFor(playing, 30000, 'run to start');
      await waitFor("!document.getElementById('guide').hidden", 10000, 'the guide arrow');
      assert.match(await text('#guideName'), /Photos|Fingerprints|Torch|Lockpick|Clothes|Balaclava/);
      const t0 = await text('#time');
      await key('keydown', 'KeyW');
      await waitFor("parseInt(document.getElementById('speed').textContent) > 20", 30000, 'speed above 20 km/h');
      await key('keyup', 'KeyW');
      // the clock advances at most 50 ms per frame, so on a slow software renderer this can take a while
      await waitFor(`document.getElementById('time').textContent !== ${JSON.stringify(t0)}`, 120000, 'timer to count down');
      assert.deepEqual(errors, []);
    });

    await t.test('rejected: a card button cannot act while driving', async () => {
      await evaluate("const c = document.getElementById('card'); c.innerHTML = '<button class=\"btn\" data-action=\"menu\">x</button><button class=\"btn\" data-action=\"next-act\">y</button>'; c.querySelectorAll('button').forEach(b => b.click()); true");
      await sleep(300);
      assert.ok(await evaluate(playing), 'still driving');
    });

    await t.test('pause and resume with the keyboard', async () => {
      await key('keydown', 'KeyP');
      await waitFor("!document.getElementById('overlay').hidden", 5000, 'pause card');
      assert.equal(await text('#card h2'), 'Paused');
      const t0 = await text('#time');
      await sleep(1500);
      assert.equal(await text('#time'), t0, 'the clock stops while paused');
      await key('keydown', 'Enter');
      await waitFor(playing, 5000, 'resume');
    });

    await t.test('story mode: prologue, then act 1 starts on the city map', async () => {
      await key('keydown', 'KeyP');
      await waitFor("!document.getElementById('overlay').hidden", 5000);
      await click('[data-action="menu"]');
      await waitFor(menuReady, 30000);
      await click('[data-action="story"]');
      assert.match(await text('#card h1'), /Necklace/);
      assert.equal(await evaluate("document.querySelectorAll('.acts > div').length"), 3);
      await click('[data-action="act"]');
      await startDriving('act 1 to start');
      assert.match(await text('#missionEye'), /Act 1 · The Evidence/);
      assert.equal(await evaluate("[...document.querySelectorAll('#chips .chip.ev')].map(c => c.getAttribute('aria-label')).join()"), 'Photos,Fingerprints,Torch,Lockpick,Clothes,Balaclava', 'six pieces of evidence to find in Lisbon');
      assert.deepEqual(errors, []);
    });

    await t.test('rejected: tampered saved data falls back to the defaults', async () => {
      await evaluate("localStorage.setItem('shard-heist-pick', '{\"mode\":\"constructor\",\"veh\":\"__proto__\"}'); localStorage.setItem('shard-heist-city-best', 'NaN'); localStorage.setItem('shard-heist-gfx', 'toString'); true");
      await load();
      assert.equal(await evaluate("document.querySelector('[data-pick=\"mode\"][aria-pressed=\"true\"]').dataset.val"), 'city');
      assert.equal(await evaluate("document.querySelector('[data-pick=\"veh\"][aria-pressed=\"true\"]').dataset.val"), 'car');
      assert.match(await text('.m-foot'), /Lisbon no run yet/);
      assert.deepEqual(errors, []);
      await evaluate('localStorage.clear(), true');
    });

    await t.test('error screen: a blocked library shows a clear message instead of a black page', async () => {
      await send('Network.setBlockedURLs', { urls: ['*cdnjs.cloudflare.com*'] });
      await send('Page.navigate', { url: base + 'room-2-chase/' });
      await waitFor("!document.getElementById('fatal').hidden", 30000, 'error screen');
      assert.equal(await text('#fatalTitle'), 'The game could not load');
      assert.match(await text('#fatalText'), /cdnjs\.cloudflare\.com/);
      assert.ok(await evaluate("document.getElementById('fatalDismiss').hidden"), 'a load failure can only be fixed by reloading');
      await send('Network.setBlockedURLs', { urls: [] });
    });

    await t.test('error screen: no WebGL shows how to fix it', async () => {
      const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: "const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(k, o){ return /webgl/.test(k) ? null : g.call(this, k, o); };" });
      await send('Page.navigate', { url: base + 'room-2-chase/' });
      await waitFor("!document.getElementById('fatal').hidden", 30000, 'error screen');
      assert.equal(await text('#fatalTitle'), '3D graphics are not available');
      assert.match(await text('#fatalText'), /WebGL/);
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    });

    // ---------- Room 1: the escape room ----------
    const hs = k => click(`[data-hotspot="${k}"]`);
    const seconds = async () => { const [m, sec] = (await text('#time')).split(':').map(Number); return m * 60 + sec; };

    await t.test('the game and music volumes are set in the menu, kept, and refused when tampered with', async () => {
      await load();
      const slide = (k, v) => evaluate(`(() => { const r = document.querySelector('[data-vol="${k}"]'); r.value = ${v}; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      assert.equal(await evaluate("document.querySelectorAll('#card [data-vol]').length"), 2, 'two sliders in the menu');
      await slide('game', 40); await slide('music', 15);
      assert.equal(await evaluate("localStorage.getItem('shard-heist-volume')"), '{"game":0.4,"music":0.15}');
      await load();
      assert.equal(await evaluate("document.querySelector('[data-vol=\"game\"]').value + '/' + document.querySelector('[data-vol=\"music\"]').value"), '40/15', 'kept after a reload');
      await click('[data-action="go"]');
      await startDriving('a run');
      await key('keydown', 'KeyP');
      await waitFor("document.querySelectorAll('#card [data-vol]').length === 2", 10000, 'sliders on the pause card');
      await click('[data-action="menu"]');
      await evaluate("localStorage.setItem('shard-heist-volume', '{\"game\":\"loud\"}'), true");
      await load();
      assert.equal(await evaluate("document.querySelector('[data-vol=\"game\"]').value"), '100', 'rejected: tampered volume falls back to full');
      await evaluate("localStorage.removeItem('shard-heist-volume'), true");
      assert.deepEqual(errors, []);
    });

    await t.test('drivers: a name is added in the menu and kept; Enter in the field saves it; bad names and HTML are refused', async () => {
      await evaluate(`localStorage.setItem('shard-heist-board', JSON.stringify({ drivers: ['Sarah', '<img src=x onerror=window.__xss=1>'], runs: { city: [{ name: '<b>Eve</b>', time: 99 }] } })), true`);
      await load();
      const names = "[...document.querySelectorAll('#card [data-driver]')].map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join()";
      assert.equal(await evaluate(names), 'img srcx onerror,Sarah', 'rejected: the HTML in a saved name is shown as plain text');
      assert.equal(await evaluate("!document.querySelector('#card img[src=\"x\"]') && !window.__xss"), true);
      const type = (v, how) => evaluate(`(() => { const i = document.querySelector('#card .drv-input'); i.value = ${JSON.stringify(v)}; ${how === 'enter' ? "i.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }))" : "document.querySelector('#card .drv-add').click()"}; return true; })()`);
      await type('  Alex  ', 'enter');
      assert.equal(await evaluate(names), 'Alex*,img srcx onerror,Sarah');
      assert.ok(await evaluate(menuReady), 'Enter in the name field does not start a run');
      assert.equal(await evaluate("localStorage.getItem('shard-heist-driver')"), 'Alex');
      await type('<>', 'click');
      assert.ok(await evaluate("document.querySelector('#card .drv-input').classList.contains('bad')"), 'rejected: an empty name is marked');
      assert.equal(await evaluate(names), 'Alex*,img srcx onerror,Sarah');
      await load();
      assert.equal(await evaluate(names), 'Alex*,img srcx onerror,Sarah', 'kept after a reload');
      assert.match(await text('#card .drv-hint'), /Driving as Alex/);
      await click('#card [data-driver="Sarah"]');
      assert.equal(await evaluate(names), 'Sarah*,Alex,img srcx onerror');
      assert.equal(await evaluate("localStorage.getItem('shard-heist-driver')"), 'Sarah');
      await evaluate("localStorage.removeItem('shard-heist-board'), localStorage.removeItem('shard-heist-driver'), true");
      assert.deepEqual(errors, []);
    });

    await t.test('phone: tilt steering is offered, hides the steering buttons sideways, and is refused upright', async () => {
      await load();
      // the choice is offered exactly when the browser reports a touch screen and a motion sensor (a mouse-only desktop is refused)
      assert.equal(await evaluate("document.querySelectorAll('[data-steer]').length > 0"), await evaluate("matchMedia('(pointer: coarse)').matches && typeof DeviceOrientationEvent !== 'undefined'"), 'tilt is offered only to touch devices with a sensor');
      const phone = (width, height, type, angle) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true, screenOrientation: { type, angle } });
      await phone(844, 390, 'landscapePrimary', 90);
      await send('Emulation.setTouchEmulationEnabled', { enabled: true });
      await send('DeviceOrientation.setDeviceOrientationOverride', { alpha: 0, beta: 15, gamma: -70 });
      await load();
      assert.equal(await evaluate("document.querySelector('[data-steer=\"tilt\"]').getAttribute('aria-pressed')"), 'true', 'a phone starts with tilt');
      await click('[data-action="go"]');
      await startDriving('run on the phone');
      await waitFor("document.getElementById('touch').classList.contains('tilt')", 20000, 'tilt to take over');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-key=\"left\"]')).visibility"), 'hidden');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-key=\"up\"]')).visibility"), 'visible', 'gas stays');
      await phone(390, 844, 'portraitPrimary', 0);
      await waitFor("!document.getElementById('touch').classList.contains('tilt')", 20000, 'buttons to come back upright');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-key=\"left\"]')).visibility"), 'visible');
      await phone(844, 390, 'landscapePrimary', 90);
      await key('keydown', 'KeyP');
      await waitFor("!!document.querySelector('[data-steer=\"pads\"]')", 20000, 'choice on the pause card');
      await click('[data-steer="pads"]');
      await click('[data-action="resume"]');
      await waitFor("!document.getElementById('touch').classList.contains('tilt')", 20000, 'buttons when chosen');
      assert.equal(await evaluate("localStorage.getItem('shard-heist-steer')"), 'pads');
      await evaluate("localStorage.removeItem('shard-heist-steer'), true");
      assert.deepEqual(errors, []);
      await send('DeviceOrientation.clearDeviceOrientationOverride');
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await send('Emulation.clearDeviceMetricsOverride');
    });

    await t.test('the start page leads to both rooms, in playing order, and runs no script', async () => {
      errors.length = 0;
      await send('Page.navigate', { url: base });
      await waitFor("!!document.querySelector('.start-rooms')", 15000, 'start page');
      // the stylesheet may arrive a moment after the markup
      await waitFor("getComputedStyle(document.querySelector('.start-room b')).fontFamily.includes('Big Shoulders')", 10000, 'start page stylesheet').catch(() => {});
      assert.equal(await evaluate("[...document.querySelectorAll('.start-room')].map(a => a.getAttribute('href')).join()"), 'room-1-escape/,room-2-chase/');
      assert.equal(await evaluate("document.scripts.length"), 0, 'no script on the start page');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.start-room b')).fontFamily.includes('Big Shoulders')"), true, 'the shared fonts load');
      assert.deepEqual(errors, []);
    });

    // ### Math.random is fixed for the escape room, so the mini games are dealt as battleship (the tile), spot the difference
    // ### (the mirror) and tic-tac-toe (the scratches), and the tic-tac-toe bot always takes the last free cell.
    let fixedRandom;
    await t.test('escape room: the briefing explains who, where and how, then the clock starts', async () => {
      fixedRandom = (await send('Page.addScriptToEvaluateOnNewDocument', { source: 'Math.random = () => .99;' })).identifier;
      await send('Page.navigate', { url: base + 'room-1-escape/' });
      await waitFor("!!document.querySelector('#card h1')", LOAD_MS, 'briefing');
      await evaluate("localStorage.removeItem('escape-room-save'), true");
      errors.length = 0;
      await send('Page.navigate', { url: base + 'room-1-escape/' });
      await waitFor("!!document.querySelector('#card h1')", LOAD_MS, 'briefing');
      assert.match(await text('#card'), /Museu de Marinha/);
      assert.equal(await evaluate("getComputedStyle(document.getElementById('btnNotes')).visibility"), 'hidden', 'rejected: the clue button cannot be reached during the briefing');
      await click('[data-do="next"]');
      assert.match(await text('#card'), /inmate 4471/);
      await click('[data-do="next"]');
      assert.ok(await evaluate("document.getElementById('overlay').classList.contains('cine')"), 'card 3 is a scene in the room: Hale shuts the door');
      await waitFor("/ten minutes have begun/.test(document.getElementById('cineLine').textContent)", 60000, 'Hale says the ten minutes have begun');
      for (let i = 0; i < 2; i++) await click('[data-do="next"]');
      assert.ok(!(await evaluate("document.getElementById('overlay').classList.contains('cine')")), 'the scene ends with card 3');
      assert.match(await text('#card'), /Drag/);
      assert.match(await text('#card'), /Arrow keys up and down: walk forwards and backwards/, 'the card explains walking with the arrow keys');
      assert.doesNotMatch(await text('#card'), /Buttons at the bottom/, 'no walk buttons on a computer with a keyboard');
      await click('[data-do="start"]');
      await waitFor("document.getElementById('overlay').hidden && !document.getElementById('hud').classList.contains('off')", 10000, 'clock to start');
      assert.equal(await text('#place'), 'The Door');
      assert.equal(await evaluate("document.getElementById('goBar').hidden"), true, 'the "Walk to" buttons are only shown on touch screens');
      await waitFor("document.getElementById('time').textContent !== '10:00'", 120000, 'clock to run');
      assert.deepEqual(errors, []);
    });

    await t.test('escape room: the arrow keys walk you through the room; while a card is open they do not', async () => {
      // the clock starts at the door, facing it: walking backwards takes you to the sinks without any button
      await key('keydown', 'ArrowDown');
      await waitFor("document.getElementById('place').textContent === 'The Sinks'", 60000, 'walking backwards into the sinks');
      await key('keyup', 'ArrowDown');
      await key('keydown', 'KeyP');
      await waitFor("!document.getElementById('overlay').hidden", 5000, 'pause card');
      await key('keydown', 'ArrowUp'); await sleep(2500); await key('keyup', 'ArrowUp');
      assert.equal(await text('#place'), 'The Sinks', 'rejected: no walking while the pause card is open');
      await key('keydown', 'KeyP');
      await waitFor("document.getElementById('overlay').hidden", 5000, 'resumed');
      assert.deepEqual(errors, []);
    });

    await t.test('escape room: the air vent comes from the Openverse API, is asked for once, kept, and credited on the pause card', async () => {
      await waitFor("!!localStorage.getItem('escape-room-vent')", 30000, 'the choice from the API is kept');
      const kept = JSON.parse(await evaluate("localStorage.getItem('escape-room-vent')"));
      assert.equal(kept.url, VENT_ANSWER.results[1].url, 'the CC0 recording, not the CC BY one');
      let card = '';
      for (let i = 0; i < 30 && !/Openverse/.test(card); i++){
        await key('keydown', 'KeyP'); await waitFor("!document.getElementById('overlay').hidden", 5000, 'pause card');
        card = await text('#card'); await key('keydown', 'KeyP'); await waitFor("document.getElementById('overlay').hidden", 5000, 'resumed');
        if (!/Openverse/.test(card)) await sleep(1000);
      }
      assert.match(card, /Air vent: “Ventilation hum \(test\)” by stand-in \(Freesound, CC0\), found through the Openverse API/);
      assert.equal(ventCalls.api, 1, 'one search of the API');
      assert.ok(ventCalls.file >= 1, 'the recording is played from Freesound');
      assert.deepEqual(errors, []);
    });

    // ### From here on the tests move between the parts of the room with the touch-screen "Walk to" buttons (hidden on a
    // ### computer, but still in the page), so they do not have to steer a walk with the arrow keys every time.
    await t.test('escape room rejected: the car key cannot be taken while the tile is on, and the sinks have nothing to take', async () => {
      await hs('go:stall');
      assert.equal(await evaluate("!!document.querySelector('[data-hotspot=\"take:carkey\"]')"), false);
      assert.equal(await evaluate("!!document.querySelector('[data-hotspot=\"play:tile\"]')"), true);
      // the tile opens its mini game; giving it up (Esc) gives nothing
      await hs('play:tile');
      await waitFor("!!document.querySelector('#card .mg[data-game=\"battleship\"] .bs-grid.theirs button')", 5000, 'battleship');
      assert.match(await text('#card'), /car key/);
      assert.equal(await text('#card .mg-secs'), '30');
      await key('keydown', 'Escape');
      assert.ok(await evaluate("document.getElementById('overlay').hidden"), 'Esc closes the mini game');
      assert.equal(await evaluate("!!document.querySelector('[data-hotspot=\"take:carkey\"]')"), false, 'rejected: no car key without winning');
      await hs('go:sinks');
      assert.equal(await evaluate("[...document.querySelectorAll('[data-hotspot^=\"take:\"]')].length"), 0);
      assert.equal(await evaluate("document.querySelectorAll('.slot.full').length"), 0);
      assert.equal(await text('#place'), 'The Sinks');
    });

    await t.test('escape room: progress is saved and offered after a reload', async () => {
      await hs('go:door');
      await hs('take:mop');
      await send('Page.navigate', { url: base + 'room-1-escape/' });
      await waitFor("!!document.querySelector('[data-do=\"resume\"]')", LOAD_MS, 'continue card');
      assert.match(await text('#card'), /Mop/);
      await click('[data-do="resume"]');
      assert.equal(await text('#place'), 'The Door');
      assert.equal(await evaluate("document.querySelectorAll('.slot.full').length"), 1);
      assert.equal(ventCalls.api, 1, 'after the reload the kept air vent is used: the API is not asked again');
    });

    await t.test('escape room rejected: real keys on a lock wheel never try the code', async () => {
      await hs('go:stall'); await hs('go:hatch'); await hs('lock');
      await waitFor("!!document.getElementById('lockUi')", 5000, 'lock card');
      const realKey = async (code, key, vk) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, code, key, windowsVirtualKeyCode: vk, text: type === 'keyDown' && code === 'Enter' ? '\r' : undefined }); };
      await realKey('Tab', 'Tab', 9);
      await evaluate("document.querySelector('[data-turn=\"3,1\"]').focus(), true");
      const wheel = await evaluate("document.activeElement.dataset.turn || ''");
      assert.equal(wheel, '3,1', 'the wheel has the focus');
      const before = await evaluate("[...document.querySelectorAll('#lockUi output')].map(o => o.textContent).join('')");
      const clock = await seconds();
      await realKey('Enter', 'Enter', 13); await realKey('Enter', 'Enter', 13);
      assert.equal(await evaluate("document.activeElement.dataset.turn || ''"), wheel, 'the wheel keeps the focus');
      assert.notEqual(await evaluate("[...document.querySelectorAll('#lockUi output')].map(o => o.textContent).join('')"), before, 'the wheel turned');
      assert.ok(clock - await seconds() < 10, 'no 30 s penalty');
      assert.match(await text('#tries'), /Each wrong code/);
      for (let i = 0; i < 2; i++) await click('[data-turn="3,-1"]');
      await click('[data-do="close"]');
      await hs('go:stall');
      await hs('go:sinks');
    });

    await t.test('escape room: the mirror plays only when steamed up, and a won mini game gives its digits', async () => {
      assert.equal(await text('#place'), 'The Sinks');
      await hs('play:mirror');
      assert.ok(await evaluate("document.getElementById('overlay').hidden"), 'rejected: no mini game at the dry mirror');
      await hs('tap'); await hs('play:mirror');
      await waitFor("!!document.querySelector('#card .mg[data-game=\"spotdiff\"] canvas')", 5000, 'spot the difference');
      await click('[data-do="close"]');
      await hs('go:door'); await hs('play:scratches');
      await waitFor("!!document.querySelector('#card .mg[data-game=\"tictactoe\"] .ttt-cell')", 5000, 'tic-tac-toe');
      for (const c of [0, 1, 2]){
        await waitFor(`!document.querySelector('.ttt-cell[data-cell="${c}"]').disabled`, 5000, 'the player’s turn');
        await click(`.ttt-cell[data-cell="${c}"]`);
      }
      await waitFor("/Clue found/.test((document.querySelector('#card .eyebrow') || {}).textContent || '')", 10000, 'the clue card');
      assert.match(await text('#card .paper'), /_ _ 1 2/);
      await click('[data-do="close"]');
      assert.equal(await text('#clueCount'), '1 / 3');
      assert.equal(await evaluate("!!document.querySelector('[data-hotspot=\"play:scratches\"]')"), false, 'rejected: a won spot cannot be played again');
      assert.equal(await evaluate("!!document.querySelector('[data-hotspot=\"read:scratches\"]')"), true, 'but its clue can be read again');
      assert.deepEqual(errors, []);
    });

    await t.test('escape room: a wrong code costs 30 s, the right one (1912) is Ending A', async () => {
      await hs('go:stall');
      await hs('go:hatch');
      await hs('lock');
      await waitFor("!!document.getElementById('lockUi')", 5000, 'lock card');
      const before = await seconds();
      await click('[data-do="try"]');
      const after = await seconds();
      assert.ok(before - after >= 30 && before - after <= 32, `wrong code cost ${before - after} s`);
      for (const [w, n, d] of [[0, 1, 1], [1, 1, -1], [2, 1, 1], [3, 2, 1]]) for (let k = 0; k < n; k++) await click(`[data-turn="${w},${d}"]`);
      assert.equal(await evaluate("[...document.querySelectorAll('#lockUi output')].map(o => o.textContent).join('')"), '1912');
      await click('[data-do="try"]');
      await waitFor("/Ending A/.test((document.querySelector('#card .eyebrow') || {}).textContent || '')", 120000, 'Ending A card');
      assert.match(await text('#card'), /Took you long enough/);
      assert.deepEqual(errors, []);
      await evaluate("localStorage.removeItem('escape-room-save'), true");
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixedRandom });
    });
  } finally {
    try { ws.close(); } catch (e) {}
    chrome.kill();
    server.close();
    await new Promise(r => setTimeout(r, 500));
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
});
