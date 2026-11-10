// Room 1: the 3D prison washroom (rendering, camera, hotspots, sound, cards). The rules it plays by live in src/rules.js.
(() => {
'use strict';
if (typeof THREE === 'undefined' || typeof EscapeRules === 'undefined'){
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
// ### fluorescent tube that flickers, a weaker lamp over the stall, and cold corridor light through the door window.
const canvas = $('room');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
catch (e){ ShardFatal('3D graphics are not available', 'This game needs WebGL. Turn on hardware acceleration in your browser settings, update your graphics driver or try another browser.'); return; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, COARSE ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const ANISO = renderer.capabilities.getMaxAnisotropy();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050607);
scene.fog = new THREE.FogExp2(0x0b0e0e, 0.03);
const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.03, 60);
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
// Tiles: 8 x 8 glazed tiles of 15 cm, so one texture covers 1.2 m of wall
const tileTex = repeatX => canvasTex(TEX, TEX, (g, w, h) => {
  const n = 8, b = w / n, gw = Math.max(2, w / 220);
  g.fillStyle = '#4f5853'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++){
    const l = 188 + rnd() * 18 | 0;
    g.fillStyle = `rgb(${l - 10},${l},${l - 16})`;
    g.fillRect(i * b + gw, j * b + gw, b - gw * 2, b - gw * 2);
    const gl = g.createLinearGradient(i * b, j * b, i * b + b, j * b + b);
    gl.addColorStop(0, 'rgba(255,255,255,.14)'); gl.addColorStop(.5, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(0,0,0,.08)');
    g.fillStyle = gl; g.fillRect(i * b + gw, j * b + gw, b - gw * 2, b - gw * 2);
    if (rnd() < 0.1){ g.strokeStyle = 'rgba(60,64,58,.55)'; g.lineWidth = 1.2; g.beginPath(); let x = i * b + rnd() * b, y = j * b; g.moveTo(x, y); for (let k = 0; k < 5; k++){ x += (rnd() - .5) * b * .4; y += b / 5; g.lineTo(x, y); } g.stroke(); }
  }
  grime(g, w, h, 26, 'rgba(92,78,48,.16)', w * .12, true);
  grime(g, w, h, 18, 'rgba(40,46,40,.14)', w * .06, false);
}, [repeatX, 1.5]);
const paintTex = canvasTex(TEX, TEX, (g, w, h) => {
  g.fillStyle = '#7d8a80'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++){ const v = rnd() * 40 - 20 | 0; g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 400})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
  grime(g, w, h, 30, 'rgba(70,60,40,.18)', w * .15, false);
  for (let i = 0; i < 14; i++){ g.fillStyle = 'rgba(160,160,150,.5)'; const x = rnd() * w, y = rnd() * h; g.beginPath(); g.ellipse(x, y, 6 + rnd() * 20, 4 + rnd() * 12, rnd() * 3, 0, 7); g.fill(); }
}, [3, 1]);
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
// Scratches in the tiles beside the door: the date the "unsinkable" ship went down, one digit gouged out
const scratchesTex = canvasTex(1024, 640, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  const scratch = (text, x, y, size, rot, alpha) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.font = `700 ${size}px "Arial Narrow", Arial, sans-serif`;
    // on the pale tiles a scratch shows as a dark groove full of grime, with a bright chipped edge beside it
    for (let k = 0; k < 3; k++){ g.strokeStyle = `rgba(38,40,36,${alpha * (1 - k * .2)})`; g.lineWidth = 2.6; g.strokeText(text, (rnd() - .5) * 2.5, (rnd() - .5) * 2.5); }
    g.strokeStyle = `rgba(255,255,250,${alpha * .5})`; g.lineWidth = 1; g.strokeText(text, 1.5, 1.5);
    g.restore();
  };
  scratch('THE UNSINKABLE', 60, 130, 76, -.025, .85);
  scratch('WENT DOWN ON HER FIRST VOYAGE', 50, 230, 52, .015, .85);
  scratch('15 APRIL 19   2', 70, 360, 82, -.02, .9);
  // the third digit is scratched over until nothing can be read
  g.strokeStyle = 'rgba(38,40,36,.85)'; g.lineWidth = 3;
  for (let i = 0; i < 26; i++){ const x = 520 + rnd() * 50, y = 290 + rnd() * 70; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - .5) * 60, y + (rnd() - .5) * 60); g.stroke(); }
  scratch('1500 LOST', 90, 470, 60, .03, .8);
  scratch('IIII IIII', 700, 560, 40, 0, .45);
  g.strokeStyle = 'rgba(38,40,36,.3)'; g.lineWidth = 1.2;
  for (let i = 0; i < 30; i++){ const x = rnd() * w, y = rnd() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - .5) * 120, y + (rnd() - .5) * 30); g.stroke(); }
});
// Steam on the mirror, with the letters someone traced into it left clear
const steamTex = canvasTex(1024, 512, (g, w, h) => {
  const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(225,232,232,.95)'); gr.addColorStop(1, 'rgba(225,232,232,.72)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 3000; i++){ g.fillStyle = `rgba(255,255,255,${rnd() * .25})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, rnd() * 3, 0, 7); g.fill(); }
  g.globalCompositeOperation = 'destination-out';
  g.font = '800 132px "Arial Narrow", Arial, sans-serif'; g.textAlign = 'center'; g.lineWidth = 16; g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0,0,0,1)'; g.strokeText('UNSINKABLE?', w / 2, h * .58);
  for (let i = 0; i < 9; i++){ const x = 160 + rnd() * (w - 320), y = h * .6; g.fillRect(x, y, 5, 40 + rnd() * 90); }
});
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

// ---------- Materials ----------
// ### The surfaces of the cell: painted canvas textures for walls, floor and metal, so the room loads no image files.
const M = {
  tiles: w => new THREE.MeshStandardMaterial({ map: tileTex(w / 1.2), roughness: .32, metalness: 0 }),
  paint: new THREE.MeshStandardMaterial({ map: paintTex, roughness: .9 }),
  floor: new THREE.MeshStandardMaterial({ map: concreteTex, roughness: .78 }),
  ceiling: new THREE.MeshStandardMaterial({ color: 0x3a3e3c, roughness: .95 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xbcc4c8, metalness: .88, roughness: .3 }),
  dullSteel: new THREE.MeshStandardMaterial({ color: 0x8f989c, metalness: .7, roughness: .5 }),
  mirror: new THREE.MeshStandardMaterial({ color: 0xdfe4e6, metalness: 1, roughness: .12 }),
  door: new THREE.MeshStandardMaterial({ color: 0x3e4b54, metalness: .55, roughness: .55 }),
  partition: new THREE.MeshStandardMaterial({ color: 0x6d7a73, metalness: .4, roughness: .55 }),
  plate: new THREE.MeshStandardMaterial({ map: plateTex, metalness: .75, roughness: .4 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 1 }),
  pipe: new THREE.MeshStandardMaterial({ color: 0x59605c, metalness: .6, roughness: .45 }),
  bucket: new THREE.MeshStandardMaterial({ color: 0xe0b021, roughness: .55 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x9c7a50, roughness: .7 }),
  mopHead: new THREE.MeshStandardMaterial({ color: 0xbdb7a6, roughness: 1 }),
  paper: new THREE.MeshStandardMaterial({ color: 0xe9dfc4, roughness: .9, side: THREE.DoubleSide }),
  tube: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe9fff2, emissiveIntensity: 2.4 }),
  corridor: new THREE.MeshBasicMaterial({ map: corridorTex }),
  guard: new THREE.MeshBasicMaterial({ map: guardTex, transparent: true, opacity: 0, depthWrite: false }),
  graffiti: new THREE.MeshStandardMaterial({ map: graffitiTex, transparent: true, roughness: .8, depthWrite: false }),
  scratches: new THREE.MeshStandardMaterial({ map: scratchesTex, transparent: true, roughness: .8, depthWrite: false }),
  steam: new THREE.MeshStandardMaterial({ map: steamTex, transparent: true, opacity: 0, roughness: 1, depthWrite: false }),
  sign: new THREE.MeshStandardMaterial({ map: signTex, roughness: .8 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x1c1d1e, roughness: .9 })
};

// ---------- The washroom ----------
// ### The room is 8 m wide (x -4..4), 6 m deep (z -3..3) and 3 m high. The steel door is in the south wall, the sinks on the
// ### west wall, the toilet stall in the north-east corner with the hatch in its floor, the mop in the south-east corner.
const W = 8, D = 6, H = 3, TILE_H = 1.8;
const add = (mesh, parent = room) => { mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh; };
const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return add(m); };
const cyl = (rt, rb, h, mat, x, y, z, seg = 20) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); return add(m); };
const plane = (w, h, mat, x, y, z, ry = 0, rx = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.receiveShadow = true; room.add(m); return m; };
const HOT = {};   // hotspot key -> meshes that can be clicked
// ### Registers a clickable object (a hotspot) for the marker and the rules.
const hot = (key, ...meshes) => { (HOT[key] = HOT[key] || []).push(...meshes); meshes.forEach(m => { if (m.material !== M.steam) m.material = m.material.clone(); m.userData.hot = key; }); };

function wall(len, x, z, ry){
  plane(len, TILE_H, M.tiles(len), x, TILE_H / 2, z, ry);
  const p = plane(len, H - TILE_H, M.paint, x, TILE_H + (H - TILE_H) / 2, z, ry);
  p.material = M.paint.clone(); p.material.map = paintTex.clone(); p.material.map.needsUpdate = true; p.material.map.repeat.set(len / 2.6, .5);
  const trim = box(len, .05, .03, M.partition, x, TILE_H, z); trim.rotation.y = ry; trim.position.x += Math.sin(ry) * .015; trim.position.z += Math.cos(ry) * .015;
}
{ // floor with an opening where the hatch is (shape coordinates are metres; y of the shape becomes -z in the room)
  const fs = new THREE.Shape(); fs.moveTo(-W / 2, -D / 2); fs.lineTo(W / 2, -D / 2); fs.lineTo(W / 2, D / 2); fs.lineTo(-W / 2, D / 2); fs.lineTo(-W / 2, -D / 2);
  const hp = new THREE.Path(), hx = 2.2, hz = 1.75, hh = .37; hp.moveTo(hx - hh, hz - hh); hp.lineTo(hx - hh, hz + hh); hp.lineTo(hx + hh, hz + hh); hp.lineTo(hx + hh, hz - hh); hp.lineTo(hx - hh, hz - hh); fs.holes.push(hp);
  const ft = concreteTex.clone(); ft.needsUpdate = true; ft.repeat.set(.5, .5);
  const fl = new THREE.Mesh(new THREE.ShapeGeometry(fs), new THREE.MeshStandardMaterial({ map: ft, roughness: .78 }));
  fl.rotation.x = -Math.PI / 2; fl.receiveShadow = true; room.add(fl);
}
plane(W, D, M.ceiling, 0, H, 0, 0, Math.PI / 2);
wall(W, 0, -D / 2, 0);            // north
// south (door wall), built around the doorway so the open door shows the corridor in the briefing
wall(3.45, -2.275, D / 2, Math.PI); wall(3.45, 2.275, D / 2, Math.PI);
{ const p = plane(1.1, H - 2.14, M.paint, 0, 2.14 + (H - 2.14) / 2, D / 2, Math.PI); p.material = M.paint.clone(); p.material.map = paintTex.clone(); p.material.map.needsUpdate = true; p.material.map.repeat.set(1.1 / 2.6, .3); }
wall(D, -W / 2, 0, Math.PI / 2);  // west (sinks)
wall(D, W / 2, 0, -Math.PI / 2);  // east
// skirting drain channel and floor drain
cyl(.12, .12, .01, M.dark, 0, .006, .3, 24);
for (let i = -2; i <= 2; i++) box(.22, .012, .012, M.dullSteel, 0, .012, .3 + i * .045);

// Pipes along the ceiling and down to the sinks
const pipe = (len, x, y, z, axis) => { const p = cyl(.045, .045, len, M.pipe, x, y, z, 12); if (axis === 'x') p.rotation.z = Math.PI / 2; if (axis === 'z') p.rotation.x = Math.PI / 2; return p; };
pipe(W, 0, 2.78, -2.88, 'x'); pipe(W, 0, 2.66, -2.9, 'x'); pipe(D, -3.9, 2.78, 0, 'z');
pipe(1.9, -3.92, 1.85, -1.5); pipe(1.9, -3.92, 1.85, 1.5);
for (const x of [-3, -1, 1, 3]) box(.06, .12, .1, M.dullSteel, x, 2.78, -2.9);

// Lights: the caged tube in the middle, a lamp over the stall, corridor light through the window
const hemi = new THREE.HemisphereLight(0xa9b8b0, 0x1a1c1b, .32); room.add(hemi);
const mainLight = new THREE.SpotLight(0xe4f2e9, 3.2, 14, 1.3, .65, 1.6);
mainLight.position.set(-.6, 2.86, .3); mainLight.target.position.set(-.6, 0, .3);
mainLight.castShadow = true; mainLight.shadow.mapSize.set(COARSE ? 512 : 1024, COARSE ? 512 : 1024); mainLight.shadow.bias = -.0005; mainLight.shadow.radius = 4;
room.add(mainLight, mainLight.target);
const stallLight = new THREE.SpotLight(0xffe6c4, 2.1, 7, .95, .7, 1.8);
stallLight.position.set(2.75, 2.86, -1.8); stallLight.target.position.set(2.75, 0, -1.9);
stallLight.castShadow = !COARSE; stallLight.shadow.mapSize.set(512, 512); stallLight.shadow.bias = -.0008;
room.add(stallLight, stallLight.target);
const windowLight = new THREE.SpotLight(0x9cc4ff, .9, 8, .5, .8, 1.5);
windowLight.position.set(0, 1.7, 3.3); windowLight.target.position.set(0, .6, 0); room.add(windowLight, windowLight.target);
const tube = box(1.3, .06, .14, M.tube, -.6, 2.93, .3); tube.castShadow = false;
for (let i = 0; i < 5; i++){ const c = box(.012, .1, .2, M.dullSteel, -1.2 + i * .3, 2.93, .3); c.castShadow = false; }
const stallTube = box(.6, .05, .1, M.tube.clone(), 2.75, 2.94, -1.8); stallTube.castShadow = false;
stallTube.material.emissive.set(0xffe6c4); stallTube.material.emissiveIntensity = 1.8;
plane(1.9, .7, M.sign, 3.995, 1.6, 1.3, -Math.PI / 2);

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

// Sinks with a polished steel mirror, the soap dish with the spoon and the hot tap
box(.5, .06, 2.6, M.steel, -3.75, .86, 0);
box(.5, .12, 2.6, M.steel, -3.75, .78, 0);
const basins = [];
for (const z of [-.65, .65]){
  const b = new THREE.Mesh(new THREE.CylinderGeometry(.19, .13, .12, 24, 1, true), M.steel); b.position.set(-3.73, .83, z); add(b); basins.push(b);
  cyl(.19, .19, .004, M.dark, -3.73, .891, z, 24).material = new THREE.MeshStandardMaterial({ color: 0x2a2e30, metalness: .9, roughness: .25 });
  const sp = cyl(.025, .025, .18, M.steel, -3.94, .98, z, 10); sp.rotation.z = Math.PI / 2;
  cyl(.03, .03, .05, M.steel, -3.96, 1.05, z + .12, 10);
}
const hotTap = cyl(.034, .034, .05, new THREE.MeshStandardMaterial({ color: 0xb33a2c, roughness: .5 }), -3.96, 1.05, -.53, 12);
hot('tap', hotTap, basins[0]);
pipe(.8, -3.85, .4, -.65); pipe(.8, -3.85, .4, .65);
const mirror = plane(2.2, .72, M.mirror, -3.985, 1.6, 0, Math.PI / 2);
box(.01, .8, 2.28, M.dullSteel, -3.996, 1.6, 0);
const steam = plane(2.2, .72, M.steam, -3.975, 1.6, 0, Math.PI / 2); steam.renderOrder = 2;
hot('read:mirror', mirror, steam);
const dish = box(.12, .025, .2, M.dullSteel, -3.85, .905, 0);
const spoon = new THREE.Group();
const sBowl = new THREE.Mesh(new THREE.SphereGeometry(.03, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.steel); sBowl.scale.set(1, .25, 1.4); sBowl.rotation.x = Math.PI;
const sHandle = new THREE.Mesh(new THREE.BoxGeometry(.012, .005, .13), M.steel); sHandle.position.z = .09;
spoon.add(sBowl, sHandle); spoon.position.set(-3.85, .93, -.04); spoon.rotation.y = .5; room.add(spoon);
hot('take:spoon', dish, sBowl, sHandle);
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
hot('read:scratches', scratches);

// The toilet stall: partitions, steel toilet, graffiti, the crooked tile and the hatch in the floor
const SX0 = 1.5, SZ1 = -.7;
box(.04, 1.9, 2.3, M.partition, SX0, 1.1, -1.85);
box(.3, 1.9, .04, M.partition, SX0 + .15, 1.1, SZ1); box(.3, 1.9, .04, M.partition, 3.85, 1.1, SZ1);
box(2.54, .06, .06, M.dullSteel, 2.75, 2.06, SZ1);
for (const z of [-2.9, SZ1 + .05]) box(.06, .14, .06, M.dullSteel, SX0, .07, z);
box(.62, .78, .24, M.steel, 3.25, .39, -2.86);
box(.5, .36, .5, M.steel, 3.25, .18, -2.55);
const bowl = cyl(.24, .2, .1, M.steel, 3.25, .41, -2.5, 24); bowl.scale.z = 1.2;
cyl(.18, .18, .006, M.dark, 3.25, .462, -2.5, 24).scale.z = 1.2;
box(.08, .06, .04, M.dullSteel, 3.25, .86, -2.75);
const roll = cyl(.055, .055, .1, M.paper, 3.75, .7, -2.0, 14); roll.rotation.z = Math.PI / 2;
const graffiti = plane(1.05, .66, M.graffiti, SX0 + .025, 1.32, -1.9, Math.PI / 2);
hot('read:graffiti', graffiti);
// The crooked tile, the dark hole behind it and the car key hidden there
const TILE_POS = new THREE.Vector3(2.62, .58, -2.988);
plane(.15, .15, M.dark, TILE_POS.x, TILE_POS.y, -2.996);
const tile = box(.15, .15, .018, new THREE.MeshStandardMaterial({ map: tileTex(1), roughness: .3 }), TILE_POS.x, TILE_POS.y, TILE_POS.z);
tile.material.map.repeat.set(1 / 8, 1 / 8); tile.rotation.z = .07;
// the car key: a brass blade, a black plastic head and a worn leather fob, lying in the hollow
const carKey = new THREE.Group();
const keyHead = new THREE.Mesh(new THREE.BoxGeometry(.03, .022, .008), new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: .5 }));
const keyBlade = new THREE.Mesh(new THREE.BoxGeometry(.045, .009, .003), new THREE.MeshStandardMaterial({ color: 0xc8a24a, metalness: .85, roughness: .3 })); keyBlade.position.x = .036;
const keyRing = new THREE.Mesh(new THREE.TorusGeometry(.01, .002, 6, 14), M.steel); keyRing.position.x = -.022;
const keyFob = new THREE.Mesh(new THREE.BoxGeometry(.028, .04, .004), new THREE.MeshStandardMaterial({ color: 0x5a3820, roughness: .85 })); keyFob.position.set(-.036, -.016, 0); keyFob.rotation.z = .4;
carKey.add(keyHead, keyBlade, keyRing, keyFob); carKey.position.set(TILE_POS.x + .005, TILE_POS.y - .01, -2.99); carKey.rotation.z = -.2; carKey.scale.setScalar(1.5); carKey.visible = false; room.add(carKey);
hot('pry', tile); hot('take:carkey', keyHead, keyBlade, keyFob);
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
const shaft = new THREE.Mesh(new THREE.BoxGeometry(HS, 4, HS), new THREE.MeshStandardMaterial({ color: 0x2b2a27, roughness: 1, side: THREE.BackSide }));
shaft.position.set(HATCH.x, -2.01, HATCH.z); room.add(shaft);
for (let y = -.3; y > -3.9; y -= .3){ const r = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, .42, 8), M.dullSteel); r.rotation.z = Math.PI / 2; r.position.set(HATCH.x, y, HATCH.z - HS / 2 + .08); room.add(r); }
const tunnelLight = new THREE.PointLight(0xffb066, 0, 5, 2); tunnelLight.position.set(HATCH.x, -3.4, HATCH.z); room.add(tunnelLight);

// Environment map for the steel: a blurred stand-in of the room (tiled walls, dark floor, the bright tube), built once
{
  const envScene = new THREE.Scene();
  const et = canvasTex(64, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#3a3f3c'); gr.addColorStop(.4, '#9aa69e'); gr.addColorStop(.62, '#b9c2bb'); gr.addColorStop(.64, '#3c403e'); gr.addColorStop(1, '#1a1c1b'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  envScene.add(new THREE.Mesh(new THREE.BoxGeometry(8, 3, 6), new THREE.MeshBasicMaterial({ map: et, side: THREE.BackSide })));
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.4, .08, .25), new THREE.MeshBasicMaterial({ color: 0xffffff })); strip.position.set(-.6, 1.45, .3); envScene.add(strip);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, .02).texture;
  pmrem.dispose();
  scene.background = new THREE.Color(0x050607);
}

// ---------- Camera: viewpoints and looking around ----------
// ### Each scene has a viewpoint (where you stand and what you face). Walking to another scene glides the camera there.
// ### Dragging the mouse or a finger, or the arrow keys, turns your head within limits.
const VIEWS = {
  intro: { pos: [0, 1.62, 2.2], look: [0, 1.4, -3] },
  door: { pos: [-.9, 1.62, 1.2], look: [1.25, .95, 3] },
  sinks: { pos: [-2.15, 1.62, .1], look: [-4, 1.15, 0] },
  stall: { pos: [2.75, 1.62, .15], look: [2.7, .72, -3] },
  hatch: { pos: [2.3, 1.02, -.86], look: [2.22, .05, -1.55] },
  tunnel: { pos: [2.2, -2.6, -1.6], look: [2.2, -3.9, -1.95] },
  cell: { pos: [0, 1.62, 1.1], look: [0, 1.45, 3] },
  closing: { pos: [.5, 1.5, -.3], look: [-.05, 1.05, 3] }
};
const cam = { pos: new THREE.Vector3(...VIEWS.intro.pos), yaw: 0, pitch: 0, from: null, t: 1, dur: 1, yawOff: 0, pitchOff: 0, idle: 0 };
// ### The camera angles that look at a point.
const anglesTo = (pos, look) => { const d = new THREE.Vector3(...look).sub(new THREE.Vector3(...pos)); return { yaw: Math.atan2(d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) }; };
let camTarget = { pos: new THREE.Vector3(...VIEWS.intro.pos), ...anglesTo(VIEWS.intro.pos, VIEWS.intro.look) };
Object.assign(cam, { yaw: camTarget.yaw, pitch: camTarget.pitch });
// ### Moves the camera smoothly to another place in the cell.
function goView(name, dur){
  const v = VIEWS[name];
  cam.from = { pos: cam.pos.clone(), yaw: cam.yaw, pitch: cam.pitch };
  camTarget = { pos: new THREE.Vector3(...v.pos), ...anglesTo(v.pos, v.look) };
  // turn the short way round
  while (camTarget.yaw - cam.from.yaw > Math.PI) camTarget.yaw -= Math.PI * 2;
  while (camTarget.yaw - cam.from.yaw < -Math.PI) camTarget.yaw += Math.PI * 2;
  cam.t = 0; cam.dur = REDUCED ? .01 : (dur || 1.1); cam.yawOff = 0; cam.pitchOff = 0;
}
// ### Moves the camera each frame, towards the current place and where the player is looking.
function updateCamera(dt){
  if (cam.t < 1){
    cam.t = Math.min(1, cam.t + dt / cam.dur);
    const e = cam.t < .5 ? 2 * cam.t * cam.t : 1 - Math.pow(-2 * cam.t + 2, 2) / 2;
    cam.pos.lerpVectors(cam.from.pos, camTarget.pos, e);
    cam.yaw = cam.from.yaw + (camTarget.yaw - cam.from.yaw) * e;
    cam.pitch = cam.from.pitch + (camTarget.pitch - cam.from.pitch) * e;
  }
  const bob = REDUCED ? 0 : Math.sin(clock * 1.3) * .004;
  const yaw = cam.yaw + cam.yawOff, pitch = clamp(cam.pitch + cam.pitchOff, -1.35, 1.2);
  camera.position.set(cam.pos.x, cam.pos.y + bob, cam.pos.z);
  camera.lookAt(cam.pos.x + Math.sin(yaw) * Math.cos(pitch), cam.pos.y + bob + Math.sin(pitch), cam.pos.z - Math.cos(yaw) * Math.cos(pitch));
}
let drag = null;
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId }; try { canvas.setPointerCapture(e.pointerId); } catch (err) {} initAudio(); });
canvas.addEventListener('pointermove', e => {
  if (drag){
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved > 6){ canvas.classList.add('dragging'); cam.yawOff = clamp(cam.yawOff + dx * .004, -1.3, 1.3); cam.pitchOff = clamp(cam.pitchOff - dy * .004, -.7, .7); $('lookHint').classList.add('gone'); }
  } else hover(e);
});
canvas.addEventListener('pointerup', e => { if (drag && drag.moved <= 6) clickAt(e); drag = null; canvas.classList.remove('dragging'); });
canvas.addEventListener('pointercancel', () => { drag = null; canvas.classList.remove('dragging'); });

// ---------- Hotspots: markers and clicking objects ----------
// ### visibleHotspots() from rules.js says what can be used right now. Objects get a pulsing marker (a real button, so it
// ### works with a keyboard and on touch screens); walking happens with the "Walk to" buttons. Clicking an object in the
// ### 3D view does the same as its marker.
const ANCHORS = {
  'take:mop': [3.35, .9, 2.45], 'wedge': [.38, 1.02, 2.86], 'take:spoon': [-3.85, .95, 0], 'tap': [-3.94, 1.08, -.53],
  'read:mirror': [-3.97, 1.75, .45], 'read:graffiti': [1.53, 1.5, -1.9], 'pry': [2.62, .58, -2.97], 'take:carkey': [2.62, .58, -2.97], 'read:scratches': [1.75, 1.3, 2.95],
  'lock': [2.2, .1, -1.1]
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
    if (h.action === 'go'){ b.textContent = h.label; go.appendChild(b); continue; }
    b.className = 'mk'; b.innerHTML = '<i></i><span></span>'; b.querySelector('span').textContent = h.label;
    mk.appendChild(b); markerEls.push({ el: b, at: new THREE.Vector3(...(ANCHORS[keyOf(h)] || [0, 1, 0])) });
  }
  $('goBar').hidden = !go.children.length;
}
// ### Places the 2D markers over their 3D objects.
function updateMarkers(){
  const w = innerWidth, h = innerHeight, busy = !overlay.hidden || cam.t < 1;
  for (const m of markerEls){
    tmp.copy(m.at).project(camera);
    const on = !busy && tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
    m.el.style.display = on ? '' : 'none';
    if (on) m.el.style.transform = `translate(${((tmp.x + 1) / 2 * w - 14).toFixed(1)}px, ${((1 - tmp.y) / 2 * h - 14).toFixed(1)}px)`;
  }
}
// ### Finds the hotspot under the pointer with a ray through the scene.
function pick(e){
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const live = new Set(R.visibleHotspots(S).map(keyOf));
  const meshes = Object.entries(HOT).filter(([k]) => live.has(k)).flatMap(([, ms]) => ms).filter(m => m.visible);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  return hit && hit.distance < 6 ? hit.object.userData.hot : null;
}
let hovered = null;
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
  if (action === 'lock'){ if (S.scene === 'hatch') showLock(); return; }
  act(action, target);
}
// ### Sends an action to Rules, and shows the answer. Refused actions return the state unchanged, with a reason.
function act(action, target){
  const before = S, r = R.perform(S, action, target);
  cue(r.cue);
  if (!r.ok){ say(r.message, 'warn'); return r; }
  S = r.state;
  if (action !== 'new') save();
  if (S.scene !== before.scene) goView(S.scene === 'tunnel' ? 'hatch' : S.scene);
  if (action === 'read' && S.clues.includes(target) && R.CLUES[target] && !(target === 'mirror' && !S.steam)) showClue(target);
  else if (r.message && !S.ending) say(r.message, action === 'try' && !S.ending ? 'warn' : action === 'take' || action === 'pry' ? 'good' : '');
  if (action === 'try' && !S.ending){ guardShow = 3; renderLock(); }
  if (S.ending === 'A' && before.ending !== 'A'){ hideCard(); endingA(); }
  syncWorld(); renderHud(); renderHotspots();
  return r;
}

// ### syncWorld puts every object where the state says it is: spoon in the dish or gone, mop in the bucket or jammed
// ### against the door, the tile on the wall or on the floor, the car key in its hollow, the lock wheels, the steam.
function syncWorld(){
  spoon.visible = !S.inventory.includes('spoon');
  const mp = S.wedged ? MOP_DOOR : S.inventory.includes('mop') ? null : MOP_CORNER;
  mop.visible = !!mp;
  if (mp){ mop.position.copy(mp.p); mop.rotation.copy(mp.r); }
  if (S.tileOpen && tile.userData.fall === undefined) tile.userData.fall = 0;
  if (!S.tileOpen){ tile.position.copy(TILE_POS); tile.rotation.set(0, 0, .07); delete tile.userData.fall; }
  carKey.visible = S.tileOpen && !S.inventory.includes('carkey');
  S.lock.forEach((d, i) => { if (wheelTex[i].userData !== d){ drawDigit(wheelTex[i], d); wheelTex[i].userData = d; } });
  if (!S.ending){ lidPivot.rotation.x = 0; tunnelLight.intensity = 0; }
}

// ---------- HUD and cards ----------
// ### The clock, inventory and journal, and the cards for clues, the lock and the endings. They only show what Rules says.
const overlay = $('overlay'), card = $('card'), hud = $('hud');
const ICON = {
  spoon: '<svg viewBox="0 0 40 24" aria-hidden="true"><ellipse cx="10" cy="12" rx="8" ry="5" fill="#cfd6d9"/><rect x="16" y="10.5" width="22" height="3" rx="1.5" fill="#cfd6d9"/></svg>',
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
  card.className = 'card' + (cls ? ' ' + cls : ''); card.innerHTML = html; overlay.hidden = false;
  const b = card.querySelector('.btn'); if (b && !COARSE) b.focus({ preventScroll: true });
}
// ### Closes a clue or lock card.
function hideCard(){ overlay.hidden = true; }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ### The briefing: five short cards so a first-time player knows what happened, who they are, where, why and how to play.
// ### The first card is the front page of an old newspaper (.news in styles.css): the theft at the Museu de Marinha in Lisbon.
// ### It has no eyebrow or title of its own: the newspaper headline is the card's h1.
// ### The third is not a card but a short scene in the room (see "Briefing scene" below): Hale shuts and locks the door.
const BRIEF = [
  [null, null, '<div class="news-wrap"><article class="news" aria-label="Front page of The Lisbon Times"><div class="mast-top"><span>Front page</span><span>Magazine</span></div><div class="mast">The Lisbon Times</div><div class="dateline"><span>Vol. CXXI · No. 107</span><span>Lisbon, Monday 16 April 2012</span><span>€1.20</span></div><h1>Titanic necklace vanishes from naval museum</h1><div class="deck">The Starfall necklace disappears on the night of the centenary. No alarm sounded.</div><div class="cols"><div class="by">By our crime correspondent</div><p>BELÉM — The Starfall necklace, lent by the Ashford family to the Museu de Marinha for a limited exhibition marking 100 years since the sinking of the Titanic, disappeared from its glass case on the night of the centenary.</p><figure><div class="photo"><div class="ht"><svg class="necklace" viewBox="0 0 160 72" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><radialGradient id="nl-spot" cx=".5" cy=".3" r=".62"><stop offset="0" stop-color="#d8d8d8"/><stop offset=".45" stop-color="#6e6e6e"/><stop offset="1" stop-color="#141414"/></radialGradient><linearGradient id="nl-bust" x1="0" x2="1"><stop offset="0" stop-color="#1c1c1c"/><stop offset=".42" stop-color="#3e3e3e"/><stop offset=".6" stop-color="#323232"/><stop offset="1" stop-color="#161616"/></linearGradient><radialGradient id="nl-pearl" cx=".35" cy=".32" r=".7"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#e6e6e6"/><stop offset=".8" stop-color="#8a8a8a"/><stop offset="1" stop-color="#3a3a3a"/></radialGradient><linearGradient id="nl-base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8b8b8"/><stop offset=".12" stop-color="#5a5a5a"/><stop offset="1" stop-color="#1a1a1a"/></linearGradient><linearGradient id="nl-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".0"/><stop offset=".45" stop-color="#fff" stop-opacity=".0"/><stop offset=".5" stop-color="#fff" stop-opacity=".28"/><stop offset=".56" stop-color="#fff" stop-opacity=".0"/><stop offset=".7" stop-color="#fff" stop-opacity=".0"/><stop offset=".73" stop-color="#fff" stop-opacity=".14"/><stop offset=".76" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="160" height="72" fill="url(#nl-spot)"/><path d="M62 0H98V9Q98 24 124 34L132 60H28L36 34Q62 24 62 9Z" fill="url(#nl-bust)"/><path d="M28 58H132L140 72H20Z" fill="url(#nl-base)"/><rect x="72" y="62" width="16" height="5" fill="#cfcfcf"/><path d="M73.5 64h13M73.5 65.6h9" stroke="#555" stroke-width=".5"/><g fill="#000" opacity=".45"><ellipse cx="104.9" cy="15.4" rx="2" ry="1.3"/><ellipse cx="103.8" cy="19.5" rx="2" ry="1.3"/><ellipse cx="102.1" cy="23.3" rx="2" ry="1.3"/><ellipse cx="100.0" cy="26.9" rx="2" ry="1.3"/><ellipse cx="97.4" cy="30.0" rx="2" ry="1.3"/><ellipse cx="94.5" cy="32.7" rx="2" ry="1.3"/><ellipse cx="91.4" cy="34.8" rx="2" ry="1.3"/><ellipse cx="88.0" cy="36.3" rx="2" ry="1.3"/><ellipse cx="84.4" cy="37.3" rx="2" ry="1.3"/><ellipse cx="80.8" cy="37.6" rx="2" ry="1.3"/><ellipse cx="77.2" cy="37.3" rx="2" ry="1.3"/><ellipse cx="73.6" cy="36.3" rx="2" ry="1.3"/><ellipse cx="70.2" cy="34.8" rx="2" ry="1.3"/><ellipse cx="67.1" cy="32.7" rx="2" ry="1.3"/><ellipse cx="64.2" cy="30.0" rx="2" ry="1.3"/><ellipse cx="61.6" cy="26.9" rx="2" ry="1.3"/><ellipse cx="59.5" cy="23.3" rx="2" ry="1.3"/><ellipse cx="57.8" cy="19.5" rx="2" ry="1.3"/><ellipse cx="56.7" cy="15.4" rx="2" ry="1.3"/></g><g fill="url(#nl-pearl)"><circle cx="104.1" cy="13.8" r="2.1"/><circle cx="103.0" cy="17.9" r="2.1"/><circle cx="101.3" cy="21.7" r="2.1"/><circle cx="99.2" cy="25.3" r="2.1"/><circle cx="96.6" cy="28.4" r="2.1"/><circle cx="93.7" cy="31.1" r="2.1"/><circle cx="90.6" cy="33.2" r="2.1"/><circle cx="87.2" cy="34.7" r="2.1"/><circle cx="83.6" cy="35.7" r="2.1"/><circle cx="80.0" cy="36.0" r="2.1"/><circle cx="76.4" cy="35.7" r="2.1"/><circle cx="72.8" cy="34.7" r="2.1"/><circle cx="69.4" cy="33.2" r="2.1"/><circle cx="66.3" cy="31.1" r="2.1"/><circle cx="63.4" cy="28.4" r="2.1"/><circle cx="60.8" cy="25.3" r="2.1"/><circle cx="58.7" cy="21.7" r="2.1"/><circle cx="57.0" cy="17.9" r="2.1"/><circle cx="55.9" cy="13.8" r="2.1"/></g><path d="M80 36.5V41" stroke="#bbb" stroke-width=".8"/><polygon points="80,40.5 82.3,46.2 88.4,46.6 83.7,50.5 85.2,56.4 80,53.1 74.8,56.4 76.3,50.5 71.6,46.6 77.7,46.2" fill="url(#nl-pearl)" stroke="#111" stroke-width=".5"/><g stroke="#fff" stroke-linecap="round"><path d="M80 43.5v6M77 46.5h6" stroke-width=".7"/><path d="M93 15v5M90.5 17.5h5M61 27v3M59.5 28.5h3" stroke-width=".45" opacity=".8"/></g><path d="M22 2H138V72M22 2V72" fill="none" stroke="#9a9a9a" stroke-width=".5" opacity=".35"/><rect width="160" height="72" fill="url(#nl-glass)"/></svg></div><b></b></div><figcaption>The Starfall necklace on display at the Museu de Marinha, before the theft.</figcaption></figure><p>No alarm sounded. The museum has closed the exhibition.</p><p>A detective has been put on the case.</p></div></article></div>'],
  ['Cell Block D · 02:14', 'Plot <em>Twist</em>', 'Three weeks ago you were that detective. You followed the trail from the empty case at the Museu de Marinha, and it ended at your own door: the necklace’s velvet box, hidden in your car. Tonight you are <b>inmate 4471</b>, convicted of stealing it. Someone framed you.</p><p>Not everyone believed it. <b>Your oldest friend on the force</b> stood by you through the trial and kept digging until he found the proof that clears your name. But the people who framed you found out and came after him. Before he disappeared from Lisbon, he <b>hid the evidence across the city</b>, in places only you would know to look.'],
  ['The washroom · 02:16', 'Ten <em>minutes</em>', 'cine'],
  ['The rumour', 'A way <em>down</em>', 'Inmates whisper about a <b>hatch in the floor</b> of this washroom, locked with a four-digit code. The code is hidden somewhere in the room. Find it, open the hatch, get out before Hale comes back.'],
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
  const body = text ? (text.startsWith('<div') ? text : `<p>${text}</p>`) : `<div class="howto">
      <b>Drag</b><span>Look around (or use the arrow keys)</span>
      <b>Markers</b><span>Click a pulsing marker or the object itself to use it</span>
      <b>Walk to</b><span>Buttons bottom right take you to another part of the room</span>
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
    <div class="clue-list">${list || '<div class="empty">Nothing yet. Look closely at the mirror, the walls and anything that looks out of place.</div>'}</div>
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
// ### Shows one of the two endings.
function showEnding(){
  const A = S.ending === 'A', E = R.ENDINGS[S.ending];
  showCard(`<div class="eyebrow">${A ? 'Ending A of 2' : 'Ending B of 2'}</div>
    <h1>${A ? 'Out <em>below</em>' : 'Back to <em>the cell</em>'}</h1><p>${esc(E.text)}</p>
    <p>Time left: <b>${fmt(S.time)}</b> · Clues: <b>${S.clues.length} of 3</b> · Wrong codes: <b>${S.wrongTries}</b>${S.wedged ? ' · You jammed the door' : ''}</p>
    ${A ? '<div class="next">Room 2 · The chase starts at the end of this tunnel</div>' : '<p>Tip: the jammed door buys you a minute, and the steam shows more than your face.</p>'}
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
  else if (d === 'start'){ const r = act('start'); if (r.ok){ hideCard(); hud.classList.remove('off'); } }
  else if (d === 'resume') resumeRoom();
  else if (d === 'pause') showPause();
  else if (d === 'ask-new') showAskNew();
  else if (d === 'new'){ paused = false; hatchAnim = -1; tileVel = 0; endingShown = false; act('new'); writeStore(R.SAVE_KEY, ''); hud.classList.add('off'); goView('intro', .8); doorFlash = 0; windowLight.intensity = .9; showBrief(0); }
  else if (d === 'close') hideCard();
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
  if (e.code === 'ArrowLeft') cam.yawOff = clamp(cam.yawOff - .08, -1.3, 1.3);
  if (e.code === 'ArrowRight') cam.yawOff = clamp(cam.yawOff + .08, -1.3, 1.3);
  if (e.code === 'ArrowUp') cam.pitchOff = clamp(cam.pitchOff + .06, -.7, .7);
  if (e.code === 'ArrowDown') cam.pitchOff = clamp(cam.pitchOff - .06, -.7, .7);
});
// The clock must not run while nobody is looking
document.addEventListener('visibilitychange', () => {
  if (document.hidden && S.scene !== 'intro' && !S.ending && !paused) showPause();
  if (ac){ if (document.hidden) ac.suspend(); else if (!muted) ac.resume(); }
});
addEventListener('blur', () => { if (S.scene !== 'intro' && !S.ending && !paused) showPause(); });
addEventListener('pagehide', () => { if (ac) ac.suspend(); save(); });
addEventListener('shardheist:fatal', () => { if (S.scene !== 'intro' && !S.ending && !paused) showPause(); if (ac) ac.suspend(); $('fatalReload').focus(); });

// ---------- Sound ----------
// ### Synthesised with Web Audio: the hum of the fluorescent tube, dripping water, running water while the tap is on,
// ### and short effects for every kind of action. Starts on the first click, as browsers require.
let ac = null, master = null, waterGain = null, noiseBuf = null, dripIn = 3;
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
  hall.visible = true; cineT = REDUCED ? CINE_END : 0;
  overlay.classList.add('cine'); $('lookHint').classList.add('hush'); goView('closing', 1.2);
  if (REDUCED){ cineLine(LINES[2][1]); card.querySelector('#cineClock').classList.add('on'); guardShow = 5; }
  else cineLine(LINES[0][1]);
  updateCine(0);
}
function stopCine(){
  overlay.classList.remove('cine'); $('lookHint').classList.remove('hush');
  if (cineT < 0) return;
  cineT = -1; hall.visible = false; doorPivot.rotation.y = 0; haleFade(0); haleShadow.material.opacity = 0; doorLight.intensity = 0; shake = 0;
  if (S.scene === 'intro') goView('intro', .9);
}
// ### One step of the scene: the door, the light and Hale follow the time; the sounds and words come once each.
function updateCine(dt){
  if (cineT < 0) return;
  const t0 = cineT, t = cineT = Math.min(CINE_END + 1, cineT + dt), at = s => t0 < s && t >= s;
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
function endingA(){ hatchAnim = 0; endingShown = false; }
function endingB(){ doorFlash = 1; goView('cell', .6); setTimeout(() => { if (S.ending === 'B'){ showEnding(); } }, 1400); }

// ---------- Loop ----------
// ### Runs once per screen refresh: the clock (rules.tick), then animations (camera, steam, flicker, guard, tile, hatch),
// ### then the markers and the picture. The clock only runs while playing, not paused and not in the briefing.
let clock = 0, last = performance.now(), guardShow = 0, flicker = 0, tileVel = 0;
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
  updateCine(dt);
  if (shake > 0 && !REDUCED){ shake = Math.max(0, shake - dt); camera.position.x += (Math.random() - .5) * shake * .05; camera.position.y += (Math.random() - .5) * shake * .05; }
  // fluorescent flicker
  flicker -= dt;
  let li = 1;
  if (flicker < 0){ flicker = 2 + Math.random() * 7; }
  if (flicker < .25 && !REDUCED) li = Math.random() < .5 ? .25 : 1;
  mainLight.intensity = 3.2 * li; tube.material.emissiveIntensity = 2.4 * li;
  // steam on the mirror and rising from the hot sink
  const st = S.steam ? 1 : 0;
  M.steam.opacity += (st * .92 - M.steam.opacity) * Math.min(1, dt * .45);
  if (waterGain) waterGain.gain.value += ((S.steam && !paused ? .05 : 0) - waterGain.gain.value) * Math.min(1, dt * 4);
  steamPuffs.forEach(s => { s.userData.t = (s.userData.t + dt * .25) % 1; const t = s.userData.t; s.position.set(-3.73 + Math.sin(t * 9 + s.id) * .05, .9 + t * 1.1, -.65 + Math.cos(t * 7 + s.id) * .08); s.scale.setScalar(.15 + t * .5); s.material.opacity = S.steam ? Math.sin(t * Math.PI) * .35 : Math.max(0, s.material.opacity - dt); });
  // the guard's silhouette in the window
  guardShow = Math.max(0, guardShow - dt);
  M.guard.opacity += ((guardShow > 0 || S.ending === 'B' ? .95 : 0) - M.guard.opacity) * Math.min(1, dt * 3);
  // the tile falls off the wall when pried
  if (tile.userData.fall !== undefined && tile.position.y > .01){
    tileVel += dt * 4; tile.position.y = Math.max(.01, tile.position.y - tileVel * dt); tile.position.z = Math.min(-2.75, tile.position.z + dt * .5);
    tile.rotation.x = Math.min(Math.PI / 2, tile.rotation.x + dt * 5);
    if (tile.position.y <= .01) tileVel = 0;
  }
  // the hatch opens and the camera climbs down
  if (hatchAnim >= 0){
    hatchAnim += dt;
    lidPivot.rotation.x = -Math.min(1.9, hatchAnim * 1.6);
    tunnelLight.intensity = Math.min(1.6, hatchAnim);
    if (hatchAnim > 1.3 && cam.t >= 1 && !endingShown && camTarget.pos.y > 0) goView('tunnel', 2.2);
    if (hatchAnim > 3.8 && !endingShown){ endingShown = true; showEnding(); }
  }
  if (doorFlash > 0){ doorFlash = Math.max(0, doorFlash - dt * .5); windowLight.intensity = .9 + doorFlash * 8; }
  // dripping tap
  if (ac && !paused && (dripIn -= dt) < 0){ dripIn = 2.5 + Math.random() * 5; tone(1200 + Math.random() * 500, .08, 'sine', .025, 500); }
  if ((sayTimer -= dt) <= 0) $('say').classList.remove('show');
  updateMarkers();
  renderer.render(scene, camera);
}

function resize(){
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------- Start ----------
// ### Restores a saved game if there is a valid one, then starts the loop.
if (saved && R.canContinue(saved)){
  S = saved; goView(S.scene, .01); syncWorld(); renderHud(); renderHotspots(); paused = true; showContinue();
} else { syncWorld(); renderHud(); renderHotspots(); showBrief(0); }
renderer.compile(scene, camera);
requestAnimationFrame(frame);
})();
