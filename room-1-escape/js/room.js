// Room 1: the 3D prison washroom (rendering, camera, hotspots, sound, cards). The rules it plays by live in src/rules.js.
(() => {
'use strict';
if (typeof THREE === 'undefined' || typeof EscapeRules === 'undefined' || typeof MiniGames === 'undefined'){
  if (window.ShardFatal) ShardFatal('The game could not load', 'The 3D engine did not arrive. Check your internet connection or turn off content blockers for this page, then reload.');
  return;
}
const R = EscapeRules;
// Every hex colour in this file is written in sRGB; convert to linear for the filmic pipeline
(() => { const setHex = THREE.Color.prototype.setHex; THREE.Color.prototype.setHex = function(hex){ setHex.call(this, hex); return this.convertSRGBToLinear(); }; })();

// ---------- State and saving ----------
// ### S is the whole game state from rules.js. It only ever changes through act() (player actions) and the clock in
// ### frame(). It is saved to localStorage after every accepted action and every few seconds while the clock runs.
const $ = id => document.getElementById(id);
const readStore = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const writeStore = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
let S = R.newState(), paused = false, saveTimer = 0;
// nothing has happened yet on the briefing, and it must not replace a real save
const save = () => { if (S.scene !== 'intro') writeStore(R.SAVE_KEY, JSON.stringify(S)); };
const saved = R.restore(readStore(R.SAVE_KEY));
const COARSE = matchMedia('(pointer: coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = t => { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- Renderer, scene, camera ----------
// ### One renderer with soft shadows and filmic tone mapping. The room is lit like a real night-time washroom: one caged
// ### fluorescent tube that burns steadily (it no longer flickers), a weaker lamp over the stall, and cold corridor light
// ### through the door window.
const canvas = $('room');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
catch (e){ ShardFatal('3D graphics are not available', 'This game needs WebGL. Turn on hardware acceleration in your browser settings, update your graphics driver or try another browser.'); return; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));   // then set by adaptResolution() to suit the frame rate
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;   // filtered with each light's shadow.radius: as soft, and cheaper per pixel
// ### Nothing in the room moves most of the time, so the shadow maps are only redrawn for the frames in which something
// ### does (the mop, the tile, the hatch lid, the door and Hale in the briefing). shadowsMoved() asks for that.
renderer.shadowMap.autoUpdate = false;
let shadowFrames = 2;
const shadowsMoved = () => { shadowFrames = 2; };
// sharp textures at grazing angles, but no more than 8 samples: beyond that the cost rises and the picture barely changes
const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050607);
scene.fog = new THREE.FogExp2(0x0b0e0e, 0.03);
// the near plane sits 5 cm in front of the eye: you can never get closer to a wall, and the depth buffer stays precise
// enough that decals on the walls never shimmer
const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.05, 40);
const room = new THREE.Group();
scene.add(room);
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); ShardFatal('The graphics were reset', 'The browser stopped the 3D view, usually after a driver reset or when memory runs low. Reload to continue.'); });

// ---------- Painted textures ----------
// ### Every surface is painted on a canvas at start-up: glazed tiles with grout and grime, flaking paint, stained concrete,
// ### diamond-plate steel, scratched graffiti and the steamed-up mirror. No image files are downloaded.
const TEX = COARSE ? 512 : 1024;
const rnd = mulberry32(4471);
// ### Paints a texture on a canvas, so the room needs no image files.
function canvasTex(w, h, draw, repeat){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding; t.anisotropy = ANISO;
  if (repeat){ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
// ### Adds dirt, scratches and stains to a wall texture.
function grime(g, w, h, n, color, maxR, lowBias){
  for (let i = 0; i < n; i++){
    const x = rnd() * w, y = lowBias ? h - Math.pow(rnd(), 2) * h : rnd() * h, r = (0.2 + rnd()) * maxR;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
// ### Tiles: 12 x 12 glazed tiles of 15 cm in the old institutional green, so one picture covers 1.8 m of wall (the whole
// ### height of the tiling). Over the years tiles broke and were replaced with whatever was in the store: cream, pale
// ### mint, a darker bottle green, a sandy one. Every wall paints its own picture, so the odd tiles sit somewhere else.
const TILE_ODD = [[.012, [200, 194, 164]], [.026, [140, 166, 136]], [.04, [54, 84, 62]], [.045, [176, 158, 120]]];
const tileTex = () => canvasTex(TEX, TEX, (g, w, h) => {
  const n = 12, b = w / n, gw = Math.max(2, w / 300);
  g.fillStyle = '#34423a'; g.fillRect(0, 0, w, h);   // the grout, dark with dirt
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++){
    const odd = rnd(), l = (rnd() - .5) * 16, x = i * b + gw, y = j * b + gw, s = b - gw * 2;
    const c = (TILE_ODD.find(([p]) => odd < p) || [0, [88 + l, 120 + l, 94 + l * .8]])[1];
    g.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; g.fillRect(x, y, s, s);
    const gl = g.createLinearGradient(x, y, x + s, y + s);
    gl.addColorStop(0, 'rgba(255,255,255,.12)'); gl.addColorStop(.5, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(0,0,0,.1)');
    g.fillStyle = gl; g.fillRect(x, y, s, s);
    // crazing in the glaze and the odd crack right across a tile
    if (rnd() < .12){ g.strokeStyle = 'rgba(30,40,32,.5)'; g.lineWidth = 1.2; g.beginPath(); let cx = x + rnd() * s, cy = y; g.moveTo(cx, cy); for (let k = 0; k < 5; k++){ cx += (rnd() - .5) * s * .4; cy += s / 5; g.lineTo(cx, cy); } g.stroke(); }
    if (rnd() < .05){ g.fillStyle = 'rgba(40,36,28,.45)'; g.beginPath(); g.arc(x + (rnd() < .5 ? 0 : s), y + rnd() * s, 2 + rnd() * s * .12, 0, 7); g.fill(); }   // a chipped corner
  }
  grime(g, w, h, 30, 'rgba(70,58,30,.18)', w * .08, true);
  grime(g, w, h, 20, 'rgba(30,40,30,.14)', w * .05, false);
}, [1, 1]);
const concreteTex = canvasTex(TEX, TEX, (g, w, h) => {
  g.fillStyle = '#5a5d5b'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 16000; i++){ const v = rnd(); g.fillStyle = v > .5 ? `rgba(255,255,255,${(v - .5) * .12})` : `rgba(0,0,0,${v * .2})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
  grime(g, w, h, 40, 'rgba(40,34,24,.2)', w * .14, false);
  g.strokeStyle = 'rgba(30,30,30,.35)'; g.lineWidth = 2;
  for (let i = 1; i < 2; i++){ g.beginPath(); g.moveTo(0, i * h / 2); g.lineTo(w, i * h / 2); g.stroke(); g.beginPath(); g.moveTo(i * w / 2, 0); g.lineTo(i * w / 2, h); g.stroke(); }
}, [4, 3]);
const plateTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#6f777b'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 32) for (let x = (y / 32 % 2) * 16; x < w; x += 32){
    g.save(); g.translate(x + 8, y + 8); g.rotate(Math.PI / 4 * ((x + y) / 32 % 2 ? 1 : -1));
    g.fillStyle = '#9aa2a6'; g.fillRect(-9, -2.5, 18, 5); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(-9, 2.5, 18, 1.5); g.restore();
  }
  grime(g, w, h, 8, 'rgba(60,40,20,.25)', 60, false);
}, [2, 2]);
// Scratched graffiti on the stall wall, including the clue
const graffitiTex = canvasTex(1024, 640, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  const scratch = (text, x, y, size, rot, alpha) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.font = `700 ${size}px "Arial Narrow", Arial, sans-serif`;
    for (let k = 0; k < 3; k++){ g.strokeStyle = `rgba(230,232,225,${alpha * (1 - k * .25)})`; g.lineWidth = 1.4; g.strokeText(text, (rnd() - .5) * 2, (rnd() - .5) * 2); }
    g.restore();
  };
  scratch('SHE WAS UNSINKABLE', 70, 150, 74, -.03, .85);
  scratch('SHE SAILED ONLY ONCE', 90, 260, 66, .02, .85);
  scratch('THE YEAR OPENS THE FLOOR', 60, 370, 62, -.015, .9);
  scratch('IIII IIII IIII II', 640, 520, 44, 0, .5);
  scratch('J.R. WAS HERE', 80, 560, 40, .05, .45);
  scratch('NO WAY OUT?', 660, 80, 42, -.06, .4);
  g.strokeStyle = 'rgba(230,232,225,.35)'; g.lineWidth = 1;
  for (let i = 0; i < 40; i++){ const x = rnd() * w, y = rnd() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - .5) * 120, y + (rnd() - .5) * 30); g.stroke(); }
});
// Scratches in the tiles beside the door: the date the "unsinkable" ship went down, the year gouged out. Once its mini game
// is won, the last two digits of the code show under it (paintScratches is called again with won = true).
const paintScratches = (g, w, h, won) => {
  g.clearRect(0, 0, w, h);
  const scratch = (text, x, y, size, rot, alpha) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.font = `700 ${size}px "Arial Narrow", Arial, sans-serif`;
    // in the green glaze a scratch shows as a dark groove full of grime, with a bright chipped edge beside it
    for (let k = 0; k < 3; k++){ g.strokeStyle = `rgba(38,40,36,${alpha * (1 - k * .2)})`; g.lineWidth = 2.6; g.strokeText(text, (rnd() - .5) * 2.5, (rnd() - .5) * 2.5); }
    g.strokeStyle = `rgba(255,255,250,${alpha * .5})`; g.lineWidth = 1; g.strokeText(text, 1.5, 1.5);
    g.restore();
  };
  scratch('THE UNSINKABLE', 60, 130, 76, -.025, .85);
  scratch('WENT DOWN ON HER FIRST VOYAGE', 50, 230, 52, .015, .85);
  scratch('15 APRIL', 70, 360, 82, -.02, .9);
  // the year is scratched over until nothing can be read
  g.strokeStyle = 'rgba(38,40,36,.85)'; g.lineWidth = 3;
  for (let i = 0; i < 60; i++){ const x = 440 + rnd() * 200, y = 290 + rnd() * 70; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - .5) * 60, y + (rnd() - .5) * 60); g.stroke(); }
  scratch('1500 LOST', 90, 470, 60, .03, .8);
  if (won) scratch('CODE  _ _ 1 2', 420, 580, 92, -.03, 1);
  scratch('IIII IIII', 700, 560, 40, 0, .45);
  g.strokeStyle = 'rgba(38,40,36,.3)'; g.lineWidth = 1.2;
  for (let i = 0; i < 30; i++){ const x = rnd() * w, y = rnd() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - .5) * 120, y + (rnd() - .5) * 30); g.stroke(); }
};
const scratchesTex = canvasTex(1024, 640, (g, w, h) => paintScratches(g, w, h, false));
// Steam on the mirror, with the letters someone traced into it left clear. Once the mirror's mini game is won, the first
// two digits of the code show in the steam too.
const paintSteam = (g, w, h, won) => {
  g.clearRect(0, 0, w, h);
  const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(225,232,232,.95)'); gr.addColorStop(1, 'rgba(225,232,232,.72)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 3000; i++){ g.fillStyle = `rgba(255,255,255,${rnd() * .25})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, rnd() * 3, 0, 7); g.fill(); }
  g.globalCompositeOperation = 'destination-out';
  g.font = '800 132px "Arial Narrow", Arial, sans-serif'; g.textAlign = 'center'; g.lineWidth = 16; g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0,0,0,1)';
  if (won){ g.font = '800 96px "Arial Narrow", Arial, sans-serif'; g.strokeText('UNSINKABLE?', w / 2, h * .36); g.font = '800 150px "Arial Narrow", Arial, sans-serif'; g.strokeText('1 9 _ _', w / 2, h * .8); }
  else g.strokeText('UNSINKABLE?', w / 2, h * .58);
  for (let i = 0; i < 9; i++){ const x = 160 + rnd() * (w - 320), y = h * .6; g.fillRect(x, y, 5, 40 + rnd() * 90); }
  g.globalCompositeOperation = 'source-over';
};
const steamTex = canvasTex(1024, 512, (g, w, h) => paintSteam(g, w, h, false));
// ### Paints a clue texture again (the mirror and the scratches show their digits once won).
const painted = new Map();
function repaint(tex, paint, won){
  if ((painted.get(tex) || false) === won) return;
  painted.set(tex, won);
  const c = tex.image; paint(c.getContext('2d'), c.width, c.height, won); tex.needsUpdate = true;
}
const signTex = canvasTex(1024, 384, (g, w, h) => {
  g.fillStyle = '#d9cfa8'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1d1f1e'; g.fillRect(0, 0, w, 70); g.fillRect(0, h - 26, w, 26);
  g.font = '800 46px "Arial Narrow", Arial, sans-serif'; g.fillStyle = '#d9cfa8'; g.fillText('CELL BLOCK D · WASHROOM 2', 30, 52);
  g.fillStyle = '#1d1f1e'; g.font = '800 64px "Arial Narrow", Arial, sans-serif'; g.fillText('10 MINUTES MAXIMUM', 30, 160);
  g.font = '600 40px "Arial Narrow", Arial, sans-serif'; g.fillText('ONE INMATE AT A TIME · NO TALKING', 30, 230);
  g.fillText('REPORT DAMAGE TO THE DUTY OFFICER', 30, 290);
  grime(g, w, h, 12, 'rgba(90,70,40,.25)', 120, false);
});
const corridorTex = canvasTex(256, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#cfe7ff'); gr.addColorStop(1, '#5d7da6');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const guardTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#05070a';
  g.beginPath(); g.arc(w * .52, h * .38, w * .17, 0, 7); g.fill();
  g.beginPath(); g.moveTo(w * .1, h); g.quadraticCurveTo(w * .12, h * .6, w * .52, h * .58); g.quadraticCurveTo(w * .92, h * .6, w * .94, h); g.fill();
  g.fillRect(w * .3, h * .2, w * .44, h * .06);
  g.fillRect(w * .36, h * .1, w * .32, h * .12);
});
// ### Paints a digit for the wheels of the combination lock.
const digitTex = () => { const c = document.createElement('canvas'); c.width = c.height = 64; const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t; };
function drawDigit(t, d){
  const g = t.image.getContext('2d');
  g.fillStyle = '#262b2e'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#e9ece6'; g.font = '700 46px Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(d), 32, 35);
  t.needsUpdate = true;
}
// ### The relief of the tiles: one height map (the grout lies lower, the glaze has a rounded edge) and one gloss map (the
// ### glaze is smooth, the grout matt), painted once and shared by every tiled surface.
const tileRelief = (() => {
  const S2 = 512, n = 8, s = S2 / n, gw = s * .037;
  const bump = document.createElement('canvas'), gloss = document.createElement('canvas');
  bump.width = bump.height = gloss.width = gloss.height = S2;
  const b = bump.getContext('2d'), r = gloss.getContext('2d');
  b.fillStyle = '#000'; b.fillRect(0, 0, S2, S2); r.fillStyle = '#ececec'; r.fillRect(0, 0, S2, S2);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++){
    for (let k = 0; k < 4; k++){ const v = 110 + k * 45, o = gw + k * 1.2; b.fillStyle = `rgb(${v},${v},${v})`; b.fillRect(i * s + o, j * s + o, s - o * 2, s - o * 2); }
    const v = 46 + rnd() * 30 | 0; r.fillStyle = `rgb(${v},${v},${v})`; r.fillRect(i * s + gw, j * s + gw, s - gw * 2, s - gw * 2);
  }
  // dull patches where years of cleaning have worn the glaze
  for (let i = 0; i < 40; i++){ const x = rnd() * S2, y = rnd() * S2, rr = 10 + rnd() * 40, g = r.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, 'rgba(170,170,170,.35)'); g.addColorStop(1, 'rgba(170,170,170,0)'); r.fillStyle = g; r.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
  // ### The height map is turned into a normal map once. A bump map is worked out per pixel on screen and sparkles along
  // ### the grout as you move; a normal map is filtered like any texture, so the relief stays calm while you walk and look.
  const normal = document.createElement('canvas'); normal.width = normal.height = S2;
  const hd = b.getImageData(0, 0, S2, S2).data, nc = normal.getContext('2d'), out = nc.createImageData(S2, S2), o = out.data;
  const h = (x, y) => hd[(((y + S2) % S2) * S2 + (x + S2) % S2) * 4] / 255;
  for (let y = 0; y < S2; y++) for (let x = 0; x < S2; x++){
    const dx = (h(x + 1, y) - h(x - 1, y)) * 2.2, dy = (h(x, y + 1) - h(x, y - 1)) * 2.2, l = Math.hypot(dx, dy, 1), i = (y * S2 + x) * 4;
    o[i] = (-dx / l * .5 + .5) * 255; o[i + 1] = (dy / l * .5 + .5) * 255; o[i + 2] = (1 / l * .5 + .5) * 255; o[i + 3] = 255;
  }
  nc.putImageData(out, 0, 0);
  return { normal, gloss };
})();
// ### A tiled material for w x h metres of wall: the colour picture (12 tiles across) and the relief and gloss (8 tiles
// ### across) start at the same corner and share the 15 cm grid, so the grout lines meet exactly.
function tileMat(w, h = TILE_H){
  const map = tileTex(), mk = (img, aniso) => { const t = new THREE.CanvasTexture(img); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; t.repeat.set(w / 1.2, h / 1.2); return t; };
  map.repeat.set(w / 1.8, h / 1.8);
  return new THREE.MeshStandardMaterial({ map, normalMap: mk(tileRelief.normal, ANISO), roughnessMap: mk(tileRelief.gloss, Math.min(ANISO, 4)), roughness: 1, metalness: 0 });
}
// ### Powder-coated stall partitions: a slightly mottled finish, scuffs, scratched tally marks and dirt rising from the floor.
const partitionTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#6f7c75'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 5000; i++){ const v = rnd() < .5 ? 255 : 0; g.fillStyle = `rgba(${v},${v},${v},${rnd() * .05})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
  grime(g, w, h, 30, 'rgba(50,44,30,.22)', w * .12, true);
  g.strokeStyle = 'rgba(205,210,200,.35)'; g.lineWidth = 1;
  for (let i = 0; i < 26; i++){ const x = rnd() * w, y = rnd() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - .5) * 70, y + (rnd() - .5) * 18); g.stroke(); }
  g.fillStyle = 'rgba(30,30,28,.3)'; for (let i = 0; i < 12; i++){ g.beginPath(); g.arc(rnd() * w, rnd() * h, 1 + rnd() * 3, 0, 7); g.fill(); }
});
// ### The ceiling: painted concrete with the joints of the slabs and brown water stains around the old leaks.
const ceilingTex = canvasTex(TEX / 2, TEX / 2, (g, w, h) => {
  g.fillStyle = '#4a4f4c'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 6000; i++){ const v = rnd(); g.fillStyle = v > .5 ? `rgba(255,255,255,${(v - .5) * .08})` : `rgba(0,0,0,${v * .12})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
  for (let k = 0; k < 5; k++){ const x = rnd() * w, y = rnd() * h, r = 20 + rnd() * 70;
    for (let j = 0; j < 3; j++){ g.strokeStyle = `rgba(110,80,40,${.25 - j * .06})`; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y, r * (1 - j * .2), r * (.7 - j * .12), rnd(), 0, 7); g.stroke(); }
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(90,70,40,.25)'); gr.addColorStop(1, 'rgba(90,70,40,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
}, [2, 1.5]);
// ### Soft shadows where surfaces meet (ambient occlusion), painted as gradients rather than computed every frame.
const aoTex = canvasTex(8, 128, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(0,0,0,.62)'); gr.addColorStop(.35, 'rgba(0,0,0,.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
const blobTex = canvasTex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(0,0,0,.7)'); gr.addColorStop(.55, 'rgba(0,0,0,.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
// ### Dirt on the floor: rings of limescale and grime around the toilet and the drain, stains and drips.
const stainTex = canvasTex(256, 256, (g, w, h) => {
  for (let i = 0; i < 26; i++){ const x = w / 2 + (rnd() - .5) * w * .5, y = h / 2 + (rnd() - .5) * h * .5, r = 10 + rnd() * 50, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${60 + rnd() * 40 | 0},${50 + rnd() * 30 | 0},30,.3)`); gr.addColorStop(1, 'rgba(60,50,30,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  g.strokeStyle = 'rgba(200,195,170,.25)'; g.lineWidth = 3; g.beginPath(); g.ellipse(w / 2, h / 2, w * .36, h * .3, 0, 0, 7); g.stroke();
});
// ### Grilles: slots for the air vent, small holes for the intercom speaker.
const grilleTex = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#9aa2a4'; g.fillRect(0, 0, w, h); g.fillStyle = '#121414'; for (let y = 10; y < h - 8; y += 12) g.fillRect(8, y, w - 16, 6); });
const speakerTex = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#a4abad'; g.fillRect(0, 0, w, h); g.fillStyle = '#181a1a'; for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (Math.hypot(x - 3, y - 3) < 3.4){ g.beginPath(); g.arc(22 + x * 14, 22 + y * 14, 3.5, 0, 7); g.fill(); } });

// soft gradients and small parts need no extra texture samples at grazing angles; the ceiling and steel need only a few
for (const t of [aoTex, blobTex, stainTex, grilleTex, speakerTex]) t.anisotropy = 1;
ceilingTex.anisotropy = partitionTex.anisotropy = 4;

// ---------- Scanned textures (Poly Haven, CC0) ----------
// ### Real photographed surfaces from Poly Haven's free asset library (polyhaven.com, all CC0), fetched once through its
// ### API and kept in room-1-escape/textures: a scratched hangar floor of poured concrete, a painted cinder-block wall,
// ### a scratched steel plate whose gloss and dents give the stainless steel its wear, and the "Bank Vault" HDRI (a
// ### caged concrete vault under a fluorescent tube) that every metal surface reflects. Each file loads once; every
// ### surface that uses it gets its own copy with its own repeat, and all copies are refreshed when the picture arrives.
const SCAN = (() => {
  const loader = new THREE.TextureLoader(), files = {};
  return (file, srgb, rx = 1, ry = 1, aniso = ANISO) => {
    let f = files[file];
    if (!f){
      f = files[file] = { copies: [], img: null };
      loader.load('textures/' + file, t => { f.img = t.image; for (const c of f.copies){ c.image = t.image; c.needsUpdate = true; } shadowsMoved(); });
    }
    const t = new THREE.Texture(f.img || undefined);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = aniso;
    if (srgb) t.encoding = THREE.sRGBEncoding;
    if (f.img) t.needsUpdate = true;
    f.copies.push(t);
    return t;
  };
})();
// ### Painted cinder blocks for the walls above the tiles (one picture is about a metre of wall). The scan is a grey
// ### block; the tint (linear, above 1) paints it the yellowed cream of the walls in the photo, keeping its pores and joints.
function blockMat(w, h){
  const m = new THREE.MeshStandardMaterial({ map: SCAN('wall-blocks-color.jpg', true, w, h), normalMap: SCAN('wall-blocks-normal.jpg', false, w, h, 4),
    normalScale: new THREE.Vector2(1.2, 1.2), roughnessMap: SCAN('wall-blocks-rough.jpg', false, w, h, 2), roughness: 1.1 });
  m.color.setRGB(4.1, 3.75, 3.2);
  return m;
}
// ### Stainless steel: the scanned scratches change the gloss and dent the surface a little; the vault HDRI does the rest.
function steelMat(color, roughness, o){
  return new THREE.MeshStandardMaterial(Object.assign({ color, metalness: 1, roughness, roughnessMap: SCAN('steel-scratches-rough.jpg', false, 1, 1),
    normalMap: SCAN('steel-scratches-normal.jpg', false, 1, 1, 4), normalScale: new THREE.Vector2(.35, .35), envMapIntensity: 1.25 }, o));
}

