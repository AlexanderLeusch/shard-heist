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
const { createServer } = require('../scripts/serve.js');

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
async function load(){
  errors.length = 0;
  await send('Page.navigate', { url: base });
  await waitFor(menuReady, LOAD_MS, 'main menu');
}

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
    else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map(a => a.value || a.description).join(' '));
    // CSP violations, blocked or failed requests (the browser asks for a favicon on its own, which this game does not have)
    else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/favicon.ico/.test(msg.params.entry.url || '')) errors.push(msg.params.entry.text);
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  // Software rendering is slow, so start in Balanced graphics unless a test sets something else on purpose
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try { if (!localStorage.getItem('shard-heist-gfx')) localStorage.setItem('shard-heist-gfx', 'balanced'); } catch (e) {}" });

  try {
    await t.test('the menu loads with all three maps, three vehicles and the story mode', async () => {
      await load();
      assert.equal(await evaluate("document.querySelectorAll('[data-pick=\"mode\"]').length"), 3);
      assert.equal(await evaluate("document.querySelectorAll('[data-pick=\"veh\"]').length"), 3);
      assert.ok(await evaluate("!!document.querySelector('[data-action=\"story\"]')"));
      assert.ok(await evaluate("document.getElementById('fatal').hidden"), 'no error screen');
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
      await waitFor(playing, 30000, 'run to start');
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
      await waitFor(playing, 30000, 'act 1 to start');
      assert.match(await text('#missionEye'), /Act 1 · The Scatter/);
      assert.deepEqual(errors, []);
    });

    await t.test('rejected: tampered saved data falls back to the defaults', async () => {
      await evaluate("localStorage.setItem('shard-heist-pick', '{\"mode\":\"constructor\",\"veh\":\"__proto__\"}'); localStorage.setItem('shard-heist-city-best', 'NaN'); localStorage.setItem('shard-heist-gfx', 'toString'); true");
      await load();
      assert.equal(await evaluate("document.querySelector('[data-pick=\"mode\"][aria-pressed=\"true\"]').dataset.val"), 'city');
      assert.equal(await evaluate("document.querySelector('[data-pick=\"veh\"][aria-pressed=\"true\"]').dataset.val"), 'car');
      assert.match(await text('.m-foot'), /City no run yet/);
      assert.deepEqual(errors, []);
      await evaluate('localStorage.clear(), true');
    });

    await t.test('error screen: a blocked library shows a clear message instead of a black page', async () => {
      await send('Network.setBlockedURLs', { urls: ['*cdnjs.cloudflare.com*'] });
      await send('Page.navigate', { url: base });
      await waitFor("!document.getElementById('fatal').hidden", 30000, 'error screen');
      assert.equal(await text('#fatalTitle'), 'The game could not load');
      assert.match(await text('#fatalText'), /cdnjs\.cloudflare\.com/);
      assert.ok(await evaluate("document.getElementById('fatalDismiss').hidden"), 'a load failure can only be fixed by reloading');
      await send('Network.setBlockedURLs', { urls: [] });
    });

    await t.test('error screen: no WebGL shows how to fix it', async () => {
      const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: "const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(k, o){ return /webgl/.test(k) ? null : g.call(this, k, o); };" });
      await send('Page.navigate', { url: base });
      await waitFor("!document.getElementById('fatal').hidden", 30000, 'error screen');
      assert.equal(await text('#fatalTitle'), '3D graphics are not available');
      assert.match(await text('#fatalText'), /WebGL/);
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    });
  } finally {
    try { ws.close(); } catch (e) {}
    chrome.kill();
    server.close();
    await new Promise(r => setTimeout(r, 500));
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
});