// ---------- Materials ----------
// ### The surfaces of the cell: scanned textures for the concrete, the cinder blocks and the steel, painted canvas
// ### textures for everything that tells the story (the tiles, the graffiti, the scratches, the steam, the sign).
const M = {
  tiles: w => tileMat(w),
  floor: new THREE.MeshStandardMaterial({ map: concreteTex, roughness: .78 }),
  ceiling: new THREE.MeshStandardMaterial({ map: ceilingTex, roughness: .95, normalMap: SCAN('floor-concrete-normal.jpg', false, 3, 2.25, 4), normalScale: new THREE.Vector2(.8, .8) }),
  steel: steelMat(0xc9cfd2, 1.35),
  dullSteel: steelMat(0x9aa2a6, 2.1, { envMapIntensity: .9 }),
  // the toilet: polished stainless steel, seen from both sides inside the bowl and the basin
  bowl: steelMat(0xd2d8da, 1.1, { side: THREE.DoubleSide }),
  // the steel bench, the urinal trough and the showers: plain stainless, a little duller where hands and water wear it
  worn: steelMat(0xb4bcc0, 1.7),
  water: new THREE.MeshStandardMaterial({ color: 0x5d6b5e, metalness: .1, roughness: .04, transparent: true, opacity: .88 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xe8ecee, metalness: 1, roughness: .12 }),
  cove: new THREE.MeshStandardMaterial({ color: 0x24382c, roughness: .35 }),
  grille: new THREE.MeshStandardMaterial({ map: grilleTex, metalness: .5, roughness: .6 }),
  speaker: new THREE.MeshStandardMaterial({ map: speakerTex, metalness: .6, roughness: .5 }),
  plastic: new THREE.MeshStandardMaterial({ color: 0xd9dad3, roughness: .45 }),
  red: new THREE.MeshStandardMaterial({ color: 0xa8251c, roughness: .4 }),
  led: new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a1a, emissiveIntensity: 3 }),
  ao: new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  blob: new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  stain: new THREE.MeshStandardMaterial({ map: stainTex, transparent: true, depthWrite: false, roughness: .9, polygonOffset: true, polygonOffsetFactor: -3 }),
  mirror: new THREE.MeshStandardMaterial({ color: 0xdfe4e6, metalness: 1, roughness: .12 }),
  door: new THREE.MeshStandardMaterial({ color: 0x3e4b54, metalness: .55, roughness: .55 }),
  partition: new THREE.MeshStandardMaterial({ map: partitionTex, metalness: .35, roughness: .5 }),
  plate: new THREE.MeshStandardMaterial({ map: plateTex, metalness: .75, roughness: .4 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 1 }),
  pipe: new THREE.MeshStandardMaterial({ color: 0x59605c, metalness: .6, roughness: .45 }),
  bucket: new THREE.MeshStandardMaterial({ color: 0xe0b021, roughness: .55 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x9c7a50, roughness: .7 }),
  mopHead: new THREE.MeshStandardMaterial({ color: 0xbdb7a6, roughness: 1 }),
  paper: new THREE.MeshStandardMaterial({ color: 0xe9dfc4, roughness: .9, side: THREE.DoubleSide }),
  tube: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe9d2, emissiveIntensity: 2.4 }),
  corridor: new THREE.MeshBasicMaterial({ map: corridorTex }),
  guard: new THREE.MeshBasicMaterial({ map: guardTex, transparent: true, opacity: 0, depthWrite: false }),
  graffiti: new THREE.MeshStandardMaterial({ map: graffitiTex, transparent: true, roughness: .8, depthWrite: false }),
  scratches: new THREE.MeshStandardMaterial({ map: scratchesTex, transparent: true, roughness: .8, depthWrite: false }),
  steam: new THREE.MeshStandardMaterial({ map: steamTex, transparent: true, opacity: 0, roughness: 1, depthWrite: false }),
  sign: new THREE.MeshStandardMaterial({ map: signTex, roughness: .8 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x1c1d1e, roughness: .9 }),
  frost: new THREE.MeshStandardMaterial({ color: 0x9fb4c4, emissive: 0x24384e, emissiveIntensity: 1, roughness: .2, metalness: 0 }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xf2c014, roughness: .5 }),
  black: new THREE.MeshStandardMaterial({ color: 0x141516, roughness: .6 })
};

// ---------- Water on the floor ----------
// ### The puddles are real mirrors. When one is in view the room is drawn a second time, at 40 % of the width and height
// ### of the screen, by a camera mirrored under the floor (the way three.js's Reflector does it, with an oblique near plane
// ### that cuts away everything below the floor). Each point of a puddle looks that picture up where its mirror image
// ### is, so the lamps, the steel and the red glow show in the water: bent a little by slow ripples and by the rings of
// ### the drops that fall from the shower head. Where the water stands the concrete is darker, round it a damp rim;
// ### the flatter you look across a puddle, the more it mirrors (Fresnel). The shapes are noise, so no two are alike.
const WATER = (() => {
  // fractal noise for the outlines, painted once (three octaves that tile), so the shader reads it instead of working it out
  const noise = (() => {
    const S = 128, data = new Uint8Array(S * S * 4), oct = [[4, .55], [8, .3], [16, .15]].map(([n, a]) => ({ n, a, g: Array.from({ length: n * n }, rnd) }));
    const fade = t => t * t * (3 - 2 * t);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
      let v = 0;
      for (const o of oct){
        const fx = x / S * o.n, fy = y / S * o.n, ix = Math.floor(fx), iy = Math.floor(fy), sx = fade(fx - ix), sy = fade(fy - iy), at = (i, j) => o.g[(j % o.n) * o.n + i % o.n];
        v += o.a * ((at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy);
      }
      const i = (y * S + x) * 4; data[i] = data[i + 1] = data[i + 2] = v * 255; data[i + 3] = 255;
    }
    const t = new THREE.DataTexture(data, S, S); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    return t;
  })();
  const rt = new THREE.WebGLRenderTarget(16, 16, { encoding: THREE.sRGBEncoding, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const texMat = new THREE.Matrix4(), drip = new THREE.Vector4(3.715, 1.55, -99, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { tRefl: { value: rt.texture }, tNoise: { value: noise }, texMat: { value: texMat }, time: { value: 0 }, drip: { value: drip } },
    vertexShader: `
      uniform mat4 texMat; varying vec4 vProj; varying vec3 vWorld; varying vec2 vUv;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vUv = uv; vProj = texMat * w; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform sampler2D tRefl, tNoise; uniform float time; uniform vec4 drip; varying vec4 vProj; varying vec3 vWorld; varying vec2 vUv;
      void main(){
        // the outline: an ellipse frayed by the noise; water inside, a damp rim round it
        float n = texture2D(tNoise, vWorld.xz * 0.4).r * 0.75 + texture2D(tNoise, vWorld.xz * 1.9 + 0.37).r * 0.25;
        float d = length((vUv - 0.5) * 2.0) * 1.25 + (n - 0.5) * 0.5;
        float water = smoothstep(0.8, 0.68, d), damp = smoothstep(1.0, 0.6, d);
        if (damp <= 0.0) discard;
        // slow ripples, and rings running out from the last drop
        vec2 w = vec2(sin(vWorld.x * 21.0 + time * 1.1) + sin(vWorld.z * 29.0 - time * 1.6), sin(vWorld.z * 17.0 + time * 1.3) + sin(vWorld.x * 25.0 - time * 0.9)) * 0.0015;
        vec2 dv = vWorld.xz - drip.xy; float dl = length(dv), age = time - drip.z, front = dl - age * 0.3;
        w += dv / max(dl, 0.001) * sin(front * 95.0) * exp(-front * front * 180.0) * exp(-age * 1.3) * 0.014;
        vec4 p = vProj; p.xy += w * p.w;
        // four taps a little apart: water on rough concrete never mirrors quite sharply
        vec2 b = vec2(0.0015, 0.0025) * p.w;
        vec3 refl = (sRGBToLinear(texture2DProj(tRefl, p + vec4(b, 0.0, 0.0))).rgb + sRGBToLinear(texture2DProj(tRefl, p - vec4(b, 0.0, 0.0))).rgb
          + sRGBToLinear(texture2DProj(tRefl, p + vec4(b.y, -b.x, 0.0, 0.0))).rgb + sRGBToLinear(texture2DProj(tRefl, p - vec4(b.y, -b.x, 0.0, 0.0))).rgb) * 0.25;
        refl *= 1.0 + smoothstep(0.6, 1.0, max(refl.r, max(refl.g, refl.b))) * 2.5;   // the lamps glint
        float F = 0.3 + 0.7 * pow(1.0 - clamp(normalize(cameraPosition - vWorld).y, 0.0, 1.0), 4.0);
        float a = mix(damp * 0.35, 0.55 + 0.45 * F, water);
        gl_FragColor = linearToOutputTexel(vec4(refl, 1.0));
        gl_FragColor = vec4(gl_FragColor.rgb * water * F, a);
      }`,
    transparent: true, depthWrite: false, premultipliedAlpha: true, polygonOffset: true, polygonOffsetFactor: -4
  });
  const boxes = [], mirror = new THREE.PerspectiveCamera(), frustum = new THREE.Frustum(), pv = new THREE.Matrix4();
  const camPos = new THREE.Vector3(), look = new THREE.Vector3(), rot = new THREE.Matrix4(), plane = new THREE.Plane(), clip = new THREE.Vector4(), q = new THREE.Vector4(), size = new THREE.Vector2();
  const N = new THREE.Vector3(0, 1, 0), P0 = new THREE.Vector3(0, .004, 0);
  // the drop that falls from the shower head every few seconds
  const drop = new THREE.Mesh(new THREE.SphereGeometry(.006, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc8d4d8, roughness: .05, metalness: .5 }));
  drop.scale.y = 1.7; drop.visible = false; scene.add(drop);
  let dropT = 1.5, lastT = -1;
  const lastView = new THREE.Matrix4();
  return {
    mat, rt,
    // ### A puddle of w x d metres (the water fills about four fifths of it).
    puddle(w, d, x, z){ const m = flat(w, d, mat, x, z, .005); m.renderOrder = 1; boxes.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, .005, z), new THREE.Vector3(w, .02, d))); return m; },
    resize(){ renderer.getDrawingBufferSize(size); rt.setSize(Math.max(1, size.x * .4 | 0), Math.max(1, size.y * .4 | 0)); lastT = -1; },
    // ### Moves the ripples and the drop on, then draws the mirror picture again, but only when a puddle is in view and
    // ### the view has changed (or a fifth of a second has passed, for the steam and the guard): standing still costs nothing.
    update(t, dt){
      mat.uniforms.time.value = t;
      if ((dropT -= dt) < 0){ dropT += 2.8; drip.z = t; }   // it lands: a new ring
      const fall = .64 - dropT;   // the drop hangs at the head for a moment, then falls 2 m in 0.64 s
      drop.visible = dropT < 1.2;
      drop.position.set(drip.x, fall > 0 ? 2.0 - 4.9 * fall * fall : 2.0, drip.y);
      if (camera.position.y < .1) return;
      pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pv);
      if (!boxes.some(b => frustum.intersectsBox(b))) return;
      if (lastT >= 0 && t - lastT < .2 && camera.matrixWorld.elements.every((v, i) => Math.abs(v - lastView.elements[i]) < 1e-4)) return;
      lastView.copy(camera.matrixWorld); lastT = t;
      // the mirrored camera (three.js Reflector, for a floor at y = 0.004)
      camPos.setFromMatrixPosition(camera.matrixWorld);
      mirror.position.set(camPos.x, 2 * P0.y - camPos.y, camPos.z);
      rot.extractRotation(camera.matrixWorld);
      look.set(0, 0, -1).applyMatrix4(rot).add(camPos); look.y = 2 * P0.y - look.y;
      mirror.up.set(0, 1, 0).applyMatrix4(rot); mirror.up.y = -mirror.up.y;
      mirror.lookAt(look); mirror.far = camera.far; mirror.updateMatrixWorld();
      mirror.projectionMatrix.copy(camera.projectionMatrix);
      texMat.set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);
      // oblique near plane: the camera sees nothing below the floor
      plane.setFromNormalAndCoplanarPoint(N, P0).applyMatrix4(mirror.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const e = mirror.projectionMatrix.elements;
      q.set((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
      clip.multiplyScalar(2 / clip.dot(q));
      e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1; e[14] = clip.w;
      mat.visible = false;
      renderer.setRenderTarget(rt); renderer.render(scene, mirror); renderer.setRenderTarget(null);
      mat.visible = true;
    }
  };
})();

// ---------- The washroom ----------
// ### The room is 8 m wide (x -4..4), 6 m deep (z -3..3) and 3 m high. The steel door is in the south wall, the sinks on the
// ### west wall, the toilet stall in the north-east corner with the hatch in its floor, the mop in the south-east corner.
const W = 8, D = 6, H = 3, TILE_H = 1.8;
const add = (mesh, parent = room) => { mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh; };
const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return add(m); };
const cyl = (rt, rb, h, mat, x, y, z, seg = 20) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); return add(m); };
const plane = (w, h, mat, x, y, z, ry = 0, rx = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.receiveShadow = true; room.add(m); return m; };
// ### Decals that lie flat on the floor: soft shadows, stains and puddles.
const flat = (w, d, mat, x, z, y = .003) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); room.add(m); return m; };
// ### A soft shadow along the line where two surfaces meet: dark at the edge (pos), fading towards fade, facing normal.
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
function aoEdge(len, w, pos, fade, normal){
  const g = new THREE.PlaneGeometry(len, w); g.translate(0, -w / 2, 0);
  const y = fade.clone().negate(), x = new THREE.Vector3().crossVectors(y, normal);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, normal).setPosition(pos));
  room.add(new THREE.Mesh(g, M.ao));
}
const HOT = {};   // hotspot key -> meshes that can be clicked
// ### Registers a clickable object (a hotspot) for the marker and the rules.
const hot = (key, ...meshes) => { (HOT[key] = HOT[key] || []).push(...meshes); meshes.forEach(m => { if (m.material !== M.steam) m.material = m.material.clone(); m.userData.hot = key; }); };

// ### A wall: green tiles up to 1.8 m, a dark green cap tile, cream blocks above, and its own coat of stains. runs are
// ### [metres from the wall's left end as seen from the room, height] of pipe brackets and shower heads that rust or drip.
function wall(len, x, z, ry, runs, corners){
  const st = wallStains(len, runs, corners);
  plane(len, TILE_H, stained(M.tiles(len), st, 0, TILE_H / H), x, TILE_H / 2, z, ry);
  plane(len, H - TILE_H, stained(blockMat(len, H - TILE_H), st, TILE_H / H, 1), x, TILE_H + (H - TILE_H) / 2, z, ry);
  const trim = box(len, .05, .03, M.cove, x, TILE_H, z); trim.rotation.y = ry; trim.position.x += Math.sin(ry) * .015; trim.position.z += Math.cos(ry) * .015;
}
// ### Lays a wall's stain picture over the tiles or the blocks (v0..v1 is the part of the picture that surface shows): the
// ### colour is mixed towards the stain by its alpha, and stained glaze turns matt. That is one more texture read per
// ### pixel, where a see-through layer over every wall would have lit each pixel of wall twice.
function stained(m, tex, v0, v1){
  const u = { stainMap: { value: tex }, stainV: { value: new THREE.Vector2(v0, v1 - v0) } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'uniform vec2 stainV;\nvarying vec2 vStainUv;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vStainUv = vec2(uv.x, stainV.x + uv.y * stainV.y);');
    sh.fragmentShader = 'uniform sampler2D stainMap;\nvarying vec2 vStainUv;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', '#include <map_fragment>\n  vec4 stainC = sRGBToLinear(texture2D(stainMap, vStainUv));\n  diffuseColor.rgb = mix(diffuseColor.rgb, stainC.rgb, stainC.a);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.95, stainC.a);');
  };
  return m;
}
// ### Rust, water and dirt over a whole wall, one picture per wall so nothing repeats: brown runs from the old leaks in
// ### the ceiling and under every pipe bracket, a dirty tide line where the tiles end with grime washed down from it,
// ### limescale under the showers, dirt rising from the floor and mould in the corners (corners says at which end of the
// ### wall the room has one; the walls beside the door have one only). Laid over the wall by stained().
function wallStains(len, runs = [], corners = [true, true]){
  const PX = COARSE ? 80 : 128;
  const tex = canvasTex(Math.round(len * PX), H * PX, (g, w) => {
    const Y = m => (H - m) * PX;   // metres above the floor -> pixels from the top
    // a run: soft blobs down a wobbling line, thinner and fainter as the water dried on its way down
    const run = (u, top, length, width, rgb, a) => {
      let cx = u * PX; const steps = Math.max(2, Math.ceil(length * PX / 2));
      for (let k = 0; k < steps; k++){
        const t = k / steps, r = Math.max(.6, width * PX * (1 - t * .55) * (.6 + rnd() * .5));
        cx += (rnd() - .5) * 1.1;
        g.fillStyle = `rgba(${rgb},${a * (1 - t * t)})`; g.beginPath(); g.ellipse(cx, Y(top) + k * 2, r, r * 1.8, 0, 0, 7); g.fill();
      }
    };
    const blot = (cx, cy, r, rgb, a) => { const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2); };
    // water stains yellowing the blocks, and the leaks in the ceiling that caused them
    for (let i = 0; i < len * 1.6; i++) blot(rnd() * w, Y(2.2 + rnd() * .8), (.15 + rnd() * .45) * PX, '140,98,42', .14 + rnd() * .14);
    for (let i = 0; i < len * 1.2; i++){ const u = rnd() * len; run(u, H, .4 + rnd() * 1.4, .02 + rnd() * .05, '112,64,26', .045); if (rnd() < .5) run(u + (rnd() - .5) * .1, H, .3 + rnd() * .8, .008, '80,44,18', .05); }
    // rust under the brackets and pipes, and wet streaks or limescale below the shower heads
    for (const [u, top, kind] of runs){
      if (kind === 'shower'){ for (let k = 0; k < 6; k++) run(u + (rnd() - .5) * .3, top, .5 + rnd() * 1.1, .01 + rnd() * .025, '214,214,196', .045); }
      else for (let k = 0; k < 3; k++) run(u + (rnd() - .5) * .06, top, .5 + rnd() * .9, .008 + rnd() * .018, '128,58,18', .06);
    }
    // the tide line at the top of the tiles, with dirt washed down the glaze from it
    for (let i = 0; i < len * 30; i++) blot(rnd() * w, Y(TILE_H - .02 - Math.pow(rnd(), 2) * .2), (.03 + rnd() * .1) * PX, '72,60,30', .08);
    for (let i = 0; i < len * 2.5; i++) run(rnd() * len, TILE_H - .03, .2 + rnd() * .9, .01 + rnd() * .03, '60,54,30', .04);
    // dirt and splashes rising from the floor
    const fg = g.createLinearGradient(0, Y(.5), 0, Y(0)); fg.addColorStop(0, 'rgba(40,32,18,0)'); fg.addColorStop(.7, 'rgba(40,32,18,.22)'); fg.addColorStop(1, 'rgba(30,24,14,.5)');
    g.fillStyle = fg; g.fillRect(0, Y(.5), w, .5 * PX);
    for (let i = 0; i < len * 40; i++) blot(rnd() * w, Y(Math.pow(rnd(), 2) * .45), (.02 + rnd() * .07) * PX, '38,30,16', .12);
    // mould creeping out of the room's corners: thick in the corner under the ceiling, thinning out along the ceiling
    // and down the joint
    corners.forEach((on, k) => {
      if (!on) return;
      for (let i = 0; i < 90; i++){
        const along = Math.pow(rnd(), 2.2), down = Math.pow(rnd(), 2.2), fade = 1 - Math.max(along, down) * .85;
        blot(k ? w - along * .9 * PX : along * .9 * PX, Y(H) + down * 1.5 * PX * (1 - along * .7), (.02 + rnd() * .06) * PX, '30,36,24', .28 * fade);
      }
    });
  });
  tex.anisotropy = 4;
  return tex;
}
{ // floor with an opening where the hatch is (shape coordinates are metres; y of the shape becomes -z in the room)
  const fs = new THREE.Shape(); fs.moveTo(-W / 2, -D / 2); fs.lineTo(W / 2, -D / 2); fs.lineTo(W / 2, D / 2); fs.lineTo(-W / 2, D / 2); fs.lineTo(-W / 2, -D / 2);
  const hp = new THREE.Path(), hx = 2.2, hz = 1.75, hh = .37; hp.moveTo(hx - hh, hz - hh); hp.lineTo(hx - hh, hz + hh); hp.lineTo(hx + hh, hz + hh); hp.lineTo(hx + hh, hz - hh); hp.lineTo(hx - hh, hz - hh); fs.holes.push(hp);
  // the scanned concrete: one picture covers 2 m of floor (the shape's uv are metres), brightened to the room's grey
  const fm = new THREE.MeshStandardMaterial({ map: SCAN('floor-concrete-color.jpg', true, .5, .5), normalMap: SCAN('floor-concrete-normal.jpg', false, .5, .5),
    roughnessMap: SCAN('floor-concrete-rough.jpg', false, .5, .5, 4), roughness: .95, envMapIntensity: .5 });
  fm.color.setRGB(1.75, 1.85, 1.9);
  const fl = new THREE.Mesh(new THREE.ShapeGeometry(fs), fm);
  fl.rotation.x = -Math.PI / 2; fl.receiveShadow = true; room.add(fl);
}
plane(W, D, M.ceiling, 0, H, 0, 0, Math.PI / 2);
wall(W, 0, -D / 2, 0, [1, 3, 5, 7].map(u => [u, 2.72]));            // north, rust under the pipe brackets
// south (door wall), built around the doorway so the open door shows the corridor in the briefing
wall(3.45, -2.275, D / 2, Math.PI, [], [false, true]); wall(3.45, 2.275, D / 2, Math.PI, [], [true, false]);
plane(1.1, H - 2.14, blockMat(1.1, H - 2.14), 0, 2.14 + (H - 2.14) / 2, D / 2, Math.PI);
wall(D, -W / 2, 0, Math.PI / 2, [[1.5, 2.72], [4.5, 2.72]]);  // west (sinks), rust where the pipes turn down
wall(D, W / 2, 0, -Math.PI / 2, [[3.45, 1.98, 'shower'], [4.55, 1.98, 'shower']]);  // east, under the shower heads
// skirting drain channel and floor drain
cyl(.12, .12, .01, M.dark, 0, .006, .3, 24);
for (let i = -2; i <= 2; i++) box(.22, .012, .012, M.dullSteel, 0, .012, .3 + i * .045);

// Pipes along the ceiling and down to the sinks
const pipe = (len, x, y, z, axis) => { const p = cyl(.045, .045, len, M.pipe, x, y, z, 12); if (axis === 'x') p.rotation.z = Math.PI / 2; if (axis === 'z') p.rotation.x = Math.PI / 2; return p; };
pipe(W, 0, 2.78, -2.88, 'x'); pipe(W, 0, 2.66, -2.9, 'x'); pipe(D, -3.9, 2.78, 0, 'z');
pipe(1.9, -3.92, 1.85, -1.5); pipe(1.9, -3.92, 1.85, 1.5);
for (const x of [-3, -1, 1, 3]) box(.06, .12, .1, M.dullSteel, x, 2.78, -2.9);

// Lights: the caged tube in the middle (an old warm-white tube), a lamp over the stall, corridor light through the window
// and two red emergency lamps (below)
const hemi = new THREE.HemisphereLight(0xb4a292, 0x1e1410, .3); room.add(hemi);
const mainLight = new THREE.SpotLight(0xffdcbc, 3.2, 14, 1.3, .65, 1.6);
mainLight.position.set(-.6, 2.86, .3); mainLight.target.position.set(-.6, 0, .3);
mainLight.castShadow = true; mainLight.shadow.mapSize.set(COARSE ? 1024 : 2048, COARSE ? 1024 : 2048); mainLight.shadow.bias = -.0005; mainLight.shadow.radius = 4;
room.add(mainLight, mainLight.target);
const stallLight = new THREE.SpotLight(0xffd6a6, 2.1, 7, .95, .7, 1.8);
stallLight.position.set(2.75, 2.86, -1.8); stallLight.target.position.set(2.75, 0, -1.9);
stallLight.castShadow = true; stallLight.shadow.mapSize.set(COARSE ? 512 : 1024, COARSE ? 512 : 1024); stallLight.shadow.bias = -.0008; stallLight.shadow.radius = 3;
room.add(stallLight, stallLight.target);
const windowLight = new THREE.SpotLight(0x9cc4ff, .9, 8, .5, .8, 1.5);
windowLight.position.set(0, 1.7, 3.3); windowLight.target.position.set(0, .6, 0); room.add(windowLight, windowLight.target);
const tube = box(1.3, .06, .14, M.tube, -.6, 2.93, .3); tube.castShadow = false;
for (let i = 0; i < 5; i++){ const c = box(.012, .1, .2, M.dullSteel, -1.2 + i * .3, 2.93, .3); c.castShadow = false; }
const stallTube = box(.6, .05, .1, M.tube.clone(), 2.75, 2.94, -1.8); stallTube.castShadow = false;
stallTube.material.emissive.set(0xffd6a6); stallTube.material.emissiveIntensity = 1.8;
plane(1.5, .56, M.sign, -1.9, 2.2, -D / 2 + .012);
// ### Red emergency lamps, as in the photo: caged red domes over the door, over the mirror by the sinks and high in the
// ### stall over the toilet. Each has a soft glow round the glass (the puddles mirror it too). Every light costs time at
// ### every pixel, so only two of them really shine, without shadows: a point light over the door and a spot in the
// ### stall aimed at the toilet (it stays inside the partition). The lamp over the mirror paints its red wash onto the
// ### wall instead. They burn steadily.
const glowTex = canvasTex(128, 128, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,120,90,.9)'); gr.addColorStop(.12, 'rgba(255,50,25,.55)'); gr.addColorStop(.4, 'rgba(200,20,8,.16)'); gr.addColorStop(1, 'rgba(160,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
glowTex.anisotropy = 1;
const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
const redGlass = new THREE.MeshStandardMaterial({ color: 0x5a0804, emissive: 0xff2412, emissiveIntensity: 2.6, roughness: .25 });
function redLamp(x, y, z, ry, intensity, reach, aim){
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; room.add(g);
  const part = (geo, mat, px, py, pz, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.rotation.set(rx, 0, rz); m.receiveShadow = true; g.add(m); return m; };
  part(new THREE.BoxGeometry(.16, .16, .025), M.dullSteel, 0, 0, .0125);
  part(new THREE.CylinderGeometry(.068, .072, .02, 20), M.dullSteel, 0, 0, .035, Math.PI / 2);
  part(new THREE.SphereGeometry(.058, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), redGlass, 0, 0, .045, Math.PI / 2);
  // the wire cage over the glass: three hoops and a ring
  for (const rz of [0, Math.PI / 3, -Math.PI / 3]) part(new THREE.TorusGeometry(.068, .0035, 4, 12, Math.PI), M.dullSteel, 0, 0, .045, Math.PI / 2, rz).rotation.order = 'ZXY';
  part(new THREE.TorusGeometry(.07, .004, 4, 18), M.dullSteel, 0, 0, .075);
  const glow = new THREE.Sprite(glowMat); glow.position.set(0, 0, .08); glow.scale.setScalar(.55); g.add(glow);
  if (!intensity){   // no light: a soft red wash on the wall round the lamp
    const wash = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), new THREE.MeshBasicMaterial({ map: glowTex, color: 0x9a3a2a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    wash.position.set(0, -.15, .004); g.add(wash);
    return;
  }
  const light = aim ? new THREE.SpotLight(0xff2a14, intensity, reach, .6, .6, 1.5) : new THREE.PointLight(0xff2a14, intensity, reach, 2);
  light.position.set(0, -.08, .3); g.add(light);
  if (aim){ light.target.position.set(...aim); room.add(light.target); }
}
redLamp(0, 2.5, D / 2 - .002, Math.PI, 1.8, 6);                       // over the door
redLamp(-W / 2 + .002, 2.32, 0, Math.PI / 2, 0);                      // over the mirror
redLamp(2.2, 2.45, -D / 2 + .002, 0, 4, 5, [3.1, .4, -2.6]);          // in the stall, over the toilet

// The door with its barred window; Officer Hale's silhouette appears in it. It hangs on hinges on the west side (x -0.52)
// and swings into the room; doorPivot turns it. Closed (rotation 0) it is exactly where it always was.
const doorPivot = new THREE.Group(), doorLeaf = new THREE.Group();
doorPivot.position.set(-.52, 0, 2.95); doorLeaf.position.set(.52, 0, -2.95); doorPivot.add(doorLeaf); room.add(doorPivot);
const onDoor = (...ms) => ms.forEach(m => doorLeaf.add(m));
onDoor(box(1.04, 2.14, .1, M.door, 0, 1.07, 2.95));
box(1.16, .06, .14, M.dullSteel, 0, 2.17, 2.95); box(.06, 2.17, .14, M.dullSteel, -.55, 1.08, 2.95); box(.06, 2.17, .14, M.dullSteel, .55, 1.08, 2.95);
onDoor(plane(.3, .34, M.corridor, 0, 1.68, 2.895, Math.PI));
const guard = plane(.3, .34, M.guard, 0, 1.66, 2.89, Math.PI); onDoor(guard);
for (let i = -1; i <= 1; i++) onDoor(cyl(.008, .008, .34, M.steel, i * .075, 1.68, 2.885, 8));
for (const [w, h, x, y] of [[.36, .03, 0, 1.865], [.36, .03, 0, 1.495], [.03, .4, -.165, 1.68], [.03, .4, .165, 1.68]]) onDoor(box(w, h, .03, M.dullSteel, x, y, 2.885));
const handle = cyl(.022, .022, .16, M.steel, .38, 1.02, 2.86, 10); handle.rotation.z = Math.PI / 2; onDoor(handle);
onDoor(box(.06, .14, .04, M.steel, .44, 1.02, 2.89));
for (const y of [.35, 1.07, 1.8]) onDoor(box(.04, .14, .05, M.steel, -.5, y, 2.88));
hot('wedge', handle);

// The corridor outside and Officer Hale in the doorway. Only seen in the briefing, while he shuts the door on you.
const hallTex = canvasTex(1024, 384, (g, w, h) => {
  g.fillStyle = '#c9d5dc'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#5f7383'; g.fillRect(0, h * .55, w, h * .45);
  g.fillStyle = '#e8b13a'; g.fillRect(0, h * .55 - 8, w, 8);
  g.fillStyle = '#26303a'; g.font = '800 54px "Arial Narrow", Arial, sans-serif'; g.fillText('CELL BLOCK D', 40, 120); g.fillText('D-01 → D-24', 640, 120);
  grime(g, w, h, 14, 'rgba(60,70,70,.25)', 90, true);
});
const hallFloorTex = canvasTex(256, 256, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h * .3, 4, w / 2, h * .3, w * .7); gr.addColorStop(0, '#b7c3cb'); gr.addColorStop(1, '#4c5962');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
// ### Officer Hale in 3D: a low-poly prison guard in a dark slate uniform with a peaked cap and badge, a moustache, a cross
// ### belt, a ring of keys on his belt and laced boots. His left arm hangs, his right arm reaches out to pull the door shut.
// ### Built from boxes and cylinders, one material per colour; haleFade() fades the whole figure in and out.
function limb(a, b, r0, r1){
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 7);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
function buildHale(){
  const mat = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, flatShading: true, roughness: .8, transparent: true, opacity: 0 }, o));
  const HM = { uniform: mat(0x2c343e, { emissive: 0x0a0d12 }), shirt: mat(0x8b9097), leather: mat(0x17181b, { roughness: .5 }), metal: mat(0xb9bdc2, { roughness: .35, metalness: .8 }),
    skin: mat(0xc89878, { roughness: .75 }), hair: mat(0x5b3b26, { roughness: .9 }), cap: mat(0x252c35, { roughness: .6 }) };
  const g = new THREE.Group();
  const put = (geo, m, x = 0, y = 0, z = 0) => { geo.translate(x, y, z); const mesh = new THREE.Mesh(geo, HM[m]); mesh.castShadow = true; g.add(mesh); return mesh; };
  const bx = (w, h, d, m, x, y, z) => put(new THREE.BoxGeometry(w, h, d), m, x, y, z);
  const cy = (rt, rb, h, m, x, y, z, n, sz) => { const geo = new THREE.CylinderGeometry(rt, rb, h, n || 8); if (sz) geo.scale(1, 1, sz); return put(geo, m, x, y, z); };
  for (const s of [-1, 1]){
    bx(.15, .14, .3, 'leather', s * .11, .07, .04); bx(.16, .12, .17, 'leather', s * .11, .2, -.01);           // boots
    put(limb([s * .11, .24, 0], [s * .12, .92, 0], .095, .12), 'uniform');                                     // trouser legs
    bx(.12, .03, .11, 'uniform', s * .24, 1.545, 0); bx(.025, .025, .02, 'metal', s * .25, 1.565, .03);         // epaulettes
    bx(.12, .11, .025, 'uniform', s * .1, 1.36, .145); bx(.022, .022, .015, 'metal', s * .1, 1.395, .16);      // chest pockets
  }
  // left arm hanging, right arm reaching out for the door
  put(limb([-.27, 1.5, 0], [-.3, 1.18, .02], .075, .065), 'uniform'); put(limb([-.3, 1.18, .02], [-.29, .92, .07], .065, .055), 'uniform');
  bx(.08, .1, .07, 'skin', -.29, .86, .08);
  put(limb([.27, 1.5, 0], [.37, 1.31, .27], .075, .065), 'uniform'); put(limb([.37, 1.31, .27], [.41, 1.2, .55], .065, .055), 'uniform');
  bx(.08, .07, .1, 'skin', .42, 1.18, .61);
  cy(.235, .215, .6, 'uniform', 0, 1.25, 0, 8, .66);                                                             // jacket
  cy(.215, .24, .24, 'uniform', 0, .85, 0, 8, .7);                                                               // jacket skirt
  cy(.222, .222, .07, 'leather', 0, .98, 0, 8, .72); bx(.09, .065, .02, 'metal', 0, .98, .165);                  // belt, buckle
  const cross = new THREE.BoxGeometry(.05, .62, .02); cross.rotateZ(-.62); put(cross, 'leather', .03, 1.27, .155); // cross belt
  for (const y of [1.18, 1.3]) bx(.025, .025, .015, 'metal', 0, y, .16);                                         // buttons
  cy(.075, .09, .08, 'shirt', 0, 1.585, .01); bx(.045, .2, .015, 'leather', 0, 1.47, .155);                      // collar, tie
  put(new THREE.TorusGeometry(.045, .008, 5, 12), 'metal', -.13, .91, .16);                                       // key ring
  for (let k = 0; k < 4; k++){ bx(.014, .1, .01, 'metal', -.105 - k * .016, .83, .165); bx(.03, .014, .01, 'metal', -.112 - k * .016, .785, .165); }
  // head
  cy(.05, .055, .1, 'skin', 0, 1.63, 0, 6);
  const skull = new THREE.IcosahedronGeometry(.115, 0); skull.scale(.95, 1.15, 1.05); put(skull, 'skin', 0, 1.75, .01);
  bx(.035, .05, .04, 'skin', 0, 1.74, .12);                                                                       // nose
  for (const s of [-1, 1]) bx(.025, .05, .035, 'skin', s * .11, 1.75, 0);                                        // ears
  bx(.11, .028, .035, 'hair', 0, 1.7, .115); bx(.22, .09, .12, 'hair', 0, 1.79, -.05);                           // moustache, hair
  cy(.15, .125, .08, 'cap', 0, 1.89, -.005, 10); cy(.122, .122, .04, 'leather', 0, 1.84, 0, 10);                 // cap
  const visor = new THREE.CylinderGeometry(.12, .12, .015, 10, 1, false, -Math.PI / 2, Math.PI); visor.rotateX(.18); put(visor, 'leather', 0, 1.825, .04);
  bx(.03, .03, .015, 'metal', 0, 1.89, .14);                                                                      // cap badge
  return { g, mats: Object.values(HM) };
}
const shadowTex = canvasTex(128, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(0,0,0,.85)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.beginPath(); g.moveTo(w * .3, 0); g.lineTo(w * .7, 0); g.lineTo(w, h); g.lineTo(0, h); g.fill();
});
const hall = new THREE.Group(); room.add(hall);
{ const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), new THREE.MeshBasicMaterial({ map: hallTex })); m.position.set(0, 1.5, 4.6); m.rotation.y = Math.PI; hall.add(m);
  const f = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.6), new THREE.MeshBasicMaterial({ map: hallFloorTex })); f.position.set(0, .002, 3.8); f.rotation.x = -Math.PI / 2; hall.add(f);
  const c = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.6), new THREE.MeshBasicMaterial({ color: 0x39434b })); c.position.set(0, 3, 3.8); c.rotation.x = Math.PI / 2; hall.add(c);
  const t = new THREE.Mesh(new THREE.BoxGeometry(1.4, .05, .12), new THREE.MeshBasicMaterial({ color: 0xf2f8ff })); t.position.set(0, 2.97, 3.7); hall.add(t); }
const hale = buildHale();
// Fades Hale in or out; he is only drawn while he can be seen
function haleFade(o){ for (const m of hale.mats) m.opacity = o; hale.g.visible = o > .01; }
hall.visible = false;
hale.g.position.set(.14, 0, 3.42); hale.g.rotation.y = Math.PI; hale.g.visible = false; room.add(hale.g);
const haleShadow = new THREE.Mesh(new THREE.PlaneGeometry(.7, 1.9), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0, depthWrite: false }));
haleShadow.position.set(.12, .004, 2.05); haleShadow.rotation.set(-Math.PI / 2, 0, Math.PI); room.add(haleShadow);
// the cold light that falls in through the open door
const doorLight = new THREE.SpotLight(0xd4e6ff, 0, 9, .62, .55, 1.3);
doorLight.position.set(0, 2.3, 4.1); doorLight.target.position.set(0, 0, .3); room.add(doorLight, doorLight.target);
// ### A light that is switched off still costs every pixel its sums, so the door light and the tunnel light are only part of
// ### the scene while they shine: the door light during the briefing scene, the tunnel light from the moment the hatch opens.
doorLight.visible = false;

// Sinks with a polished steel mirror, an empty soap dish and the hot tap
box(.5, .06, 2.6, M.steel, -3.75, .86, 0);
box(.5, .12, 2.6, M.steel, -3.75, .78, 0);
const basins = [];
for (const z of [-.65, .65]){
  const b = new THREE.Mesh(new THREE.CylinderGeometry(.19, .13, .12, 24, 1, true), M.steel); b.position.set(-3.73, .83, z); add(b); basins.push(b);
  // the basin seen from above: polished steel with a rolled rim and the drain in the middle
  cyl(.19, .19, .004, M.bowl, -3.73, .891, z, 32); cyl(.03, .03, .002, M.dark, -3.73, .894, z, 16);
  { const rim = new THREE.Mesh(new THREE.TorusGeometry(.19, .012, 8, 40), M.steel); rim.rotation.x = Math.PI / 2; rim.position.set(-3.73, .894, z); add(rim); }
  const sp = cyl(.025, .025, .18, M.steel, -3.94, .98, z, 10); sp.rotation.z = Math.PI / 2;
  cyl(.03, .03, .05, M.steel, -3.96, 1.05, z + .12, 10);
}
const hotTap = cyl(.034, .034, .05, new THREE.MeshStandardMaterial({ color: 0xb33a2c, roughness: .5 }), -3.96, 1.05, -.53, 12);
hot('tap', hotTap, basins[0]);
pipe(.8, -3.85, .4, -.65); pipe(.8, -3.85, .4, .65);
const mirror = plane(2.2, .72, M.mirror, -3.985, 1.6, 0, Math.PI / 2);
box(.01, .8, 2.28, M.dullSteel, -3.996, 1.6, 0);
const steam = plane(2.2, .72, M.steam, -3.975, 1.6, 0, Math.PI / 2); steam.renderOrder = 2;
hot('read:mirror', mirror, steam); hot('play:mirror', mirror, steam);
box(.12, .025, .2, M.dullSteel, -3.85, .905, 0);
const steamPuffs = [];
const puffTex = canvasTex(64, 64, (g, w) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
for (let i = 0; i < 14; i++){ const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, opacity: 0, depthWrite: false })); s.userData.t = i / 14; room.add(s); steamPuffs.push(s); }

// Mop and bucket in the south-east corner
cyl(.2, .16, .34, M.bucket, 3.35, .17, 2.45, 22);
cyl(.19, .19, .01, new THREE.MeshStandardMaterial({ color: 0x3c4a3c, roughness: .2 }), 3.35, .3, 2.45, 22);
const mop = new THREE.Group();
const mopStick = new THREE.Mesh(new THREE.CylinderGeometry(.017, .017, 1.45, 10), M.wood); mopStick.position.y = .72; mopStick.castShadow = true;
const mopFringe = new THREE.Mesh(new THREE.CylinderGeometry(.06, .13, .2, 14), M.mopHead); mopFringe.position.y = .02; mopFringe.castShadow = true;
mop.add(mopStick, mopFringe); room.add(mop);
const MOP_CORNER = { p: new THREE.Vector3(3.35, .24, 2.45), r: new THREE.Euler(.18, 0, -.16) };
const MOP_DOOR = { p: new THREE.Vector3(.58, 0, 2.15), r: new THREE.Euler(.36, 0, .14) };
hot('take:mop', mopStick, mopFringe);
// The scratches in the tiles beside the door (east of the door frame, facing into the room)
const scratches = plane(1.0, .62, M.scratches, 1.75, 1.3, D / 2 - .006, Math.PI);
hot('read:scratches', scratches); hot('play:scratches', scratches);

// The toilet stall: partitions, steel toilet, graffiti, the crooked tile and the hatch in the floor
const SX0 = 1.5, SZ1 = -.7;
box(.04, 1.9, 2.3, M.partition, SX0, 1.1, -1.85);
box(.3, 1.9, .04, M.partition, SX0 + .15, 1.1, SZ1); box(.3, 1.9, .04, M.partition, 3.85, 1.1, SZ1);
box(2.54, .06, .06, M.dullSteel, 2.75, 2.06, SZ1);
for (const z of [-2.9, SZ1 + .05]) box(.06, .14, .06, M.dullSteel, SX0, .07, z);
// steel edge caps on the partitions and wall brackets that hold them
box(.055, 1.9, .012, M.dullSteel, SX0, 1.1, SZ1 - .01); box(.012, 1.9, .05, M.dullSteel, SX0 + .3, 1.1, SZ1); box(.012, 1.9, .05, M.dullSteel, 3.7, 1.1, SZ1);
for (const y of [.4, 1.1, 1.8]) box(.09, .05, .03, M.dullSteel, SX0, y, -2.985);
for (const x of [SX0 + .15, 3.85]) box(.32, .12, .07, M.steel, x, .06, SZ1);   // pilaster shoes
// the stall door stands open against the east wall: hinges, a slide latch and a coat hook
{
  const pivot = new THREE.Group(); pivot.position.set(3.7, 0, SZ1 + .025); pivot.rotation.y = 1.72; room.add(pivot);
  const put = m => { m.castShadow = m.receiveShadow = true; pivot.add(m); return m; };
  const bx = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return put(m); };
  bx(.86, 1.62, .03, M.partition, -.45, 1.04, 0);
  bx(.86, .012, .036, M.dullSteel, -.45, 1.85, 0); bx(.86, .012, .036, M.dullSteel, -.45, .23, 0); bx(.012, 1.62, .036, M.dullSteel, -.88, 1.04, 0);
  for (const y of [.42, 1.04, 1.66]){ const h = new THREE.Mesh(new THREE.CylinderGeometry(.011, .011, .12, 10), M.steel); h.position.set(-.005, y, .02); put(h); }
  bx(.1, .035, .02, M.steel, -.8, 1.12, .028); bx(.025, .02, .03, M.steel, -.77, 1.12, .045);
  bx(.03, .06, .015, M.steel, -.45, 1.62, -.024); const hook = new THREE.Mesh(new THREE.TorusGeometry(.022, .006, 6, 12, Math.PI), M.steel); hook.position.set(-.45, 1.58, -.045); hook.rotation.set(0, Math.PI / 2, Math.PI); put(hook);
}
box(.035, .06, .02, M.steel, SX0 + .3, 1.12, SZ1 + .03);   // the latch keeper on the other pilaster

// ### The toilet: a one-piece stainless-steel prison unit bolted to the back wall. A rounded cabinet with a small wash basin,
// ### a drinking spout and push buttons on top; a deep bowl with a rolled rim and water in it, no seat, security screws.
const TOILET = { x: 3.25, z: -2.82, top: .958 }, BOWL_Z = -2.418, BOWL_SZ = 1.22;
{
  const T = TOILET;
  const rounded = (s, x0, y0, x1, y1, r) => { s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r); s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1); s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r); s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0); };
  const mesh = (geo, mat) => add(new THREE.Mesh(geo, mat));
  // the cabinet, extruded upwards from its rounded footprint, with an oval opening for the basin (shape y becomes -z)
  const cs = new THREE.Shape(); rounded(cs, -.3, -.16, .3, .16, .05);
  const hole = new THREE.Path(); hole.absellipse(0, .01, .155, .112, 0, Math.PI * 2, true); cs.holes.push(hole);
  const cg = new THREE.ExtrudeGeometry(cs, { depth: .93, bevelEnabled: true, bevelThickness: .014, bevelSize: .014, bevelSegments: 3, curveSegments: 18 });
  cg.rotateX(-Math.PI / 2); cg.translate(T.x, .014, T.z); mesh(cg, M.steel);
  // the basin set into the top, its drain and the drinking spout behind it
  const lathe = (pts, seg, sx, sz, x, z) => { const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg); g.scale(sx, 1, sz); g.translate(x, 0, z); return mesh(g, M.bowl); };
  lathe([[.0, .9], [.055, .905], [.08, .93], [.092, .955], [.1, .966], [.11, .964], [.112, .958]], 32, 1.42, 1, T.x, T.z - .01);
  cyl(.018, .018, .003, M.dark, T.x, .902, T.z - .01, 16);
  cyl(.014, .016, .035, M.chrome, T.x, T.top + .017, T.z - .135, 14);
  const spout = cyl(.008, .008, .05, M.chrome, T.x, T.top + .038, T.z - .115, 10); spout.rotation.x = Math.PI / 2 - .5;
  // push buttons: basin and spout on the top, flush on the front
  for (const dx of [-.22, .22]){ cyl(.024, .024, .008, M.dullSteel, T.x + dx, T.top + .004, T.z + .12, 18); cyl(.016, .016, .012, M.chrome, T.x + dx, T.top + .012, T.z + .12, 18); }
  const fz = T.z + .174; for (const [r, d, mat] of [[.034, .008, M.dullSteel], [.024, .02, M.chrome]]){ const b = cyl(r, r, d, mat, T.x + .19, .82, fz + d / 2, 20); b.rotation.x = Math.PI / 2; }
  // the seams of the access panel on the front and its security screws
  for (const [w, h, x, y] of [[.44, .006, 0, .9], [.44, .006, 0, .47], [.006, .43, -.22, .685], [.006, .43, .22, .685]]) box(w, h, .003, M.dark, T.x + x, y, fz + .001);
  for (const x of [-.25, .25]) for (const y of [.08, .9]){ const s = cyl(.009, .009, .006, M.chrome, T.x + x, y, fz + .003, 6); s.rotation.x = Math.PI / 2; }
  // the bowl and its pedestal in one turned piece: foot, waist, flaring sides, rolled rim, then down into the trap
  lathe([[.175, 0], [.186, .012], [.186, .034], [.165, .06], [.158, .13], [.172, .22], [.2, .31], [.218, .37], [.228, .404], [.226, .424], [.212, .432], [.197, .426], [.19, .41],
    [.184, .38], [.16, .32], [.12, .27], [.072, .236], [.0, .226]], 44, 1, BOWL_SZ, T.x, BOWL_Z);
  box(.26, .24, .22, M.steel, T.x, .12, T.z + .28);   // the apron that joins bowl and cabinet
  const water = new THREE.Mesh(new THREE.CircleGeometry(.137, 40), M.water); water.rotation.x = -Math.PI / 2; water.scale.y = BOWL_SZ; water.position.set(T.x, .29, BOWL_Z); water.receiveShadow = true; room.add(water);
  cyl(.045, .045, .002, M.dark, T.x, .238, BOWL_Z - .03, 16);
  for (const dx of [-.215, .215]) cyl(.014, .014, .012, M.chrome, T.x + dx, .006, BOWL_Z + .03, 6);   // floor bolts
  // the cold-water supply: a stop valve on the wall and a chrome pipe into the side of the cabinet
  cyl(.012, .012, .24, M.chrome, T.x + .43, .24, -2.95, 10).rotation.z = Math.PI / 2;
  cyl(.03, .03, .07, M.dullSteel, T.x + .55, .24, -2.95, 12).rotation.x = Math.PI / 2;
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(.03, .006, 6, 16), M.red); wheel.position.set(T.x + .55, .24, -2.9); add(wheel);
  // limescale and dirt on the floor round the foot, and the soft shadow under the unit
  flat(.75, .95, M.blob, T.x, -2.55, .002); flat(.62, .62, M.stain, T.x, BOWL_Z, .004);
  WATER.puddle(.7, .48, T.x - .25, -1.98);
}
// ### The toilet roll on a steel holder screwed to the east wall, with a strip of paper hanging down.
{
  box(.012, .1, .2, M.steel, 3.994, .74, -2.0);
  for (const dz of [-.07, .07]) box(.07, .02, .012, M.steel, 3.955, .72, -2.0 + dz);
  const roll = cyl(.055, .055, .11, M.paper, 3.915, .72, -2.0, 18); roll.rotation.x = Math.PI / 2;
  const core = cyl(.021, .021, .112, new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: .9 }), 3.915, .72, -2.0, 10); core.rotation.x = Math.PI / 2;
  const tail = plane(.105, .16, M.paper, 3.861, .64, -2.0, -Math.PI / 2); tail.rotation.z = .03;
}
const graffiti = plane(1.05, .66, M.graffiti, SX0 + .025, 1.32, -1.9, Math.PI / 2);
hot('read:graffiti', graffiti);
// The crooked tile, the dark hole behind it and the car key hidden there
const TILE_POS = new THREE.Vector3(2.62, .58, -2.988);
plane(.15, .15, M.dark, TILE_POS.x, TILE_POS.y, -2.996);
const tile = box(.15, .15, .018, tileMat(.15, .15), TILE_POS.x, TILE_POS.y, TILE_POS.z);
tile.rotation.z = .07;
// the car key: a brass blade, a black plastic head and a worn leather fob, lying in the hollow
const carKey = new THREE.Group();
const keyHead = new THREE.Mesh(new THREE.BoxGeometry(.03, .022, .008), new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: .5 }));
const keyBlade = new THREE.Mesh(new THREE.BoxGeometry(.045, .009, .003), new THREE.MeshStandardMaterial({ color: 0xc8a24a, metalness: .85, roughness: .3 })); keyBlade.position.x = .036;
const keyRing = new THREE.Mesh(new THREE.TorusGeometry(.01, .002, 6, 14), M.steel); keyRing.position.x = -.022;
const keyFob = new THREE.Mesh(new THREE.BoxGeometry(.028, .04, .004), new THREE.MeshStandardMaterial({ color: 0x5a3820, roughness: .85 })); keyFob.position.set(-.036, -.016, 0); keyFob.rotation.z = .4;
carKey.add(keyHead, keyBlade, keyRing, keyFob); carKey.position.set(TILE_POS.x + .005, TILE_POS.y - .01, -2.99); carKey.rotation.z = -.2; carKey.scale.setScalar(1.5); carKey.visible = false; room.add(carKey);
hot('play:tile', tile); hot('take:carkey', keyHead, keyBlade, keyFob);
// The hatch: frame, diamond-plate lid on a hinge, padlock with four number wheels, a shaft with a ladder below
const HATCH = new THREE.Vector3(2.2, 0, -1.75), HS = .74;
for (const [w, d, x, z] of [[HS + .08, .05, 0, -HS / 2], [HS + .08, .05, 0, HS / 2], [.05, HS, -HS / 2, 0], [.05, HS, HS / 2, 0]]) box(w, .03, d, M.dullSteel, HATCH.x + x, .015, HATCH.z + z);
const lidPivot = new THREE.Group(); lidPivot.position.set(HATCH.x, .03, HATCH.z - HS / 2); room.add(lidPivot);
const lid = new THREE.Mesh(new THREE.BoxGeometry(HS - .02, .03, HS - .02), M.plate); lid.position.set(0, 0, HS / 2); lid.castShadow = lid.receiveShadow = true; lidPivot.add(lid);
const hinge = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, HS - .1, 10), M.steel); hinge.rotation.z = Math.PI / 2; lidPivot.add(hinge);
const lockGroup = new THREE.Group(); lockGroup.position.set(0, .08, HS - .03); lidPivot.add(lockGroup);
const lockBody = new THREE.Mesh(new THREE.BoxGeometry(.2, .1, .05), new THREE.MeshStandardMaterial({ color: 0x2e3438, metalness: .8, roughness: .35 })); lockBody.castShadow = true; lockGroup.add(lockBody);
const shackle = new THREE.Mesh(new THREE.TorusGeometry(.045, .01, 8, 20, Math.PI), M.steel); shackle.position.set(0, .05, 0); lockGroup.add(shackle);
const wheelTex = [0, 1, 2, 3].map(() => digitTex());
wheelTex.forEach((t, i) => { const wm = new THREE.Mesh(new THREE.PlaneGeometry(.036, .04), new THREE.MeshBasicMaterial({ map: t })); wm.position.set(-.06 + i * .04, 0, .0255); lockGroup.add(wm); drawDigit(t, 0); });
hot('lock', lockBody, lid);
HOT['go:hatch'] = HOT.lock;   // from the stall, clicking the hatch kneels you down at it
const shaft = new THREE.Mesh(new THREE.BoxGeometry(HS, 4, HS), new THREE.MeshStandardMaterial({ color: 0x2b2a27, roughness: 1, side: THREE.BackSide }));
shaft.position.set(HATCH.x, -2.01, HATCH.z); room.add(shaft);
for (let y = -.3; y > -3.9; y -= .3){ const r = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, .42, 8), M.dullSteel); r.rotation.z = Math.PI / 2; r.position.set(HATCH.x, y, HATCH.z - HS / 2 + .08); room.add(r); }
const tunnelLight = new THREE.PointLight(0xffb066, 0, 5, 2); tunnelLight.position.set(HATCH.x, -3.4, HATCH.z); tunnelLight.visible = false; room.add(tunnelLight);

// ### Details that make the washroom feel used and real: tiled skirting, soft shadows in every corner, a camera watching,
// ### an air vent, the light switch and intercom by the door, a towel dispenser and a bin by the sinks, lamp housings.
{
  // dark glazed skirting tiles round the walls (not across the doorway)
  box(W, .1, .02, M.cove, 0, .05, -D / 2 + .01); box(3.45, .1, .02, M.cove, -2.275, .05, D / 2 - .01); box(3.45, .1, .02, M.cove, 2.275, .05, D / 2 - .01);
  box(.02, .1, D, M.cove, -W / 2 + .01, .05, 0); box(.02, .1, D, M.cove, W / 2 - .01, .05, 0);
  // soft shadows: along the floor, under the ceiling, up every corner and where the partition meets the wall
  const up = v3(0, 1, 0), down = v3(0, -1, 0);
  for (const [y, n, w] of [[.0015, up, .42], [H - .0015, down, .5]]){
    aoEdge(W, w, v3(0, y, -D / 2), v3(0, 0, 1), n); aoEdge(W, w, v3(0, y, D / 2), v3(0, 0, -1), n);
    aoEdge(D, w, v3(-W / 2, y, 0), v3(1, 0, 0), n); aoEdge(D, w, v3(W / 2, y, 0), v3(-1, 0, 0), n);
  }
  aoEdge(2.3, .3, v3(SX0 + .02, .0015, -1.85), v3(1, 0, 0), up); aoEdge(2.3, .3, v3(SX0 - .02, .0015, -1.85), v3(-1, 0, 0), up);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]){
    aoEdge(H, .35, v3(sx * W / 2, H / 2, sz * (D / 2 - .002)), v3(-sx, 0, 0), v3(0, 0, -sz));
    aoEdge(H, .35, v3(sx * (W / 2 - .002), H / 2, sz * D / 2), v3(0, 0, -sz), v3(-sx, 0, 0));
  }
  for (const sx of [-1, 1]) aoEdge(1.9, .22, v3(SX0 + sx * .02, 1.1, -D / 2 + .002), v3(sx, 0, 0), v3(0, 0, 1));
  flat(.9, 2.9, M.blob, -3.7, 0); flat(.7, .7, M.blob, 3.35, 2.45); flat(.8, .8, M.stain, 0, .3); WATER.puddle(1.15, .75, -3.2, .55);
  WATER.puddle(1.6, 1.3, -.25, .75);   // round the floor drain in the middle
  // the security camera high in the north-west corner, its red light blinking
  const cctv = new THREE.Group(); cctv.position.set(-3.72, 2.66, -2.72); cctv.rotation.set(-.42, -Math.PI * .75, 0, 'YXZ'); room.add(cctv);
  const part = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = m.receiveShadow = true; cctv.add(m); return m; };
  part(new THREE.BoxGeometry(.13, .12, .3), M.plastic, 0, 0, 0); part(new THREE.BoxGeometry(.17, .015, .34), M.plastic, 0, .07, -.02);
  part(new THREE.CylinderGeometry(.045, .045, .03, 18), M.dark, 0, 0, -.16, Math.PI / 2); part(new THREE.CylinderGeometry(.03, .03, .005, 18), M.mirror, 0, 0, -.176, Math.PI / 2);
  part(new THREE.SphereGeometry(.008, 8, 6), M.led, .045, -.04, -.152);
  box(.06, .06, .02, M.dullSteel, -3.88, 2.74, -2.99); box(.02, .06, .06, M.dullSteel, -3.99, 2.74, -2.88);
  { const arm = cyl(.014, .014, .25, M.dullSteel, -3.8, 2.73, -2.8, 8); arm.rotation.set(Math.PI / 2, 0, Math.PI / 4); }
  // a ventilation grille in the ceiling and one high on the wall above the toilet
  box(.52, .02, .42, M.grille, 1.1, H - .01, 1.5); box(.56, .012, .46, M.dullSteel, 1.1, H - .003, 1.5);
  box(.4, .25, .02, M.grille, 3.3, 2.5, -D / 2 + .012); box(.44, .29, .01, M.dullSteel, 3.3, 2.5, -D / 2 + .004);
  // the light switch by the door with its conduit to the ceiling, the intercom on the other side
  box(.08, .12, .035, M.dullSteel, -.85, 1.35, D / 2 - .018); box(.015, .035, .012, M.plastic, -.85, 1.35, D / 2 - .04);
  cyl(.012, .012, H - 1.41, M.dullSteel, -.85, (H + 1.41) / 2, D / 2 - .015, 8);
  for (const y of [1.9, 2.5]) box(.035, .02, .025, M.dullSteel, -.85, y, D / 2 - .013);
  box(.17, .24, .02, M.steel, .88, 1.45, D / 2 - .011);
  plane(.11, .11, M.speaker, .88, 1.5, D / 2 - .022, Math.PI);
  { const b = cyl(.02, .02, .02, M.red, .88, 1.38, D / 2 - .025, 16); b.rotation.x = Math.PI / 2; }
  // a paper-towel dispenser and a steel bin by the sinks
  box(.12, .38, .3, M.steel, -3.93, 1.4, 2.05); box(.02, .012, .22, M.dark, -3.87, 1.22, 2.05);
  cyl(.17, .15, .44, M.dullSteel, -3.68, .22, 2.25, 22); cyl(.155, .155, .004, M.dark, -3.68, .43, 2.25, 22);
  { const r = new THREE.Mesh(new THREE.TorusGeometry(.17, .008, 6, 28), M.steel); r.rotation.x = Math.PI / 2; r.position.set(-3.68, .44, 2.25); add(r); }
  flat(.55, .55, M.blob, -3.68, 2.25);
  // ### More of a real prison washroom: a stainless urinal trough on the north wall under the house rules, a barred
  // ### window of wired glass high up with the night behind it, two push-button showers on the east wall with their drain,
  // ### a steel bench bolted to the wall by the door, a fire extinguisher, a soap dispenser and a yellow wet-floor sign.
  { // the urinal trough: splashback, trough with a rolled rim and a film of water, brackets, flush pipe and waste pipe
    const X = -2, L = 2, Z = -D / 2;
    box(L, .9, .015, M.worn, X, .95, Z + .008);
    box(L, .02, .26, M.worn, X, .42, Z + .15); box(L, .2, .02, M.worn, X, .52, Z + .28);
    { const r = cyl(.016, .016, L, M.worn, X, .62, Z + .285, 12); r.rotation.z = Math.PI / 2; }
    for (const dx of [-L / 2, L / 2]) box(.02, .2, .28, M.worn, X + dx, .52, Z + .15);
    box(L - .04, .004, .24, M.water, X, .44, Z + .15);
    for (const dx of [-.8, 0, .8]) box(.04, .3, .2, M.dullSteel, X + dx, .26, Z + .11);
    cyl(.025, .025, .42, M.pipe, X - .8, .21, Z + .16, 12);
    { const f = cyl(.014, .014, L, M.chrome, X, 1.38, Z + .03, 10); f.rotation.z = Math.PI / 2; }
    cyl(.014, .014, 1.6, M.chrome, X + L / 2 - .1, 2.18, Z + .03, 10);
    box(.08, .12, .04, M.worn, X + L / 2 + .12, 1.2, Z + .02); { const b = cyl(.02, .02, .02, M.chrome, X + L / 2 + .12, 1.2, Z + .045, 14); b.rotation.x = Math.PI / 2; }
    flat(2.2, .7, M.stain, X, Z + .45); WATER.puddle(1.15, .55, X + .3, Z + .5);
  }
  { // the window: wired, frosted glass glowing faintly with the yard lights, five bars and a heavy steel frame
    const X = .4, Y = 2.3, Z = -D / 2, w = .9, h = .46;
    const wire = canvasTex(256, 128, (g, cw, ch) => { g.fillStyle = '#c7d4dc'; g.fillRect(0, 0, cw, ch); g.strokeStyle = 'rgba(40,46,50,.55)'; g.lineWidth = 1.5; for (let i = 0; i <= cw; i += 16){ g.beginPath(); g.moveTo(i, 0); g.lineTo(i, ch); g.stroke(); } for (let j = 0; j <= ch; j += 16){ g.beginPath(); g.moveTo(0, j); g.lineTo(cw, j); g.stroke(); } grime(g, cw, ch, 10, 'rgba(70,60,40,.3)', 40, true); });
    const glass = M.frost.clone(); glass.map = wire; glass.emissiveMap = wire;
    plane(w, h, glass, X, Y, Z + .01);
    for (const [bw, bh, dx, dy] of [[w + .1, .05, 0, h / 2 + .025], [w + .1, .05, 0, -h / 2 - .025], [.05, h + .1, -w / 2 - .025, 0], [.05, h + .1, w / 2 + .025, 0]]) box(bw, bh, .07, M.dullSteel, X + dx, Y + dy, Z + .035);
    for (let i = 0; i < 5; i++) cyl(.012, .012, h, M.steel, X - w / 2 + w * (i + .5) / 5, Y, Z + .05, 8);
    box(w + .14, .03, .1, M.dullSteel, X, Y - h / 2 - .06, Z + .05);   // the sill
  }
  { // two showers: supply pipe from the ceiling, wall plate, arm and head; a push-button valve; one drain in the floor
    for (const z of [.45, 1.55]){
      const X = W / 2;
      cyl(.016, .016, H - 2.05, M.pipe, X - .03, (H + 2.05) / 2, z, 10);
      box(.015, .16, .12, M.worn, X - .008, 2.05, z);
      { const a = cyl(.014, .014, .26, M.chrome, X - .13, 2.07, z, 10); a.rotation.z = Math.PI / 2; }
      { const hd = cyl(.055, .03, .05, M.chrome, X - .27, 2.04, z, 18); hd.rotation.z = -.5; }
      cyl(.05, .05, .003, M.dark, X - .285, 2.012, z, 18);
      box(.03, .16, .11, M.worn, X - .015, 1.2, z);
      { const b = cyl(.025, .025, .025, M.chrome, X - .035, 1.22, z, 16); b.rotation.z = Math.PI / 2; }
      box(.06, .015, .18, M.worn, X - .03, 1.0, z);   // a soap ledge
      flat(.8, .8, M.blob, X - .35, z);
    }
    box(.24, .01, .24, M.dullSteel, 3.55, .005, 1.0);
    for (let i = -2; i <= 2; i++) box(.2, .012, .018, M.dark, 3.55, .006, 1.0 + i * .04);
    WATER.puddle(1.3, 2.2, 3.35, 1.0); flat(1.1, 1.6, M.stain, 3.5, 1.0);
  }
  { // the steel bench bolted to the wall west of the door
    const X = -2.35, Z = D / 2;
    box(1.6, .04, .36, M.worn, X, .46, Z - .2); box(1.6, .06, .02, M.worn, X, .44, Z - .385);
    for (const dx of [-.65, .65]){ box(.04, .42, .3, M.dullSteel, X + dx, .23, Z - .17); box(.12, .12, .01, M.dullSteel, X + dx, .3, Z - .006); }
    for (const dx of [-.7, -.2, .2, .7]){ const b = cyl(.01, .01, .006, M.chrome, X + dx, .482, Z - .2, 6); }
    flat(1.9, .7, M.blob, X, Z - .25);
  }
  { // a fire extinguisher on its bracket by the door, and a soap dispenser between the sinks
    const X = -1.25, Z = D / 2 - .1;
    cyl(.075, .075, .44, M.red, X, .6, Z, 18); cyl(.05, .075, .06, M.red, X, .85, Z, 18);
    cyl(.02, .02, .06, M.black, X, .9, Z, 10); box(.12, .025, .04, M.black, X + .03, .935, Z);
    { const hose = new THREE.Mesh(new THREE.TorusGeometry(.07, .008, 6, 16, Math.PI * 1.2), M.black); hose.position.set(X + .07, .78, Z + .02); hose.rotation.y = Math.PI / 2; add(hose); }
    box(.16, .05, .1, M.dullSteel, X, .45, Z + .04); box(.05, .5, .01, M.dullSteel, X, .6, Z + .095);
    box(.08, .16, .08, M.steel, -3.955, 1.1, 0); box(.02, .02, .03, M.black, -3.91, 1.015, 0);
  }
  { // the wet-floor sign: a yellow A-frame by the showers
    const g = new THREE.Group(); g.position.set(2.7, 0, 1.35); g.rotation.y = .5; room.add(g);
    const signFace = canvasTex(128, 256, (c, w, h) => { c.fillStyle = '#f2c014'; c.fillRect(0, 0, w, h); c.fillStyle = '#141516'; c.font = '800 26px "Arial Narrow", Arial, sans-serif'; c.textAlign = 'center'; c.fillText('CAUTION', w / 2, 46); c.fillText('WET', w / 2, 200); c.fillText('FLOOR', w / 2, 230); c.beginPath(); c.moveTo(w / 2, 70); c.lineTo(w - 18, 170); c.lineTo(18, 170); c.closePath(); c.lineWidth = 6; c.strokeStyle = '#141516'; c.stroke(); c.fillRect(w / 2 - 4, 100, 8, 40); c.fillRect(w / 2 - 4, 148, 8, 8); });
    const face = new THREE.MeshStandardMaterial({ map: signFace, roughness: .5 });
    for (const s of [-1, 1]){ const p = new THREE.Mesh(new THREE.BoxGeometry(.3, .6, .012), [M.yellow, M.yellow, M.yellow, M.yellow, face, face]); p.position.set(0, .3, s * .09); p.rotation.x = s * -.16; p.castShadow = p.receiveShadow = true; g.add(p); }
    flat(.5, .5, M.blob, 2.7, 1.35);
  }
  // the bucket's wire handle
  { const hd = new THREE.Mesh(new THREE.TorusGeometry(.2, .006, 6, 24, Math.PI), M.dullSteel); hd.position.set(3.35, .33, 2.45); hd.rotation.set(-1.0, .5, 0); add(hd); }
  // housings over both lamps and a cage over the stall lamp
  box(1.42, .035, .2, M.dullSteel, -.6, H - .02, .3); box(.7, .035, .16, M.dullSteel, 2.75, H - .02, -1.8);
  for (let i = 0; i < 3; i++) box(.012, .07, .15, M.dullSteel, 2.5 + i * .25, 2.94, -1.8);
}

// ### Prison cloth: broad black and sand stripes of a coarse cotton twill. The stripes' edges wander a little where the dye
// ### bled, the diagonal ribs of the twill and thicker and thinner threads run through it, and it is faded and grubby in
// ### places. Returns the colour and a matching bump map for the ribs. The stripes run across v (one dark and one sand
// ### stripe per repeat) and the texture tiles both ways; rib sets how strongly the twill shows. Used for the uniform on the wall and the sleeves of your arms.
function prisonCloth(w, h, repeat, rib = 1){
  const weave = (x, y) => (((x + y) & 3) < 2 ? 1 : -1) * (((x >> 1) + y) % 7 === 0 ? .4 : 1);   // the twill's diagonal ribs
  const slub = []; for (let y = 0; y < h; y++) slub.push((rnd() - .5) * .1);
  const ph = [rnd(), rnd(), rnd(), rnd()].map(p => p * Math.PI * 2), TAU = Math.PI * 2;
  const shift = x => (Math.sin(TAU * x / w * 3 + ph[0]) * 1.2 + Math.sin(TAU * x / w * 8 + ph[1]) * .6) * h / 256;
  const width = x => (Math.sin(TAU * x / w * 5 + ph[2]) * 1.1 + Math.sin(TAU * x / w * 11 + ph[3]) * .5) * h / 256;
  const map = canvasTex(w, h, g => {
    const img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const yy = (y + shift(x) + h) % h, edge = Math.abs(yy - h / 2 - width(x)), dark = yy < h / 2 + width(x);
      const blur = Math.min(1, Math.min(edge, yy, h - yy) / 1.5), k = 1 + weave(x, y) * .035 * rib + slub[y] * .6 + (rnd() - .5) * .05;
      const c = dark ? [34, 32, 31] : [196, 186, 152], o = dark ? [196, 186, 152] : [34, 32, 31], mix = .5 - .5 * blur;
      const i = (y * w + x) * 4;
      for (let j = 0; j < 3; j++) d[i + j] = clamp((c[j] * (1 - mix) + o[j] * mix) * k, 0, 255);
      d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grime(g, w, h, 9, 'rgba(78,60,34,.16)', w * .35, false);              // old sweat and dirt
    grime(g, w, h, 6, 'rgba(240,232,210,.07)', w * .3, false);            // faded where it was scrubbed
  }, repeat);
  const bump = canvasTex(w, h, g => {
    const img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ const v = clamp(128 + weave(x, y) * 60 * rib + slub[y] * 400 + (rnd() - .5) * 30, 0, 255), i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    g.putImageData(img, 0, 0);
  }, repeat);
  bump.encoding = THREE.LinearEncoding;
  return { map, bump };
}
// ### The prisoner's uniform, hung on a hook on the north wall under the red lamp: a striped jacket hung by its collar,
// ### and the matching trousers hung behind it by the waistband, their legs showing under the jacket. The jacket is a
// ### tube of cloth built point by point: gathered at the collar, the shoulders sagging down to either side, soft folds
// ### that grow towards the hem, the lower back pushed off the wall by the trousers. On it sit a turned down collar, a
// ### dark gap down the front with its buttons, a breast pocket whose stripes do not quite match, and a sewn on cloth
// ### patch with the number 1356 stamped on it. The stripes follow the cloth (texture v runs down it).
{
  const PERIOD = .13, LJ = .76;   // one black and one sand stripe; the jacket's length from the collar
  const tex = prisonCloth(256, 256, [1, 1]);
  const cloth = new THREE.MeshStandardMaterial({ map: tex.map, bumpMap: tex.bump, bumpScale: .0007, roughness: .97 });
  const clothD = cloth.clone(); clothD.side = THREE.DoubleSide;
  const gap = new THREE.MeshStandardMaterial({ color: 0x070606, roughness: 1, side: THREE.DoubleSide });
  // a tube of cloth: fn(t, a) gives the point at t (0 top .. 1 bottom) and angle a, and how far the cloth there is pulled
  // up against the hang (the stripes follow it); v0 + t * len is the length of cloth from the top
  const clothTube = (rows, cols, v0, len, fn) => {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++){
      const t = i / rows, p = fn(t, j / cols * Math.PI * 2); pos.push(p[0], p[1], p[2]); uv.push(j / cols * 3, -(v0 + t * len - (p[3] || 0)) / PERIOD);
    }
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++){ const a = i * (cols + 1) + j, b = a + cols + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    geo.computeVertexNormals();
    const n = geo.attributes.normal;   // close the seam where the tube meets itself
    for (let i = 0; i <= rows; i++){ const a = i * (cols + 1), b = a + cols; const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1; n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l); }
    return geo;
  };
  const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const folds = (x, t) => (Math.sin(x * 30 + 1.3) * .6 + Math.sin(x * 53 + .4) * .25 + Math.sin(x * 13 + t * 4) * .5) * (.002 + .016 * ss(.15, 1, t));
  const g = new THREE.Group(); g.position.set(1.15, 1.84, -D / 2); room.add(g);
  const put = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  // the jacket: half its width, how far its back stands off the wall, and how far its front bulges, down its length
  const jw = t => .025 + .17 * ss(.01, .26, t) + .02 * ss(.26, 1, t);
  const back = t => .012 + .05 * ss(.4, .75, t);
  const jd = t => .018 + .03 * ss(0, .18, t) + .012 * t;
  // the point on the front of the jacket at x across and t down it
  const front = (x, t) => {
    const c = Math.pow(Math.min(1, Math.abs(x) / jw(t)), 1 / .6), s = Math.sqrt(Math.max(0, 1 - c * c));
    const z = back(t) + jd(t) * Math.pow(s, .7) + folds(x, t) * s + .018 * Math.exp(-Math.pow((t - .07) / .04, 2)) * s;   // bunched under the collar
    return [x + .008 * Math.sin(t * 5 + 1) * ss(.1, .6, t), -.03 - t * LJ, z];
  };
  // across the sagging shoulders a stripe runs downhill from the collar
  const sag = (x, t) => .07 * Math.pow(Math.min(1, Math.abs(x) / .19), 1.5) * (1 - ss(.15, .5, t)) + folds(x, t) * .2;
  put(clothTube(56, 36, 0, LJ, (t, a) => {
    const w = jw(t), c = Math.cos(a), sn = Math.sin(a), x = w * Math.sign(c) * Math.pow(Math.abs(c), .6);
    if (sn > 0) return [...front(x, t), sag(x, t)];
    return [x + .008 * Math.sin(t * 5 + 1) * ss(.1, .6, t), -.03 - t * LJ, back(t) + sn * .004, sag(x, t)];
  }), cloth);
  // a piece laid on the front of the jacket: corner(u, v) gives x and t, lift how far it stands off the cloth
  const onFront = (corner, nu, nv, lift, uvOf, mat) => {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= nv; i++) for (let j = 0; j <= nu; j++){
      const u = j / nu, v = i / nv, [x, t] = corner(u, v), p = front(x, t);
      pos.push(p[0], p[1], p[2] + lift(u, v)); uv.push(...uvOf(u, v, x, t));
    }
    for (let i = 0; i < nv; i++) for (let j = 0; j < nu; j++){ const a = i * (nu + 1) + j, b = a + nu + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    geo.computeVertexNormals();
    return put(geo, mat);
  };
  const clothUv = shift => (u, v, x, t) => [x * 6, -(t * LJ - sag(x, t) + shift) / PERIOD];
  // the turned down collar: a band round the hook and two points lying on the chest
  put(clothTube(4, 16, .3, .04, (t, a) => [Math.cos(a) * .034, -.006 - t * .04, .03 + Math.sin(a) * .024, 0]), cloth);
  for (const sd of [-1, 1]){
    const lerp = (p, q, k) => p + (q - p) * k;
    onFront((u, v) => [sd * lerp(lerp(.01, .045, u), lerp(.022, .04, u), v), lerp(lerp(.045, .08, u), lerp(.2, .19, u), v)], 6, 8,
      (u, v) => .006 + .006 * (1 - v), clothUv(.031), clothD);
  }
  // the dark gap where the two fronts meet, from the collar down to the hem, and five buttons beside it
  onFront((u, v) => [-.002 + u * .004, .17 + v * .83], 1, 40, () => .0008, (u, v) => [u, v], gap);
  for (let i = 0; i < 5; i++){
    const t = .22 + i * .15, p = front(-.018, t);
    const b = put(new THREE.CylinderGeometry(.0085, .0085, .005, 12), M.black); b.rotation.x = Math.PI / 2; b.position.set(p[0], p[1], p[2] + .004);
  }
  // the breast pocket on the left of the chest; its stripes are a little off the jacket's, its top edge is hemmed
  onFront((u, v) => [.045 + u * .105, .37 + v * .15], 8, 8, (u, v) => .004 + .002 * Math.sin(u * Math.PI), clothUv(.022), clothD);
  onFront((u, v) => [.045 + u * .105, .37 + v * .006], 8, 1, () => .0065, (u, v) => [u, v], gap);
  // the number patch above it: off-white cloth, the number stamped in black ink, worn, and stitched round the edge
  const numTex = canvasTex(256, 128, (c, w, h) => {
    c.fillStyle = '#d6cfb8'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++){ const v = rnd() < .5 ? 255 : 60; c.fillStyle = `rgba(${v},${v},${v * .9},${rnd() * .09})`; c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1); }
    grime(c, w, h, 5, 'rgba(90,70,40,.16)', 60, false);
    c.fillStyle = '#151413'; c.font = 'bold 86px "Arial Narrow", "Helvetica Neue", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.save(); c.translate(w / 2, h / 2 + 4); c.rotate(-.02); c.scale(1, 1.05); c.fillText('1356', 0, 0); c.restore();
    for (let i = 0; i < 700; i++){ c.fillStyle = `rgba(214,207,184,${.3 + rnd() * .6})`; c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }   // worn ink
    c.strokeStyle = 'rgba(40,36,30,.75)'; c.lineWidth = 2; c.setLineDash([6, 5]); c.strokeRect(8, 8, w - 16, h - 16);   // the stitches
  });
  const numMat = new THREE.MeshStandardMaterial({ map: numTex, roughness: .95, side: THREE.DoubleSide });
  onFront((u, v) => [.032 + u * .118, .255 + v * .076], 10, 4, () => .0045, (u, v) => [u, 1 - v], numMat);
  // the sleeves hang from the shoulders down both sides, in front of the body's edge, bunched a little at the elbow
  for (const sd of [-1, 1]){
    put(clothTube(26, 14, .16 + sd * .02, .54, (t, a) => {
      const r = .022 + .025 * ss(0, .14, t) - .006 * t + .003 * Math.sin(t * 19 + a * 2) + .004 * Math.exp(-Math.pow((t - .52) / .06, 2)) + .003 * ss(.93, .97, t);
      const cx = sd * (.15 + .065 * ss(0, .25, t)), cy = -.17 - t * .52, cz = .045 + .02 * ss(0, .2, t) + .045 * ss(.5, 1, t);
      return [cx + Math.cos(a) * r * .85, cy, cz + Math.sin(a) * r, Math.abs(Math.cos(a)) * .015];
    }), cloth);
    const cuff = put(new THREE.CircleGeometry(.036, 12), M.dark); cuff.rotation.x = Math.PI / 2; cuff.scale.x = .85; cuff.position.set(sd * .215, -.689, .11);
  }
  // the trousers' legs, hung behind the jacket by the waistband and showing below its hem
  for (const sd of [-1, 1]){
    put(clothTube(20, 16, .37 + sd * .03, .6, (t, a) => {
      const rx = .062 + .006 * t + .003 * Math.sin(t * 13 + a * 3 + sd), rz = .034 + .004 * t;
      return [sd * (.056 + .008 * t) + Math.cos(a) * rx, -.52 - t * .6, .052 + Math.sin(a) * rz, Math.abs(Math.cos(a)) * .01];
    }), cloth);
    const hem = put(new THREE.CircleGeometry(1, 16), M.dark); hem.rotation.x = Math.PI / 2; hem.scale.set(.066, .036, 1); hem.position.set(sd * .064, -1.119, .052);
  }
  // the hook it hangs on, screwed to the tiles
  box(.035, .07, .012, M.dullSteel, 1.15, 1.88, -D / 2 + .006);
  const hk = new THREE.Mesh(new THREE.TorusGeometry(.02, .005, 6, 12, Math.PI * 1.2), M.steel); hk.position.set(1.15, 1.86, -D / 2 + .03); hk.rotation.set(0, Math.PI / 2, Math.PI * .9); add(hk);
  flat(.5, .3, M.blob, 1.15, -D / 2 + .12);
}
// ### Toilet rolls dropped on the floor: lying on their sides at odd angles, one squashed, one with a long tail of paper
// ### unrolled across the stall floor into the puddle by the toilet.
{
  const paperTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#efe9d9'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++){ g.fillStyle = `rgba(140,130,105,${rnd() * .12})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
    g.fillStyle = 'rgba(150,140,115,.35)'; for (let x = 0; x < w; x += 6) g.fillRect(x, 0, 3, 2);   // the perforation
  }, [1, 1]);
  const paper = new THREE.MeshStandardMaterial({ map: paperTex, roughness: .95, side: THREE.DoubleSide });
  const card = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: .9, side: THREE.DoubleSide });
  const R = .056, r = .021, LEN = .1;
  const rollGeo = new THREE.LatheGeometry([[r + .002, -LEN / 2], [R - .005, -LEN / 2], [R, -LEN / 2 + .005], [R, LEN / 2 - .005], [R - .005, LEN / 2], [r + .002, LEN / 2]].map(([a, b]) => new THREE.Vector2(a, b)), 20);
  const coreGeo = new THREE.CylinderGeometry(r, r, LEN + .002, 16, 1, true);
  const roll = (x, z, yaw, squash = 1) => {
    const grp = new THREE.Group(); grp.position.set(x, R * squash, z); grp.rotation.set(0, yaw, Math.PI / 2, 'YXZ'); room.add(grp);
    for (const [geo, mat] of [[rollGeo, paper], [coreGeo, card]]){ const mm = new THREE.Mesh(geo, mat); mm.scale.set(squash, 1, 1); mm.castShadow = mm.receiveShadow = true; grp.add(mm); }
    flat(.22, .2, M.blob, x, z);
  };
  // a strip of paper lying along a path on the floor, crumpled here and there, rising to the roll it came from
  const strip = pts => {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z))), n = 70, len = curve.getLength(), pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++){
      const t = i / n, p = curve.getPointAt(t), tan = curve.getTangentAt(t);
      const lift = .003 + Math.max(0, Math.sin(t * 26 + 1)) * .007 * (1 - t * .6);
      for (const sd of [-1, 1]){ pos.push(p.x - tan.z * sd * .05, lift + sd * .003 * Math.sin(t * 41), p.z + tan.x * sd * .05); uv.push((sd + 1) / 2, t * len / .11); }
    }
    for (let i = 0; i < n; i++){ const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    const mm = new THREE.Mesh(geo, paper); mm.receiveShadow = true; room.add(mm);
  };
  roll(2.98, -1.3, .5); strip([[2.98, -1.3], [3.12, -1.52], [3.0, -1.78], [3.14, -2.02]]);   // in the stall, into the puddle
  roll(1.72, -2.68, 1.45);                                  // kicked into the stall corner
  roll(-3.15, -1.6, -.45, .7);                              // squashed flat by the sinks
  roll(.62, -1.62, 2.3); strip([[.62, -1.62], [.42, -1.48], [.2, -1.6], [.02, -1.42]]);   // in the middle of the room
}

// Environment map for the steel: a blurred stand-in of the room (tiled walls, dark floor, the bright tube), built once
{
  const envScene = new THREE.Scene();
  const et = canvasTex(64, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#3a3f3c'); gr.addColorStop(.4, '#9aa69e'); gr.addColorStop(.62, '#b9c2bb'); gr.addColorStop(.64, '#3c403e'); gr.addColorStop(1, '#1a1c1b'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  envScene.add(new THREE.Mesh(new THREE.BoxGeometry(8, 3, 6), new THREE.MeshBasicMaterial({ map: et, side: THREE.BackSide })));
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.4, .08, .25), new THREE.MeshBasicMaterial({ color: 0xffffff })); strip.position.set(-.6, 1.45, .3); envScene.add(strip);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, .02).texture;
  scene.background = new THREE.Color(0x050607);
  // ### Then the real thing: Poly Haven's "Bank Vault" HDRI, stored as RGBE in a PNG (red, green, blue and a shared
  // ### exponent in the alpha channel), so the fluorescent tube in it is many times brighter than the walls, as in life.
  new THREE.TextureLoader().load('textures/bank-vault-rgbe.png', t => {
    t.encoding = THREE.RGBEEncoding; t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.flipY = true;
    const env = pmrem.fromEquirectangular(t).texture;
    scene.environment.dispose(); scene.environment = env; t.dispose(); pmrem.dispose();
  }, undefined, () => pmrem.dispose());
}
// ### Surfaces that are not metal only pick up a little of the vault, as soft fill light; the metal shows all of it.
room.traverse(o => { if (o.isMesh && o.material.isMeshStandardMaterial && !o.material.metalness && o.material.envMapIntensity === 1) o.material.envMapIntensity = .45; });

// ### Static meshes that share a material are merged into one mesh, so the room is drawn in a few dozen draw calls instead
// ### of several hundred (and each shadow-casting light draws every caster once more). Objects that move or can be clicked
// ### stay separate. Runs once, after the room is built.
function mergeStatic(){
  const keep = new Set([mop, carKey, doorPivot, lidPivot, hale.g, hall, haleShadow]), groups = new Map();
  room.updateMatrixWorld(true);
  (function walk(o){
    for (const c of o.children){
      if (keep.has(c)) continue;
      if (c.isMesh && c.visible && !c.userData.hot && !Array.isArray(c.material) && !c.children.length){
        const k = c.material.uuid + (c.castShadow ? ':c' : '') + (c.receiveShadow ? ':r' : '');
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(c);
      }
      walk(c);
    }
  })(room);
  for (const list of groups.values()){
    if (list.length < 2) continue;
    const parts = list.map(m => {
      const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
      return g;
    });
    const nv = parts.reduce((a, g) => a + g.attributes.position.count, 0), ni = parts.reduce((a, g) => a + g.index.count, 0);
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new (nv > 65535 ? Uint32Array : Uint16Array)(ni);
    let ov = 0, oi = 0;
    for (const g of parts){
      const n = g.attributes.position.count, ia = g.index.array;
      pos.set(g.attributes.position.array, ov * 3); nor.set(g.attributes.normal.array, ov * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, ov * 2);
      for (let i = 0; i < ia.length; i++) idx[oi + i] = ia[i] + ov;
      ov += n; oi += ia.length; g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeBoundingSphere();
    const merged = new THREE.Mesh(geo, list[0].material);
    merged.castShadow = list[0].castShadow; merged.receiveShadow = list[0].receiveShadow; merged.renderOrder = list[0].renderOrder;
    merged.matrixAutoUpdate = false; room.add(merged);
    for (const m of list) m.parent.remove(m);
  }
}
mergeStatic();

// ---------- Camera: walking and looking around ----------
// ### You walk freely through the washroom in the first person: the arrow keys (or W A S D) walk, dragging the mouse or a
// ### finger turns your head. Where you stand decides which part of the room the rules see you in (the door, the sinks or
// ### the stall), so the markers of that part appear as you walk in. A touch screen has no arrow keys, so there the "Walk
// ### to" buttons glide you to a spot instead; the hatch, the briefing and the endings use the same glide.
const VIEWS = {
  intro: { pos: [0, 1.62, 2.2], look: [0, 1.4, -3] },
  door: { pos: [-.9, 1.62, 1.2], look: [1.25, .95, 3] },
  sinks: { pos: [-2.15, 1.62, .1], look: [-4, 1.15, 0] },
  stall: { pos: [3.25, 1.62, -.95], look: [2.4, .55, -2.6] },
  hatch: { pos: [2.3, 1.02, -.86], look: [2.22, .05, -1.55] },
  tunnel: { pos: [2.2, -2.6, -1.6], look: [2.2, -3.9, -1.95] },
  cell: { pos: [0, 1.62, 1.1], look: [0, 1.45, 3] },
  closing: { pos: [.5, 1.5, -.3], look: [-.05, 1.05, 3] }
};
const EYE = 1.62, WALK_SPEED = 1.7, BODY = .26, LOOK_SPEED = .0042;
// lookYaw and lookPitch are where the mouse points the head; yaw and pitch follow them within a few milliseconds, so uneven
// mouse events never make the picture jerk
const cam = { pos: new THREE.Vector3(...VIEWS.intro.pos), yaw: 0, pitch: 0, lookYaw: 0, lookPitch: 0, from: null, t: 1, dur: 1,
  vel: new THREE.Vector3(), stride: 0, bob: 0, sway: 0, stepAmp: 1 };
camera.rotation.order = 'YXZ';
// ### The camera angles that look at a point.
const anglesTo = (pos, look) => { const d = new THREE.Vector3(...look).sub(new THREE.Vector3(...pos)); return { yaw: Math.atan2(d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) }; };
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
let camTarget = { pos: new THREE.Vector3(...VIEWS.intro.pos), ...anglesTo(VIEWS.intro.pos, VIEWS.intro.look) };
Object.assign(cam, { yaw: camTarget.yaw, pitch: camTarget.pitch, lookYaw: camTarget.yaw, lookPitch: camTarget.pitch });
// ### Moves the camera smoothly to another place in the cell.
function goView(name, dur){
  const v = VIEWS[name];
  cam.yaw = wrapAngle(cam.yaw);
  cam.from = { pos: cam.pos.clone(), yaw: cam.yaw, pitch: cam.pitch };
  camTarget = { pos: new THREE.Vector3(...v.pos), ...anglesTo(v.pos, v.look) };
  // turn the short way round
  while (camTarget.yaw - cam.from.yaw > Math.PI) camTarget.yaw -= Math.PI * 2;
  while (camTarget.yaw - cam.from.yaw < -Math.PI) camTarget.yaw += Math.PI * 2;
  cam.t = 0; cam.dur = REDUCED ? .01 : (dur || 1.1); cam.vel.set(0, 0, 0);
}

// ### What you bump into, seen from above as rectangles [x0, x1, z0, z1]: the sink counter, the bin, the bucket, the stall
// ### partitions, its open door and the toilet. The walls are the edges of the room. You are a circle of BODY metres.
const SOLID = [
  [-4, -3.5, -1.3, 1.3], [-3.85, -3.51, 2.08, 2.42], [3.15, 3.55, 2.25, 2.65],
  [1.47, 1.53, -3, -.68], [1.47, 1.8, -.73, -.67], [3.7, 4, -.73, -.67], [3.68, 3.87, -.7, .2],
  [2.95, 3.55, -3, -2.14],
  [-3.05, -.95, -3, -2.68], [-3.17, -1.53, 2.58, 3], [-1.35, -1.15, 2.78, 3], [2.5, 2.9, 1.15, 1.55], [.88, 1.42, -3, -2.82]
];
// ### Keeps the circle you stand in out of every solid and inside the walls; it slides along what it touches.
function collide(p){
  for (let n = 0; n < 2; n++){
    for (const [x0, x1, z0, z1] of SOLID){
      const cx = clamp(p.x, x0, x1), cz = clamp(p.z, z0, z1), dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
      if (d >= BODY) continue;
      if (d > 1e-6){ p.x = cx + dx / d * BODY; p.z = cz + dz / d * BODY; }
      else { // the centre is inside: leave by the nearest side
        const out = [[x0 - BODY - p.x, 0], [x1 + BODY - p.x, 0], [0, z0 - BODY - p.z], [0, z1 + BODY - p.z]].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]))[0];
        p.x += out[0]; p.z += out[1];
      }
    }
    p.x = clamp(p.x, -W / 2 + BODY, W / 2 - BODY); p.z = clamp(p.z, -D / 2 + BODY, D / 2 - BODY);
  }
}
// ### Which part of the room a spot belongs to. You have to be well inside a new part before it counts, so walking along
// ### a border never switches back and forth.
function zoneAt(x, z, now){
  const m = n => (now === n ? .12 : -.12);
  if (x > SX0 && z < SZ1 + .45 + m('stall')) return 'stall';
  if (x < -1.7 + m('sinks')) return 'sinks';
  return 'door';
}
const MOVE_KEYS = { ArrowUp: [0, 1], KeyW: [0, 1], ArrowDown: [0, -1], KeyS: [0, -1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
const held = new Set();
const canWalk = () => overlay.hidden && !paused && !S.ending && S.scene !== 'intro' && cam.t >= 1;
// ### Walking into another part of the room tells the rules, quietly after the first visit. From the hatch you stand up first.
const seenScenes = new Set();
function walkInto(zone){
  if (S.scene === 'hatch' && zone !== 'stall') act('go', 'stall', true);
  if (S.scene !== zone) act('go', zone, true);
}
// ### One step of walking: speed builds up and fades out smoothly, you slide along walls, and the floor answers with soft
// ### footsteps. The head moves as in a real walk (not with reduced motion): it dips a little at every footfall and rises
// ### over the standing leg, and the body shifts its weight from one foot to the other, so the view sways gently from side
// ### to side once every two steps and tilts with it.
function walk(dt){
  // a card (a clue, the lock, a mini game, the pause) stops you on the spot; the mini games use the arrow keys themselves
  if (!canWalk()){ cam.vel.set(0, 0, 0); cam.bob *= .9; return; }
  let f = 0, s = 0;
  for (const k of held){ f += MOVE_KEYS[k][1]; s += MOVE_KEYS[k][0]; }
  const len = Math.hypot(f, s);
  if (len && S.scene === 'hatch'){ act('go', 'stall', true); }
  const fx = Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), sp = len ? WALK_SPEED / len : 0;
  const k = 1 - Math.exp(-dt * (len ? 10 : 14));
  cam.vel.x += ((fx * f - fz * s) * sp - cam.vel.x) * k;
  cam.vel.z += ((fz * f + fx * s) * sp - cam.vel.z) * k;
  const speed = Math.hypot(cam.vel.x, cam.vel.z);
  if (speed > .002){
    cam.pos.x += cam.vel.x * dt; cam.pos.z += cam.vel.z * dt;
    collide(cam.pos);
    const before = Math.floor(cam.stride / .8);
    cam.stride += speed * dt;
    if (Math.floor(cam.stride / .8) !== before){
      // no two steps are quite the same: each one dips the head a little more or less
      cam.stepAmp = .82 + Math.random() * .36;
      if (speed > .5) noise(.09, .06, 'lowpass', 240);
    }
    if (len) $('lookHint').classList.add('gone');
    const z = zoneAt(cam.pos.x, cam.pos.z, S.scene === 'hatch' ? 'stall' : S.scene);
    if (z !== (S.scene === 'hatch' ? 'stall' : S.scene)) walkInto(z);
  } else cam.vel.set(0, 0, 0);
  // stand up again after the hatch, and a gentle bob that fades in and out with the speed
  if (S.scene !== 'hatch') cam.pos.y += (EYE - cam.pos.y) * (1 - Math.exp(-dt * 6));
  const gait = REDUCED ? 0 : Math.min(1, speed / WALK_SPEED), steps = cam.stride / .8, kb = 1 - Math.exp(-dt * 12);
  // lowest at each footfall (when the footstep sounds), highest halfway through the step
  cam.bob += ((Math.abs(Math.sin(Math.PI * steps)) - .64) * .026 * gait * cam.stepAmp - cam.bob) * kb;
  cam.sway += (Math.sin(Math.PI * steps) * .011 * gait - cam.sway) * kb;
}
// ### Moves the camera each frame: a glide when one runs, otherwise walking and looking.
function updateCamera(dt){
  if (cam.t < 1){
    cam.t = Math.min(1, cam.t + dt / cam.dur);
    const e = cam.t < .5 ? 2 * cam.t * cam.t : 1 - Math.pow(-2 * cam.t + 2, 2) / 2;
    cam.pos.lerpVectors(cam.from.pos, camTarget.pos, e);
    cam.lookYaw = cam.yaw = cam.from.yaw + (camTarget.yaw - cam.from.yaw) * e;
    cam.lookPitch = cam.pitch = cam.from.pitch + (camTarget.pitch - cam.from.pitch) * e;
    cam.bob *= .9; cam.sway *= .9;
  } else {
    const k = 1 - Math.exp(-dt * 30);
    cam.yaw += (cam.lookYaw - cam.yaw) * k; cam.pitch += (cam.lookPitch - cam.pitch) * k;
    walk(dt);
  }
  // the weight shift moves the eye sideways (to the right of where you look) and tilts the head a little with it
  camera.position.set(cam.pos.x + Math.cos(cam.yaw) * cam.sway, cam.pos.y + cam.bob, cam.pos.z + Math.sin(cam.yaw) * cam.sway);
  camera.rotation.set(clamp(cam.pitch, -1.4, 1.4), -cam.yaw, -cam.sway * .45);
}
let drag = null;
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId }; try { canvas.setPointerCapture(e.pointerId); } catch (err) {} initAudio(); });
canvas.addEventListener('pointermove', e => {
  if (drag){
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    // the first few pixels decide between a click and a drag; once it is a drag, every pixel turns the head
    if (drag.moved > 6){
      if (!drag.looking){ drag.looking = true; canvas.classList.add('dragging'); $('lookHint').classList.add('gone'); }
      if (cam.t >= 1){ cam.lookYaw += dx * LOOK_SPEED; cam.lookPitch = clamp(cam.lookPitch - dy * LOOK_SPEED, -1.3, 1.25); }
    }
  } else pendingHover = e;
});
canvas.addEventListener('pointerup', e => { if (drag && drag.moved <= 6) clickAt(e); drag = null; canvas.classList.remove('dragging'); });
canvas.addEventListener('pointercancel', () => { drag = null; canvas.classList.remove('dragging'); });
if (COARSE) $('lookHint').textContent = 'Drag to look around · tap the markers';

// ---------- Your own hands ----------
// ### You see your own hands at the bottom of the picture, in the sleeves of the striped prison uniform (the same black
// ### and sand stripes as the coat on the wall). They live in a small scene of their own that is drawn over the room after
// ### a depth clear, so they never sink into a wall you stand close to and never show up in the puddles. The hands are
// ### real hand models with a skeleton (room-1-escape/models, MIT licence), so every finger bends at its own joints. Until
// ### they have loaded, or if they cannot load (for example when the page is opened straight from the folder), simple
// ### drawn hands stand in. They hide during the endings. With reduced motion they hold still.
const handScene = new THREE.Scene(), handCam = new THREE.PerspectiveCamera();
handScene.add(new THREE.HemisphereLight(0xb9c6bf, 0x1c1410, .42));
{
  const key = new THREE.DirectionalLight(0xe8ecdf, .62); key.position.set(.2, 1, -.4); handScene.add(key);
  const fill = new THREE.DirectionalLight(0xd9c7b8, .18); fill.position.set(-.3, -.4, .6); handScene.add(fill);   // light bouncing off the floor
  const red = new THREE.PointLight(0xff2a1a, .12, 3); red.position.set(-.8, .5, -.6); handScene.add(red);   // the emergency lamps
}
const HAND_MAT = {
  skin: new THREE.MeshStandardMaterial({ color: 0xa06e55, roughness: .66 }),
  nail: new THREE.MeshStandardMaterial({ color: 0xd9b3a0, roughness: .35 }),
  // the real hands: skin with faint blotches and redder patches, matt but with a soft sheen
  real: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .6, envMapIntensity: .35, skinning: true, map: canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#a8765c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++){ const r = 2 + rnd() * 9; g.fillStyle = rnd() < .5 ? `rgba(176,104,84,${rnd() * .12})` : `rgba(214,170,140,${rnd() * .12})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2); g.fill(); }
    for (let i = 0; i < 1600; i++){ g.fillStyle = `rgba(90,52,40,${rnd() * .07})`; g.fillRect(rnd() * w, rnd() * h, 1, 1); }   // pores
  }, [3, 3]) }),
  sleeve: (() => { const c = prisonCloth(256, 256, [1, 3.2], .25); return new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: .97, side: THREE.DoubleSide, map: c.map, bumpMap: c.bump, bumpScale: .0004 }); })()
};
// ### The cuff and the sleeve, running from the wrist (the origin) back out of the picture along +z.
function addSleeve(arm){
  arm.add(new THREE.Mesh(new THREE.CylinderGeometry(.038, .04, .035, 18, 1, true).rotateX(Math.PI / 2).translate(0, 0, .05), HAND_MAT.sleeve));
  arm.add(new THREE.Mesh(new THREE.CylinderGeometry(.042, .052, .42, 18).rotateX(Math.PI / 2).translate(0, -.004, .275), HAND_MAT.sleeve));
}
// ### The drawn stand-in hand with its forearm in a sleeve. The wrist is at the origin and the fingers point along -z, as
// ### the camera looks; side is 1 for the right hand and -1 for the left. Every part with the same material is merged, so
// ### each arm is drawn in three draw calls.
function buildHand(side){
  const arm = new THREE.Group();
  const mesh = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); (parent || arm).add(m); return m; };
  mesh(new THREE.SphereGeometry(1, 18, 12).scale(.043, .017, .052).translate(0, 0, -.046), HAND_MAT.skin);
  mesh(new THREE.SphereGeometry(1, 14, 10).scale(.035, .019, .03).translate(-side * .012, -.004, -.012), HAND_MAT.skin);   // the ball of the thumb
  [[-.027, .047, .031, .0088], [-.009, .052, .034, .0086], [.009, .049, .032, .0082], [.026, .038, .025, .0072]].forEach(([x, l1, l2, r], i) => {
    const base = new THREE.Group(); base.position.set(side * x, 0, -.09 + Math.abs(x) * .25); arm.add(base);
    mesh(new THREE.SphereGeometry(r * 1.04, 10, 8), HAND_MAT.skin, base);
    mesh(new THREE.CylinderGeometry(r * .95, r, l1, 9).rotateX(Math.PI / 2).translate(0, 0, -l1 / 2), HAND_MAT.skin, base);
    const mid = new THREE.Group(); mid.position.z = -l1; base.add(mid);
    mesh(new THREE.SphereGeometry(r * .93, 10, 8), HAND_MAT.skin, mid);
    mesh(new THREE.CylinderGeometry(r * .8, r * .92, l2, 9).rotateX(Math.PI / 2).translate(0, 0, -l2 / 2), HAND_MAT.skin, mid);
    mesh(new THREE.SphereGeometry(r * .8, 10, 8).translate(0, 0, -l2), HAND_MAT.skin, mid);
    mesh(new THREE.SphereGeometry(1, 8, 6).scale(r * .62, r * .25, r * .9).translate(0, r * .62, -l2 + r * .55), HAND_MAT.nail, mid);
    base.rotation.set(-.22 - i * .07, side * (i - 1.5) * -.03, 0); mid.rotation.x = -.38 - i * .06;
  });
  const thumb = new THREE.Group(); thumb.position.set(-side * .036, -.008, -.03); arm.add(thumb);
  thumb.rotation.set(-.25, side * .55, -side * .5);
  mesh(new THREE.SphereGeometry(.0105, 10, 8), HAND_MAT.skin, thumb);
  mesh(new THREE.CylinderGeometry(.0095, .0108, .036, 9).rotateX(Math.PI / 2).translate(0, 0, -.018), HAND_MAT.skin, thumb);
  const tip = new THREE.Group(); tip.position.z = -.036; tip.rotation.x = -.3; thumb.add(tip);
  mesh(new THREE.SphereGeometry(.0096, 10, 8), HAND_MAT.skin, tip);
  mesh(new THREE.CylinderGeometry(.0084, .0094, .029, 9).rotateX(Math.PI / 2).translate(0, 0, -.0145), HAND_MAT.skin, tip);
  mesh(new THREE.SphereGeometry(.0084, 10, 8).translate(0, 0, -.029), HAND_MAT.skin, tip);
  mesh(new THREE.SphereGeometry(1, 8, 6).scale(.0055, .002, .0075).translate(0, .0068, -.025), HAND_MAT.nail, tip);
  mesh(new THREE.CylinderGeometry(.027, .03, .05, 14).rotateX(Math.PI / 2).scale(1.25, .8, 1).translate(0, 0, .012), HAND_MAT.skin);
  addSleeve(arm);
  bakeArm(arm);
  handScene.add(arm);
  return { arm, wrist: null, fingers: null, thumb: null };
}
// ### Merges every part of an arm that shares a material into one mesh, in the arm's own space.
function bakeArm(arm){
  arm.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(arm.matrixWorld).invert(), groups = new Map(), m4 = new THREE.Matrix4();
  arm.traverse(o => { if (o.isMesh){ if (!groups.has(o.material)) groups.set(o.material, []); groups.get(o.material).push(o); } });
  arm.clear();
  for (const [mat, list] of groups){
    const parts = list.map(o => { const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld)); o.geometry.dispose(); return g; });
    const n = parts.reduce((a, g) => a + g.attributes.position.count, 0), pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0;
    for (const g of parts){ pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; g.dispose(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    arm.add(new THREE.Mesh(geo, mat));
  }
}
// ### Reads a binary glTF file (.glb) with one skinned mesh, as the hand models are: the mesh, its joints and the matrices
// ### that bind the skin to them. A few lines instead of three.js's GLTFLoader, so no other library has to be loaded.
function readGlb(buf){
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('not a glb file');
  const jsonLen = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen))), bin = 20 + jsonLen + 8;
  const acc = i => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType], st = bin + (bv.byteOffset || 0) + (a.byteOffset || 0);
    return new T(buf.slice(st, st + a.count * n * T.BYTES_PER_ELEMENT));
  };
  const prim = json.meshes[0].primitives[0], A = prim.attributes, skin = json.skins[0];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(acc(A.POSITION), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(acc(A.NORMAL), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(acc(A.TEXCOORD_0), 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(acc(A.JOINTS_0)), 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(acc(A.WEIGHTS_0), 4));
  geo.setIndex(new THREE.BufferAttribute(acc(prim.indices), 1));
  const nodes = json.nodes.map((n, i) => {
    const o = skin.joints.includes(i) ? new THREE.Bone() : new THREE.Object3D();
    o.name = n.name || '';
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  json.nodes.forEach((n, i) => (n.children || []).forEach(c => nodes[i].add(nodes[c])));
  const ibm = acc(skin.inverseBindMatrices), inverses = skin.joints.map((j, k) => new THREE.Matrix4().fromArray(ibm, k * 16));
  const meshNode = json.nodes.findIndex(n => n.mesh !== undefined);
  return { geo, root: nodes[json.scenes[json.scene || 0].nodes[0]], meshParent: nodes[meshNode], bones: skin.joints.map(j => nodes[j]), inverses };
}
const FINGERS = ['index', 'middle', 'ring', 'pinky'];
// ### Builds a real hand from its model: the joints are chained (wrist, knuckle, the three finger bones) so that bending
// ### one joint carries the rest of the finger with it, and the whole hand is turned so that its wrist sits at the origin
// ### with the fingers along -z and the back of the hand up, like the drawn hand. Then the forearm and sleeve are added.
function buildRealHand(side, buf){
  const m = readGlb(buf), by = {};
  m.root.traverse(o => { if (o.name) by[o.name] = o; });
  m.root.updateMatrixWorld(true);
  const chain = list => { for (let i = 1; i < list.length; i++) if (by[list[i]] && by[list[i - 1]]) by[list[i - 1]].attach(by[list[i]]); };
  chain(['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']);
  for (const f of FINGERS) chain(['wrist', f + '-finger-metacarpal', f + '-finger-phalanx-proximal', f + '-finger-phalanx-intermediate', f + '-finger-phalanx-distal', f + '-finger-tip']);
  const mesh = new THREE.SkinnedMesh(m.geo, HAND_MAT.real);
  mesh.frustumCulled = false;
  m.meshParent.add(mesh);
  m.root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(m.bones, m.inverses), mesh.matrixWorld);
  // put the wrist at the origin, facing the way the drawn hand does
  m.root.applyMatrix4(new THREE.Matrix4().copy(by.wrist.matrixWorld).invert());
  const arm = new THREE.Group(), wrist = new THREE.Group();
  wrist.add(m.root); arm.add(wrist); addSleeve(arm);
  const joint = o => ({ o, rest: o.quaternion.clone() });
  const fingers = FINGERS.map(f => [f + '-finger-phalanx-proximal', f + '-finger-phalanx-intermediate', f + '-finger-phalanx-distal'].map(n => joint(by[n])));
  const thumb = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal'].map(n => joint(by[n]));
  handScene.add(arm);
  return { arm, wrist, fingers, thumb };
}
// ### Loads the two real hands and swaps them in for the drawn ones. If they cannot be loaded, the drawn hands stay.
function loadRealHands(){
  Promise.all(['right', 'left'].map(n => fetch('models/hand-' + n + '.glb').then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })))
    .then(([r, l]) => {
      for (const [key, buf, side] of [['r', r, 1], ['l', l, -1]]){
        const h = buildRealHand(side, buf);
        handScene.remove(HANDS[key].arm);
        Object.assign(HANDS[key], h);
      }
    })
    .catch(() => {});
}
// one hand's state: where it is and how fast it moves (springs), its swing size this stride, and its idle gesture
const handState = () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), w: new THREE.Vector3(), wr: new THREE.Vector2(), wv: new THREE.Vector2(),
  amp: 1, ampT: 1, step: 0, curl: [0, 0, 0, 0, 0], gesture: null, gestureT: 0, nextGesture: 3 + Math.random() * 6, seed: Math.random() * 100, init: false });
const HANDS = { r: Object.assign(buildHand(1), handState()), l: Object.assign(buildHand(-1), handState()), reach: 0, down: 1 };
loadRealHands();
// ### Where each hand is (x, y, z from the eye) and how it is turned (pitch, yaw, roll). At rest the arms hang relaxed:
// ### the hands low at the edge of the picture, thumbs up and palms turned towards each other, the forearms rising from
// ### below. To use something the right hand turns palm down and reaches forward into the middle of the picture.
const HAND_REST = { r: [.2, -.215, -.37, -.06, .1, -.9], l: [-.2, -.221, -.38, -.06, -.08, .92] };
const HAND_REACH = [.12, -.165, -.5, .3, .35, -.35];
// how much each finger is bent at rest (index to little finger, then the thumb): a relaxed hand curls more towards the little finger
const CURL_REST = [.3, .4, .48, .56, .2];
// ### Little things a hand does while you stand still, now and then: make a loose fist, tap with the index finger,
// ### stretch the fingers or rub the thumb along the fingertips. Each is a curve over its duration, per finger.
const GESTURES = {
  fist: { dur: 1.6, curl: t => [.75, .8, .8, .8, .35].map(c => c * Math.sin(Math.PI * t)) },
  tap: { dur: 1.4, curl: t => [-.35 * Math.max(0, Math.sin(Math.PI * 4 * t)) * Math.sin(Math.PI * t), 0, 0, 0, 0] },
  stretch: { dur: 1.8, curl: t => [-.45, -.5, -.5, -.5, -.3].map(c => c * Math.sin(Math.PI * t)), spread: t => .18 * Math.sin(Math.PI * t) },
  rub: { dur: 2, curl: t => [.35, .3, .2, .1, .45 + .15 * Math.sin(Math.PI * 6 * t)].map(c => c * Math.sin(Math.PI * t)) }
};
const GESTURE_NAMES = Object.keys(GESTURES);
// ### The right hand reaches out when you use something (a marker, a click or a key).
function reachHand(){ if (!REDUCED) HANDS.reach = 1; }
// smooth noise: a few slow waves of unrelated speeds, so nothing ever repeats in step
const wobble = (seed, t) => Math.sin(t * .71 + seed) * .5 + Math.sin(t * 1.37 + seed * 2.3) * .3 + Math.sin(t * 2.9 + seed * 4.1) * .2;
// ### A spring pulls each value towards where it should be: it overshoots a little and settles, as a loose arm does.
function spring(x, v, target, k, damping, dt){
  const n = Math.max(1, Math.ceil(dt / .008)), h = dt / n;
  for (let i = 0; i < n; i++){ v += (k * (target - x) - damping * v) * h; x += v * h; }
  return [x, v];
}
// ### Moves the hands each frame. Walking swings the arms like pendulums, opposite to each other and to the legs, one
// ### swing every two steps, each swing a little different; the arms trail behind a turn of the head, the wrists flop a
// ### little behind the arms, and the fingers curl and open with the swing and drift on their own. Standing still, the
// ### hands breathe and now and then make a small gesture. Using something sends the right hand forward, fingers open.
function updateHands(dt){
  const show = !S.ending && hatchAnim < 0 && camera.position.y > 0;
  HANDS.down += ((show ? 0 : 1) - HANDS.down) * (1 - Math.exp(-dt * 5));
  const still = REDUCED ? 0 : 1, t = clock;
  HANDS.reach = Math.max(0, HANDS.reach - dt / .55);
  const sp = Math.min(1, Math.hypot(cam.vel.x, cam.vel.z) / WALK_SPEED) * still, steps = cam.stride / .8, ph = steps * Math.PI;
  const reach = Math.sin(HANDS.reach * Math.PI) ** .7, lerp = (a, b, k) => a + (b - a) * k;
  for (const key of ['r', 'l']){
    const h = HANDS[key], [x, y, z, rx, ry, rz] = HAND_REST[key], side = key === 'r' ? 1 : -1, sd = h.seed;
    // every step the next swing gets its own size, so no two strides look the same
    if (Math.floor(steps) !== h.step){ h.step = Math.floor(steps); h.ampT = .78 + Math.random() * .4; }
    h.amp += (h.ampT - h.amp) * (1 - Math.exp(-dt * 3));
    const swing = Math.sin(ph + (side > 0 ? Math.PI : 0) + wobble(sd, t * .5) * .25) * sp * h.amp;
    const out = key === 'r' ? reach : 0, R = HAND_REACH, idle = (1 - sp * .6) * still;
    const breathe = Math.sin(t * 1.6 + sd) * .0028 * still;
    // where the arm should be: rest pose, the swing (the elbow bends more on the way forward), a slow drift, the reach
    const tp = [lerp(x - side * swing * .022 + wobble(sd + 1, t) * .004 * idle, R[0], out),
      lerp(y + (swing > 0 ? swing * .065 : swing * .035) + breathe + wobble(sd + 2, t) * .004 * idle, R[1], out) - HANDS.down * .35,
      lerp(z - swing * .095 + wobble(sd + 3, t) * .005 * idle, R[2], out)];
    const tr = [lerp(rx + swing * .2 + wobble(sd + 4, t * .8) * .03 * idle, R[3], out),
      lerp(ry + swing * side * .1 + wobble(sd + 5, t * .8) * .03 * idle, R[4], out),
      lerp(rz + swing * side * .12 + wobble(sd + 6, t * .7) * .05 * idle, R[5], out)];
    if (!h.init){ h.p.fromArray(tp); h.r.fromArray(tr); h.init = true; }
    // springs: a quick, slightly loose follow; the head turning is felt as the arm trailing behind by itself
    const P = h.p.toArray(), Vp = h.v.toArray(), Rr = h.r.toArray(), W = h.w.toArray();
    for (let i = 0; i < 3; i++){
      [P[i], Vp[i]] = spring(P[i], Vp[i], tp[i], still ? 140 : 900, still ? 15 : 60, dt);
      [Rr[i], W[i]] = spring(Rr[i], W[i], tr[i], still ? 120 : 900, still ? 13 : 60, dt);
    }
    h.p.fromArray(P); h.v.fromArray(Vp); h.r.fromArray(Rr); h.w.fromArray(W);
    h.arm.position.copy(h.p);
    h.arm.rotation.set(h.r.x, h.r.y, h.r.z, 'YXZ');
    h.arm.visible = HANDS.down < .98;
    if (!h.wrist) continue;
    // the wrist lags behind the arm's movement and flops back, a little more on the back swing
    const wt = [-W[0] * .06 - Vp[1] * 1.6 + wobble(sd + 7, t * .6) * .05 * still - out * .15, -W[1] * .05 + wobble(sd + 8, t * .5) * .06 * still];
    const wr = h.wr.toArray(), wv = h.wv.toArray();
    for (let i = 0; i < 2; i++) [wr[i], wv[i]] = spring(wr[i], wv[i], clamp(wt[i], -.5, .5), still ? 70 : 900, still ? 7 : 60, dt);
    h.wr.fromArray(wr); h.wv.fromArray(wv);
    h.wrist.rotation.set(wr[0], wr[1], 0);
    // idle gestures: only while standing still with nothing in the hand
    let g = null, gk = 0;
    if (still && sp < .08 && out < .01){
      if (h.gesture){ h.gestureT += dt / GESTURES[h.gesture].dur; if (h.gestureT >= 1){ h.gesture = null; h.nextGesture = 4 + Math.random() * 9; } }
      else if ((h.nextGesture -= dt) <= 0){ h.gesture = GESTURE_NAMES[Math.floor(Math.random() * GESTURE_NAMES.length)]; h.gestureT = 0; }
      if (h.gesture){ g = GESTURES[h.gesture]; gk = h.gestureT; }
    } else if (h.gesture){ h.gesture = null; h.nextGesture = 3 + Math.random() * 6; }
    const gc = g ? g.curl(gk) : [0, 0, 0, 0, 0], spread = (g && g.spread ? g.spread(gk) : 0) + out * .14;
    for (let f = 0; f < 5; f++){
      // the fingers close a little as the hand swings back and open as it swings forward; each drifts on its own
      const target = (CURL_REST[f] - swing * .12 + wobble(sd + 10 + f, t * 1.1) * .07 * still + gc[f]) * (1 - out * .8);
      h.curl[f] += (target - h.curl[f]) * (1 - Math.exp(-dt * (g ? 10 : 6)));
    }
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    h.fingers.forEach((bones, f) => bones.forEach((j, n) => {
      const c = h.curl[f] * [1, 1.25, .8][n], s = n ? 0 : side * (f - 1.5) * (.05 + spread * .5);
      j.o.quaternion.copy(j.rest).multiply(q.setFromEuler(e.set(-c, s, 0)));
    }));
    h.thumb.forEach((j, n) => { const c = h.curl[4] * [.5, 1, .9][n]; j.o.quaternion.copy(j.rest).multiply(q.setFromEuler(e.set(-c, n ? 0 : -side * c * .4, 0))); });
  }
}
// ### Draws the hands over the room with the same lens as the eye, after clearing the depth so nothing hides them.
function drawHands(){
  if (!HANDS.r.arm.visible) return;
  handScene.environment = scene.environment;
  handCam.projectionMatrix.copy(camera.projectionMatrix); handCam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
  renderer.autoClear = false; renderer.clearDepth(); renderer.render(handScene, handCam); renderer.autoClear = true;
}

// ---------- Hotspots: markers and clicking objects ----------
// ### visibleHotspots() from rules.js says what can be used right now. Objects get a pulsing marker (a real button, so it
// ### works with a keyboard and on touch screens), and the hatch gets a marker of its own so you can kneel down at it.
// ### Clicking an object in the 3D view does the same as its marker. With a keyboard you walk with the arrow keys; only a
// ### touch screen shows the "Walk to" buttons that glide you to another part of the room.
const ANCHORS = {
  'take:mop': [3.35, .9, 2.45], 'wedge': [.38, 1.02, 2.86], 'tap': [-3.94, 1.08, -.53],
  'read:mirror': [-3.97, 1.75, .45], 'play:mirror': [-3.97, 1.75, .45], 'read:graffiti': [1.53, 1.5, -1.9], 'play:tile': [2.62, .58, -2.97], 'take:carkey': [2.62, .58, -2.97],
  'read:scratches': [1.75, 1.3, 2.95], 'play:scratches': [1.75, 1.3, 2.95],
  'lock': [2.2, .1, -1.1], 'go:hatch': [2.2, .06, -1.75]
};
const keyOf = h => h.target ? `${h.action}:${h.target}` : h.action;
let markerEls = [];
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), tmp = new THREE.Vector3();
// ### Shows the markers for what can be used from here; Rules decides which those are.
function renderHotspots(){
  const list = R.visibleHotspots(S);
  const mk = $('markers'); mk.textContent = ''; markerEls = [];
  const go = $('goBtns'); go.textContent = '';
  for (const h of list){
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.hotspot = keyOf(h); b.setAttribute('aria-label', h.label);
    b.addEventListener('click', () => { initAudio(); use(h.action, h.target); });
    if (h.action === 'go' && h.target !== 'hatch'){ b.textContent = h.label; go.appendChild(b); continue; }
    b.className = h.action === 'go' ? 'mk go' : 'mk'; b.innerHTML = '<i></i><span></span>'; b.querySelector('span').textContent = h.label;
    mk.appendChild(b); markerEls.push({ el: b, at: new THREE.Vector3(...(ANCHORS[keyOf(h)] || [0, 1, 0])) });
  }
  $('goBar').hidden = !COARSE || !go.children.length;
}
// ### Places the 2D markers over their 3D objects.
function updateMarkers(){
  const w = innerWidth, h = innerHeight, busy = !overlay.hidden || cam.t < 1;
  for (const m of markerEls){
    tmp.copy(m.at).project(camera);
    const on = !busy && tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
    // only touch the page when a marker really moved, so a still view costs no layout work
    const tf = on ? `translate(${((tmp.x + 1) / 2 * w - 14).toFixed(1)}px, ${((1 - tmp.y) / 2 * h - 14).toFixed(1)}px)` : '';
    if (on !== m.on){ m.el.style.display = on ? '' : 'none'; m.on = on; }
    if (on && tf !== m.tf){ m.el.style.transform = tf; m.tf = tf; }
  }
}
// ### Finds the hotspot under the pointer with a ray through the scene.
function pick(e){
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const live = new Set(R.visibleHotspots(S).map(keyOf));
  const meshes = Object.entries(HOT).filter(([k]) => live.has(k)).flatMap(([, ms]) => ms).filter(m => m.visible);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  // a mesh can stand for more than one hotspot (the hatch lid: kneel down at it, then open the lock); the live one counts
  return hit && hit.distance < 6 ? Object.keys(HOT).find(k => live.has(k) && HOT[k].includes(hit.object)) || null : null;
}
let hovered = null, pendingHover = null;   // pointer moves are handled once per frame, not once per event
// ### Highlights the hotspot under the pointer.
function hover(e){
  if (!overlay.hidden) return;
  const k = pick(e);
  if (k === hovered) return;
  if (hovered) (HOT[hovered] || []).forEach(m => { if (m.material.emissive) m.material.emissive.setHex(m.userData.em || 0); });
  hovered = k; canvas.classList.toggle('over', !!k);
  if (k) (HOT[k] || []).forEach(m => { if (m.material.emissive){ m.userData.em = m.material.emissive.getHex(); m.material.emissive.setHex(0x3a2008); } });
}
// ### Handles a click on the scene.
function clickAt(e){
  if (!overlay.hidden || S.scene === 'intro') return;
  const k = pick(e);
  if (!k) return;
  const h = R.visibleHotspots(S).find(x => keyOf(x) === k);
  if (h) use(h.action, h.target);
}

// ---------- Actions ----------
// ### use() is what a marker, a click or a key calls. "lock" only opens the lock card; everything else goes through
// ### rules.perform(). Accepted: the new state is kept, saved and shown. Refused: the state stays as it was, and the
// ### player sees why.
function use(action, target){
  if (paused || S.ending) return;
  reachHand();
  if (action === 'lock'){ if (S.scene === 'hatch') showLock(); return; }
  act(action, target);
}
// ### Sends an action to Rules, and shows the answer. Refused actions return the state unchanged, with a reason.
function act(action, target, quiet){
  const before = S, r = R.perform(S, action, target);
  cue(r.cue);
  if (!r.ok){ say(r.message, 'warn'); return r; }
  S = r.state;
  if (action !== 'new') save();
  // walking into another part of the room moves nothing; a button or a marker glides you there
  if (S.scene !== before.scene && !quiet) goView(S.scene === 'tunnel' ? 'hatch' : S.scene);
  const known = seenScenes.has(S.scene); if (action === 'go') seenScenes.add(S.scene);
  if (r.cue === 'game'){ showMini(target, r.message); return r; }
  if ((action === 'read' || action === 'win') && R.CLUES[target]) showClue(target);
  else if (r.message && !S.ending && !(quiet && known)) say(r.message, action === 'try' && !S.ending ? 'warn' : action === 'take' ? 'good' : '');
  if (action === 'try' && !S.ending){ guardShow = 3; renderLock(); }
  if (S.ending === 'A' && before.ending !== 'A'){ hideCard(); endingA(); }
  syncWorld(); renderHud(); renderHotspots();
  return r;
}

// ### syncWorld puts every object where the state says it is: mop in the bucket or jammed
// ### against the door, the tile on the wall or on the floor, the car key in its hollow, the lock wheels, the steam.
function syncWorld(){
  const mp = S.wedged ? MOP_DOOR : S.inventory.includes('mop') ? null : MOP_CORNER;
  mop.visible = !!mp;
  if (mp){ mop.position.copy(mp.p); mop.rotation.copy(mp.r); }
  if (S.tileOpen && tile.userData.fall === undefined) tile.userData.fall = 0;
  if (!S.tileOpen){ tile.position.copy(TILE_POS); tile.rotation.set(0, 0, .07); delete tile.userData.fall; }
  carKey.visible = S.tileOpen && !S.inventory.includes('carkey');
  repaint(steamTex, paintSteam, S.clues.includes('mirror'));
  repaint(scratchesTex, paintScratches, S.clues.includes('scratches'));
  S.lock.forEach((d, i) => { if (wheelTex[i].userData !== d){ drawDigit(wheelTex[i], d); wheelTex[i].userData = d; } });
  if (!S.ending){ lidPivot.rotation.x = 0; tunnelLight.intensity = 0; tunnelLight.visible = false; }
  shadowsMoved();
}

// ---------- HUD and cards ----------
// ### The clock, inventory and journal, and the cards for clues, the lock and the endings. They only show what Rules says.
const overlay = $('overlay'), card = $('card'), hud = $('hud');
const ICON = {
  mop: '<svg viewBox="0 0 40 24" aria-hidden="true"><rect x="2" y="10.5" width="28" height="3" rx="1.5" fill="#c49a64"/><path d="M28 6h10v12H28z" fill="#d8d2bf"/></svg>',
  carkey: '<svg viewBox="0 0 40 24" aria-hidden="true"><rect x="6" y="7" width="12" height="10" rx="3" fill="#7d8489"/><path d="M18 10.5h16l2 1.5-2 1.5h-3l-1 1.5-1-1.5H18z" fill="#d6b25a"/><circle cx="5" cy="12" r="3" fill="none" stroke="#cfd6d9" stroke-width="1.5"/></svg>'
};
// ### Updates the clock, inventory and journal from the current state.
function renderHud(){
  $('place').textContent = (R.SCENES[S.scene] || { title: S.scene === 'cell' ? 'The Cell' : 'Cell Block D' }).title;
  const slots = $('slots'); slots.textContent = '';
  for (let i = 0; i < 3; i++){
    const it = S.inventory[i], d = document.createElement('div');
    d.className = 'slot' + (it ? ' full' : '');
    if (it){ d.innerHTML = ICON[it]; d.append(R.ITEMS[it]); } else d.textContent = 'Empty';
    slots.appendChild(d);
  }
  $('clueCount').textContent = `${S.clues.length} / 3`;
  renderClock();
}
let lastClock = '';
function renderClock(){
  const t = fmt(S.time);
  if (t !== lastClock){ $('time').textContent = t; lastClock = t; }
  $('time').classList.toggle('low', S.time <= 60 && !S.ending);
  $('clockPanel').classList.toggle('grace', S.graceUsed && !S.ending);
}
let sayTimer = 0;
function say(text, kind){
  if (!text) return;
  const el = $('say'); el.textContent = text; el.className = 'say show' + (kind ? ' ' + kind : '');
  sayTimer = Math.min(9, 3 + text.length / 22);
}
function showCard(html, cls){
  stopMini();
  card.className = 'card' + (cls ? ' ' + cls : ''); card.innerHTML = html; overlay.hidden = false;
  const b = card.querySelector('.btn'); if (b && !COARSE) b.focus({ preventScroll: true });
}
// ### Closes a clue or lock card.
function hideCard(){ stopMini(); overlay.hidden = true; }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ### The briefing: five short cards so a first-time player knows what happened, who they are, where, why and how to play.
// ### The first card is the front page of an old newspaper (.news in styles.css): the theft at the Museu de Marinha in Lisbon.
// ### It has no eyebrow or title of its own: the newspaper headline is the card's h1.
// ### The third is not a card but a short scene in the room (see "Briefing scene" below): Hale shuts and locks the door.
const BRIEF = [
  [null, null, '<div class="news-wrap"><article class="news" aria-label="Front page of The Lisbon Times"><div class="mast-top"><span>Front page</span><span>Magazine</span></div><div class="mast">The Lisbon Times</div><div class="dateline"><span>Vol. CXXI · No. 107</span><span>Lisbon, Monday 16 April 2012</span><span>€1.20</span></div><h1>Titanic necklace vanishes from naval museum</h1><div class="deck">The Starfall necklace disappears on the night of the centenary. No alarm sounded.</div><div class="cols"><div class="by">By our crime correspondent</div><p>BELÉM — The Starfall necklace, lent by the Ashford family to the Museu de Marinha for a limited exhibition marking 100 years since the sinking of the Titanic, disappeared from its glass case on the night of the centenary.</p><figure><div class="photo"><div class="ht"><svg class="necklace" viewBox="0 0 160 72" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><radialGradient id="nl-spot" cx=".5" cy=".3" r=".62"><stop offset="0" stop-color="#d8d8d8"/><stop offset=".45" stop-color="#6e6e6e"/><stop offset="1" stop-color="#141414"/></radialGradient><linearGradient id="nl-bust" x1="0" x2="1"><stop offset="0" stop-color="#1c1c1c"/><stop offset=".42" stop-color="#3e3e3e"/><stop offset=".6" stop-color="#323232"/><stop offset="1" stop-color="#161616"/></linearGradient><radialGradient id="nl-pearl" cx=".35" cy=".32" r=".7"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#e6e6e6"/><stop offset=".8" stop-color="#8a8a8a"/><stop offset="1" stop-color="#3a3a3a"/></radialGradient><linearGradient id="nl-base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8b8b8"/><stop offset=".12" stop-color="#5a5a5a"/><stop offset="1" stop-color="#1a1a1a"/></linearGradient><linearGradient id="nl-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".0"/><stop offset=".45" stop-color="#fff" stop-opacity=".0"/><stop offset=".5" stop-color="#fff" stop-opacity=".28"/><stop offset=".56" stop-color="#fff" stop-opacity=".0"/><stop offset=".7" stop-color="#fff" stop-opacity=".0"/><stop offset=".73" stop-color="#fff" stop-opacity=".14"/><stop offset=".76" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="160" height="72" fill="url(#nl-spot)"/><path d="M62 0H98V9Q98 24 124 34L132 60H28L36 34Q62 24 62 9Z" fill="url(#nl-bust)"/><path d="M28 58H132L140 72H20Z" fill="url(#nl-base)"/><rect x="72" y="62" width="16" height="5" fill="#cfcfcf"/><path d="M73.5 64h13M73.5 65.6h9" stroke="#555" stroke-width=".5"/><g fill="#000" opacity=".45"><ellipse cx="104.9" cy="15.4" rx="2" ry="1.3"/><ellipse cx="103.8" cy="19.5" rx="2" ry="1.3"/><ellipse cx="102.1" cy="23.3" rx="2" ry="1.3"/><ellipse cx="100.0" cy="26.9" rx="2" ry="1.3"/><ellipse cx="97.4" cy="30.0" rx="2" ry="1.3"/><ellipse cx="94.5" cy="32.7" rx="2" ry="1.3"/><ellipse cx="91.4" cy="34.8" rx="2" ry="1.3"/><ellipse cx="88.0" cy="36.3" rx="2" ry="1.3"/><ellipse cx="84.4" cy="37.3" rx="2" ry="1.3"/><ellipse cx="80.8" cy="37.6" rx="2" ry="1.3"/><ellipse cx="77.2" cy="37.3" rx="2" ry="1.3"/><ellipse cx="73.6" cy="36.3" rx="2" ry="1.3"/><ellipse cx="70.2" cy="34.8" rx="2" ry="1.3"/><ellipse cx="67.1" cy="32.7" rx="2" ry="1.3"/><ellipse cx="64.2" cy="30.0" rx="2" ry="1.3"/><ellipse cx="61.6" cy="26.9" rx="2" ry="1.3"/><ellipse cx="59.5" cy="23.3" rx="2" ry="1.3"/><ellipse cx="57.8" cy="19.5" rx="2" ry="1.3"/><ellipse cx="56.7" cy="15.4" rx="2" ry="1.3"/></g><g fill="url(#nl-pearl)"><circle cx="104.1" cy="13.8" r="2.1"/><circle cx="103.0" cy="17.9" r="2.1"/><circle cx="101.3" cy="21.7" r="2.1"/><circle cx="99.2" cy="25.3" r="2.1"/><circle cx="96.6" cy="28.4" r="2.1"/><circle cx="93.7" cy="31.1" r="2.1"/><circle cx="90.6" cy="33.2" r="2.1"/><circle cx="87.2" cy="34.7" r="2.1"/><circle cx="83.6" cy="35.7" r="2.1"/><circle cx="80.0" cy="36.0" r="2.1"/><circle cx="76.4" cy="35.7" r="2.1"/><circle cx="72.8" cy="34.7" r="2.1"/><circle cx="69.4" cy="33.2" r="2.1"/><circle cx="66.3" cy="31.1" r="2.1"/><circle cx="63.4" cy="28.4" r="2.1"/><circle cx="60.8" cy="25.3" r="2.1"/><circle cx="58.7" cy="21.7" r="2.1"/><circle cx="57.0" cy="17.9" r="2.1"/><circle cx="55.9" cy="13.8" r="2.1"/></g><path d="M80 36.5V41" stroke="#bbb" stroke-width=".8"/><polygon points="80,40.5 82.3,46.2 88.4,46.6 83.7,50.5 85.2,56.4 80,53.1 74.8,56.4 76.3,50.5 71.6,46.6 77.7,46.2" fill="url(#nl-pearl)" stroke="#111" stroke-width=".5"/><g stroke="#fff" stroke-linecap="round"><path d="M80 43.5v6M77 46.5h6" stroke-width=".7"/><path d="M93 15v5M90.5 17.5h5M61 27v3M59.5 28.5h3" stroke-width=".45" opacity=".8"/></g><path d="M22 2H138V72M22 2V72" fill="none" stroke="#9a9a9a" stroke-width=".5" opacity=".35"/><rect width="160" height="72" fill="url(#nl-glass)"/></svg></div><b></b></div><figcaption>The Starfall necklace on display at the Museu de Marinha, before the theft.</figcaption></figure><p>No alarm sounded. The museum has closed the exhibition.</p><p>A detective has been put on the case.</p></div></article></div>'],
  ['Cell Block D · 02:14', 'Plot <em>Twist</em>', 'Three weeks ago you were that detective. You followed the trail from the empty case at the Museu de Marinha, and it ended at your own door: the necklace’s velvet box, hidden in your car. Tonight you are <b>inmate 4471</b>, convicted of stealing it. Someone framed you.</p><p>Not everyone believed it. <b>Your oldest friend on the force</b> stood by you through the trial and kept digging until he found the proof that clears your name. But the people who framed you found out and came after him. Before he disappeared from Lisbon, he <b>hid the evidence across the city</b>, in places only you would know to look.'],
  ['The washroom · 02:16', 'Ten <em>minutes</em>', 'cine'],
  ['The rumour', 'A way <em>down</em>', 'Inmates whisper about a <b>hatch in the floor</b> of this washroom, locked with a four-digit code. Three spots in the room hide what you need: <b>a car key</b>, the <b>first two digits</b> and the <b>last two digits</b> of the code. Each one is guarded by a short Titanic mini game. Win them, open the hatch, get out before Hale comes back.'],
  ['How to play', 'Your <em>moves</em>', null]
];
let briefStep = 0;
// ### Shows the opening briefing.
function showBrief(i){
  briefStep = i;
  const [eye, title, text] = BRIEF[i], last = i === BRIEF.length - 1;
  if (text === 'cine'){
    showCard(`<div class="steps">${BRIEF.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="eyebrow">${eye}</div><p class="cine-line" id="cineLine" aria-live="polite"></p>
      <div class="actions"><button class="btn" data-do="next">Next <small>Enter</small></button><button class="btn ghost" data-do="back">Back</button>
      <div class="cine-clock" id="cineClock" aria-hidden="true">10:00</div></div>`, 'cine');
    startCine();
    return;
  }
  stopCine();
  // ### How to play: you walk with the arrow keys; a touch screen has none, so it gets the "Walk to" buttons instead.
  const moving = COARSE ? `
      <b>Walk to</b><span>Buttons at the bottom take you to another part of the room</span>
      <b>Drag</b><span>Look around with your finger</span>
      <b>Markers</b><span>Tap a pulsing marker or the object itself to use it</span>` : `
      <b>↑ ↓</b><span>Arrow keys up and down: walk forwards and backwards</span>
      <b>← →</b><span>Arrow keys left and right: step to the side (W A S D work too)</span>
      <b>Drag</b><span>Hold the mouse button and move the mouse to turn your head and look around</span>
      <b>Walk in</b><span>Walk to the sinks or into the toilet stall: what you can use there gets a pulsing marker</span>
      <b>Markers</b><span>Click a pulsing marker or the object itself to use it</span>`;
  const body = text ? (text.startsWith('<div') ? text : `<p>${text}</p>`) : `<div class="howto">${moving}
      <b>Mini games</b><span>The crooked tile, the mirror and the scratches each open a mini game of ${MiniGames.TIME} s. Win it to get the clue</span>
      <b>Items</b><span>What you pick up appears bottom left and is used automatically</span>
      <b>Clues</b><span>Everything you read is kept in your clue notes</span>
      <b>P / Esc</b><span>Pause. The clock keeps running while you read and try the lock</span>
    </div><p>Wrong codes make noise. Each one costs <b>${R.WRONG_CODE_PENALTY} seconds</b>.</p>`;
  showCard(`<div class="steps">${BRIEF.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>
    ${eye ? `<div class="eyebrow">${eye}</div><h1>${title}</h1>` : ''}${body}
    <div class="actions">${last ? '<button class="btn" data-do="start">Start the clock <small>Enter</small></button>' : '<button class="btn" data-do="next">Next <small>Enter</small></button>'}
    ${i > 0 ? '<button class="btn ghost" data-do="back">Back</button>' : ''}</div>`);
}
function showContinue(){
  showCard(`<div class="eyebrow">Saved game</div><h2>Back in the <em>washroom</em></h2>
    <p>You still have <b>${fmt(S.time)}</b>. Items: <b>${S.inventory.length ? S.inventory.map(i => R.ITEMS[i]).join(', ') : 'none'}</b>. Clues: <b>${S.clues.length} of 3</b>.</p>
    <div class="actions"><button class="btn" data-do="resume">Continue <small>Enter</small></button><button class="btn ghost" data-do="ask-new">New game</button></div>`);
}
function showAskNew(){
  showCard(`<div class="eyebrow">New game</div><h2>Start <em>over?</em></h2><p>Your saved progress will be lost.</p>
    <div class="actions"><button class="btn danger" data-do="new">Yes, start over</button><button class="btn ghost" data-do="${S.scene === 'intro' ? 'brief' : paused ? 'pause' : 'resume'}">Back</button></div>`);
}
function showPause(){
  paused = true;
  showCard(`<div class="eyebrow">${esc(R.SCENES[S.scene] ? R.SCENES[S.scene].title : '')} · ${fmt(S.time)} left</div><h2>Paused</h2>
    <p>Items: <b>${S.inventory.length ? S.inventory.map(i => R.ITEMS[i]).join(', ') : 'none'}</b> · Clues: <b>${S.clues.length} of 3</b> · Wrong codes: <b>${S.wrongTries}</b></p>
    <div class="actions"><button class="btn" data-do="resume">Resume <small>Enter</small></button><button class="btn ghost" data-do="ask-new">Restart</button></div>
    <label class="vol">Volume <input type="range" min="0" max="100" step="5" data-vol value="${Math.round(volume * 100)}" aria-label="Volume"><output>${Math.round(volume * 100)}%</output></label>`);
}
function showClue(k){
  const c = R.CLUES[k];
  showCard(`<div class="eyebrow">Clue found · ${S.clues.length} of 3</div><div class="paper"><small>${esc(c.title)}</small>${esc(c.text)}</div>
    <div class="actions"><button class="btn" data-do="close">Got it <small>Enter</small></button></div>`);
}
function showNotes(){
  const list = S.clues.map(k => `<div class="paper"><small>${esc(R.CLUES[k].title)}</small>${esc(R.CLUES[k].text)}</div>`).join('');
  showCard(`<div class="eyebrow">Your clue notes</div><h2>${S.clues.length} of 3 <em>clues</em></h2>
    <div class="clue-list">${list || '<div class="empty">Nothing yet. Try the crooked tile, the mirror (once it is steamed up) and the scratches by the door.</div>'}</div>
    <div class="actions"><button class="btn" data-do="close">Back to the room <small>Enter</small></button></div>`);
}
function showLock(){
  showCard(`<div class="eyebrow">The hatch · combination lock</div><h2>Four <em>wheels</em></h2>
    <div class="lock" id="lockUi"></div><div class="tries" id="tries"></div>
    <div class="actions"><button class="btn" data-do="try">Try the code <small>Enter</small></button><button class="btn ghost" data-do="close">Step back</button></div>`);
  renderLock();
}
function renderLock(){
  const ui = card.querySelector('#lockUi');
  if (!ui) return;
  // redrawing removes the wheel button in use: a keyboard player stays on it, or the next Enter would try the code and cost 30 s
  const a = document.activeElement, turn = a && a.dataset && a.dataset.turn && a.matches(':focus-visible') ? a.dataset.turn : null;
  ui.innerHTML = S.lock.map((d, i) => `<div class="wheel"><button data-turn="${i},1" aria-label="Wheel ${i + 1} up">▲</button><output aria-label="Wheel ${i + 1}">${d}</output><button data-turn="${i},-1" aria-label="Wheel ${i + 1} down">▼</button></div>`).join('');
  if (turn) ui.querySelector(`[data-turn="${turn}"]`).focus();
  card.querySelector('#tries').textContent = S.wrongTries ? `Wrong codes so far: ${S.wrongTries} · each costs ${R.WRONG_CODE_PENALTY} s` : 'Each wrong code costs ' + R.WRONG_CODE_PENALTY + ' s';
}
// ---------- Mini games ----------
// ### A clue spot that is used ("play" accepted by Rules, cue "game") opens its mini game from minigames.js in the card. A
// ### win is sent to Rules as "win", which gives the clue; a loss offers the same game again. Closing the card, pausing or
// ### an ending stops the game without a result. The clock keeps running while you play.
let mini = null, miniSpot = null;
const SPOT_NAME = { tile: 'The crooked tile', mirror: 'Writing on the mirror', scratches: 'Scratches by the door' };
const SPOT_PRIZE = { tile: 'the car key', mirror: 'the first two digits of the code', scratches: 'the last two digits of the code' };
function showMini(spot, id){
  const info = MiniGames.INFO[id];
  if (!info) return;
  showCard(`<div class="eyebrow">${SPOT_NAME[spot]} · mini game · ${MiniGames.TIME} seconds</div><h2>${info.title}</h2>
    <p>${esc(info.how)} Win to get <b>${SPOT_PRIZE[spot]}</b>.</p><div id="miniHost"></div>
    <div class="actions"><button class="mg-quit" data-do="close">Give up <small>Esc</small></button></div>`, 'mini');
  miniSpot = spot;
  mini = MiniGames.open(card.querySelector('#miniHost'), id, {
    sound: miniSound,
    onEnd: (won, reason) => { mini = null; if (S.ending) return; if (won) act('win', spot); else showMiniLost(spot, id, reason); }
  });
}
function showMiniLost(spot, id, reason){
  showCard(`<div class="eyebrow">${SPOT_NAME[spot]} · ${esc(MiniGames.INFO[id].name)}</div><h2>Not <em>this time</em></h2>
    <p>${esc(reason || 'You lost the mini game.')} Try again: it is the same game, and the clock is still running.</p>
    <div class="actions"><button class="btn" data-do="replay">Try again <small>Enter</small></button><button class="btn ghost" data-do="close">Back to the room</button></div>`);
}
function stopMini(){ if (mini){ mini.stop(); mini = null; } }
// ### The short sounds of the mini games, made from the same tones and noise as the room's.
function miniSound(n){
  if (!ac) return;
  switch (n){
    case 'hit': noise(.25, .35, 'lowpass', 500); tone(110, .25, 'sine', .2, 60); break;
    case 'splash': noise(.18, .12, 'highpass', 1800); break;
    case 'good': tone(660, .1, 'triangle', .1); tone(990, .14, 'triangle', .08, null, .07); break;
    case 'bad': tone(140, .2, 'square', .05, 90); break;
    case 'jump': tone(420, .1, 'sine', .06, 760); break;
    case 'tick': cue('tick'); break;
    case 'pop': tone(760, .07, 'square', .045, 480); break;
    case 'flip': noise(.04, .09, 'lowpass', 900); break;
    case 'bell': tone(1320, .45, 'sine', .07); tone(1980, .3, 'sine', .03); break;
    case 'win': [523, 659, 784, 1046].forEach((f, i) => tone(f, .18, 'triangle', .09, null, i * .09)); break;
    case 'lose': tone(300, .5, 'sawtooth', .05, 90); break;
  }
}

// ### Shows one of the two endings.
function showEnding(){
  const A = S.ending === 'A', E = R.ENDINGS[S.ending];
  showCard(`<div class="eyebrow">${A ? 'Ending A of 2' : 'Ending B of 2'}</div>
    <h1>${A ? 'Out <em>below</em>' : 'Back to <em>the cell</em>'}</h1><p>${esc(E.text)}</p>
    <p>Time left: <b>${fmt(S.time)}</b> · Clues: <b>${S.clues.length} of 3</b> · Wrong codes: <b>${S.wrongTries}</b>${S.wedged ? ' · You jammed the door' : ''}</p>
    ${A ? '<div class="next">Room 2 · The chase starts at the end of this tunnel</div>' : '<p>Tip: the jammed door buys you a minute, and the hot tap steams up the mirror so you can play for its digits.</p>'}
    <div class="actions"><button class="btn" data-do="new">${A ? 'Play again' : 'Try again'} <small>Enter</small></button></div>`, A ? 'ending-a' : 'ending-b');
}
// the volume slider on the pause card; a short tick when it is let go
card.addEventListener('input', e => {
  const r = e.target.closest('[data-vol]');
  if (!r) return;
  volume = Math.min(1, Math.max(0, Number(r.value) / 100));
  writeStore(R.VOLUME_KEY, String(volume));
  r.parentNode.querySelector('output').textContent = r.value + '%';
  if (master) master.gain.value = loud();
});
card.addEventListener('change', e => { if (e.target.closest('[data-vol]')) cue('take'); });
card.addEventListener('click', e => {
  const t = e.target.closest('[data-turn]');
  if (t){ const [i, d] = t.dataset.turn.split(',').map(Number); act('turn', [i, d]); renderLock(); return; }
  const b = e.target.closest('[data-do]');
  if (!b) return;
  initAudio();
  const d = b.dataset.do;
  if (d === 'next') showBrief(Math.min(BRIEF.length - 1, briefStep + 1));
  else if (d === 'back') showBrief(Math.max(0, briefStep - 1));
  else if (d === 'brief') showBrief(0);
  else if (d === 'start'){ const r = act('start', MiniGames.pickGames(Math.random)); if (r.ok){ hideCard(); hud.classList.remove('off'); } }
  else if (d === 'resume') resumeRoom();
  else if (d === 'pause') showPause();
  else if (d === 'ask-new') showAskNew();
  else if (d === 'new'){ paused = false; seenScenes.clear(); held.clear(); hatchAnim = -1; tileVel = 0; endingShown = false; act('new'); writeStore(R.SAVE_KEY, ''); hud.classList.add('off'); goView('intro', .8); doorFlash = 0; windowLight.intensity = .9; showBrief(0); }
  else if (d === 'close') hideCard();
  else if (d === 'replay' && miniSpot) use('play', miniSpot);
  else if (d === 'try') act('try');
});
$('btnPause').addEventListener('click', e => { e.currentTarget.blur(); if (S.ending || S.scene === 'intro') return; if (paused) resumeRoom(); else showPause(); });
$('btnNotes').addEventListener('click', e => { e.currentTarget.blur(); if (!paused && !S.ending && S.scene !== 'intro') showNotes(); });
let muted = false;
// ### Back to the room from the pause or continue card: the clock runs again, the HUD shows, and so does the sound.
function resumeRoom(){ paused = false; hideCard(); hud.classList.remove('off'); if (ac && !muted && !document.hidden) ac.resume(); }
$('btnSound').addEventListener('click', e => { e.currentTarget.blur(); toggleSound(); });
// ### Turns the sound on or off.
function toggleSound(){ muted = !muted; $('soundWaves').style.display = muted ? 'none' : ''; $('btnSound').setAttribute('aria-label', muted ? 'Turn sound on' : 'Mute sound'); if (master) master.gain.value = loud(); }
// ### The player's volume: the slider squared, because the ear hears loudness roughly that way.
let volume = R.parseVolume(readStore(R.VOLUME_KEY));
const loud = () => muted ? 0 : .8 * volume * volume;
addEventListener('keydown', e => {
  if (!$('fatal').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  // a held Enter must not repeat an action: each wrong code costs 30 seconds
  if (e.code === 'Enter' && e.repeat){ e.preventDefault(); return; }
  if (e.code === 'Enter' && !overlay.hidden){ const b = card.querySelector('.btn'); if (b && document.activeElement && document.activeElement.closest && document.activeElement.closest('.card') && document.activeElement.tagName === 'BUTTON') return; if (b){ e.preventDefault(); b.click(); } return; }
  if ((e.code === 'KeyP' || e.code === 'Escape') && !e.repeat){
    if (S.ending || S.scene === 'intro') return;
    if (paused) resumeRoom(); else if (!overlay.hidden && e.code === 'Escape') hideCard(); else showPause();
    return;
  }
  if (e.code === 'KeyM') toggleSound();
  if (!overlay.hidden) return;
  // walking: held keys are remembered here and turned into steps in walk(); the page itself never scrolls
  if (MOVE_KEYS[e.code]){ e.preventDefault(); if (!e.repeat && !paused) held.add(e.code); }
});
addEventListener('keyup', e => held.delete(e.code));
// The clock must not run while nobody is looking
document.addEventListener('visibilitychange', () => {
  if (document.hidden){ held.clear(); if (S.scene !== 'intro' && !S.ending && !paused) showPause(); }
  if (ac){ if (document.hidden) ac.suspend(); else if (!muted) ac.resume(); }
});
addEventListener('blur', () => { held.clear(); if (S.scene !== 'intro' && !S.ending && !paused) showPause(); });
addEventListener('pagehide', () => { if (ac) ac.suspend(); save(); });
addEventListener('shardheist:fatal', () => { if (S.scene !== 'intro' && !S.ending && !paused) showPause(); if (ac) ac.suspend(); $('fatalReload').focus(); });

// ---------- Sound ----------
// ### Web Audio: two real recordings (CC0, in room-1-escape/sounds with their credits) for the hot tap and the air vent,
// ### and synthesised sounds for the rest: the hum of the fluorescent tube, dripping water and short effects for every
// ### kind of action. Starts on the first click, as browsers require. If a recording cannot be loaded (for example when
// ### the page is opened as a file), the tap falls back to synthesised hiss and the vent stays silent.
let ac = null, master = null, waterGain = null, noiseBuf = null, dripIn = 3;
// ### Where the loops lie in the recordings (seconds): the tap's steady stream, then its end (water stops, handle shut);
// ### the vent's seamless loop. Measured when the files were made; see sounds/CREDITS.md.
const TAP = { file: 'sounds/tap-water.mp3', loopStart: 1.08, loopEnd: 8.28, vol: .45 };
const VENT = { file: 'sounds/air-vent.mp3', loopStart: .25, loopEnd: 9.25, vol: .12 };
let tapBuf = null, tapBus = null, tapSrc = null, tapOn = false;
// ### Creates the audio on the first click, as browsers require.
function initAudio(){
  if (ac){ if (ac.state === 'suspended' && !document.hidden) ac.resume(); return; }
  try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e){ ac = null; return; }
  master = ac.createGain(); master.gain.value = loud(); master.connect(ac.destination);
  noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const hum = ac.createOscillator(), hum2 = ac.createOscillator(), hf = ac.createBiquadFilter(), hg = ac.createGain();
  hum.type = 'sawtooth'; hum.frequency.value = 100; hum2.type = 'sine'; hum2.frequency.value = 50;
  hf.type = 'lowpass'; hf.frequency.value = 320; hg.gain.value = .022;
  hum.connect(hf); hum2.connect(hf); hf.connect(hg); hg.connect(master); hum.start(); hum2.start();
  const water = ac.createBufferSource(); water.buffer = noiseBuf; water.loop = true;
  const wf = ac.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 1400; wf.Q.value = .6;
  waterGain = ac.createGain(); waterGain.gain.value = 0;
  water.connect(wf); wf.connect(waterGain); waterGain.connect(master); water.start();
  tapBus = ac.createGain(); tapBus.gain.value = 0; tapBus.connect(master);
  loadSound(TAP.file, b => { tapBuf = b; });
  loadSound(VENT.file, startVent);
}
// ### Fetches and decodes one recording, then hands it on; a failure leaves the synthesised sound in its place.
function loadSound(file, then){
  fetch(file).then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(file)))
    .then(data => new Promise((ok, fail) => ac.decodeAudioData(data, ok, fail)))
    .then(then, () => {});
}
// ### The air vent: its recording loops for the rest of the game, faded in over two seconds.
function startVent(buf){
  const s = ac.createBufferSource(), g = ac.createGain(), t = ac.currentTime;
  s.buffer = buf; s.loop = true; s.loopStart = VENT.loopStart; s.loopEnd = VENT.loopEnd;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(VENT.vol, t + 2);
  s.connect(g); g.connect(master); s.start(t, VENT.loopStart);
}
// ### The hot tap follows the rules' steam: turned on, the recording plays the handle and the water starting, then loops
// ### the steady stream; turned off, the stream fades into the recording's end. Pausing only fades the tap out.
function updateTap(dt){
  if (!tapBuf) return;
  tapBus.gain.value += ((paused ? 0 : TAP.vol) - tapBus.gain.value) * Math.min(1, dt * 4);
  if (S.steam === tapOn) return;
  tapOn = S.steam;
  const t = ac.currentTime, old = tapSrc;
  if (old){ old.g.gain.setValueAtTime(1, t); old.g.gain.linearRampToValueAtTime(0, t + .12); old.s.stop(t + .15); }
  const s = ac.createBufferSource(), g = ac.createGain();
  s.buffer = tapBuf; s.connect(g); g.connect(tapBus);
  if (tapOn){ s.loop = true; s.loopStart = TAP.loopStart; s.loopEnd = TAP.loopEnd; s.start(t); }
  else { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + .12); s.start(t, TAP.loopEnd); }
  tapSrc = tapOn ? { s, g } : null;
}
// ### Plays one short tone.
function tone(freq, dur, type, vol, slideTo, delay){
  if (!ac) return;
  const t = ac.currentTime + (delay || 0), o = ac.createOscillator(), g = ac.createGain();
  o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + .02);
}
// ### Plays one short burst of filtered noise.
function noise(dur, vol, type, freq, delay){
  if (!ac) return;
  const t = ac.currentTime + (delay || 0), s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf; f.type = type || 'lowpass'; f.frequency.value = freq || 800;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + dur + .02);
}
// ### Plays a sound cue for an event, such as a warning or a lock opening.
function cue(name){
  if (!ac || !name) return;
  switch (name){
    case 'tick': tone(2400, .03, 'square', .03); noise(.03, .05, 'highpass', 3000); break;
    case 'clunk': noise(.25, .5, 'lowpass', 260); tone(90, .3, 'sine', .3, 50); break;
    case 'scrape': for (let i = 0; i < 4; i++) noise(.12, .18, 'bandpass', 2600, i * .11); break;
    case 'take': tone(660, .12, 'triangle', .12); tone(990, .16, 'triangle', .1, null, .08); break;
    case 'paper': noise(.22, .12, 'highpass', 2200); break;
    case 'open': tone(140, 1.4, 'sawtooth', .07, 55); noise(.4, .35, 'lowpass', 300, 1.1); break;
    case 'bang': noise(.7, .9, 'lowpass', 500); tone(70, .6, 'sine', .5, 40); break;
    case 'warn': tone(880, .12, 'square', .05); tone(880, .12, 'square', .05, null, .2); break;
    case 'rattle': for (let i = 0; i < 6; i++) noise(.07, .45, 'bandpass', 900, i * .13); break;
    case 'nope': tone(120, .18, 'square', .05); break;
    case 'step': noise(.12, .12, 'lowpass', 180); break;
    case 'door': noise(.3, .5, 'lowpass', 220); break;
    case 'wedge': noise(.2, .3, 'lowpass', 400); tone(200, .2, 'triangle', .1); break;
    case 'water': break;
    default: tone(520, .06, 'sine', .04);
  }
}

// ---------- Briefing scene ----------
// ### Briefing card 3 as a short scene in the room: you turn round to the open door, Officer Hale stands in the corridor
// ### light, swings the door shut, locks it and tells you through it that your ten minutes have begun. Next skips it; Back
// ### from card 4 plays it again. With reduced motion it starts at the end: the door shut and his words on the card.
const DOOR_OPEN = 1.35, CINE_END = 5;
let cineT = -1, shake = 0;
const LINES = [
  [0, '<span class="narr">Officer Hale walks you to washroom 2 and holds the door open.</span>'],
  [.9, '<b>Hale:</b> “Inside, 4471.”'],
  [3.4, '<b>Hale</b>, through the door: “Your ten minutes have begun. Not a second more.”']
];
function cineLine(html){ const el = card.querySelector('#cineLine'); if (el) el.innerHTML = html; }
function startCine(){
  hall.visible = true; doorLight.visible = true; cineT = REDUCED ? CINE_END : 0;
  overlay.classList.add('cine'); $('lookHint').classList.add('hush'); goView('closing', 1.2);
  if (REDUCED){ cineLine(LINES[2][1]); card.querySelector('#cineClock').classList.add('on'); guardShow = 5; }
  else cineLine(LINES[0][1]);
  updateCine(0);
}
function stopCine(){
  overlay.classList.remove('cine'); $('lookHint').classList.remove('hush');
  if (cineT < 0) return;
  cineT = -1; hall.visible = false; doorPivot.rotation.y = 0; haleFade(0); haleShadow.material.opacity = 0; doorLight.intensity = 0; doorLight.visible = false; shake = 0; shadowsMoved();
  if (S.scene === 'intro') goView('intro', .9);
}
// ### One step of the scene: the door, the light and Hale follow the time; the sounds and words come once each.
function updateCine(dt){
  if (cineT < 0) return;
  const t0 = cineT, t = cineT = Math.min(CINE_END + 1, cineT + dt), at = s => t0 < s && t >= s;
  if (t !== t0) shadowsMoved();
  const k = clamp((t - 1.7) / .95, 0, 1), open = 1 - k * k;   // held open, then swung shut, faster and faster
  doorPivot.rotation.y = DOOR_OPEN * open;
  doorLight.intensity = 4 * open;
  haleFade(Math.min(1, t * 2.5) * (open > .02 ? 1 : 0));
  hale.g.position.z = 3.42 + k * .12;
  haleShadow.material.opacity = .5 * open * Math.min(1, t * 2.5);
  for (const [s, html] of LINES) if (s > 0 && at(s)) cineLine(html);
  if (at(1.7)) cue('open');
  if (at(2.65)){ cue('bang'); shake = .45; hall.visible = false; }
  if (at(3.05)){ cue('clunk'); guardShow = 5; }
  if (at(3.25)) cue('rattle');
  if (at(3.4)){ const c = card.querySelector('#cineClock'); if (c) c.classList.add('on'); }
}

// ---------- Endings ----------
// ### Ending A: the lid swings up, warm light comes from below and the camera climbs down the ladder, then the ending
// ### card. Ending B: the door is flung open, white corridor light floods in, then the card.
let hatchAnim = -1, doorFlash = 0, endingShown = false;
function endingA(){ hatchAnim = 0; endingShown = false; tunnelLight.visible = true; }
function endingB(){ doorFlash = 1; goView('cell', .6); setTimeout(() => { if (S.ending === 'B'){ showEnding(); } }, 1400); }

// ---------- Loop ----------
// ### Runs once per screen refresh: the clock (rules.tick), then animations (camera, steam, guard, tile, hatch), then the
// ### markers and the picture. The clock only runs while playing, not paused and not in the briefing.
let clock = 0, last = performance.now(), guardShow = 0, tileVel = 0;
// ### The room loop each frame: clock, camera, markers and drawing.
function frame(now){
  requestAnimationFrame(frame);
  const elapsed = clamp((now - last) / 1000, 0, 1), dt = Math.min(elapsed, .05); last = now; clock += dt;
  if (!paused && S.scene !== 'intro' && !S.ending){
    const r = R.tick(S, elapsed);
    if (r.state !== S){
      S = r.state;
      if (r.message){ if (!S.ending) say(r.message, 'warn'); cue(r.cue); if (r.cue === 'warn' || r.cue === 'rattle') guardShow = 3; }
      if (S.ending === 'B'){ save(); renderHud(); renderHotspots(); endingB(); }
      else if ((saveTimer += dt) > 3){ save(); saveTimer = 0; }
      renderClock();
    }
  }
  updateCamera(dt);
  updateHands(dt);
  updateCine(dt);
  if (shake > 0 && !REDUCED){ shake = Math.max(0, shake - dt); camera.position.x += (Math.random() - .5) * shake * .05; camera.position.y += (Math.random() - .5) * shake * .05; }
  // steam on the mirror and rising from the hot sink
  const st = S.steam ? 1 : 0;
  M.steam.opacity += (st * .92 - M.steam.opacity) * Math.min(1, dt * .45);
  if (waterGain) waterGain.gain.value += ((S.steam && !paused && !tapBuf ? .05 : 0) - waterGain.gain.value) * Math.min(1, dt * 4);
  if (ac) updateTap(dt);
  steamPuffs.forEach(s => { s.userData.t = (s.userData.t + dt * .25) % 1; const t = s.userData.t; s.position.set(-3.73 + Math.sin(t * 9 + s.id) * .05, .9 + t * 1.1, -.65 + Math.cos(t * 7 + s.id) * .08); s.scale.setScalar(.15 + t * .5); s.material.opacity = S.steam ? Math.sin(t * Math.PI) * .35 : Math.max(0, s.material.opacity - dt); s.visible = s.material.opacity > .003; });
  // the guard's silhouette in the window
  guardShow = Math.max(0, guardShow - dt);
  M.guard.opacity += ((guardShow > 0 || S.ending === 'B' ? .95 : 0) - M.guard.opacity) * Math.min(1, dt * 3);
  // the tile falls off the wall when pried
  if (tile.userData.fall !== undefined && tile.position.y > .01){
    tileVel += dt * 4; tile.position.y = Math.max(.01, tile.position.y - tileVel * dt); tile.position.z = Math.min(-2.75, tile.position.z + dt * .5);
    tile.rotation.x = Math.min(Math.PI / 2, tile.rotation.x + dt * 5);
    if (tile.position.y <= .01) tileVel = 0;
    shadowsMoved();
  }
  // the hatch opens and the camera climbs down
  if (hatchAnim >= 0){
    hatchAnim += dt;
    lidPivot.rotation.x = -Math.min(1.9, hatchAnim * 1.6);
    if (hatchAnim < 1.3) shadowsMoved();
    tunnelLight.intensity = Math.min(1.6, hatchAnim);
    if (hatchAnim > 1.3 && cam.t >= 1 && !endingShown && camTarget.pos.y > 0) goView('tunnel', 2.2);
    if (hatchAnim > 3.8 && !endingShown){ endingShown = true; showEnding(); }
  }
  if (doorFlash > 0){ doorFlash = Math.max(0, doorFlash - dt * .5); windowLight.intensity = .9 + doorFlash * 8; }
  // dripping tap
  if (ac && !paused && (dripIn -= dt) < 0){ dripIn = 2.5 + Math.random() * 5; tone(1200 + Math.random() * 500, .08, 'sine', .025, 500); }
  if ((sayTimer -= dt) <= 0) $('say').classList.remove('show');
  M.led.emissiveIntensity = (clock % 2) < .12 ? 3 : .15;   // the camera's red light
  if (pendingHover){ hover(pendingHover); pendingHover = null; }
  updateMarkers();
  if (shadowFrames > 0){ renderer.shadowMap.needsUpdate = true; shadowFrames--; }
  // while a mini game runs the room behind the card stands still, so it is not drawn again and the game runs smoothly;
  // a new size is applied just before drawing: resizing after it would clear the picture and show a black frame
  if (!mini){
    if (sizeDirty){ sizeDirty = false; renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); WATER.resize(); }
    camera.updateMatrixWorld();
    WATER.update(clock, dt);
    renderer.render(scene, camera);
    drawHands();
  }
  adaptResolution(elapsed);
}

// ### The resolution follows the frame rate: when frames take too long the picture is drawn with fewer pixels, and when
// ### there is room to spare for a while it goes back up, never above the screen's own pixel density. It starts at 1.5x
// ### at most (sharp enough, and a quarter of the pixels of 2x), and each step back up waits longer than the last, so the
// ### sharpness never pumps up and down.
const PR_MAX = Math.min(window.devicePixelRatio || 1, COARSE ? 1.5 : 2), PR_MIN = Math.min(PR_MAX, .75);
let pixelRatio = Math.min(PR_MAX, 1.5), perfT = 0, perfN = 0, perfGood = 0, perfWait = 4, sizeDirty = false;
renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight, false); WATER.resize();
function adaptResolution(elapsed){
  if (elapsed > .25 || document.hidden || !overlay.hidden) return;   // a hitch (a tab switch, a card) says nothing about the graphics card
  perfT += elapsed; perfN++;
  if (perfT < 1) return;
  const ft = perfT / perfN; perfT = perfN = 0;
  let next = pixelRatio;
  if (ft > 1 / 45){ next = Math.max(PR_MIN, pixelRatio - .25); perfGood = 0; perfWait = Math.min(60, perfWait * 2); }
  else if (ft < 1 / 57 && ++perfGood >= perfWait){ next = Math.min(PR_MAX, pixelRatio + .25); perfGood = 0; }
  if (next !== pixelRatio){ pixelRatio = next; sizeDirty = true; }
}
addEventListener('resize', () => { sizeDirty = true; });

// ---------- Start ----------
// ### Restores a saved game if there is a valid one, then starts the loop.
if (saved && R.canContinue(saved)){
  S = saved; goView(S.scene, .01); syncWorld(); renderHud(); renderHotspots(); paused = true; showContinue();
} else { syncWorld(); renderHud(); renderHotspots(); showBrief(0); }
renderer.compile(scene, camera);
requestAnimationFrame(frame);
})();
