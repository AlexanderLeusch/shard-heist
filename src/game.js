// Shard Heist: the game (rendering, worlds, AI, sound, HUD, story mode). The rules it plays by live in src/core.js.
(() => {
'use strict';
if (typeof THREE === 'undefined' || typeof ShardCore === 'undefined'){
  if (window.ShardFatal) ShardFatal('The game could not load', 'The 3D engine did not arrive. Check your internet connection or turn off content blockers for this page, then reload.');
  return;
}
const Core = ShardCore;
// Every hex colour in this file is written in sRGB; convert to linear for the filmic pipeline
(() => { const setHex = THREE.Color.prototype.setHex; THREE.Color.prototype.setHex = function(hex){ setHex.call(this, hex); return this.convertSRGBToLinear(); }; })();

// ---------- Modes & vehicles ----------
// ### The tuning tables (MODES for the maps, VEH for the vehicles) and every game rule live in src/core.js, where the
// ### tests can reach them. Change a number there and the whole game, including the stat bars in the menu, follows it.
const { MODES, VEH, REV_SPEED, REPAIR_AMOUNT } = Core;
let mode = 'city', M = MODES.city, V = VEH.car;
const readStore = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const writeStore = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const sel = Core.parsePick(readStore('shard-heist-pick'));

const PITCH = 48, HALF_BLOCK = 17, LIMIT = 147;
const HW = { LEN: 4000, Z0: -150, Z1: 4500, our: [-3.4, -7.15, -10.9], opp: [3.4, 7.15, 10.9], rail: 15.6 };
const BAY = 3, FLOOR = 3.5, GROUND = 4.5, TU = BAY * 8, TV = FLOOR * 8;
const COARSE = matchMedia('(pointer: coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TEX = COARSE ? 512 : 2048;

const $ = id => document.getElementById(id);
const { clamp, wrapAngle, mulberry32, shuffle, fmtTime, fmtTimeExact } = Core;
const C = h => new THREE.Color(h);
const WHITE = C(0xffffff);

// ---------- Renderer & scene ----------
// ### Creates the WebGL renderer, the scene, the camera and the sky. The sky is a gradient shader on a big sphere; the same
// ### sphere is rendered once into a PMREM environment map so glass and car paint reflect the night sky.
// ### Lighting is a hemisphere light plus a cold moon with soft shadows that follows the player; it is night, like room 1.
// ### Colours are authored in sRGB and converted to linear (see the Color patch at the top) for ACES filmic tone mapping.
const canvas = $('game');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
catch (e){ ShardFatal('3D graphics are not available', 'This game needs WebGL. Turn on hardware acceleration in your browser settings, update your graphics driver or try another browser.'); return; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, COARSE ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
const ANISO = renderer.capabilities.getMaxAnisotropy();

const FOG = 0x1d2142;   // night haze, the same night as room 1 (about 02:30)
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG, 0.0031);
renderer.setClearColor(FOG);
const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 1000);

const skyMat = new THREE.ShaderMaterial({
  uniforms: { top: { value: C(0x03050f) }, mid: { value: C(0x111735) }, horizon: { value: C(0x463352) }, fogc: { value: C(FOG) } },
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 fogc; varying vec3 vP; void main(){ float t = vP.y; vec3 c = mix(horizon, mid, smoothstep(0.02, 0.22, t)); c = mix(c, top, smoothstep(0.22, 0.75, t)); c = mix(fogc, c, smoothstep(-0.03, 0.06, t)); gl_FragColor = linearToOutputTexel(vec4(c, 1.0)); }',
  side: THREE.BackSide, depthWrite: false, fog: false
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 24, 16), skyMat);
sky.renderOrder = -1;
scene.add(sky);

(() => {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat));
  scene.environment = pmrem.fromScene(envScene, 0.03).texture;
})();
function tuneEnv(root){
  root.traverse(o => {
    if (!o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if (m.isMeshStandardMaterial) m.envMapIntensity = m.userData.env !== undefined ? m.userData.env : 0.4;
    });
  });
}

scene.add(new THREE.HemisphereLight(0x6f7cc8, 0x1b1b28, 0.52));
// the "sun" is the moon: cold, weak, high; street lamps, windows and headlights do the rest
const sun = new THREE.DirectionalLight(0xaabfff, 0.42);
sun.castShadow = true;
sun.shadow.mapSize.set(COARSE ? 1024 : 2048, COARSE ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 320 });
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);
const SUN_OFF = [-90, 60, -40];

const glowTexture = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.22, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const aoTexture = (() => {
  const c = document.createElement('canvas'); c.width = 4; c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, 'rgba(0,0,0,.62)'); gr.addColorStop(0.45, 'rgba(0,0,0,.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
  return new THREE.CanvasTexture(c);
})();
const SPARK = C(0x55ecff), GOLD = C(0xffc857), GREEN = C(0x4ef0a0), SPARKS = C(0xffa04a);

// ---------- Geometry batching ----------
// ### Batch collects thousands of boxes and quads (walls, roofs, kerbs, road markings) into ONE mesh per material,
// ### so the GPU draws a whole city in a handful of draw calls. mergeGeos glues ready-made three.js geometries together.
class Batch {
  constructor(){ this.p = []; this.n = []; this.u = []; this.c = []; }
  push(p, n, u, v, col){ this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.u.push(u, v); this.c.push(col.r, col.g, col.b); }
  // corners a,b = bottom (left,right), c,d = top (right,left), seen from outside
  quadUV(a, b, c, d, n, uv, col, colB){
    const cb = colB || col;
    this.push(a, n, uv[0], uv[1], cb); this.push(b, n, uv[2], uv[3], cb); this.push(c, n, uv[4], uv[5], col);
    this.push(a, n, uv[0], uv[1], cb); this.push(c, n, uv[4], uv[5], col); this.push(d, n, uv[6], uv[7], col);
  }
  quad(a, b, c, d, n, r, col, colB){ this.quadUV(a, b, c, d, n, [r[0], r[1], r[2], r[1], r[2], r[3], r[0], r[3]], col, colB); }
  sides(x0, x1, y0, y1, z0, z1, col, tu, tv, uo, vo, colB){
    uo = uo || 0; vo = vo || 0;
    const su = l => tu ? l / tu : 0, sv = l => tv ? l / tv : 0, w = x1 - x0, d = z1 - z0, va = vo, vb = vo + sv(y1 - y0);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [uo, va, uo + su(w), vb], col, colB);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [uo + 0.375, va, uo + 0.375 + su(w), vb], col, colB);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [uo + 0.625, va, uo + 0.625 + su(d), vb], col, colB);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [uo + 0.125, va, uo + 0.125 + su(d), vb], col, colB);
  }
  top(x0, x1, y, z0, z1, col, uv){ this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], uv || [0, 0, 1, 1], col); }
  box(x0, x1, y0, y1, z0, z1, col){ this.sides(x0, x1, y0, y1, z0, z1, col); this.top(x0, x1, y1, z0, z1, col); }
  mesh(mat){
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return new THREE.Mesh(g, mat);
  }
}
function mergeGeos(list){
  const pos = [], nor = [], uvs = [];
  list.forEach(g => {
    const n = g.index ? g.toNonIndexed() : g;
    const p = n.attributes.position.array, q = n.attributes.normal.array, u = n.attributes.uv ? n.attributes.uv.array : null;
    for (let i = 0; i < p.length; i++){ pos.push(p[i]); nor.push(q[i]); }
    for (let i = 0; i < p.length / 3; i++) uvs.push(u ? u[i * 2] : 0, u ? u[i * 2 + 1] : 0);
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.computeBoundingSphere();
  return out;
}
const boxG = (w, h, d, x, y, z, rx) => { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(x, y, z); return g; };

// ---------- Vehicle geometry ----------
// ### Cars are built from a side silhouette (Shape) that is extruded across the car width, giving real wheel arches.
// ### shapeBody pulls the sides in towards the roof (tumblehome) and rounds the corners; smoothGeo welds vertices so the
// ### paint shades smoothly. makeCarParts/makeTruckParts return all parts (body, glass, lights, wheels) for traffic and police.
// ### Fleet draws many identical vehicles with InstancedMesh (one draw call per part); GlowPts draws their head/tail light glow.
// Side profile (z = length, y = height) extruded across the width, so cars get real silhouettes and wheel arches
function extrudeProfile(shape, width, bevel){
  const depth = width - bevel * 2;
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 12 });
  g.rotateY(-Math.PI / 2);
  g.translate(depth / 2, 0, 0);
  return g;
}
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// Pull the sides in towards the roof (tumblehome) and round the corners in plan view
function shapeBody(geo, o){
  const p = geo.attributes.position, zc = o.zc || 0;
  for (let i = 0; i < p.count; i++){
    const y = p.getY(i), zt = Math.min(1, Math.abs(p.getZ(i) - zc) / o.half);
    p.setX(i, p.getX(i) * (1 - o.tumble * sstep(o.belt, o.roof, y) - o.plan * Math.pow(zt, 4)));
  }
  p.needsUpdate = true;
  return geo;
}
// Weld shared corners so bodies shade smoothly and reflect like painted metal
function smoothGeo(geo){
  const g = geo.index ? geo.toNonIndexed() : geo, pos = g.attributes.position, uv = g.attributes.uv;
  const map = new Map(), verts = [], uvs = [], idx = [];
  for (let i = 0; i < pos.count; i++){
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
    let k = map.get(key);
    if (k === undefined){ k = verts.length / 3; map.set(key, k); verts.push(x, y, z); uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0); }
    idx.push(k);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}
function wheelSet(positions, r, w){
  const tires = [], rims = [];
  positions.forEach(([x, z]) => {
    const t = new THREE.CylinderGeometry(r, r, w, 18); t.rotateZ(Math.PI / 2); t.translate(x, r, z); tires.push(t);
    const rim = new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 10); rim.rotateZ(Math.PI / 2); rim.translate(x, r, z); rims.push(rim);
  });
  return { tire: mergeGeos(tires), rim: mergeGeos(rims) };
}
function makeCarParts(suv){
  const k = suv ? 1.16 : 1;
  const s = new THREE.Shape();
  s.moveTo(-2.22, 0.3);
  s.lineTo(-1.9, 0.3);
  s.absarc(-1.4, 0.37, 0.5, Math.PI, 0, true);
  s.lineTo(0.9, 0.3);
  s.absarc(1.4, 0.37, 0.5, Math.PI, 0, true);
  s.lineTo(2.2, 0.3);
  s.lineTo(2.27, 0.56 * k);
  s.lineTo(2.18, 0.8 * k);
  s.lineTo(1.72, 0.92 * k);
  s.lineTo(0.85, 1.0 * k);
  s.lineTo(-1.25, 1.02 * k);
  s.lineTo(suv ? -2.15 : -1.95, (suv ? 1.0 : 0.98) * k);
  s.lineTo(-2.26, 0.84 * k);
  s.lineTo(-2.3, 0.55);
  s.closePath();
  const top = suv ? 1.74 : 1.45;
  const body = smoothGeo(shapeBody(extrudeProfile(s, 1.86, 0.12), { half: 2.42, belt: 0.82 * k, roof: top, tumble: 0.1, plan: 0.14 }));
  const g = new THREE.Shape();
  g.moveTo(0.82, 0.98 * k); g.lineTo(suv ? 0.1 : 0.2, top - 0.03); g.lineTo(suv ? -1.95 : -0.85, top); g.lineTo(suv ? -2.12 : -1.55, 1.0 * k); g.closePath();
  const glass = smoothGeo(shapeBody(extrudeProfile(g, 1.62, 0.06), { half: 2.42, belt: 1.0 * k, roof: top, tumble: 0.24, plan: 0.1 }));
  const rf = new THREE.Shape();
  rf.moveTo(suv ? 0.05 : 0.15, top - 0.04); rf.lineTo(suv ? 0.02 : 0.12, top + 0.02); rf.lineTo(suv ? -1.92 : -0.86, top + 0.04); rf.lineTo(suv ? -1.96 : -0.9, top - 0.02); rf.closePath();
  const roof = smoothGeo(shapeBody(extrudeProfile(rf, 1.58, 0.04), { half: 2.42, belt: 1.0 * k, roof: top, tumble: 0.24, plan: 0.1 }));
  const wheels = wheelSet([[0.82, 1.4], [-0.82, 1.4], [0.82, -1.4], [-0.82, -1.4]], 0.37, 0.26);
  const trim = mergeGeos([
    boxG(1.86, 0.24, 0.2, 0, 0.42, 2.24), boxG(1.86, 0.24, 0.2, 0, 0.42, -2.26),
    boxG(1.0, 0.2, 0.05, 0, 0.62, 2.31),
    boxG(0.24, 0.12, 0.14, 0.98, 1.02 * k, 0.72), boxG(0.24, 0.12, 0.14, -0.98, 1.02 * k, 0.72),
    boxG(1.86, 0.08, 3.0, 0, 0.36, 0)
  ]);
  const beltX = 0.93 * (1 - 0.1 * sstep(0.82 * k, top, 1.0 * k));
  const chrome = mergeGeos([wheels.rim, boxG(0.52, 0.12, 0.03, 0, 0.44, 2.4), boxG(0.52, 0.12, 0.03, 0, 0.6, -2.45),
    boxG(0.025, 0.03, 2.2, beltX, 1.0 * k, -0.4), boxG(0.025, 0.03, 2.2, -beltX, 1.0 * k, -0.4),
    boxG(0.04, 0.035, 0.18, beltX + 0.01, 0.86 * k, 0.15), boxG(0.04, 0.035, 0.18, -beltX - 0.01, 0.86 * k, 0.15),
    boxG(0.04, 0.035, 0.18, beltX + 0.01, 0.86 * k, -0.85), boxG(0.04, 0.035, 0.18, -beltX - 0.01, 0.86 * k, -0.85)]);
  const head = mergeGeos([boxG(0.4, 0.09, 0.05, 0.6, 0.74 * k, 2.35), boxG(0.4, 0.09, 0.05, -0.6, 0.74 * k, 2.35)]);
  const tail = mergeGeos([boxG(0.5, 0.08, 0.05, 0.58, 0.84 * k, -2.4), boxG(0.5, 0.08, 0.05, -0.58, 0.84 * k, -2.4)]);
  const lens = mergeGeos([boxG(0.48, 0.16, 0.06, 0.6, 0.74 * k, 2.38), boxG(0.48, 0.16, 0.06, -0.6, 0.74 * k, 2.38), boxG(0.56, 0.15, 0.06, 0.58, 0.84 * k, -2.43), boxG(0.56, 0.15, 0.06, -0.58, 0.84 * k, -2.43)]);
  return { body: mergeGeos([body, roof]), glass, trim, chrome, tire: wheels.tire, head, tail, lens, bodyOnly: body, roof };
}
function makeTruckParts(){
  const s = new THREE.Shape();
  s.moveTo(1.6, 0.75); s.lineTo(4.2, 0.75); s.lineTo(4.32, 1.35); s.lineTo(4.2, 2.35); s.lineTo(3.55, 3.15); s.lineTo(1.65, 3.2); s.closePath();
  const cab = smoothGeo(shapeBody(extrudeProfile(s, 2.5, 0.12), { half: 1.4, zc: 2.95, belt: 1.4, roof: 3.3, tumble: 0.05, plan: 0.12 }));
  const ws = new THREE.Shape();
  ws.moveTo(4.22, 2.3); ws.lineTo(3.58, 3.08); ws.lineTo(3.5, 3.04); ws.lineTo(4.12, 2.26); ws.closePath();
  const glass = mergeGeos([extrudeProfile(ws, 2.3, 0.02), boxG(0.06, 0.8, 1.1, 1.27, 2.45, 2.85), boxG(0.06, 0.8, 1.1, -1.27, 2.45, 2.85)]);
  const cargo = boxG(2.62, 3.1, 6.6, 0, 2.3, -2.0);
  const wheels = wheelSet([[1.15, 3.1], [-1.15, 3.1], [1.15, -2.5], [-1.15, -2.5], [1.15, -3.9], [-1.15, -3.9]], 0.52, 0.42);
  const trim = mergeGeos([boxG(2.2, 0.45, 9.3, 0, 0.7, -0.25), boxG(2.56, 0.42, 0.3, 0, 0.66, 4.3), boxG(0.5, 0.45, 1.2, 1.1, 1.0, 1.0), boxG(2.4, 0.5, 1.0, 0, 3.4, 2.7), boxG(2.66, 0.12, 6.64, 0, 0.78, -2.0)]);
  const chrome = mergeGeos([wheels.rim, boxG(1.4, 0.5, 0.04, 0, 1.45, 4.36)]);
  const head = mergeGeos([boxG(0.42, 0.22, 0.06, 0.9, 1.05, 4.33), boxG(0.42, 0.22, 0.06, -0.9, 1.05, 4.33)]);
  const tail = mergeGeos([boxG(0.3, 0.2, 0.06, 1.05, 1.05, -5.33), boxG(0.3, 0.2, 0.06, -1.05, 1.05, -5.33)]);
  return { body: cab, glass, cargo, trim, chrome, tire: wheels.tire, head, tail };
}
// The yellow Lisbon tram: lit windows between white pillars, a yellow body and a trolley pole on the roof
function makeTramParts(){
  const pillars = [];
  for (let z = -3.6; z <= 3.61; z += 1.2) pillars.push(boxG(2.26, 1.2, 0.16, 0, 2.25, z));
  const wheels = wheelSet([[0.85, 1.5], [-0.85, 1.5], [0.85, -1.5], [-0.85, -1.5]], 0.38, 0.2);
  return {
    body: mergeGeos([boxG(2.2, 1.0, 8.4, 0, 1.15, 0), boxG(2.1, 0.16, 7.8, 0, 3.12, 0), boxG(2.24, 1.25, 0.12, 0, 2.25, 4.14), boxG(2.24, 1.25, 0.12, 0, 2.25, -4.14)]),
    cargo: mergeGeos([boxG(2.24, 0.14, 8.4, 0, 1.6, 0), boxG(2.24, 0.26, 8.2, 0, 2.92, 0), ...pillars]),
    lit: mergeGeos([boxG(2.16, 1.2, 8.1, 0, 2.25, 0), boxG(1.3, 0.72, 0.04, 0, 2.32, 4.21), boxG(1.3, 0.72, 0.04, 0, 2.32, -4.21)]),
    trim: mergeGeos([boxG(1.9, 0.35, 7, 0, 0.5, 0), boxG(2.0, 0.2, 0.2, 0, 0.75, 4.25), boxG(2.0, 0.2, 0.2, 0, 0.75, -4.25), boxG(0.06, 0.06, 3.2, 0, 3.9, -0.9, -0.5)]),
    chrome: wheels.rim, tire: wheels.tire,
    head: boxG(0.34, 0.34, 0.06, 0, 1.3, 4.23),
    tail: mergeGeos([boxG(0.3, 0.16, 0.06, 0.7, 1.3, -4.23), boxG(0.3, 0.16, 0.06, -0.7, 1.3, -4.23)])
  };
}
const PARTS = { sedan: makeCarParts(false), suv: makeCarParts(true), truck: makeTruckParts(), tram: makeTramParts() };
const SHARED = {
  glass: (() => { const m = new THREE.MeshStandardMaterial({ color: 0x1c2533, roughness: 0.08, metalness: 0.85 }); m.userData.env = 1.3; return m; })(),
  trim: new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 0.75 }),
  chrome: (() => { const m = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.25, metalness: 0.9 }); m.userData.env = 1.1; return m; })(),
  tire: new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.92 }),
  head: new THREE.MeshBasicMaterial({ color: 0xfff4d6 }),
  tail: new THREE.MeshBasicMaterial({ color: 0xff2a3a }),
  cargo: new THREE.MeshStandardMaterial({ color: 0xe6e8ee, roughness: 0.55, metalness: 0.15 }),
  lit: new THREE.MeshBasicMaterial({ color: 0xe8bd78 }),
  lens: (() => { const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.28, clearcoat: 1, depthWrite: false }); m.userData.env = 1.4; return m; })(),
  paint: (() => { const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.07 }); m.userData.env = 1.0; return m; })()
};
const CAR_COLS = [0xe8e8ec, 0x2b2f3a, 0x9c2d3a, 0x2f5d8c, 0xc9a24a, 0x5b6b5e, 0x7d8494, 0x1d1f26, 0xd06030, 0xb8c4cf, 0x6e2340, 0x2f6b6a];

// Instanced fleet of identical vehicles; each part one InstancedMesh
class Fleet {
  constructor(group, parts, n, rnd, color){
    this.meshes = [];
    for (const k of ['body', 'glass', 'cargo', 'lit', 'trim', 'chrome', 'tire', 'head', 'tail', 'lens']){
      if (!parts[k]) continue;
      const m = new THREE.InstancedMesh(parts[k], k === 'body' ? SHARED.paint : SHARED[k], n);
      m.frustumCulled = false;
      m.castShadow = k === 'body' || k === 'cargo' || k === 'glass';
      m.receiveShadow = k === 'body' || k === 'cargo';
      if (k === 'body') for (let i = 0; i < n; i++) m.setColorAt(i, tint.set(color || CAR_COLS[Math.floor((rnd ? rnd() : Math.random()) * CAR_COLS.length)]));
      group.add(m); this.meshes.push(m);
    }
  }
  set(i, x, y, z, h, on){
    dummy.position.set(x, y, z); dummy.rotation.set(0, h, 0); dummy.scale.setScalar(on ? 1 : 0.0001); dummy.updateMatrix();
    for (const m of this.meshes) m.setMatrixAt(i, dummy.matrix);
  }
  commit(){ for (const m of this.meshes) m.instanceMatrix.needsUpdate = true; }
}
class GlowPts {
  constructor(group, n, color, size){
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(-999), 3));
    this.p = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTexture, color, size, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.p.frustumCulled = false; group.add(this.p); this.a = g.attributes.position;
  }
  set(i, x, y, z){ this.a.setXYZ(i, x, y, z); }
  commit(){ this.a.needsUpdate = true; }
}
// head/tail glow for a vehicle at heading h
function vehicleGlow(head, tail, i, x, z, h, front, back, y, off, on){
  const fx = Math.sin(h), fz = Math.cos(h), rx = -fz, rz = fx, Y = on ? y : -999;
  head.set(i * 2, x + fx * front + rx * off, Y, z + fz * front + rz * off); head.set(i * 2 + 1, x + fx * front - rx * off, Y, z + fz * front - rz * off);
  tail.set(i * 2, x - fx * back + rx * off, Y, z - fz * back + rz * off); tail.set(i * 2 + 1, x - fx * back - rx * off, Y, z - fz * back - rz * off);
}

// ---------- Facade textures ----------
// ### All building textures are painted at start-up on <canvas> - no image files are downloaded. makeFacade draws brick,
// ### office and glass-tower facades with lit or dark windows, curtains and blinds; a second canvas holds the light that the
// ### windows emit (emissive map). baixaFronts paints the Pombaline fronts of Lisbon (see below). makeShops draws the arched
// ### stone ground floors with painted shop signs, makeArcade the arcades of the Praca do Comercio.
const LIT_WARM = ['#ffd9a0', '#ffe6c4', '#ffc985', '#ffdfb0'];
const LIT_COOL = ['#d8ecff', '#eaf4ff', '#cfe3ff'];
const CURTAIN = ['rgba(150,60,60,.85)', 'rgba(70,90,140,.85)', 'rgba(200,170,120,.88)', 'rgba(90,110,80,.85)'];
function canvasPair(w, h){
  const m = document.createElement('canvas'); m.width = w; m.height = h;
  const e = document.createElement('canvas'); e.width = w; e.height = h;
  const ge = e.getContext('2d'); ge.fillStyle = '#000'; ge.fillRect(0, 0, w, h);
  return [m, m.getContext('2d'), e, ge];
}
function toTex(m, e){
  const out = { map: new THREE.CanvasTexture(m), emissive: new THREE.CanvasTexture(e) };
  [out.map, out.emissive].forEach(t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANISO; t.encoding = THREE.sRGBEncoding; });
  return out;
}
function speckle(g, w, h, r, n){
  for (let k = 0; k < n; k++){
    const v = r() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},.04)`;
    g.fillRect(r() * w, r() * h, 2 + r() * 5, 1 + r() * 2);
  }
}
function paneUnlit(g, x, y, w, h){
  const gr = g.createLinearGradient(x, y, x, y + h);
  gr.addColorStop(0, '#5b6a8e'); gr.addColorStop(0.5, '#2a3450'); gr.addColorStop(1, '#151b2c');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = 'rgba(255,255,255,.07)';
  g.beginPath(); g.moveTo(x + w * 0.25, y); g.lineTo(x + w * 0.55, y); g.lineTo(x + w * 0.15, y + h); g.lineTo(x - w * 0.15, y + h); g.closePath(); g.fill();
  g.restore();
}
function paneLit(g, ge, x, y, w, h, r, cool, ceiling){
  const pal = cool ? LIT_COOL : LIT_WARM, col = pal[Math.floor(r() * pal.length)];
  g.fillStyle = col; g.fillRect(x, y, w, h);
  const sh = g.createLinearGradient(x, y, x, y + h);
  sh.addColorStop(0, 'rgba(255,255,255,.15)'); sh.addColorStop(1, 'rgba(70,35,10,.38)');
  g.fillStyle = sh; g.fillRect(x, y, w, h);
  if (r() < 0.4){ g.fillStyle = 'rgba(45,28,22,.38)'; g.fillRect(x + w * (0.08 + r() * 0.5), y + h * 0.5, w * (0.18 + r() * 0.2), h * 0.5); }
  let cut = 0;
  if (!ceiling && r() < 0.3){
    cut = h * (0.2 + r() * 0.5);
    g.fillStyle = 'rgba(236,226,206,.94)'; g.fillRect(x, y, w, cut);
    g.fillStyle = 'rgba(0,0,0,.1)'; for (let k = y + 3; k < y + cut; k += 4) g.fillRect(x, k, w, 1);
  }
  if (!ceiling && r() < 0.25){ g.fillStyle = CURTAIN[Math.floor(r() * CURTAIN.length)]; g.fillRect(x, y, w * 0.17, h); g.fillRect(x + w * 0.83, y, w * 0.17, h); }
  ge.globalAlpha = 0.55 + r() * 0.45; ge.fillStyle = col; ge.fillRect(x, y + cut, w, h - cut);
  if (cut){ ge.globalAlpha = 0.22; ge.fillRect(x, y, w, cut); }
  if (ceiling){
    const lh = Math.max(2, h * 0.04);
    g.fillStyle = '#ffffff'; g.fillRect(x, y + h * 0.05, w, lh);
    ge.globalAlpha = 1; ge.fillStyle = '#ffffff'; ge.fillRect(x, y + h * 0.05, w, lh);
  }
  ge.globalAlpha = 1;
}
// ### A Pombaline front is plain and has a fixed order of floors: the first floor has the tallest windows and the balconies,
// ### the floors above get smaller, the top floor has plain windows with a sill. So the texture has one row per kind of floor
// ### (top of the texture first) and the builder picks the right row for each floor. Rows: 0-2 plain window, 3-5 tall window
// ### with a small balcony, 6 first floor with a balcony per window, 7 first floor with one long balcony.
const FRONT_ROWS = { sill: [0, 1, 2], sacada: [3, 4, 5], nobre: [6, 7] };
const LIOZ = '#e7e1d2';
// Windows and stonework; the same seed on every wall, so all fronts can share one light map and one tint mask
function baixaWindows(g, ge, mask, S){
  const r = mulberry32(61), n = 8, B = S / n, f = B * 0.038;
  const stone = (x, y, w, h) => { g.fillStyle = LIOZ; g.fillRect(x, y, w, h); if (mask){ mask.fillStyle = '#000'; mask.fillRect(x, y, w, h); } };
  for (let j = 0; j < n; j++){
    const kind = j < 3 ? 'sill' : j < 6 ? 'sacada' : 'nobre', y = j * B;
    const litShare = r() < 0.3 ? 0.28 : 0.07; // it is 02:30: most people are asleep
    const wh = (kind === 'sill' ? 0.5 : kind === 'sacada' ? 0.66 : 0.72) * B, wy = y + (kind === 'sill' ? 0.2 : kind === 'sacada' ? 0.12 : 0.1) * B, ww = B * 0.4;
    for (let i = 0; i < n; i++){
      const wx = i * B + (B - ww) / 2, lit = r() < litShare, shut = r() < 0.3, warm = LIT_WARM[Math.floor(r() * 4)], curtain = r() < 0.5;
      // weather stains under the opening, on the plaster
      const st = g.createLinearGradient(0, wy + wh, 0, wy + wh + B * 0.2);
      st.addColorStop(0, 'rgba(50,42,34,.16)'); st.addColorStop(1, 'rgba(50,42,34,0)');
      g.fillStyle = st; g.fillRect(wx, wy + wh, ww, B * 0.2);
      // the stone frame, with a heavier lintel on the first floor
      stone(wx - f, wy - f, ww + 2 * f, wh + 2 * f);
      if (kind === 'nobre'){ stone(wx - f * 2.2, wy - f * 2.4, ww + f * 4.4, f * 1.4); g.fillStyle = 'rgba(30,25,20,.35)'; g.fillRect(wx - f * 2.2, wy - f, ww + f * 4.4, f * 0.35); }
      // the glass: warm and dim when someone is awake, else dark, sometimes with the inner shutters closed
      if (lit){
        const gl = g.createLinearGradient(0, wy, 0, wy + wh); gl.addColorStop(0, '#f0c98c'); gl.addColorStop(1, '#a8703c');
        g.fillStyle = gl; g.fillRect(wx, wy, ww, wh);
        if (curtain){ g.fillStyle = 'rgba(240,226,200,.5)'; g.fillRect(wx, wy, ww * 0.26, wh); g.fillRect(wx + ww * 0.74, wy, ww * 0.26, wh); }
        if (ge){ ge.globalAlpha = 0.5; ge.fillStyle = warm; ge.fillRect(wx, wy, ww, wh); ge.globalAlpha = 1; }
      } else if (shut){
        g.fillStyle = '#6d6556'; g.fillRect(wx, wy, ww, wh);
        g.fillStyle = 'rgba(0,0,0,.25)'; for (let k = 1; k < 4; k++) g.fillRect(wx, wy + wh * k / 4, ww, Math.max(1, f * 0.2));
      } else paneUnlit(g, wx, wy, ww, wh);
      // white wooden sash with small panes
      const bar = Math.max(1, f * 0.3), panes = kind === 'sill' ? 3 : 4;
      for (const c of ge ? [g, ge] : [g]){
        c.fillStyle = c === g ? '#ece6d8' : '#000';
        c.fillRect(wx + ww / 2 - bar, wy, bar * 2, wh);
        for (let k = 1; k < panes; k++) c.fillRect(wx, wy + wh * k / panes, ww, bar);
      }
      // sill, or a stone slab with an iron railing
      if (kind === 'sill'){ stone(wx - f * 1.5, wy + wh, ww + f * 3, f * 1.1); continue; }
      if (j === 7) continue;
      stone(wx - f * 2.4, wy + wh, ww + f * 4.8, f * 0.9);
      const top = wy + wh * 0.68, bw = Math.max(1, f * 0.22), x0 = wx - f * 2, W = ww + f * 4;
      for (const c of ge ? [g, ge] : [g]){
        c.fillStyle = c === g ? '#191a1e' : '#000';
        c.fillRect(x0, top, W, bw * 1.6);
        for (let k = 0; k <= 8; k++) c.fillRect(x0 + k * (W - bw) / 8, top, bw, wy + wh - top);
      }
    }
    if (j === 7){ // the long balcony runs across the whole front
      const by = wy + wh, top = wy + wh * 0.68, bw = Math.max(1, f * 0.22);
      stone(0, by, S, f * 0.9);
      for (const c of ge ? [g, ge] : [g]){
        c.fillStyle = c === g ? '#191a1e' : '#000';
        c.fillRect(0, top, S, bw * 1.6);
        for (let k = 0; k < n * 11; k++) c.fillRect(k * B / 11, top, bw, by - top);
      }
    }
    // a thin stone course between the floors
    stone(0, y + B - f * 0.5, S, f * 0.5);
  }
}
function baixaWall(g, S, r){
  const n = 90;
  for (let k = 0; k < n; k++){ // old lime plaster is never one even colour
    const x = r() * S, y = r() * S, R = S * (0.03 + r() * 0.08), a = g.createRadialGradient(x, y, 0, x, y, R), dark = r() < 0.6;
    a.addColorStop(0, dark ? 'rgba(60,50,40,.05)' : 'rgba(255,255,255,.06)'); a.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = a; g.fillRect(x - R, y - R, R * 2, R * 2);
  }
  speckle(g, S, S, r, S * 2);
}
// 19th-century facade tiles: a small four-tile pattern, glazed, so the whole wall shines a little
function tilePattern(g, t, ink, ink2){
  const c = document.createElement('canvas'); c.width = c.height = Math.max(4, Math.round(t * 2));
  const p = c.getContext('2d'), w = c.width, h = w / 2;
  p.fillStyle = '#f4f2ea'; p.fillRect(0, 0, w, w);
  p.fillStyle = ink;
  for (const [x, y] of [[0, 0], [w, 0], [0, w], [w, w]]){ p.beginPath(); p.arc(x, y, h * 0.72, 0, Math.PI * 2); p.fill(); }
  p.fillStyle = '#f4f2ea';
  for (const [x, y] of [[0, 0], [w, 0], [0, w], [w, w]]){ p.beginPath(); p.arc(x, y, h * 0.38, 0, Math.PI * 2); p.fill(); }
  p.fillStyle = ink2;
  p.beginPath(); p.moveTo(h, h * 0.45); p.lineTo(h * 1.55, h); p.lineTo(h, h * 1.55); p.lineTo(h * 0.45, h); p.closePath(); p.fill();
  p.fillStyle = 'rgba(80,80,90,.28)'; p.fillRect(0, 0, w, Math.max(1, w * 0.012)); p.fillRect(0, h, w, Math.max(1, w * 0.012)); p.fillRect(0, 0, Math.max(1, w * 0.012), w); p.fillRect(h, 0, Math.max(1, w * 0.012), w);
  g.fillStyle = g.createPattern(c, 'repeat'); g.fillRect(0, 0, g.canvas.width, g.canvas.height);
}
function baixaFronts(){
  const S = TEX, B = S / 8;
  const [m0, g0, e, ge] = canvasPair(S, S);
  const maskC = document.createElement('canvas'); maskC.width = maskC.height = S / 2;
  const mg = maskC.getContext('2d'); mg.scale(0.5, 0.5); mg.fillStyle = '#fff'; mg.fillRect(0, 0, S, S);
  g0.fillStyle = '#f6f2e8'; g0.fillRect(0, 0, S, S);
  baixaWall(g0, S, mulberry32(3));
  baixaWindows(g0, ge, mg, S);
  const tiled = (ink, ink2) => {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    tilePattern(g, B / 14, ink, ink2);
    baixaWindows(g, null, null, S);
    return c;
  };
  const plaster = toTex(m0, e), blue = toTex(tiled('#2a5a9c', '#c98f2e'), e), green = toTex(tiled('#2f7a5a', '#2a5a9c'), e);
  const mask = new THREE.CanvasTexture(maskC); mask.wrapS = mask.wrapT = THREE.RepeatWrapping;
  return { plaster, blue, green, mask };
}
function makeFacade(style, seed){
  const S = TEX, n = 8, B = S / n, r = mulberry32(seed);
  const [m, g, e, ge] = canvasPair(S, S);
  if (style === 'brick'){
    g.fillStyle = '#ece6de'; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(80,50,40,.08)';
    const course = S / 128;
    for (let y = 0; y < S; y += course * 2) g.fillRect(0, y, S, Math.max(1, course * 0.35));
    speckle(g, S, S, r, S * 3);
    for (let j = 0; j < n; j++){
      const floorLit = r() < 0.5 ? 0.18 : 0.5;
      for (let i = 0; i < n; i++){
        const x = i * B, y = j * B, f = B * 0.035;
        const wx = x + B * 0.25, wy = y + B * 0.2, ww = B * 0.5, wh = B * 0.58;
        g.fillStyle = 'rgba(40,25,20,.2)'; g.fillRect(wx - f * 1.5, wy - f * 2.2, ww + f * 3, f * 2.2);
        g.fillStyle = 'rgba(255,255,255,.72)'; g.fillRect(wx - f * 1.5, wy + wh, ww + f * 3, f * 1.4);
        g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(wx - f, wy + wh + f * 1.4, ww + f * 2, f);
        g.fillStyle = '#f2efe9'; g.fillRect(wx, wy, ww, wh);
        const px = wx + f, py = wy + f, pw = ww - 2 * f, ph = wh - 2 * f;
        if (r() < floorLit) paneLit(g, ge, px, py, pw, ph, r, r() < 0.15, false); else paneUnlit(g, px, py, pw, ph);
        g.fillStyle = '#f2efe9'; g.fillRect(px + pw / 2 - f / 2, py, f, ph); g.fillRect(px, py + ph * 0.32, pw, f * 0.8);
        const sh = g.createLinearGradient(0, py, 0, py + ph * 0.25);
        sh.addColorStop(0, 'rgba(0,0,0,.35)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = sh; g.fillRect(px, py, pw, ph * 0.25);
      }
    }
  } else if (style === 'office'){
    g.fillStyle = '#d9dbe0'; g.fillRect(0, 0, S, S);
    speckle(g, S, S, r, S * 2);
    for (let j = 0; j < n; j++){
      const y = j * B, by = y + B * 0.18, bh = B * 0.62;
      const floorLit = r() < 0.35 ? 0.85 : 0.12;
      for (let i = 0; i < n; i++){
        const px = i * B + B * 0.03, pw = B * 0.94;
        if (r() < floorLit) paneLit(g, ge, px, by, pw, bh, r, r() < 0.65, r() < 0.5); else paneUnlit(g, px, by, pw, bh);
        g.fillStyle = '#8e96a3'; g.fillRect(i * B, by, B * 0.03, bh);
      }
      g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, by, S, B * 0.035);
      g.fillStyle = 'rgba(255,255,255,.4)'; g.fillRect(0, by + bh, S, B * 0.025);
    }
  } else {
    g.fillStyle = '#1c2436'; g.fillRect(0, 0, S, S);
    for (let j = 0; j < n; j++){
      const y = j * B, vh = B * 0.78;
      const floorLit = r() < 0.3 ? 0.8 : 0.1;
      for (let i = 0; i < n; i++){
        if (r() < floorLit) paneLit(g, ge, i * B, y, B, vh, r, r() < 0.8, true); else paneUnlit(g, i * B, y, B, vh);
      }
      g.fillStyle = '#2b3448'; g.fillRect(0, y + vh, S, B - vh);
      g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, y + vh, S, 2);
    }
    g.fillStyle = 'rgba(190,200,220,.55)';
    for (let i = 0; i < n; i++) g.fillRect(i * B, 0, Math.max(2, B * 0.02), S);
    for (let j = 0; j < n; j++) g.fillRect(0, j * B + B * 0.78, S, Math.max(2, B * 0.015));
  }
  return toTex(m, e);
}
// The arched ground floor of a Baixa house: limestone, old shop fronts of dark wood, a painted sign, most of it shut at night.
function makeShops(seed){
  const W = TEX, H = TEX / 4, n = 8, B = W / n, r = mulberry32(seed);
  const [m, g, e, ge] = canvasPair(W, H);
  const TRADES = ['Retrosaria', 'Pastelaria', 'Farmácia', 'Ourivesaria', 'Café', 'Livraria', 'Chapelaria', 'Luvaria', 'Conservas', 'Tasca', 'Ginjinha', 'Sapataria', 'Relojoaria', 'Papelaria', 'Tabacaria', 'Mercearia'];
  const WOOD = ['#2c3a2e', '#3a2a20', '#25324a', '#4a2224', '#2b2b2b'];
  g.fillStyle = '#d4cdbc'; g.fillRect(0, 0, W, H);
  speckle(g, W, H, r, W);
  g.fillStyle = 'rgba(60,52,44,.22)';
  for (let y = H / 7; y < H; y += H / 7) g.fillRect(0, y, W, Math.max(1, H * 0.006));
  for (let i = 0; i < n; i++){
    const x = i * B + B * 0.09, w = B * 0.82, top = H * 0.1, rad = w / 2, wood = WOOD[Math.floor(r() * WOOD.length)], word = TRADES[Math.floor(r() * TRADES.length)];
    const open = r() < 0.3, door = r() < 0.5;
    const arch = c => { c.beginPath(); c.moveTo(x, H); c.lineTo(x, top + rad * 0.55); c.quadraticCurveTo(x, top, x + rad, top); c.quadraticCurveTo(x + w, top, x + w, top + rad * 0.55); c.lineTo(x + w, H); c.closePath(); };
    g.fillStyle = '#efe9da'; g.save(); g.translate(x + rad, H); g.scale(1.09, 1.03); g.translate(-x - rad, -H); arch(g); g.fill(); g.restore();
    g.fillStyle = wood; arch(g); g.fill();
    // the sign board inside the arch, painted by hand
    const sy = top + H * 0.2, sh = H * 0.12;
    g.fillStyle = '#17171a'; g.fillRect(x + w * 0.06, sy, w * 0.88, sh);
    g.fillStyle = '#d9b667'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = sh * 0.6; g.font = '600 ' + fs + 'px Georgia, serif';
    const tw = g.measureText(word).width; if (tw > w * 0.8){ fs *= w * 0.8 / tw; g.font = '600 ' + fs + 'px Georgia, serif'; }
    g.fillText(word, x + rad, sy + sh * 0.54);
    const gy = sy + sh + H * 0.03, gh = H - gy - H * 0.1, gw = door ? w * 0.56 : w * 0.82, gx = x + w * 0.09;
    if (open){
      const gl = g.createLinearGradient(0, gy, 0, gy + gh); gl.addColorStop(0, '#f2cf96'); gl.addColorStop(1, '#a9743f');
      g.fillStyle = gl; g.fillRect(gx, gy, gw, gh);
      g.fillStyle = 'rgba(40,28,20,.55)';
      for (let k = 0; k < 2; k++) g.fillRect(gx, gy + gh * (0.42 + k * 0.42), gw, Math.max(1, gh * 0.04));
      for (let k = 0; k < 7; k++) g.fillRect(gx + r() * gw * 0.88, gy + gh * (0.2 + 0.42 * Math.floor(r() * 2)), gw * 0.07, gh * 0.2);
      ge.globalAlpha = 0.55; ge.fillStyle = '#ffcf8e'; ge.fillRect(gx, gy, gw, gh); ge.globalAlpha = 1;
    } else {
      // a rolled-down steel shutter
      g.fillStyle = '#3d3f43'; g.fillRect(gx, gy, gw, gh);
      g.fillStyle = 'rgba(0,0,0,.3)'; for (let k = 0; k < 14; k++) g.fillRect(gx, gy + gh * k / 14, gw, Math.max(1, gh * 0.012));
    }
    g.strokeStyle = '#121214'; g.lineWidth = Math.max(1, B * 0.012); g.strokeRect(gx, gy, gw, gh);
    if (door){ g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(gx + gw + w * 0.04, gy, w * 0.2, H - gy); }
    g.fillStyle = '#b9b1a0'; g.fillRect(x, H - H * 0.1, w, H * 0.1);
  }
  return toTex(m, e);
}
// The arcades of the Praca do Comercio: yellow piers, stone arches, dark walkways with a few lamps
function makeArcade(){
  const W = TEX, H = TEX / 4, n = 6, A = W / n;
  const [m, g, e, ge] = canvasPair(W, H);
  g.fillStyle = '#dbbe39'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < n; i++){
    const x = i * A + A * 0.13, w = A * 0.74, rad = w / 2, top = H * 0.08, spring = top + rad * (H / A) * 0.9;
    const arch = c => { c.beginPath(); c.moveTo(x, H); c.lineTo(x, spring); c.quadraticCurveTo(x, top, x + rad, top); c.quadraticCurveTo(x + w, top, x + w, spring); c.lineTo(x + w, H); c.closePath(); };
    g.fillStyle = LIOZ; g.save(); g.translate(x + rad, H); g.scale(1.1, 1.05); g.translate(-x - rad, -H); arch(g); g.fill(); g.restore();
    const d = g.createLinearGradient(0, top, 0, H); d.addColorStop(0, '#1a1712'); d.addColorStop(0.5, '#2c251a'); d.addColorStop(1, '#14120e');
    g.fillStyle = d; arch(g); g.fill();
    const ly = spring + H * 0.06, lg = g.createRadialGradient(x + rad, ly, 0, x + rad, ly, w * 0.5);
    lg.addColorStop(0, 'rgba(255,205,140,.8)'); lg.addColorStop(1, 'rgba(255,205,140,0)');
    g.save(); arch(g); g.clip(); g.fillStyle = lg; g.fillRect(x, top, w, H - top); g.restore();
    const le = ge.createRadialGradient(x + rad, ly, 0, x + rad, ly, w * 0.3);
    le.addColorStop(0, 'rgba(255,205,140,.7)'); le.addColorStop(1, 'rgba(255,205,140,0)');
    ge.fillStyle = le; ge.fillRect(x, top, w, H - top);
  }
  return toTex(m, e);
}
const FRONTS = baixaFronts();
const FAC = { brick: makeFacade('brick', 11), office: makeFacade('office', 17), glass: makeFacade('glass', 23), shop: makeShops(31), arcade: makeArcade() };
const facMat = (f, o) => new THREE.MeshStandardMaterial(Object.assign({ map: f.map, emissiveMap: f.emissive, emissive: 0xffffff, emissiveIntensity: 1.1, vertexColors: true }, o));
// Paints only the plaster in the house colour: the mask keeps the limestone frames, the iron and the glass as they are
function frontMat(f, o){
  const m = facMat(f, o);
  m.onBeforeCompile = sh => {
    sh.uniforms.tintMask = { value: FRONTS.mask };
    sh.fragmentShader = 'uniform sampler2D tintMask;\n' + sh.fragmentShader.replace('#include <color_fragment>', 'diffuseColor.rgb *= mix(vec3(1.0), vColor, texture2D(tintMask, vUv).r);');
  };
  return m;
}
const MAT = {
  brick: facMat(FAC.brick, { roughness: 0.88 }),
  office: facMat(FAC.office, { roughness: 0.62, metalness: 0.1 }),
  glass: facMat(FAC.glass, { roughness: 0.12, metalness: 0.7 }),
  pombal: frontMat(FRONTS.plaster, { roughness: 0.92, emissiveIntensity: 0.85 }),
  tileB: frontMat(FRONTS.blue, { roughness: 0.3, metalness: 0.05, emissiveIntensity: 0.85 }),
  tileG: frontMat(FRONTS.green, { roughness: 0.3, metalness: 0.05, emissiveIntensity: 0.85 }),
  shop: facMat(FAC.shop, { roughness: 0.75, emissiveIntensity: 0.8 }),
  arcade: facMat(FAC.arcade, { roughness: 0.85, emissiveIntensity: 0.8 })
};
MAT.glass.userData.env = 1.3;
MAT.tileB.userData.env = 1.0; MAT.tileG.userData.env = 1.0;
const PAL = {
  brick: [0xc98f7a, 0xd9c3a5, 0xe6dccd, 0xb07a63, 0xa9b0bb, 0xd6b48f, 0x9c6b5c],
  office: [0xd0d3d9, 0xc2c6cc, 0xb9b2a6, 0xdcd8cf, 0xa9adb6],
  glass: [0x9fb4d4, 0x8fa8c0, 0xa9c3c9, 0x8f98b8, 0xb5c2d6],
  // muted lime washes: ochre, sand, rose, salmon, grey-blue, sage and off-white
  pombal: [0xd9b45f, 0xe2c88d, 0xe3b9a8, 0xd99f8c, 0xb4c4c9, 0xa8bfa6, 0xf0e9da, 0xc98f62, 0xe8dcc0, 0xf2eee4],
  tileB: [0xffffff, 0xf4f0e6],
  tileG: [0xffffff, 0xf4f0e6]
};

// ---------- Procedural surfaces: wet asphalt, calçada, grass ----------
// ### surfaceSet generates tileable colour, roughness and normal maps from noise: wet asphalt with puddles (low roughness),
// ### calçada cobbles, grass and a neutral detail texture. Cones and beams are fake volumetric light under lamps
// ### and in front of headlights (additive, no real lighting cost).
function tileNoise(n, r){ const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = r(); return a; }
function sampleTile(L, n, u, v){
  const fx = u * n, fy = v * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const i0 = ((ix % n) + n) % n, j0 = ((iy % n) + n) % n, i1 = (i0 + 1) % n, j1 = (j0 + 1) % n;
  const a = L[j0 * n + i0], b = L[j0 * n + i1], c = L[j1 * n + i0], d = L[j1 * n + i1];
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
// Tileable albedo, roughness and normal maps from one height field
function surfaceSet(S, seed, colorFn, roughFn, bump){
  const r = mulberry32(seed), L1 = tileNoise(6, r), L2 = tileNoise(24, r), L3 = tileNoise(96, r);
  const h = new Float32Array(S * S), patch = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
    const u = x / S, v = y / S, i = y * S + x;
    patch[i] = sampleTile(L1, 6, u, v) * 0.65 + sampleTile(L2, 24, u, v) * 0.35;
    h[i] = sampleTile(L3, 96, u, v) * 0.5 + r() * 0.5;
  }
  const mk = fn => {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
    for (let i = 0; i < S * S; i++){ const px = fn(i); d[i * 4] = px[0]; d[i * 4 + 1] = px[1]; d[i * 4 + 2] = px[2]; d[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANISO; return t;
  };
  const map = mk(i => colorFn(h[i], patch[i])); map.encoding = THREE.sRGBEncoding;
  const rough = mk(i => { const v = roughFn(h[i], patch[i]) * 255; return [v, v, v]; });
  const normal = mk(i => {
    const x = i % S, y = (i - x) / S;
    const l = h[y * S + (x + S - 1) % S], rr = h[y * S + (x + 1) % S], t = h[((y + S - 1) % S) * S + x], b = h[((y + 1) % S) * S + x];
    const nx = (l - rr) * bump, ny = (t - b) * bump, len = Math.hypot(nx, ny, 1);
    return [(nx / len * 0.5 + 0.5) * 255, (ny / len * 0.5 + 0.5) * 255, (1 / len * 0.5 + 0.5) * 255];
  });
  return { map, rough, normal };
}
const ASPHALT = surfaceSet(COARSE ? 256 : 1024, 41,
  (h, p) => { const k = 54 + h * 34 - (p < 0.34 ? 12 : 0) + (h > 0.97 ? 40 : 0); return [k, k, k + 5]; },
  (h, p) => p < 0.34 ? 0.06 + (0.34 - p) * 0.15 : 0.6 + h * 0.32, 2.4);
// Calçada: the small limestone cobbles of Lisbon's pavements, and the black waves of the Rossio on top of them
function cobbleJoints(set){
  const c = set.map.image, g = c.getContext('2d'), r = mulberry32(5), n = 16, s = c.width / n;
  g.fillStyle = 'rgba(58,52,46,.6)';
  for (let j = 0; j < n; j++){
    g.fillRect(0, j * s, c.width, Math.max(1, s * 0.09));
    for (let i = 0; i < n; i++) g.fillRect((i + (j % 2) * 0.5 + (r() - 0.5) * 0.2) * s, j * s, Math.max(1, s * 0.09), s);
  }
}
const calcadaColour = (h, p) => { const k = 205 + h * 40 - p * 20; return [k, k - 2, k - 8]; };
const CALCADA = surfaceSet(COARSE ? 256 : 512, 19, calcadaColour, h => 0.55 + h * 0.3, 2);
cobbleJoints(CALCADA);
const WAVES = surfaceSet(COARSE ? 256 : 512, 21, calcadaColour, h => 0.55 + h * 0.3, 2);
(() => {
  const c = WAVES.map.image, g = c.getContext('2d'), w = c.width;
  g.strokeStyle = '#1c1d22'; g.lineWidth = w * 0.14;
  for (let y = -w; y <= 2 * w; y += w / 2){
    g.beginPath();
    for (let x = -8; x <= w + 8; x += 8){ const v = y + Math.sin(x / w * Math.PI * 2) * w * 0.14; if (x < 0) g.moveTo(x, v); else g.lineTo(x, v); }
    g.stroke();
  }
})();
cobbleJoints(WAVES);
// Barrel roof tiles in rows, tinted per roof
const roofTiles = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), r = mulberry32(8), rows = 8, cols = 10, h = 256 / rows, w = 256 / cols;
  for (let j = 0; j < rows; j++) for (let i = 0; i <= cols; i++){
    const x = (i + (j % 2) * 0.5) * w - w / 2, v = 190 + r() * 65, gr = g.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, 'rgb(' + v * 0.55 + ',' + v * 0.55 + ',' + v * 0.55 + ')'); gr.addColorStop(0.5, 'rgb(' + v + ',' + v + ',' + v + ')'); gr.addColorStop(1, 'rgb(' + v * 0.55 + ',' + v * 0.55 + ',' + v * 0.55 + ')');
    g.fillStyle = gr; g.fillRect(x, j * h, w, h);
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x, j * h + h - 2, w, 2);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = ANISO;
  return t;
})();
const GRASS = surfaceSet(COARSE ? 256 : 512, 13,
  (h, p) => [40 + h * 40 + p * 30, 70 + h * 60 + p * 40, 38 + h * 30], () => 0.95, 2.2);
function surfaceMat(set, repeat, opts){
  const clone = t => { const c = t.clone(); c.needsUpdate = true; c.repeat.set(repeat[0], repeat[1]); return c; };
  const m = new THREE.MeshStandardMaterial(Object.assign({ map: clone(set.map), roughnessMap: clone(set.rough), normalMap: clone(set.normal), normalScale: new THREE.Vector2(0.7, 0.7), roughness: 1, metalness: 0 }, opts || {}));
  m.userData.env = 0.9;
  return m;
}
// Soft additive light cones under lamps and in front of headlights
const coneTex = (() => {
  const c = document.createElement('canvas'); c.width = 4; c.height = 128;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.35, 'rgba(255,255,255,.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
})();
function coneGeo(x, z, top, radius){ const g = new THREE.ConeGeometry(radius, top - 0.2, 20, 1, true); g.translate(x, (top + 0.2) / 2, z); return g; }
function lightCones(list, opacity){
  return new THREE.Mesh(mergeGeos(list), new THREE.MeshBasicMaterial({ map: coneTex, color: 0xffd9a8, transparent: true, opacity: opacity || 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
}
const BEAM_GEO = new THREE.ConeGeometry(2.4, 14, 20, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 7);
const BEAM_MAT = new THREE.MeshBasicMaterial({ map: coneTex, color: 0xe8f0ff, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

// ---------- Worlds ----------
// ### Each map is a "world" object: a scene group, a list of colliders (boxes, circles, walls) and radar shapes.
// ### groundH returns the ground height at any point (kerbs in the city, the hill height field in the countryside).
// ### Traffic lights: every corner lamp post carries one signal head; two groups of intersections switch in turn.
// ### buildCity lays out Lisbon's Baixa as a 6x6 grid of closed blocks of Pombaline houses, plain and even in height, with
// ### arched ground floors and tile roofs with dormers; heights come from OpenStreetMap (most have 5 levels). In the north the
// ### Rossio with the National Theatre and the station, and the Praca da Figueira; in the south the yellow arcades and towers
// ### of the Praca do Comercio, the Arco da Rua Augusta and the river Tejo. Beyond them the Santa Justa lift, the cathedral,
// ### the castle on its hill, the 25 de Abril bridge and Cristo Rei.
// ### The grid is simplified: real blocks are longer than wide, here they are square. x grows east, z grows south.
const CITY = { group: new THREE.Group(), colliders: [], radar: [], built: false };
const HWY = { group: new THREE.Group(), colliders: [], radar: [], built: false };
scene.add(CITY.group, HWY.group);
let W = CITY;
const shardSpots = [], roadSpots = [], intersections = [];

function groundH(x, z){
  if (mode === 'country') return terrainH(x, z);
  if (mode !== 'city' || Math.abs(x) > 192 || Math.abs(z) > 192) return 0;
  const lx = x - Math.floor(x / PITCH) * PITCH - PITCH / 2, lz = z - Math.floor(z / PITCH) * PITCH - PITCH / 2;
  return (Math.abs(lx) <= HALF_BLOCK && Math.abs(lz) <= HALF_BLOCK) ? 0.18 : 0;
}

const dummy = new THREE.Object3D(), tint = new THREE.Color();
function instanced(group, geom, mat, list, place, colorFn){
  if (!list.length) return null;
  const m = new THREE.InstancedMesh(geom, mat, list.length);
  list.forEach((o, i) => { place(o, dummy); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); if (colorFn){ colorFn(o, tint); m.setColorAt(i, tint); } });
  m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
  group.add(m);
  return m;
}
const flatMat = opts => new THREE.MeshStandardMaterial(Object.assign({ color: 0xffffff, flatShading: true, roughness: 0.85 }, opts));

// Traffic lights: every corner lamp post carries one signal head for the approach on its side.
// Intersections alternate in two groups so the city does not switch all at once.
const SIGNAL = { cycle: 22, mats: {}, glows: {} };
function lightState(axis, grp){
  const t = (clock + (grp ? SIGNAL.cycle / 2 : 0)) % SIGNAL.cycle;
  if (axis === 'z') return t < 8 ? 'g' : t < 10 ? 'y' : 'r';
  return t < 11 ? 'r' : t < 19 ? 'g' : t < 21 ? 'y' : 'r';
}
const nodeGroup = (x, z) => (((Math.round(x / PITCH) + Math.round(z / PITCH)) % 2) + 2) % 2;
const LAMP_ON = { r: 0xff2a2a, y: 0xffb020, g: 0x2cff8a }, LAMP_OFF = { r: 0x2a0808, y: 0x2a1c05, g: 0x06200f };
function updateSignals(){
  for (const grp of [0, 1]) for (const axis of ['x', 'z']){
    const st = lightState(axis, grp);
    for (const c of ['r', 'y', 'g']){
      const key = grp + axis + c, on = st === c;
      if (SIGNAL.mats[key]) SIGNAL.mats[key].color.setHex(on ? LAMP_ON[c] : LAMP_OFF[c]);
      if (SIGNAL.glows[key]) SIGNAL.glows[key].visible = on;
    }
  }
}

function buildCity(){
  const grp = CITY.group, colliders = CITY.colliders, radarRects = CITY.radar;
  const rng = mulberry32(2026);
  const FB = { pombal: new Batch(), tileB: new Batch(), tileG: new Batch(), shop: new Batch(), arcade: new Batch() };
  const roofs = new Batch(), trim = new Batch(), slabs = new Batch(), grass = new Batch(), marks = new Batch(),
        neon = new Batch(), poles = new Batch(), pools = new Batch(), ao = new Batch(), housings = new Batch(), waves = new Batch(), lift = new Batch();
  const lampB = {}, lampP = {};
  for (const g of [0, 1]) for (const a of ['x', 'z']) for (const c of ['r', 'y', 'g']){ lampB[g + a + c] = new Batch(); lampP[g + a + c] = []; }
  const slabSide = C(0x8d8a84), slabTop = C(0xb2afa6), plazaTop = C(0xd8d3c6), stoneCol = C(0xd6ccb4), TILE_ROOFS = [0xbf5d24, 0xa9552c, 0xc26a3a, 0x9c4f2c];
  const trees = [];
  const pick = style => C(PAL[style][Math.floor(rng() * PAL[style].length)]);

  const stone = new THREE.MeshStandardMaterial({ color: 0xc6bda6, roughness: 0.85, emissive: 0x2a261b });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x4e6a5e, roughness: 0.55, metalness: 0.45, emissive: 0x141e1a });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), surfaceMat(ASPHALT, [175, 175], { color: 0xb8bcc8 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  grp.add(ground);

  // i runs west to east, j north to south; the four blocks around the start stay ordinary houses
  const types = new Map([['-3,-1', 'park'], ['2,-2', 'park'], ['2,1', 'park'], ['-1,-3', 'rossio'], ['0,-3', 'figueira'], ['-1,2', 'praca'], ['0,2', 'praca'], ['-3,-3', 'lift'], ['-1,-4', 'teatro'], ['-2,-4', 'estacao']]);
  // The yellow arcaded houses around the Praca do Comercio
  const YELLOW = new Set(['-2,2', '1,2', '-1,1', '0,1']);

  function facade(style, x0, x1, y0, y1, z0, z1, col){
    FB[style].sides(x0, x1, y0, y1, z0, z1, col, TU, TV, Math.floor(rng() * 8) / 8, Math.floor(rng() * 8) / 8);
  }
  function ledge(x0, x1, y, z0, z1, col, o){ trim.box(x0 - o, x1 + o, y, y + 0.3, z0 - o, z1 + o, col); }
  // A tile roof: four steep slopes from the eaves, q metres inwards; tile rows run along the eaves
  function hipRoof(x0, x1, y, z0, z1, h, col, inset){
    const q = inset || Math.min(x1 - x0, z1 - z0) * 0.38, L = Math.hypot(q, h), ny = q / L, nh = h / L, lx = x1 - x0, lz = z1 - z0, slope = L / 2;
    const uv = len => [0, 0, len / 2.5, 0, (len - q) / 2.5, slope, q / 2.5, slope];
    roofs.quadUV([x0, y, z1], [x1, y, z1], [x1 - q, y + h, z1 - q], [x0 + q, y + h, z1 - q], [0, ny, nh], uv(lx), col);
    roofs.quadUV([x1, y, z0], [x0, y, z0], [x0 + q, y + h, z0 + q], [x1 - q, y + h, z0 + q], [0, ny, -nh], uv(lx), col);
    roofs.quadUV([x1, y, z1], [x1, y, z0], [x1 - q, y + h, z0 + q], [x1 - q, y + h, z1 - q], [nh, ny, 0], uv(lz), col);
    roofs.quadUV([x0, y, z0], [x0, y, z1], [x0 + q, y + h, z1 - q], [x0 + q, y + h, z0 + q], [-nh, ny, 0], uv(lz), col);
    roofs.top(x0 + q, x1 - q, y + h, z0 + q, z1 - q, col, [0, 0, (lx - 2 * q) / 2.5, (lz - 2 * q) / 2.5]);
  }
  const roofTile = () => C(TILE_ROOFS[Math.floor(rng() * TILE_ROOFS.length)]);
  function aoRect(x0, x1, z0, z1){
    const y = 0.19, s = 2.6, n = [0, 1, 0];
    ao.quadUV([x0, y, z1 + s], [x1, y, z1 + s], [x1, y, z1], [x0, y, z1], n, [0, 0, 1, 0, 1, 1, 0, 1], WHITE);
    ao.quadUV([x0, y, z0], [x1, y, z0], [x1, y, z0 - s], [x0, y, z0 - s], n, [0, 1, 1, 1, 1, 0, 0, 0], WHITE);
    ao.quadUV([x1, y, z1], [x1 + s, y, z1], [x1 + s, y, z0], [x1, y, z0], n, [0, 1, 0, 0, 0, 0, 0, 1], WHITE);
    ao.quadUV([x0 - s, y, z1], [x0, y, z1], [x0, y, z0], [x0 - s, y, z0], n, [0, 0, 0, 1, 0, 1, 0, 0], WHITE);
  }

  // ### One city block: houses wall to wall around all four sides, each house 2 to 4 bays wide with its own colour. The block
  // ### has one height, as the plan of 1758 wanted, with stone corners between the houses, a cornice, and dormers in the roof.
  function block(cx, cz, o){
    o = o || {};
    const detail = o.detail && !COARSE; // phones get the same houses with painted slabs only
    const x0 = o.x0 !== undefined ? o.x0 : cx - 13.5, x1 = o.x1 !== undefined ? o.x1 : cx + 13.5, z0 = cz - 13.5, z1 = cz + 13.5;
    const pickFloors = rng(), floors = o.floors || (pickFloors < 0.25 ? 3 : pickFloors < 0.8 ? 4 : 5);
    const ground = o.ground || GROUND, baseY = 0.18 + ground + 0.3, top = baseY + floors * FLOOR, lime = C(0xe7e1d2);
    colliders.push({ t: 'b', x0, x1, z0, z1 });
    radarRects.push({ x0, x1, z0, z1, c: 'rgba(255,255,255,.17)' });
    aoRect(x0, x1, z0, z1);
    const sides = [{ s: [x0, z1], d: [1, 0], n: [0, 0, 1], L: x1 - x0 }, { s: [x1, z1], d: [0, -1], n: [1, 0, 0], L: z1 - z0 }, { s: [x1, z0], d: [-1, 0], n: [0, 0, -1], L: x1 - x0 }, { s: [x0, z0], d: [0, 1], n: [-1, 0, 0], L: z1 - z0 }];
    for (const { s, d, n, L } of sides){
      const bays = Math.max(2, Math.round(L / BAY)), bw = L / bays;
      const P = (t, y) => [s[0] + d[0] * t, y, s[1] + d[1] * t];
      const paneAt = (t, out, y) => [s[0] + d[0] * t + n[0] * out, y, s[1] + d[1] * t + n[2] * out];
      // a box along this side, from t0 to t1, nA to nB metres out from the wall (minus is inwards)
      const boxAt = (batch, t0, t1, nA, nB, y0, y1, col, under) => {
        const xs = [s[0] + d[0] * t0 + n[0] * nA, s[0] + d[0] * t1 + n[0] * nB], zs = [s[1] + d[1] * t0 + n[2] * nA, s[1] + d[1] * t1 + n[2] * nB];
        const xa = Math.min(...xs), xb = Math.max(...xs), za = Math.min(...zs), zb = Math.max(...zs);
        batch.box(xa, xb, y0, y1, za, zb, col);
        if (under) batch.quad([xa, y0, za], [xb, y0, za], [xb, y0, zb], [xa, y0, zb], [0, -1, 0], [0, 0, 0, 0], col);
      };
      for (let k = 0; k < bays;){
        let w = Math.min(bays - k, 2 + Math.floor(rng() * 3));
        if (bays - k - w === 1) w++;
        const t0 = k * bw, t1 = (k + w) * bw;
        const style = o.yellow || rng() >= 0.12 ? 'pombal' : rng() < 0.7 ? 'tileB' : 'tileG'; // tiles stayed the exception in the Baixa
        const col = o.yellow ? C(0xdbbe39) : pick(style), u0 = Math.floor(rng() * 8) / 8;
        const us = o.yellow ? Math.floor(rng() * 6) / 6 : Math.floor(rng() * 8) / 8, ub = o.yellow ? w * bw / 24 : w / 8;
        FB[o.yellow ? 'arcade' : 'shop'].quad(P(t0, 0.18), P(t1, 0.18), P(t1, 0.18 + ground), P(t0, 0.18 + ground), n, [us, 0, us + ub, 1], WHITE);
        let y = baseY;
        for (let f = 0; f < floors; f++){
          const kind = f === 0 ? 'nobre' : f === floors - 1 ? 'sill' : 'sacada', list = FRONT_ROWS[kind], row = list[Math.floor(rng() * list.length)];
          FB[style].quad(P(t0, y), P(t1, y), P(t1, y + FLOOR), P(t0, y + FLOOR), n, [u0, 1 - (row + 1) / 8, u0 + w / 8, 1 - row / 8], col);
          // real stone slabs under the balconies, close by only
          if (detail && kind !== 'sill'){
            const sy = y + FLOOR * (kind === 'nobre' ? 0.18 : 0.22);
            if (row === 7) boxAt(trim, t0 + 0.2, t1 - 0.2, 0, 0.6, sy - 0.13, sy, lime, true);
            else for (let b = 0; b < w; b++){ const tc = t0 + (b + 0.5) * bw; boxAt(trim, tc - 0.8, tc + 0.8, 0, 0.55, sy - 0.12, sy, lime, true); }
          }
          y += FLOOR;
        }
        // the stone corner of the house, and dormers in the roof above it
        boxAt(trim, t0 - 0.22, t0 + 0.22, -0.02, 0.1, 0.18 + ground, top, lime);
        if (o.detail){
          const dn = detail ? Math.max(1, w - 1) : 1;
          for (let q = 0; q < dn; q++){
            const tc = t0 + (t1 - t0) * (q + 0.5) / dn, dy = top + 0.9;
            boxAt(trim, tc - 0.65, tc + 0.65, -2.0, -0.95, dy, dy + 1.45, lime);
            const pane = rng() < 0.12, n0 = -0.93;
            (pane ? neon : housings).quad(paneAt(tc - 0.42, n0, dy + 0.15), paneAt(tc + 0.42, n0, dy + 0.15), paneAt(tc + 0.42, n0, dy + 1.25), paneAt(tc - 0.42, n0, dy + 1.25), n, [0, 0, 0, 0], pane ? C(0xffc98a) : C(0x171a24));
            boxAt(roofs, tc - 0.85, tc + 0.85, -2.2, -0.8, dy + 1.45, dy + 1.65, C(0x8e4c34));
          }
        }
        k += w;
      }
    }
    // base course, cornice and roof run around the whole block
    ledge(x0, x1, 0.18 + ground, z0, z1, lime, 0.12);
    ledge(x0, x1, top - 0.12, z0, z1, lime, 0.42);
    trim.box(x0 - 0.42, x1 + 0.42, top + 0.18, top + 0.3, z0 - 0.42, z1 + 0.42, lime);
    hipRoof(x0 - 0.35, x1 + 0.35, top + 0.3, z0 - 0.35, z1 + 0.35, 3.3, roofTile(), 3.6);
    for (let k = 0; k < 4; k++){
      const a = rng(), onX = rng() < 0.5, sx = onX ? x0 + 2 + a * (x1 - x0 - 4) : (rng() < 0.5 ? x0 + 3.4 : x1 - 3.4), sz = onX ? (rng() < 0.5 ? z0 + 3.4 : z1 - 3.4) : z0 + 2 + a * (z1 - z0 - 4);
      trim.box(sx - 0.45, sx + 0.45, top + 2.4, top + 5, sz - 0.3, sz + 0.3, C(0xdcd5c6));
    }
    return { top };
  }
  // A corner tower of the Praca do Comercio: one floor higher, with a steep lead-grey roof
  function torreao(x0, x1, z0, z1, top){
    const h = top + FLOOR + 1.2;
    FB.pombal.sides(x0, x1, top - 0.4, h, z0, z1, C(0xdbbe39), TU, TV, 0, 0.25);
    trim.box(x0 - 0.45, x1 + 0.45, h, h + 0.4, z0 - 0.45, z1 + 0.45, stoneCol);
    hipRoof(x0 - 0.3, x1 + 0.3, h + 0.4, z0 - 0.3, z1 + 0.3, 6.5, C(0x5e625f));
  }

  // The National Theatre closes the north of the Rossio: white neoclassical body, six columns, a pediment
  function teatro(cx, cz){
    const front = cz + 12, parts = [boxG(30, 16, 24, cx, 8.18, cz - 1.5), boxG(44, 11, 20, cx, 5.68, cz - 2), boxG(31.4, 0.8, 25.4, cx, 16.4, cz - 1.5), boxG(45.2, 0.7, 21.2, cx, 11.4, cz - 2)];
    for (let k = -3; k < 3; k++){
      const c = new THREE.CylinderGeometry(0.62, 0.74, 9.4, 14); c.translate(cx + (k + 0.5) * 3.6, 6.1, front + 2.8); parts.push(c);
      parts.push(boxG(1.6, 0.5, 1.6, cx + (k + 0.5) * 3.6, 1.2, front + 2.8), boxG(1.6, 0.4, 1.6, cx + (k + 0.5) * 3.6, 11, front + 2.8));
    }
    parts.push(boxG(22.4, 1.5, 6.6, cx, 11.95, front + 1.4), boxG(23.2, 0.5, 7, cx, 12.95, front + 1.4), boxG(23, 0.45, 7.4, cx, 0.42, front + 1.4), boxG(22, 0.45, 6.8, cx, 0.87, front + 1.4));
    const tri = new THREE.Shape(); tri.moveTo(-11.6, 0); tri.lineTo(11.6, 0); tri.lineTo(0, 3.9); tri.closePath();
    const ped = new THREE.ExtrudeGeometry(tri, { depth: 6.8, bevelEnabled: false }); ped.translate(cx, 13.2, front - 2); parts.push(ped);
    parts.push(boxG(0.9, 2.6, 0.8, cx, 18.3, front + 2));
    const body = new THREE.Mesh(mergeGeos(parts), stone); body.castShadow = true; grp.add(body);
    for (let k = -2; k <= 2; k++){
      neon.box(cx + k * 3.6 - 0.8, cx + k * 3.6 + 0.8, 1.1, 5.4, front - 0.05, front + 0.02, C(0xe0a868));
      neon.box(cx + k * 3.6 - 0.55, cx + k * 3.6 + 0.55, 7, 10, front - 0.05, front + 0.02, C(0x38261a));
    }
    for (const sx of [-1, 1]) for (let k = 0; k < 2; k++){
      const wx = cx + sx * (17.5 + k * 3.2);
      neon.box(wx - 0.6, wx + 0.6, 2, 5, cz + 8, cz + 8.06, C(0x2c2a2c));
      neon.box(wx - 0.6, wx + 0.6, 6.6, 9.4, cz + 8, cz + 8.06, C(0x2c2a2c));
    }
    hipRoof(cx - 15.4, cx + 15.4, 16.8, cz - 13.8, cz + 10.8, 3.2, C(0x8f8d86), 4);
  }
  // Rossio station: neo-Manueline, two intertwined horseshoe portals, a niche between them, a clock in a small turret
  function estacao(cx, cz){
    const [m, g, e, ge] = canvasPair(512, 512);
    g.fillStyle = '#d8ceb6'; g.fillRect(0, 0, 512, 512);
    speckle(g, 512, 512, mulberry32(4), 900);
    g.fillStyle = 'rgba(70,60,48,.2)'; for (let y = 28; y < 512; y += 28) g.fillRect(0, y, 512, 2);
    const horse = (c, x, y, R) => { c.beginPath(); c.moveTo(x - R * 0.72, 512); c.lineTo(x - R * 0.72, y + R * 0.72); c.arc(x, y, R, Math.PI * 0.75, Math.PI * 0.25); c.lineTo(x + R * 0.72, 512); c.closePath(); };
    for (const x of [165, 347]){
      g.fillStyle = '#efe6cf'; horse(g, x, 262, 104); g.fill();
      g.strokeStyle = '#8f8263'; g.lineWidth = 7; g.setLineDash([9, 7]); horse(g, x, 262, 98); g.stroke(); g.setLineDash([]);
      for (const c of [g, ge]){ c.fillStyle = c === g ? '#d7a15a' : '#8a6234'; horse(c, x, 262, 86); c.fill(); }
      g.fillStyle = '#2b2118'; g.fillRect(x - 54, 340, 108, 172);
      g.strokeStyle = '#3d3020'; g.lineWidth = 5; g.beginPath(); g.moveTo(x, 182); g.lineTo(x, 340); g.moveTo(x - 60, 262); g.lineTo(x + 60, 262); g.stroke();
    }
    g.fillStyle = '#6f6248'; g.beginPath(); g.moveTo(236, 512); g.lineTo(236, 300); g.quadraticCurveTo(256, 258, 276, 300); g.lineTo(276, 512); g.closePath(); g.fill();
    g.fillStyle = '#d9d1bb'; g.fillRect(246, 330, 20, 72); g.beginPath(); g.arc(256, 322, 10, 0, 7); g.fill();
    g.fillStyle = '#8f8263';
    for (let x = 12; x < 512; x += 46) g.fillRect(x, 92, 22, 26);
    g.fillStyle = 'rgba(70,60,48,.4)'; g.fillRect(0, 122, 512, 7);
    const tex = toTex(m, e);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), new THREE.MeshStandardMaterial({ map: tex.map, emissiveMap: tex.emissive, emissive: 0xffffff, roughness: 0.85 }));
    const fz = cz + 15.2; face.position.set(cx, 13, fz); grp.add(face);
    const parts = [boxG(26, 26, 22, cx, 13, fz - 11.05), boxG(5.4, 8, 5.4, cx, 29.5, fz - 2.8)];
    for (let k = -6; k <= 6; k++) parts.push(boxG(1.1, 1.8, 1, cx + k * 2.1, 26.9, fz - 0.4), boxG(1.1, 1.8, 1, cx + k * 2.1, 26.9, fz - 21.6));
    for (let k = -1; k <= 1; k++) parts.push(boxG(1.1, 1.3, 1, cx + k * 1.9, 34.1, fz - 0.5));
    const body = new THREE.Mesh(mergeGeos(parts), stone); body.castShadow = true; grp.add(body);
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const cg = c.getContext('2d');
    cg.fillStyle = '#fff4d8'; cg.beginPath(); cg.arc(64, 64, 60, 0, 7); cg.fill();
    cg.strokeStyle = '#2d2a24'; cg.lineWidth = 5; cg.stroke(); cg.lineCap = 'round';
    const hand = (a, l, w) => { cg.lineWidth = w; cg.beginPath(); cg.moveTo(64, 64); cg.lineTo(64 + Math.sin(a) * l, 64 - Math.cos(a) * l); cg.stroke(); };
    hand(2.5 / 12 * Math.PI * 2, 30, 6); hand(Math.PI, 46, 4);
    const ct = new THREE.CanvasTexture(c); ct.encoding = THREE.sRGBEncoding;
    const clock = new THREE.Mesh(new THREE.CircleGeometry(1.9, 24), new THREE.MeshBasicMaterial({ map: ct })); clock.position.set(cx, 30, fz - 0.05); grp.add(clock);
  }

  function park(cx, cz){
    const gTop = C(0x3c6b45), gSide = C(0x2f5838);
    for (const [a, b] of [[-13, -1.5], [1.5, 13]]) for (const [c, d] of [[-13, -1.5], [1.5, 13]]){
      grass.sides(cx + a, cx + b, 0.18, 0.3, cz + c, cz + d, gSide);
      grass.top(cx + a, cx + b, 0.3, cz + c, cz + d, gTop);
      const qx = cx + (a + b) / 2, qz = cz + (c + d) / 2;
      shardSpots.push({ x: qx, z: qz, park: true });
      for (let n = 0; n < 6; n++){
        const tx = qx + (rng() - 0.5) * 9, tz = qz + (rng() - 0.5) * 9;
        if (Math.hypot(tx - qx, tz - qz) < 4) continue;
        trees.push({ x: tx, z: tz, s: 0.8 + rng() * 0.5, rot: rng() * 6.28, v: rng() });
        colliders.push({ t: 'c', x: tx, z: tz, r: 0.5 });
      }
    }
    radarRects.push({ x0: cx - 13, x1: cx + 13, z0: cz - 13, z1: cz + 13, c: 'rgba(78,240,160,.16)' });
  }

  const glowPts = [], cones = [];
  function fountain(cx, cz){
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.2, 0.8, 24), stone); base.position.set(cx, 0.58, cz);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.1, 24), new THREE.MeshStandardMaterial({ color: 0x2f9fd0, emissive: 0x1a6c98, roughness: 0.1, metalness: 0.2 }));
    water.position.set(cx, 0.95, cz);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.8, 10), stone); col.position.set(cx, 2.0, cz);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.5, 0.5, 16), stone); bowl.position.set(cx, 3.4, cz);
    [base, col, bowl].forEach(m => { m.castShadow = true; m.receiveShadow = true; });
    grp.add(base, water, col, bowl);
    colliders.push({ t: 'c', x: cx, z: cz, r: 3.2 });
    radarRects.push({ x0: cx - 3.2, x1: cx + 3.2, z0: cz - 3.2, z1: cz + 3.2, c: 'rgba(85,236,255,.25)' });
  }
  // Rossio: the wave pavement, the column of Dom Pedro IV and two fountains
  function rossio(cx, cz){
    const column = new THREE.Mesh(mergeGeos([new THREE.CylinderGeometry(1.5, 1.8, 2.2, 16).translate(0, 1.3, 0), new THREE.CylinderGeometry(0.55, 0.65, 15, 12).translate(0, 9.5, 0), new THREE.BoxGeometry(1.5, 0.6, 1.5).translate(0, 17.3, 0)]), stone);
    column.position.set(cx, 0, cz); column.castShadow = true;
    const figure = new THREE.Mesh(mergeGeos([boxG(0.8, 1.9, 0.6, 0, 18.5, 0), boxG(0.5, 0.5, 0.5, 0, 19.7, 0)]), bronze);
    figure.position.set(cx, 0, cz);
    grp.add(column, figure);
    colliders.push({ t: 'c', x: cx, z: cz, r: 1.8 });
    radarRects.push({ x0: cx - 1.8, x1: cx + 1.8, z0: cz - 1.8, z1: cz + 1.8, c: 'rgba(255,255,255,.3)' });
    fountain(cx - 10, cz); fountain(cx + 10, cz);
    shardSpots.push({ x: cx, z: cz + 10.5 }, { x: cx, z: cz - 10.5 });
  }
  // A horse and rider on a stone pedestal: Dom Jose I on the Praca do Comercio, Dom Joao I on the Praca da Figueira
  function equestrian(x, z, s){
    const ped = new THREE.Mesh(mergeGeos([new THREE.CylinderGeometry(2.2, 2.2, 1.2, 16).translate(0, 0.6, 0), new THREE.CylinderGeometry(1.5, 1.9, 5.2, 16).translate(0, 3.8, 0)]), stone);
    ped.position.set(x, 0, z); ped.castShadow = true;
    const parts = [boxG(1.1, 1.2, 3.0, 0, 3.0, 0), boxG(0.7, 1.5, 0.8, 0, 4.0, 1.5, -0.5), boxG(0.5, 0.6, 1.1, 0, 4.75, 2.05, 0.4),
      boxG(0.3, 2.0, 0.3, 0.4, 1.3, -1.2), boxG(0.3, 2.0, 0.3, -0.4, 1.3, -1.2), boxG(0.3, 2.0, 0.3, 0.4, 1.3, 1.2), boxG(0.3, 1.1, 0.3, -0.4, 2.6, 1.7, 1.0),
      boxG(0.2, 1.8, 0.3, 0, 2.6, -1.8, -0.3), boxG(0.8, 1.5, 0.6, 0, 4.35, -0.2), boxG(0.45, 0.5, 0.45, 0, 5.4, -0.2), boxG(1.1, 0.14, 0.6, 0, 5.7, -0.2), boxG(0.18, 2.0, 0.18, 0.62, 4.5, 0.2)];
    const statue = new THREE.Mesh(mergeGeos(parts), bronze);
    statue.scale.setScalar(s); statue.position.set(x, 6.4, z); statue.castShadow = true;
    grp.add(ped, statue);
    pools.top(x - 9, x + 9, 0.21, z - 9, z + 9, C(0xffc98a));
    colliders.push({ t: 'c', x, z, r: 2.2 });
    radarRects.push({ x0: x - 2.2, x1: x + 2.2, z0: z - 2.2, z1: z + 2.2, c: 'rgba(255,255,255,.3)' });
  }
  // The Arco da Rua Augusta closes the south end of the street; the clock shows the hour of the escape
  function arco(z0){
    const shp = new THREE.Shape();
    shp.moveTo(-15, 0); shp.lineTo(-7.2, 0); shp.lineTo(-7.2, 10.5); shp.absarc(0, 10.5, 7.2, Math.PI, 0, true); shp.lineTo(7.2, 0);
    shp.lineTo(15, 0); shp.lineTo(15, 24); shp.lineTo(-15, 24); shp.closePath();
    const body = new THREE.ExtrudeGeometry(shp, { depth: 6, bevelEnabled: false, curveSegments: 20 }); body.translate(0, 0, z0);
    const zm = z0 + 3, zF = z0 + 6.2;
    const extra = [boxG(31.4, 0.9, 7.2, 0, 18.1, zm), boxG(31.8, 0.9, 7.6, 0, 24.3, zm), boxG(18, 3.2, 5, 0, 26.2, zm), boxG(9, 2.4, 3.6, 0, 29, zm), boxG(1.6, 4.4, 1.3, 0, 32.4, zm), boxG(5.6, 0.5, 0.7, 0, 33.2, zm)];
    for (const sx of [-1, 1]) for (const dz of [0, 1]) for (const x of [8.4, 13.4]){
      const c = new THREE.CylinderGeometry(0.62, 0.72, 14.4, 12); c.translate(sx * x, 9.4, dz ? zF : z0 - 0.4); extra.push(c);
      extra.push(boxG(1.8, 2.2, 1.8, sx * x, 1.1, dz ? zF : z0 - 0.4));
    }
    const arch = new THREE.Mesh(mergeGeos([body, ...extra]), stone);
    arch.castShadow = true; arch.receiveShadow = true; grp.add(arch);
    // inscription and clock, painted once and shown on both faces
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#d6ccb4'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#2d2a24'; g.font = '700 30px Georgia, serif'; g.textAlign = 'center'; g.fillText('VIRTVTIBVS MAIORVM', 256, 232);
    g.fillStyle = '#fff4d8'; g.beginPath(); g.arc(256, 96, 88, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2d2a24'; g.lineWidth = 7; g.stroke();
    g.lineCap = 'round';
    for (let k = 0; k < 12; k++){ const a = k / 12 * Math.PI * 2; g.beginPath(); g.moveTo(256 + Math.sin(a) * 72, 96 - Math.cos(a) * 72); g.lineTo(256 + Math.sin(a) * 82, 96 - Math.cos(a) * 82); g.stroke(); }
    const hand = (a, l, w) => { g.lineWidth = w; g.beginPath(); g.moveTo(256, 96); g.lineTo(256 + Math.sin(a) * l, 96 - Math.cos(a) * l); g.stroke(); };
    hand(2.5 / 12 * Math.PI * 2, 46, 9); hand(Math.PI, 68, 6);
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = ANISO;
    const plate = new THREE.MeshBasicMaterial({ map: tex });
    for (const [pz, rot] of [[z0 + 6.03, 0], [z0 - 0.03, Math.PI]]){
      const m = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), plate);
      m.position.set(0, 21, pz); m.rotation.y = rot; grp.add(m);
    }
    for (const sx of [-1, 1]){
      colliders.push({ t: 'b', x0: sx < 0 ? -15 : 7.2, x1: sx < 0 ? -7.2 : 15, z0, z1: z0 + 6 });
      radarRects.push({ x0: sx < 0 ? -15 : 7.2, x1: sx < 0 ? -7.2 : 15, z0, z1: z0 + 6, c: 'rgba(255,226,160,.5)' });
      cones.push(coneGeo(sx * 9.5, z0 + 8, 12, 5));
    }
  }
  // The Santa Justa lift: an iron tower with a walkway across the houses to the Carmo hill
  function liftTower(cx, cz){
    const x0 = cx + 5, x1 = cx + 11, z0 = cz - 3, z1 = cz + 3, top = 42, iron = C(0x2a2c33);
    lift.sides(x0, x1, 0.18, top, z0, z1, WHITE, 6, 14);
    trim.box(x0 - 0.4, x1 + 0.4, top, top + 0.5, z0 - 0.4, z1 + 0.4, iron);
    lift.sides(x0 + 1, x1 - 1, top + 0.5, top + 5, z0 + 1, z1 - 1, WHITE, 4, 7);
    trim.box(x0 + 0.6, x1 - 0.6, top + 5, top + 5.5, z0 + 0.6, z1 - 0.6, iron);
    trim.box(cx - 40, x0, top - 3, top - 1.9, cz - 1.8, cz + 1.8, iron);
    trim.box(cx - 40, x0, top - 1.9, top - 0.9, cz - 1.8, cz - 1.6, iron);
    trim.box(cx - 40, x0, top - 1.9, top - 0.9, cz + 1.6, cz + 1.8, iron);
    colliders.push({ t: 'b', x0, x1, z0, z1 });
    radarRects.push({ x0, x1, z0, z1, c: 'rgba(255,255,255,.3)' });
  }

  function signalHead(px, pz, fx, fz, axis, g){
    const hx = px + fx * 0.25, hz = pz + fz * 0.25;
    const sx = fz !== 0 ? 0.21 : 0.17, sz = fz !== 0 ? 0.17 : 0.21;
    housings.box(hx - sx, hx + sx, 3.3, 4.55, hz - sz, hz + sz, C(0x1d2027));
    housings.box(Math.min(px, hx) - 0.06, Math.max(px, hx) + 0.06, 4.35, 4.45, Math.min(pz, hz) - 0.06, Math.max(pz, hz) + 0.06, C(0x3a3f4b));
    const lx = hx + fx * 0.2, lz = hz + fz * 0.2;
    [['r', 4.25], ['y', 3.92], ['g', 3.59]].forEach(([c, y]) => {
      const ax = fz !== 0 ? 0.12 : 0.03, az = fz !== 0 ? 0.03 : 0.12;
      lampB[g + axis + c].box(lx - ax, lx + ax, y - 0.12, y + 0.12, lz - az, lz + az, WHITE);
      lampP[g + axis + c].push(lx + fx * 0.1, y, lz + fz * 0.1);
    });
  }

  for (let i = -4; i <= 3; i++) for (let j = -4; j <= 3; j++){
    const cx = (i + 0.5) * PITCH, cz = (j + 0.5) * PITCH;
    const isInner = i >= -3 && i <= 2 && j >= -3 && j <= 2;
    if (j === 3) continue; // south of the waterfront road lies the river
    const key = i + ',' + j, type = types.get(key) || 'build', open = type === 'praca' || type === 'figueira';
    slabs.sides(cx - HALF_BLOCK, cx + HALF_BLOCK, 0, 0.18, cz - HALF_BLOCK, cz + HALF_BLOCK, slabSide);
    if (type === 'rossio') waves.top(cx - HALF_BLOCK, cx + HALF_BLOCK, 0.18, cz - HALF_BLOCK, cz + HALF_BLOCK, plazaTop, [(cx - HALF_BLOCK) / 11, (cz + HALF_BLOCK) / 11, (cx + HALF_BLOCK) / 11, (cz - HALF_BLOCK) / 11]);
    else slabs.top(cx - HALF_BLOCK, cx + HALF_BLOCK, 0.18, cz - HALF_BLOCK, cz + HALF_BLOCK, open ? plazaTop : slabTop, [(cx - HALF_BLOCK) / 4, (cz + HALF_BLOCK) / 4, (cx + HALF_BLOCK) / 4, (cz - HALF_BLOCK) / 4]);
    if (type === 'park') park(cx, cz);
    else if (type === 'rossio') rossio(cx, cz);
    else if (open){
      if (type === 'figueira') equestrian(cx, cz, 1);
      shardSpots.push({ x: cx + 10.5, z: cz }, { x: cx - 10.5, z: cz });
    }
    else if (type === 'teatro') teatro(cx, cz);
    else if (type === 'estacao') estacao(cx, cz);
    else if (type === 'lift'){ block(cx, cz, { x1: cx + 2, detail: true }); liftTower(cx, cz); }
    else if (YELLOW.has(key)){
      const { top } = block(cx, cz, { yellow: true, floors: 3, ground: 6, detail: true });
      // the towers stand where the wings meet the river
      if (key === '-2,2') torreao(cx + 1.5, cx + 13.8, cz + 1.5, cz + 13.8, top);
      if (key === '1,2') torreao(cx - 13.8, cx - 1.5, cz + 1.5, cz + 13.8, top);
    }
    else block(cx, cz, { detail: isInner });
    if (!isInner) continue;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]){
      const x = cx + sx * 15.4, z = cz + sz * 15.4;
      // an old cast-iron street lantern; the traffic light hangs on the same post
      poles.sides(x - 0.09, x + 0.09, 0.18, 4.95, z - 0.09, z + 0.09, C(0x23262c));
      poles.sides(x - 0.2, x + 0.2, 0.18, 1.1, z - 0.2, z + 0.2, C(0x23262c));
      cones.push(coneGeo(x, z, 5.1, 3.2));
      neon.box(x - 0.19, x + 0.19, 4.95, 5.5, z - 0.19, z + 0.19, C(0xffd9a0));
      housings.box(x - 0.27, x + 0.27, 5.5, 5.62, z - 0.27, z + 0.27, C(0x1d2027));
      housings.box(x - 0.12, x + 0.12, 5.62, 5.82, z - 0.12, z + 0.12, C(0x1d2027));
      glowPts.push(x, 5.2, z);
      pools.top(x - 8, x + 8, 0.21, z - 8, z + 8, C(0xffc98a));
      colliders.push({ t: 'c', x, z, r: 0.3 });
      // signal head for the approach whose right-hand corner this is
      const ix = cx + sx * 24, iz = cz + sz * 24, relx = -sx, relz = -sz, g = nodeGroup(ix, iz);
      if (relx < 0 && relz < 0) signalHead(x, z, 0, -1, 'z', g);
      else if (relx > 0 && relz > 0) signalHead(x, z, 0, 1, 'z', g);
      else if (relx < 0 && relz > 0) signalHead(x, z, -1, 0, 'x', g);
      else signalHead(x, z, 1, 0, 'x', g);
    }
  }

  // The square is one surface: the stretch of Rua Augusta that crosses it is paved like the rest
  slabs.top(-7, 7, 0.012, 103, 137, plazaTop, [-7 / 4, 137 / 4, 7 / 4, 103 / 4]);
  equestrian(0, 120, 1.25);
  arco(80);

  // Quay, Cais das Colunas and the river Tejo
  trim.box(-700, 700, 0, 0.35, 151, 157, stoneCol);
  const pillars = mergeGeos([-6, 6].flatMap(x => [new THREE.CylinderGeometry(0.5, 0.6, 6, 12).translate(x, 3.3, 155), new THREE.BoxGeometry(1.5, 0.6, 1.5).translate(x, 6.5, 155)]));
  const colunas = new THREE.Mesh(pillars, stone); colunas.castShadow = true; grp.add(colunas);
  const ripple = GRASS.normal.clone(); ripple.needsUpdate = true; ripple.repeat.set(70, 40);
  const river = new THREE.Mesh(new THREE.PlaneGeometry(1400, 640), new THREE.MeshStandardMaterial({ color: 0x12304c, roughness: 0.24, metalness: 0.6, normalMap: ripple, normalScale: new THREE.Vector2(0.3, 0.3) }));
  river.material.userData.env = 1.5;
  river.rotation.x = -Math.PI / 2; river.position.set(0, 0.08, 157 + 320); river.receiveShadow = true;
  grp.add(river); CITY.water = river;
  radarRects.push({ x0: -300, x1: 300, z0: 157, z1: 340, c: 'rgba(70,140,230,.28)' });

  // The hills around the valley: Bairro Alto in the west, the castle hill in the east, the Avenida in the north
  const HILLS = [[330, -110, 175, 64, 240], [-345, -60, 150, 60, 320], [0, -470, 340, 45, 190]];
  const hillH = (x, z) => Math.max(0, ...HILLS.map(([cx, cz, rx, ry, rz]) => ry * Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2 - ((z - cz) / rz) ** 2))));
  grp.add(new THREE.Mesh(mergeGeos(HILLS.map(([cx, cz, rx, ry, rz]) => new THREE.SphereGeometry(1, 24, 14).scale(rx, ry, rz).translate(cx, 0, cz))), new THREE.MeshStandardMaterial({ color: 0x2a3142, roughness: 1 })));
  for (let n = 0; n < 240; n++){
    const a = rng() * Math.PI * 2, r = 205 + rng() * 240, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.max(Math.abs(x), Math.abs(z)) < 200 || z > 145 || (x > 186 && x < 220 && Math.abs(z) < 8)) continue;
    const base = hillH(x, z), w = 12 + Math.floor(rng() * 4) * 3, d = 12 + Math.floor(rng() * 4) * 3, h = (3 + Math.floor(rng() * 3)) * FLOOR;
    const style = rng() < 0.88 ? 'pombal' : 'tileB';
    facade(style, x - w / 2, x + w / 2, base - 4, base + h, z - d / 2, z + d / 2, pick(style).multiplyScalar(0.85));
    hipRoof(x - w / 2, x + w / 2, base + h, z - d / 2, z + d / 2, 3, roofTile());
  }
  // Houses climbing the hills, so the slopes are not empty at night
  for (const [hx, hz, rx, , rz] of HILLS) for (let n = 0; n < 130; n++){
    const a = rng() * Math.PI * 2, q = Math.sqrt(rng()) * 0.96, x = hx + Math.cos(a) * q * rx, z = hz + Math.sin(a) * q * rz;
    if (Math.max(Math.abs(x), Math.abs(z)) < 200 || z > 145 || (x > 186 && x < 220 && Math.abs(z) < 8)) continue;
    const base = hillH(x, z), w = 10 + Math.floor(rng() * 3) * 3, d = 10 + Math.floor(rng() * 3) * 3, h = (2 + Math.floor(rng() * 3)) * FLOOR;
    const style = rng() < 0.88 ? 'pombal' : 'tileG';
    facade(style, x - w / 2, x + w / 2, base - 5, base + h, z - d / 2, z + d / 2, pick(style).multiplyScalar(0.85));
    hipRoof(x - w / 2, x + w / 2, base + h, z - d / 2, z + d / 2, 2.6, roofTile());
  }
  // The Se, Lisbon's cathedral, on the slope at the end of Rua da Conceicao: two crenellated towers and a rose window, facing west
  {
    const x = 222, b = hillH(x, 0) - 3, tw = [];
    for (const sz of [-8.5, 8.5]){
      tw.push(boxG(11, 34, 10, x + 5, b + 17, sz));
      for (let k = -1; k <= 1; k++){ tw.push(boxG(1.6, 2, 1.6, x + 0.4, b + 35, sz + k * 3.4), boxG(1.6, 2, 1.6, x + 9.6, b + 35, sz + k * 3.4)); }
      for (const dz of [-4.2, 4.2]) tw.push(boxG(1.6, 2, 1.6, x + 5, b + 35, sz + dz));
    }
    tw.push(boxG(9, 24, 7.6, x + 4, b + 12, 0), boxG(32, 18, 18, x + 26, b + 9, 0));
    const se = new THREE.Mesh(mergeGeos(tw), new THREE.MeshStandardMaterial({ color: 0xc9b48c, roughness: 0.9, emissive: 0x4a3f2c })); grp.add(se);
    // the terrace it stands on, lit from below, with the street climbing up to it
    const terrace = new THREE.Mesh(boxG(46, b + 3, 40, x + 20, (b + 3) / 2, 0), new THREE.MeshStandardMaterial({ color: 0x7c6f58, roughness: 0.95, emissive: 0x2a241a }));
    grp.add(terrace);
    for (const sz of [-7, 7]) for (let k = 0; k < 5; k++) glowPts.push(x - 44 + k * 10, 4 + k * b / 5, sz);
    const rose = new THREE.Mesh(new THREE.CircleGeometry(2.2, 20), new THREE.MeshBasicMaterial({ color: 0x4a3620 })); rose.rotation.y = -Math.PI / 2; rose.position.set(x - 0.56, b + 17, 0); grp.add(rose);
    neon.box(x - 0.55, x - 0.5, b + 3, b + 10, -1.7, 1.7, C(0x2a1e14));
  }
  // The Castelo de Sao Jorge, floodlit like every night
  {
    const cx = 300, cz = -115, b = hillH(cx, cz) - 3, W2 = 40, D2 = 28, wall = C(0xd8a868), H = 13;
    neon.box(cx - W2, cx + W2, b, b + H, cz - D2, cz - D2 + 3, wall); neon.box(cx - W2, cx + W2, b, b + H, cz + D2 - 3, cz + D2, wall);
    neon.box(cx - W2, cx - W2 + 3, b, b + H, cz - D2, cz + D2, wall); neon.box(cx + W2 - 3, cx + W2, b, b + H, cz - D2, cz + D2, wall);
    for (const [tx, tz] of [[-W2, -D2], [W2, -D2], [-W2, D2], [W2, D2], [0, D2], [-W2 / 2, -D2]]) neon.box(cx + tx - 5, cx + tx + 5, b, b + H + 8, cz + tz - 5, cz + tz + 5, C(0xe0b274));
    for (let x = -W2; x < W2; x += 6){ neon.box(cx + x, cx + x + 3, b + H, b + H + 2, cz + D2 - 2, cz + D2, wall); neon.box(cx + x, cx + x + 3, b + H, b + H + 2, cz - D2, cz - D2 + 2, wall); }
    for (let z = -D2; z < D2; z += 6) neon.box(cx - W2, cx - W2 + 2, b + H, b + H + 2, cz + z, cz + z + 3, wall);
  }
  // Far across the water (no fog, or the night would swallow them): the south bank, Cristo Rei and the 25 de Abril bridge
  const farMat = c => new THREE.MeshBasicMaterial({ color: c, fog: false });
  const bank = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12).scale(1200, 46, 130).translate(0, 0, 770), farMat(0x070a18));
  const cristo = new THREE.Mesh(mergeGeos([boxG(9, 42, 9, -170, 62, 690), boxG(5.5, 19, 4, -170, 92, 690), boxG(22, 2.8, 3, -170, 98, 690), boxG(3, 3.4, 3, -170, 103, 690)]), farMat(0xa9aec4));
  const bridge = new THREE.Group();
  {
    const seg = (x0, y0, x1, y1, t) => { const l = Math.hypot(x1 - x0, y1 - y0), g = new THREE.BoxGeometry(l, t, t); g.rotateZ(Math.atan2(y1 - y0, x1 - x0)); g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0); return g; };
    const steel = [new THREE.BoxGeometry(700, 4, 9).translate(0, 40, 0)];
    for (const tx of [-150, 150]) steel.push(new THREE.BoxGeometry(7, 112, 5).translate(tx, 56, -6), new THREE.BoxGeometry(7, 112, 5).translate(tx, 56, 6), new THREE.BoxGeometry(7, 5, 16).translate(tx, 108, 0), new THREE.BoxGeometry(7, 5, 16).translate(tx, 72, 0));
    const main = x => 46 + 62 * (x / 150) ** 2;
    for (let x = -150; x < 150; x += 12.5){ steel.push(seg(x, main(x), x + 12.5, main(x + 12.5), 1.4)); steel.push(new THREE.BoxGeometry(0.5, main(x) - 42, 0.5).translate(x, (main(x) + 42) / 2, 0)); }
    for (const sx of [-1, 1]) steel.push(seg(sx * 150, 108, sx * 350, 42, 1.4));
    bridge.add(new THREE.Mesh(mergeGeos(steel), farMat(0x93422c)));
    const lamps = [];
    for (let x = -345; x <= 345; x += 12) lamps.push(x, 43.5, 0);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lamps, 3));
    bridge.add(new THREE.Points(lg, new THREE.PointsMaterial({ map: glowTexture, color: 0xffcf8c, size: 7, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute([-150, 114, 0, 150, 114, 0], 3));
    bridge.add(new THREE.Points(rg, new THREE.PointsMaterial({ map: glowTexture, color: 0xff3344, size: 15, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
    bridge.position.set(-400, 0, 410); bridge.rotation.y = -1.2;
  }
  const bl = [];
  for (let n = 0; n < 260; n++){ const x = (rng() - 0.5) * 1700, k = rng(); bl.push(x, 5 + k * 28, 655 + k * 55); }
  const blg = new THREE.BufferGeometry(); blg.setAttribute('position', new THREE.Float32BufferAttribute(bl, 3));
  grp.add(bank, cristo, bridge, new THREE.Points(blg, new THREE.PointsMaterial({ map: glowTexture, color: 0xffd9a0, size: 3.4, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));

  // Road markings, crosswalks and stop lines
  const wht = C(0xd8dbe4);
  for (let k = -3; k <= 3; k++){
    const c = k * PITCH;
    for (let s = -186; s < 186; s += 6){
      const mid = s + 1.5;
      if (Math.abs(mid - Math.round(mid / PITCH) * PITCH) < 14) continue;
      if (k < 3) marks.top(s, s + 3, 0.02, c - 0.12, c + 0.12, wht);
      // no lane line where Rua Augusta crosses the square, and none in the river
      if (s < 148 && !(k === 0 && s > 100 && s < 137)) marks.top(c - 0.12, c + 0.12, 0.02, s, s + 3, wht);
    }
    for (let m = -3; m <= 3; m++){
      const ix = m * PITCH, iz = c;
      intersections.push({ x: ix, z: iz });
      for (let q = -5.6; q <= 5.7; q += 1.6){
        marks.top(ix + 8, ix + 11, 0.02, iz + q - 0.4, iz + q + 0.4, wht);
        marks.top(ix - 11, ix - 8, 0.02, iz + q - 0.4, iz + q + 0.4, wht);
        marks.top(ix + q - 0.4, ix + q + 0.4, 0.02, iz + 8, iz + 11, wht);
        marks.top(ix + q - 0.4, ix + q + 0.4, 0.02, iz - 11, iz - 8, wht);
      }
      marks.top(ix - 6.8, ix - 0.3, 0.02, iz - 11.9, iz - 11.45, wht);
      marks.top(ix + 0.3, ix + 6.8, 0.02, iz + 11.45, iz + 11.9, wht);
      marks.top(ix - 11.9, ix - 11.45, 0.02, iz + 0.3, iz + 6.8, wht);
      marks.top(ix + 11.45, ix + 11.9, 0.02, iz - 6.8, iz - 0.3, wht);
    }
    for (let m = -3; m <= 2; m++){
      roadSpots.push({ x: m * PITCH + 24, z: c, axis: 'x' });
      roadSpots.push({ x: c, z: m * PITCH + 24, axis: 'z' });
    }
  }

  // The tram tracks, along the exact path the trams drive: a stone track bed set into the asphalt, a dark groove and a
  // bright steel rail on each side, with a curve at each corner of the loop and straight through the crossings
  const trackBed = new Batch(), bedCol = C(0x8a8780), grooveCol = C(0x17181c), railCol = C(0xd5d9e2);
  const flat = (batch, a, b, c, d, col) => {
    const area = [a, b, c, d].reduce((t, p, i, q) => { const n = q[(i + 1) % 4]; return t + p[0] * n[2] - n[0] * p[2]; }, 0);
    const pts = area < 0 ? [a, b, c, d] : [d, c, b, a], uv = pts.flatMap(p => [p[0] / 4, p[2] / 4]);
    batch.quadUV(pts[0], pts[1], pts[2], pts[3], [0, 1, 0], uv, col);
  };
  // one strip offset from the lane centre by `off`, half as wide as `half`, height y, along a straight run and its corner curve
  const strip = (batch, off, half, y, col) => {
    const T = TRAM_LOOP, corners = [[T.x0, T.z0], [T.x1, T.z0], [T.x1, T.z1], [T.x0, T.z1]], LANE = T.lane;
    corners.forEach((A, q) => {
      const B = corners[(q + 1) % 4], L = Math.hypot(B[0] - A[0], B[1] - A[1]), dx = (B[0] - A[0]) / L, dz = (B[1] - A[1]) / L, [rx, rz] = rightOf(dx, dz);
      const o0 = LANE + off - half, o1 = LANE + off + half;
      const p = (t, o) => [A[0] + dx * t + rx * o, y, A[1] + dz * t + rz * o];
      flat(batch, p(7, o0), p(L - 7, o0), p(L - 7, o1), p(7, o1), col);
      // the same centre and radius the tram turns around (startTurn): the kerb corner, radius 3.5
      const Cx = B[0] - dx * 7 + rx * 7, Cz = B[1] - dz * 7 + rz * 7, a0 = Math.atan2(-rz, -rx), delta = wrapAngle(Math.atan2(dz, dx) - a0), ARC = 10;
      const arc = (ang, o) => [Cx + Math.cos(ang) * (7 - o), y, Cz + Math.sin(ang) * (7 - o)];
      for (let i = 0; i < ARC; i++){
        const a = a0 + delta * i / ARC, b = a0 + delta * (i + 1) / ARC;
        flat(batch, arc(a, o0), arc(b, o0), arc(b, o1), arc(a, o1), col);
      }
    });
  };
  strip(trackBed, 0, 1.15, 0.012, bedCol);
  for (const side of [-0.72, 0.72]){ strip(marks, side, 0.15, 0.03, grooveCol); strip(marks, side, 0.075, 0.045, railCol); }

  // Parked cars along the curbs
  const parked = [];
  for (let k = -3; k <= 3; k++) for (let m = -3; m <= 2; m++) for (const side of [-1, 1]) for (const slot of [14, 34]){
    for (const axis of ['x', 'z']){
      if (rng() > 0.35) continue;
      const along = m * PITCH + slot + (rng() - 0.5) * 2, across = k * PITCH + side * 5.6;
      const x = axis === 'x' ? along : across, z = axis === 'x' ? across : along;
      if (Math.hypot(x, z) < 24 || (Math.abs(x) < 8 && z > 66 && z < 137)) continue;
      parked.push({ x, z, h: (axis === 'x' ? Math.PI / 2 : 0) + (rng() < 0.5 ? Math.PI : 0), suv: rng() < 0.3 });
      const hx = axis === 'x' ? 2.3 : 0.95, hz = axis === 'x' ? 0.95 : 2.3;
      colliders.push({ t: 'p', x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz });
      radarRects.push({ x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, c: 'rgba(255,255,255,.3)' });
    }
  }
  for (const suv of [false, true]){
    const list = parked.filter(p => p.suv === suv);
    const f = new Fleet(grp, suv ? PARTS.suv : PARTS.sedan, list.length, rng);
    list.forEach((p, i) => f.set(i, p.x, 0, p.z, p.h, true));
    f.commit();
  }

  const add = (mesh, cast, recv) => { mesh.castShadow = !!cast; mesh.receiveShadow = !!recv; grp.add(mesh); return mesh; };
  for (const s of ['pombal', 'tileB', 'tileG', 'shop', 'arcade']) add(FB[s].mesh(MAT[s]), true, true);
  add(trim.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })), true, true);
  add(roofs.mesh(new THREE.MeshStandardMaterial({ map: roofTiles, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })), false, true);
  add(slabs.mesh(surfaceMat(CALCADA, [1, 1], { vertexColors: true })), false, true);
  add(waves.mesh(surfaceMat(WAVES, [1, 1], { vertexColors: true })), false, true);
  add(trackBed.mesh(surfaceMat(CALCADA, [1, 1], { vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })), false, true);
  add(lift.mesh(facMat(toTex(...(() => {
    const [m, g, e, ge] = canvasPair(128, 256);
    g.fillStyle = '#25272e'; g.fillRect(0, 0, 128, 256);
    g.strokeStyle = '#6f7380'; g.lineWidth = 4;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++){
      const x = 12 + i * 58, y = 12 + j * 82, w = 46, h = 70;
      for (const c of [g, ge]){
        c.fillStyle = c === g ? '#927349' : '#4e3c24';
        c.beginPath(); c.moveTo(x, y + h); c.lineTo(x, y + 22); c.quadraticCurveTo(x + 4, y + 6, x + w / 2, y); c.quadraticCurveTo(x + w - 4, y + 6, x + w, y + 22); c.lineTo(x + w, y + h); c.closePath(); c.fill();
      }
      g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + 22); g.quadraticCurveTo(x + 4, y + 6, x + w / 2, y); g.quadraticCurveTo(x + w - 4, y + 6, x + w, y + 22); g.lineTo(x + w, y + h); g.closePath(); g.stroke();
      g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2, y + h); g.moveTo(x, y + h * 0.55); g.lineTo(x + w, y + h * 0.55); g.stroke();
    }
    return [m, e];
  })()), { roughness: 0.6, metalness: 0.4 })), true, false);
  add(ao.mesh(new THREE.MeshBasicMaterial({ map: aoTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })), false, false);
  add(grass.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })), false, true);
  add(marks.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })), false, true);
  add(neon.mesh(new THREE.MeshBasicMaterial({ vertexColors: true })), false, false);
  add(poles.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5 })), true, false);
  add(housings.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 })), true, false);
  add(pools.mesh(new THREE.MeshBasicMaterial({ map: glowTexture, vertexColors: true, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })), false, false);
  for (const key of Object.keys(lampB)){
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    SIGNAL.mats[key] = mat;
    add(lampB[key].mesh(mat), false, false);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(lampP[key], 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTexture, color: LAMP_ON[key[2]], size: 1.6, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    SIGNAL.glows[key] = pts; grp.add(pts);
  }
  grp.add(lightCones(cones));
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(glowPts, 3));
  grp.add(new THREE.Points(pg, new THREE.PointsMaterial({ map: glowTexture, color: 0xffd79a, size: 4.6, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));

  const tTrunk = new THREE.CylinderGeometry(0.18, 0.26, 2.6, 6); tTrunk.translate(0, 1.3, 0);
  const tCrown = new THREE.IcosahedronGeometry(1.7, 0); tCrown.translate(0, 3.6, 0);
  const placeTree = (o, d) => { d.position.set(o.x, 0.3, o.z); d.rotation.set(0, o.rot, 0); d.scale.setScalar(o.s); };
  instanced(grp, tTrunk, flatMat({ color: 0x5e4433 }), trees, placeTree);
  instanced(grp, tCrown, flatMat(), trees, placeTree, (o, t) => t.set(0x3d7a4c).offsetHSL((o.v - 0.5) * 0.06, 0, (o.v - 0.5) * 0.1));
  initCityTraffic();
  CITY.built = true;
}

// ---------- City traffic: lane following, turns at intersections, obeys the signals ----------
// ### Each city car drives in the right-hand lane towards the next intersection (node), decides straight/left/right there,
// ### and follows a circular arc through the turn. It stops at red lights, keeps distance to the car ahead and to the player,
// ### and is stunned for a moment when hit. Leftover distance is carried over between straight and arc so motion stays smooth.
// ### Trams use the same logic, but Core.tramNext keeps them on the loop, which is where buildCity lays the tracks.
const npcs = [];
let npcFleets = null, npcHead = null, npcTail = null;
const N_NPC = 26, NPC_SUV = 8, N_TRAM = 3;
const { TRAM_LOOP } = Core;
const TRAM_SEGS = (() => {
  const T = TRAM_LOOP, out = [];
  for (let x = T.x0; x < T.x1; x += PITCH) out.push({ x, z: T.z0, dx: 1, dz: 0 }, { x: x + PITCH, z: T.z1, dx: -1, dz: 0 });
  for (let z = T.z0; z < T.z1; z += PITCH) out.push({ x: T.x1, z, dx: 0, dz: 1 }, { x: T.x0, z: z + PITCH, dx: 0, dz: -1 });
  return out;
})();
const rightOf = (dx, dz) => [-dz, dx];
const inGrid = (x, z) => Math.abs(x) <= 3 * PITCH + 1 && Math.abs(z) <= 3 * PITCH + 1;
function initCityTraffic(){
  const grp = CITY.group, rnd = mulberry32(99);
  npcFleets = { sedan: new Fleet(grp, PARTS.sedan, N_NPC - NPC_SUV, rnd), suv: new Fleet(grp, PARTS.suv, NPC_SUV, rnd), tram: new Fleet(grp, PARTS.tram, N_TRAM, rnd, 0xf2bd1c) };
  npcHead = new GlowPts(grp, (N_NPC + N_TRAM) * 2, 0xfff1cc, 2.6); npcTail = new GlowPts(grp, (N_NPC + N_TRAM) * 2, 0xff3344, 1.8);
  for (let i = 0; i < N_NPC; i++){
    const suv = i >= N_NPC - NPC_SUV;
    npcs.push({ fleet: suv ? 'suv' : 'sedan', fi: suv ? i - (N_NPC - NPC_SUV) : i, x: 0, z: 0, dx: 0, dz: 1, node: null, next: 's', speed: 0, cruise: 10, turn: null, stun: 0, on: false, h: 0 });
  }
  for (let i = 0; i < N_TRAM; i++) npcs.push({ fleet: 'tram', tram: true, fi: i, x: 0, z: 0, dx: 1, dz: 0, node: null, next: 's', speed: 0, cruise: 8, turn: null, stun: 0, on: false, h: 0 });
}
function chooseNext(n){
  if (n.tram) return Core.tramNext(n.node.x, n.node.z, n.dx, n.dz);
  const [rx, rz] = rightOf(n.dx, n.dz), opts = [];
  if (inGrid(n.node.x + n.dx * PITCH, n.node.z + n.dz * PITCH)) opts.push(['s', 0.55]);
  if (inGrid(n.node.x + rx * PITCH, n.node.z + rz * PITCH)) opts.push(['r', 0.25]);
  if (inGrid(n.node.x - rx * PITCH, n.node.z - rz * PITCH)) opts.push(['l', 0.2]);
  let tot = opts.reduce((s, o) => s + o[1], 0), r = Math.random() * tot;
  for (const [k, w] of opts){ r -= w; if (r <= 0) return k; }
  return opts[0][0];
}
function spawnNpc(n, minDist){
  for (let k = 0; k < 30; k++){
    let dx, dz, along, sx, sz;
    if (n.tram){
      const S = TRAM_SEGS[Math.floor(Math.random() * TRAM_SEGS.length)];
      dx = S.dx; dz = S.dz; sx = S.x; sz = S.z; along = 12 + Math.random() * 24;
    } else {
      const line = (Math.floor(Math.random() * 7) - 3) * PITCH, seg = (Math.floor(Math.random() * 6) - 3) * PITCH, axisX = Math.random() < 0.5, dir = Math.random() < 0.5 ? 1 : -1;
      dx = axisX ? dir : 0; dz = axisX ? 0 : dir;
      // the node this segment starts from: the far end of the block when driving against the axis
      sx = axisX ? (dir > 0 ? seg : seg + PITCH) : line; sz = axisX ? line : (dir > 0 ? seg : seg + PITCH);
      along = 12 + Math.random() * 24;
    }
    const [rx, rz] = rightOf(dx, dz);
    const x = sx + dx * along + rx * 3.5, z = sz + dz * along + rz * 3.5;
    if (Math.hypot(x - car.x, z - car.z) < minDist + (n.tram ? 4 : 0)) continue;
    if (npcs.some(o => o !== n && o.on && Math.hypot(o.x - x, o.z - z) < (n.tram || o.tram ? 16 : 12))) continue;
    n.x = x; n.z = z; n.dx = dx; n.dz = dz;
    n.node = { x: sx + dx * PITCH, z: sz + dz * PITCH };
    n.next = chooseNext(n); n.turn = null; n.stun = 0; n.on = true;
    n.cruise = n.tram ? 8 : 9 + Math.random() * 4; n.speed = n.cruise * 0.6;
    return;
  }
  n.on = false;
}
// over = metres already driven past the turn entry, so the car continues smoothly onto the arc
function startTurn(n, kind, over){
  const [rx, rz] = rightOf(n.dx, n.dz), nx = n.node.x, nz = n.node.z;
  const P0x = nx - n.dx * 7 + rx * 3.5, P0z = nz - n.dz * 7 + rz * 3.5;
  let d2x, d2z, Cx, Cz, R;
  if (kind === 'r'){ d2x = rx; d2z = rz; Cx = nx - n.dx * 7 + rx * 7; Cz = nz - n.dz * 7 + rz * 7; R = 3.5; }
  else { d2x = -rx; d2z = -rz; Cx = nx - n.dx * 7 - rx * 7; Cz = nz - n.dz * 7 - rz * 7; R = 10.5; }
  const [r2x, r2z] = rightOf(d2x, d2z);
  const P1x = nx + d2x * 7 + r2x * 3.5, P1z = nz + d2z * 7 + r2z * 3.5;
  const a0 = Math.atan2(P0z - Cz, P0x - Cx), a1 = Math.atan2(P1z - Cz, P1x - Cx);
  const delta = wrapAngle(a1 - a0);
  const len = R * Math.abs(delta), t = clamp((over || 0) / len, 0, 0.99), a = a0 + delta * t;
  n.x = Cx + R * Math.cos(a); n.z = Cz + R * Math.sin(a);
  n.turn = { Cx, Cz, R, a0, delta, t, len, d2x, d2z, P1x, P1z };
}
function npcGap(n, fx, fz){
  const rx = -fz, rz = fx;
  let gap = Infinity;
  const test = (x, z, lat) => {
    const rel = (x - n.x) * fx + (z - n.z) * fz;
    if (rel <= 0 || rel > 40) return;
    if (Math.abs((x - n.x) * rx + (z - n.z) * rz) < lat && rel < gap) gap = rel;
  };
  for (const o of npcs) if (o !== n && o.on) test(o.x, o.z, o.tram ? 2.6 : 2.2);
  test(car.x, car.z, 2.6);
  for (const p of police) if (p.active) test(p.x, p.z, 2.4);
  return gap;
}
function updateNpcs(dt){
  for (const n of npcs){
    if (!n.on){ if (Math.random() < dt) spawnNpc(n, 60); continue; }
    if (n.stun > 0){ n.stun -= dt; n.speed = Math.max(0, n.speed - 25 * dt); }
    if (n.turn){
      const T = n.turn;
      const fx0 = -Math.sin(T.a0 + T.delta * T.t) * Math.sign(T.delta), fz0 = Math.cos(T.a0 + T.delta * T.t) * Math.sign(T.delta);
      const gap = npcGap(n, fx0, fz0);
      const desired = n.stun > 0 ? 0 : Math.min(n.tram ? 4 : 6.5, Math.max(0, (gap - (n.tram ? 8.5 : 6)) * 1.0));
      n.speed += clamp((desired - n.speed) * Math.min(1, dt * 3), -14 * dt, 4 * dt);
      const tNext = T.t + Math.max(0, n.speed) * dt / T.len;
      if (tNext >= 1){
        const rest = (tNext - 1) * T.len;
        n.dx = T.d2x; n.dz = T.d2z;
        n.x = T.P1x + n.dx * rest; n.z = T.P1z + n.dz * rest; n.h = Math.atan2(n.dx, n.dz);
        n.node = { x: n.node.x + n.dx * PITCH, z: n.node.z + n.dz * PITCH };
        n.turn = null; n.next = chooseNext(n);
      } else {
        T.t = tNext;
        const a = T.a0 + T.delta * T.t;
        n.x = T.Cx + T.R * Math.cos(a); n.z = T.Cz + T.R * Math.sin(a);
        n.h = Math.atan2(-Math.sin(a) * Math.sign(T.delta), Math.cos(a) * Math.sign(T.delta));
      }
    } else {
      const toNode = (n.node.x - n.x) * n.dx + (n.node.z - n.z) * n.dz;
      let desired = n.stun > 0 ? 0 : n.cruise;
      const st = lightState(n.dx !== 0 ? 'x' : 'z', nodeGroup(n.node.x, n.node.z));
      if (toNode > 11.6 && toNode < 45 && st !== 'g' && !(st === 'y' && toNode < 17)) desired = Math.min(desired, Math.max(0, (toNode - 12.2) * 0.8));
      if (n.next !== 's' && toNode < 22) desired = Math.min(desired, 7);
      const gap = npcGap(n, n.dx, n.dz);
      desired = Math.min(desired, Math.max(0, (gap - (n.tram ? 8.5 : 6.5)) * 1.0));
      n.speed += clamp((desired - n.speed) * Math.min(1, dt * 3), -14 * dt, 4 * dt);
      n.x += n.dx * n.speed * dt; n.z += n.dz * n.speed * dt;
      n.h = Math.atan2(n.dx, n.dz);
      const left = (n.node.x - n.x) * n.dx + (n.node.z - n.z) * n.dz;
      if (left <= 7){
        if (n.next === 's'){ n.node = { x: n.node.x + n.dx * PITCH, z: n.node.z + n.dz * PITCH }; n.next = chooseNext(n); }
        else startTurn(n, n.next, 7 - left);
      }
    }
  }
  for (const n of npcs){
    npcFleets[n.fleet].set(n.fi, n.x, 0, n.z, n.h, n.on);
    vehicleGlow(npcHead, npcTail, npcs.indexOf(n), n.x, n.z, n.h, n.tram ? 4.25 : 2.3, n.tram ? 4.25 : 2.3, n.tram ? 1.3 : 0.75, n.tram ? 0.1 : 0.62, n.on);
  }
  npcFleets.sedan.commit(); npcFleets.suv.commit(); npcFleets.tram.commit(); npcHead.commit(); npcTail.commit();
  if (CITY.water) CITY.water.material.normalMap.offset.x += dt * 0.012;
}
function resetNpcs(){ npcs.forEach(n => { n.on = false; }); npcs.forEach(n => spawnNpc(n, 25)); }

// ---------- Highway ----------
// ### buildHighway creates a 4 km three-lane motorway in both directions: asphalt, lane markings, median barrier,
// ### guard rails, median lights, overhead signs with the remaining distance, forests, hills and a skyline at the finish.
function makeSign(dist){
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#0f5c3c'; g.fillRect(0, 0, 512, 160);
  g.strokeStyle = '#f2f2f2'; g.lineWidth = 6; g.strokeRect(9, 9, 494, 142);
  g.fillStyle = '#f2f2f2'; g.textBaseline = 'middle';
  g.font = '700 54px "Bricolage Grotesque", "Segoe UI", sans-serif'; g.fillText('FINISH', 40, 60);
  g.font = '700 40px "JetBrains Mono", Consolas, monospace'; g.fillText(dist, 40, 116);
  g.beginPath(); g.moveTo(440, 34); g.lineTo(478, 80); g.lineTo(452, 80); g.lineTo(452, 128); g.lineTo(428, 128); g.lineTo(428, 80); g.lineTo(402, 80); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.anisotropy = ANISO; t.encoding = THREE.sRGBEncoding;
  return t;
}

function buildHighway(){
  const grp = HWY.group, colliders = HWY.colliders, radarRects = HWY.radar;
  const rng = mulberry32(77);
  const { Z0, Z1 } = HW;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, Z1 - Z0 + 1400), surfaceMat(GRASS, [200, Math.round((Z1 - Z0 + 1400) / 8)], { color: 0x8a9a8c }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.03, (Z0 + Z1) / 2); ground.receiveShadow = true;
  grp.add(ground);
  const road = new Batch(), marks = new Batch(), conc = new Batch(), metal = new Batch(), neon = new Batch(), pools = new Batch();
  road.top(-17.5, 17.5, 0, Z0, Z1, C(0xb8bcc8), [-17.5 / 8, Z1 / 8, 17.5 / 8, Z0 / 8]);
  road.top(-17.5, -12.95, 0.004, Z0, Z1, C(0xd0d3da), [-17.5 / 8, Z1 / 8, -12.95 / 8, Z0 / 8]);
  road.top(12.95, 17.5, 0.004, Z0, Z1, C(0xd0d3da), [12.95 / 8, Z1 / 8, 17.5 / 8, Z0 / 8]);
  const wht = C(0xdfe2ea);
  for (const s of [-1, 1]){
    const line = (a, b, z0, z1) => marks.top(Math.min(s * a, s * b), Math.max(s * a, s * b), 0.02, z0, z1, wht);
    line(1.45, 1.6, Z0, Z1);
    line(12.8, 12.95, Z0, Z1);
    for (const lx of [5.275, 9.025]) for (let z = Z0; z < Z1; z += 12) line(lx - 0.08, lx + 0.08, z, z + 4.5);
  }
  for (let k = 0; k < 12; k++) for (let q = 0; q < 2; q++){
    const x0 = -12.8 + k * 0.94, z0 = HW.LEN - 0.9 + q * 0.9;
    if ((k + q) % 2 === 0) marks.top(x0, x0 + 0.94, 0.025, z0, z0 + 0.9, wht);
  }
  conc.sides(-0.45, 0.45, 0, 0.35, Z0, Z1, C(0x9a9caa));
  conc.sides(-0.22, 0.22, 0.35, 0.95, Z0, Z1, C(0xa8aab6));
  conc.top(-0.22, 0.22, 0.95, Z0, Z1, C(0xb4b6c2));
  colliders.push({ t: 'w', x0: -0.5, x1: 0.5, z0: Z0, z1: Z1 });
  radarRects.push({ x0: -13, x1: 13, z0: Z0, z1: Z1, c: 'rgba(255,255,255,.07)' });
  radarRects.push({ x0: -0.5, x1: 0.5, z0: Z0, z1: Z1, c: 'rgba(255,255,255,.4)' });
  for (const s of [-1, 1]){
    const x = s * HW.rail;
    metal.box(x - 0.08, x + 0.08, 0.55, 0.9, Z0, Z1, C(0xb9c0cc));
    for (let z = Z0; z < Z1; z += 6){ const px = x + s * 0.2; metal.box(px - 0.07, px + 0.07, 0, 0.8, z - 0.07, z + 0.07, C(0x8a919d)); }
    colliders.push({ t: 'w', x0: x - 0.3, x1: x + 0.3, z0: Z0, z1: Z1 });
    radarRects.push({ x0: x - 0.3, x1: x + 0.3, z0: Z0, z1: Z1, c: 'rgba(255,255,255,.4)' });
  }
  for (const z of [Z0, Z1]){
    conc.box(-17.5, 17.5, 0, 1.2, z - 0.6, z + 0.6, C(0xd8c25a));
    colliders.push({ t: 'w', x0: -18, x1: 18, z0: z - 0.8, z1: z + 0.8 });
  }
  const glow = [], cones = [];
  for (let z = 30; z < Z1; z += 55){
    metal.box(-0.15, 0.15, 0.95, 11, z - 0.15, z + 0.15, C(0x6c7382));
    metal.box(-4.6, 4.6, 10.8, 11.05, z - 0.1, z + 0.1, C(0x6c7382));
    for (const s of [-1, 1]){
      const hx = s * 4.6;
      neon.box(hx - 0.6, hx + 0.6, 10.6, 10.85, z - 0.25, z + 0.25, C(0xffe1b0));
      glow.push(hx, 10.6, z);
      cones.push(coneGeo(hx, z, 10.6, 5));
      pools.top(hx - 9, hx + 9, 0.03, z - 9, z + 9, C(0xffc98a));
    }
  }
  grp.add(lightCones(cones, 0.12));
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(glow, 3));
  grp.add(new THREE.Points(pg, new THREE.PointsMaterial({ map: glowTexture, color: 0xffd79a, size: 9, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  for (let z = 400; z < HW.LEN; z += 800){
    for (const s of [-1, 1]){ const x = s * 16.9; metal.box(x - 0.25, x + 0.25, 0, 7.6, z - 0.25, z + 0.25, C(0x7d8594)); }
    metal.box(-17.2, 17.2, 7.0, 7.55, z - 0.3, z + 0.3, C(0x7d8594));
    metal.box(-13.1, -1.9, 5.0, 8.6, z - 0.32, z - 0.22, C(0x5a606c));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(11, 3.44), new THREE.MeshStandardMaterial({ map: makeSign(((HW.LEN - z) / 1000).toFixed(1) + ' km'), emissive: 0xffffff, emissiveIntensity: 0.28, roughness: 0.5 }));
    sign.material.emissiveMap = sign.material.map;
    sign.position.set(-7.5, 6.8, z - 0.35); sign.rotation.y = Math.PI;
    grp.add(sign);
  }
  const trees = [];
  for (let i = 0; i < 950; i++){
    const side = rng() < 0.5 ? -1 : 1;
    trees.push({ x: side * (21 + rng() * rng() * 130), z: Z0 - 100 + rng() * (Z1 - Z0 + 300), s: 0.9 + rng() * 1.0, rot: rng() * 6.28, v: rng(), pine: rng() < 0.6 });
  }
  const pines = trees.filter(t => t.pine), rounds = trees.filter(t => !t.pine);
  const place = (o, d) => { d.position.set(o.x, 0, o.z); d.rotation.set(0, o.rot, 0); d.scale.setScalar(o.s); };
  const trunk = new THREE.CylinderGeometry(0.22, 0.32, 2.2, 6); trunk.translate(0, 1.1, 0);
  const cone1 = new THREE.ConeGeometry(2.0, 4.2, 7); cone1.translate(0, 3.6, 0);
  const cone2 = new THREE.ConeGeometry(1.4, 3.2, 7); cone2.translate(0, 5.8, 0);
  const crown = new THREE.IcosahedronGeometry(2.2, 0); crown.translate(0, 3.8, 0);
  const leafTint = base => (o, t) => t.set(base).offsetHSL((o.v - 0.5) * 0.05, 0, (o.v - 0.5) * 0.1);
  instanced(grp, trunk, flatMat({ color: 0x5e4433 }), trees, place);
  instanced(grp, cone1, flatMat(), pines, place, leafTint(0x2c5a40));
  instanced(grp, cone2, flatMat(), pines, place, leafTint(0x2c5a40));
  instanced(grp, crown, flatMat(), rounds, place, leafTint(0x3d6e44));
  const hillGeo = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 46; i++){
    const side = rng() < 0.5 ? -1 : 1;
    const h = new THREE.Mesh(hillGeo, flatMat({ color: rng() < 0.5 ? 0x2b3a3c : 0x33404a, roughness: 1 }));
    h.scale.set(60 + rng() * 90, 18 + rng() * 45, 60 + rng() * 90);
    h.position.set(side * (170 + rng() * 260), -6, Z0 + rng() * (Z1 - Z0 + 400));
    grp.add(h);
  }
  const FB = { office: new Batch(), glass: new Batch() }, roofs = new Batch();
  for (let i = 0; i < 70; i++){
    const side = rng() < 0.5 ? -1 : 1;
    const x = side * (40 + rng() * 210), z = HW.LEN - 250 + rng() * 800;
    const w = 12 + Math.floor(rng() * 6) * 3, d = 12 + Math.floor(rng() * 6) * 3, h = 20 + Math.floor(rng() * 22) * FLOOR;
    const style = rng() < 0.6 ? 'glass' : 'office';
    FB[style].sides(x - w / 2, x + w / 2, 0, h, z - d / 2, z + d / 2, C(PAL[style][Math.floor(rng() * 5)]), TU, TV, Math.floor(rng() * 8) / 8, Math.floor(rng() * 8) / 8);
    roofs.top(x - w / 2, x + w / 2, h, z - d / 2, z + d / 2, C(0x343947));
  }
  const add = (mesh, cast, recv) => { mesh.castShadow = !!cast; mesh.receiveShadow = !!recv; grp.add(mesh); return mesh; };
  add(road.mesh(surfaceMat(ASPHALT, [1, 1], { vertexColors: true })), false, true);
  add(marks.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })), false, true);
  add(conc.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })), true, true);
  add(metal.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 })), true, true);
  add(neon.mesh(new THREE.MeshBasicMaterial({ vertexColors: true })), false, false);
  add(pools.mesh(new THREE.MeshBasicMaterial({ map: glowTexture, vertexColors: true, transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })), false, false);
  add(FB.office.mesh(MAT.office), false, false);
  add(FB.glass.mesh(MAT.glass), false, false);
  add(roofs.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })), false, false);
  initTraffic();
  tuneEnv(grp);
  HWY.built = true;
}

// ---------- Highway traffic ----------
// ### Cars, SUVs and lorries move along fixed lanes. Each one cruises at its lane speed, slows behind the vehicle ahead
// ### (including the player and police) and is recycled ahead of or behind the player when it leaves the visible window.
const traffic = [];
let hwFleets = null, headPts = null, tailPts = null;
const HW_FLEET = { sedan: 30, suv: 14, truck: 10 };
const VDIM = { sedan: { len: 4.6, hw: 0.95, front: 2.3, back: 2.3, y: 0.75, off: 0.62 }, suv: { len: 4.6, hw: 1.0, front: 2.3, back: 2.3, y: 0.86, off: 0.62 }, truck: { len: 9.7, hw: 1.3, front: 4.35, back: 5.35, y: 1.05, off: 0.9 } };
function initTraffic(){
  const grp = HWY.group, rnd = mulberry32(5);
  hwFleets = { sedan: new Fleet(grp, PARTS.sedan, HW_FLEET.sedan, rnd), suv: new Fleet(grp, PARTS.suv, HW_FLEET.suv, rnd), truck: new Fleet(grp, PARTS.truck, HW_FLEET.truck, rnd) };
  const total = HW_FLEET.sedan + HW_FLEET.suv + HW_FLEET.truck;
  headPts = new GlowPts(grp, total * 2, 0xfff1cc, 3.2); tailPts = new GlowPts(grp, total * 2, 0xff3344, 2.2);
  for (const type of ['sedan', 'suv', 'truck']) for (let i = 0; i < HW_FLEET[type]; i++){
    const d = VDIM[type];
    traffic.push({ type, mi: i, len: d.len, hw: d.hw, dir: i < HW_FLEET[type] * 0.6 ? 1 : -1, x: 0, z: 0, speed: 0, cruise: 30, on: false });
  }
}
function laneSet(t){ return t.dir > 0 ? HW.our : HW.opp; }
function spawnVehicle(t, zMin, zMax){
  const lanes = laneSet(t);
  for (let k = 0; k < 24; k++){
    const li = t.type === 'truck' ? 1 + Math.floor(Math.random() * 2) : Math.floor(Math.random() * 3);
    const x = lanes[li], z = zMin + Math.random() * (zMax - zMin);
    if (z < HW.Z0 + 20 || z > HW.Z1 - 30) continue;
    if (traffic.some(o => o !== t && o.on && o.dir === t.dir && Math.abs(o.x - x) < 1 && Math.abs(o.z - z) < 30 + (o.len + t.len) / 2)) continue;
    if (Math.abs(car.x - x) < 2.6 && Math.abs(car.z - z) < 40) continue;
    t.x = x; t.z = z; t.on = true;
    t.cruise = t.type === 'truck' ? 22 + Math.random() * 3 : [34, 29, 24][li] + Math.random() * 5;
    t.speed = t.cruise;
    return;
  }
  t.on = false;
}
function resetTraffic(){
  traffic.forEach(t => { t.on = false; });
  traffic.forEach(t => spawnVehicle(t, car.z - 120, car.z + 700));
}
function updateTraffic(dt){
  for (const t of traffic){
    if (!t.on){ if (Math.random() < dt * 2) spawnVehicle(t, car.z + 380, car.z + 760); continue; }
    let gap = Infinity, aheadV = 0;
    for (const o of traffic){
      if (o === t || !o.on || o.dir !== t.dir || Math.abs(o.x - t.x) > 1) continue;
      const dz = (o.z - t.z) * t.dir;
      if (dz <= 0) continue;
      const g = dz - (o.len + t.len) / 2;
      if (g < gap){ gap = g; aheadV = o.speed; }
    }
    const obstacle = (x, z, v) => {
      if (Math.abs(x - t.x) > 2.6) return;
      const dz = (z - t.z) * t.dir;
      if (dz <= 0) return;
      const g = dz - (t.len / 2 + 2.4);
      if (g < gap){ gap = g; aheadV = Math.max(0, v * t.dir); }
    };
    obstacle(car.x, car.z, car.speed * Math.cos(car.heading));
    if (courier && courier.on) obstacle(courier.x, courier.z, courier.speed);
    for (const p of police) if (p.active) obstacle(p.x, p.z, p.speed * Math.cos(p.heading));
    let desired = t.cruise;
    if (gap < 45) desired = Math.min(desired, aheadV + (gap - 10) * 0.5);
    t.speed = Math.max(0, t.speed + clamp((desired - t.speed) * Math.min(1, dt * 3), -14 * dt, 3.5 * dt));
    if (gap < 1) t.speed = Math.min(t.speed, aheadV);
    t.z += t.speed * t.dir * dt;
    const rel = t.z - car.z;
    if (rel < -180) spawnVehicle(t, car.z + 380, car.z + 760);
    else if (rel > 820){ if (t.dir > 0) spawnVehicle(t, car.z - 170, car.z - 110); else t.on = false; }
    if (t.on && (t.z < HW.Z0 + 10 || t.z > HW.Z1 - 20)) t.on = false;
  }
  traffic.forEach((t, i) => {
    const h = t.dir > 0 ? 0 : Math.PI, d = VDIM[t.type];
    hwFleets[t.type].set(t.mi, t.x, 0, t.z, h, t.on);
    vehicleGlow(headPts, tailPts, i, t.x, t.z, h, d.front, d.back, d.y, d.off, t.on);
  });
  Object.values(hwFleets).forEach(f => f.commit());
  headPts.commit(); tailPts.commit();
}

// ---------- Countryside: a winding two-lane road through hills, fields, farms and a village ----------
// ### The road is a Catmull-Rom spline sampled every ~2 m. roadPoint(s, lat) converts "distance along the road + sideways
// ### offset" into world coordinates (interpolated, so traffic glides); roadQuery does the reverse for the player and police.
// ### The terrain is a height field: hills from noise, flattened near the road. Fields, forests, farms, a village with a
// ### church and distant mountains are placed around it. Colliders sit in a 24 m grid (collidersNear) so thousands of trees
// ### stay cheap to test. Country traffic drives both directions on the spline with the same following logic.
const CTRY = { group: new THREE.Group(), colliders: [], radar: [], grid: new Map(), built: false };
scene.add(CTRY.group);
const ROAD = { pts: [], step: 2, len: 0, lane: 1.75, half: 4.1 };
const TERR = { x0: 0, z0: 0, cell: COARSE ? 10 : 6, nx: 0, nz: 0, h: null };
const roadPos = { s: 0, lat: 0, ri: undefined };
const DETAIL = surfaceSet(COARSE ? 256 : 512, 21, (h, p) => { const k = 175 + h * 55 + p * 25; return [k, k, k]; }, h => 0.85 + h * 0.15, 2.2);
function hash2(ix, iz, seed){
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed || 1, 1103515245);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z, seed){
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
const fbm = (x, z, seed) => vnoise(x, z, seed) * 0.6 + vnoise(x * 2.03 + 11, z * 2.03 - 7, seed) * 0.27 + vnoise(x * 4.1 - 3, z * 4.1 + 5, seed) * 0.13;
// Interpolates between the 2 m samples so vehicles glide instead of stepping from point to point
function roadPoint(s, lat){
  const P = ROAD.pts, f = clamp(s / ROAD.step, 0, P.length - 1.0001), i = Math.floor(f), u = f - i, a = P[i], b = P[i + 1];
  let rx = a.rx + (b.rx - a.rx) * u, rz = a.rz + (b.rz - a.rz) * u;
  const l = Math.hypot(rx, rz) || 1; rx /= l; rz /= l;
  const x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u;
  return { x: x + rx * lat, z: z + rz * lat, h: Math.atan2(rz, -rx) };
}
const roadHeadingAt = s => roadPoint(s, 0).h;
// Nearest point on the road: arc length s and signed lateral offset (positive = right of travel)
function roadQuery(x, z, cache){
  const P = ROAD.pts, n = P.length;
  let best = Infinity, bi = 0;
  const scan = (lo, hi, st) => { for (let i = lo; i <= hi; i += st){ const dx = x - P[i].x, dz = z - P[i].z, d = dx * dx + dz * dz; if (d < best){ best = d; bi = i; } } };
  const hint = cache && cache.ri !== undefined ? cache.ri : -1;
  if (hint >= 0) scan(Math.max(0, hint - 60), Math.min(n - 1, hint + 60), 1);
  if (hint < 0 || best > 900){ best = Infinity; scan(0, n - 1, 5); const c = bi; scan(Math.max(0, c - 5), Math.min(n - 1, c + 5), 1); }
  if (cache) cache.ri = bi;
  const p = P[bi], dx = x - p.x, dz = z - p.z;
  return { s: bi * ROAD.step + dx * p.tx + dz * p.tz, lat: dx * p.rx + dz * p.rz };
}
function terrainH(x, z){
  if (!TERR.h) return 0;
  const gx = clamp((x - TERR.x0) / TERR.cell, 0, TERR.nx - 1.001), gz = clamp((z - TERR.z0) / TERR.cell, 0, TERR.nz - 1.001);
  const ix = Math.floor(gx), iz = Math.floor(gz), u = gx - ix, v = gz - iz, n = TERR.nx, H = TERR.h;
  const a = H[iz * n + ix], b = H[iz * n + ix + 1], c = H[(iz + 1) * n + ix], d = H[(iz + 1) * n + ix + 1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// Colliders live in a 24 m grid so thousands of trees stay cheap to test
function gridAdd(c){
  const G = CTRY.grid, circ = c.t === 'c';
  const x0 = circ ? c.x - c.r : c.x0, x1 = circ ? c.x + c.r : c.x1, z0 = circ ? c.z - c.r : c.z0, z1 = circ ? c.z + c.r : c.z1;
  for (let i = Math.floor(x0 / 24); i <= Math.floor(x1 / 24); i++) for (let j = Math.floor(z0 / 24); j <= Math.floor(z1 / 24); j++){
    const k = i + ',' + j; let a = G.get(k); if (!a) G.set(k, a = []); a.push(c);
  }
  CTRY.colliders.push(c);
}
let nearStamp = 0;
function collidersNear(x, z){
  if (W !== CTRY) return W.colliders;
  nearStamp++;
  const out = [], cx = Math.floor(x / 24), cz = Math.floor(z / 24);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++){
    const a = CTRY.grid.get((cx + i) + ',' + (cz + j));
    if (a) for (const c of a) if (c._seen !== nearStamp){ c._seen = nearStamp; out.push(c); }
  }
  return out;
}
// Strip that follows the road between two lateral offsets (a < b)
function ribbon(a, b, y, keep){
  const P = ROAD.pts, pos = [], uv = [], nor = [], idx = [];
  for (let i = 0; i < P.length; i++){
    const p = P[i], s = i * ROAD.step, base = pos.length / 3;
    pos.push(p.x + p.rx * a, y, p.z + p.rz * a, p.x + p.rx * b, y, p.z + p.rz * b);
    nor.push(0, 1, 0, 0, 1, 0);
    uv.push(a / 8, s / 8, b / 8, s / 8);
    if (i > 0 && (!keep || keep(s))) idx.push(base - 2, base - 1, base, base - 1, base + 1, base);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeBoundingSphere();
  return g;
}

const ctraffic = [];
let ctryFleets = null, ctryHead = null, ctryTail = null;
function buildCountry(){
  const grp = CTRY.group, rng = mulberry32(314);
  // Road centreline through seeded bends
  const ctrl = [new THREE.Vector3(0, 0, -80), new THREE.Vector3(0, 0, 0)];
  let cx = 0;
  for (let i = 1; i <= 13; i++){ cx = clamp(cx + (rng() - 0.5) * 320, -400, 400); ctrl.push(new THREE.Vector3(cx, 0, i * 260 + (rng() - 0.5) * 60)); }
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  const L = curve.getLength(), n = Math.floor(L / 2), sp = curve.getSpacedPoints(n);
  ROAD.step = L / n; ROAD.len = L;
  ROAD.pts = sp.map((p, i) => {
    const a = sp[Math.max(0, i - 2)], b = sp[Math.min(n, i + 2)];
    let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    return { x: p.x, z: p.z, tx, tz, rx: -tz, rz: tx };
  });

  // Height field: rolling hills, flat along the road
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of ROAD.pts){ minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const CL = TERR.cell;
  TERR.x0 = Math.floor((minX - 520) / CL) * CL; TERR.z0 = Math.floor((minZ - 420) / CL) * CL;
  TERR.nx = Math.ceil((maxX + 520 - TERR.x0) / CL) + 1; TERR.nz = Math.ceil((maxZ + 420 - TERR.z0) / CL) + 1;
  const B = new Map();
  ROAD.pts.forEach((p, i) => { if (i % 2) return; const k = Math.floor(p.x / 30) + ',' + Math.floor(p.z / 30); let a = B.get(k); if (!a) B.set(k, a = []); a.push(p); });
  const roadDist = (x, z) => {
    let best = 1e9; const ix = Math.floor(x / 30), iz = Math.floor(z / 30);
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++){
      const a = B.get((ix + i) + ',' + (iz + j));
      if (a) for (const p of a){ const d = (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z); if (d < best) best = d; }
    }
    return Math.min(Math.sqrt(best), 120);
  };
  const NX = TERR.nx, NZ = TERR.nz, total = NX * NZ;
  TERR.h = new Float32Array(total);
  const D = new Float32Array(total);
  const hillH = (x, z) => (fbm(x * 0.0032, z * 0.0032, 3) * 0.5 + 0.5) * 42 + fbm(x * 0.013, z * 0.013, 5) * 6;
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++){
    const x = TERR.x0 + i * CL, z = TERR.z0 + j * CL, k = j * NX + i, d = roadDist(x, z);
    D[k] = d;
    TERR.h[k] = hillH(x, z) * sstep(9, 75, d) - (d > 5.5 && d < 9 ? 0.3 : 0);
  }
  const isForest = (x, z, y) => fbm(x * 0.006 + 40, z * 0.006, 7) > 0.18 || y > 34;
  const FIELD = [0xb59f55, 0x5f7c3a, 0x7b8f45, 0x6a533b, 0x8a9a4a, 0x4e6b34, 0xa08c4a].map(h => C(h));
  const forestC = C(0x2c4529), vergeC = C(0x55733a), cc = new THREE.Color();
  const pos = new Float32Array(total * 3), col = new Float32Array(total * 3), uv = new Float32Array(total * 2), idx = [];
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++){
    const k = j * NX + i, x = TERR.x0 + i * CL, z = TERR.z0 + j * CL, y = TERR.h[k], d = D[k];
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    uv[k * 2] = x / 8; uv[k * 2 + 1] = z / 8;
    cc.copy(FIELD[Math.floor(hash2(Math.floor((x + z * 0.35) / 90), Math.floor((z - x * 0.25) / 70), 9) * FIELD.length)]);
    if (isForest(x, z, y)) cc.copy(forestC);
    if (d < 14) cc.lerp(vergeC, 1 - sstep(8, 14, d));
    cc.multiplyScalar(0.9 + hash2(i, j, 4) * 0.18);
    col[k * 3] = cc.r; col[k * 3 + 1] = cc.g; col[k * 3 + 2] = cc.b;
    if (i < NX - 1 && j < NZ - 1) idx.push(k, k + NX, k + 1, k + 1, k + NX, k + NX + 1);
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  tg.setIndex(idx); tg.computeVertexNormals(); tg.computeBoundingSphere();
  const terrain = new THREE.Mesh(tg, surfaceMat(DETAIL, [1, 1], { vertexColors: true }));
  terrain.receiveShadow = true;
  grp.add(terrain);

  // Road surface, gravel shoulders and markings
  const asphalt = new THREE.Mesh(ribbon(-ROAD.half, ROAD.half, 0.03), surfaceMat(ASPHALT, [1, 1], { color: 0xb8bcc8, side: THREE.DoubleSide }));
  asphalt.receiveShadow = true; grp.add(asphalt);
  const gravel = new THREE.Mesh(mergeGeos([ribbon(-5.4, -ROAD.half, 0.025), ribbon(ROAD.half, 5.4, 0.025)]), surfaceMat(DETAIL, [1, 1], { color: 0x857c6c, side: THREE.DoubleSide }));
  gravel.receiveShadow = true; grp.add(gravel);
  const paint = new THREE.MeshStandardMaterial({ color: 0xe6e8ee, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  grp.add(new THREE.Mesh(mergeGeos([ribbon(-3.8, -3.62, 0.04), ribbon(3.62, 3.8, 0.04), ribbon(-0.07, 0.07, 0.04, s => (s % 12) < 4.5)]), paint));

  // Telegraph poles with wires along the left verge
  const wood = new Batch(), wires = [];
  let prev = null;
  for (let s = 20; s < L - 20; s += 42){
    const pt = roadPoint(s, -7.6), y0 = terrainH(pt.x, pt.z);
    wood.box(pt.x - 0.13, pt.x + 0.13, y0, y0 + 7.6, pt.z - 0.13, pt.z + 0.13, C(0x4a3a2c));
    wood.box(pt.x - 0.75, pt.x + 0.75, y0 + 7.05, y0 + 7.2, pt.z - 0.07, pt.z + 0.07, C(0x4a3a2c));
    gridAdd({ t: 'c', x: pt.x, z: pt.z, r: 0.3 });
    const top = [pt.x, y0 + 7.15, pt.z];
    if (prev) wires.push(prev[0] - 0.6, prev[1], prev[2], top[0] - 0.6, top[1], top[2], prev[0] + 0.6, prev[1], prev[2], top[0] + 0.6, top[1], top[2]);
    prev = top;
  }
  const wm = wood.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })); wm.castShadow = true; grp.add(wm);
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
  grp.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x15161a })));

  // Forests, hedgerow trees and single trees in the fields
  const pines = [], rounds = [];
  const want = COARSE ? 1500 : 3200;
  for (let k = 0; k < 14000 && pines.length + rounds.length < want; k++){
    const x = TERR.x0 + rng() * (NX - 1) * CL, z = TERR.z0 + rng() * (NZ - 1) * CL, d = roadDist(x, z);
    if (d < 9.5) continue;
    const y = terrainH(x, z), forest = isForest(x, z, y);
    if (!forest && rng() > 0.05) continue;
    const t = { x, z, y, s: 0.85 + rng() * 0.95, rot: rng() * 6.28, v: rng() };
    (rng() < (forest ? 0.7 : 0.3) ? pines : rounds).push(t);
    if (d < 120) gridAdd({ t: 'c', x, z, r: 0.5 * t.s });
  }
  const placeT = (o, dm) => { dm.position.set(o.x, o.y - 0.15, o.z); dm.rotation.set(0, o.rot, 0); dm.scale.setScalar(o.s); };
  const trunk = new THREE.CylinderGeometry(0.22, 0.32, 2.2, 6); trunk.translate(0, 1.1, 0);
  const cone1 = new THREE.ConeGeometry(2.0, 4.2, 8); cone1.translate(0, 3.6, 0);
  const cone2 = new THREE.ConeGeometry(1.4, 3.2, 8); cone2.translate(0, 5.8, 0);
  const crown = new THREE.IcosahedronGeometry(2.3, 1); crown.translate(0, 3.9, 0);
  const leafTint = base => (o, t) => t.set(base).offsetHSL((o.v - 0.5) * 0.05, 0, (o.v - 0.5) * 0.1);
  instanced(grp, trunk, flatMat({ color: 0x5e4433 }), pines.concat(rounds), placeT);
  instanced(grp, cone1, flatMat(), pines, placeT, leafTint(0x2a5038));
  instanced(grp, cone2, flatMat(), pines, placeT, leafTint(0x2a5038));
  instanced(grp, crown, flatMat(), rounds, placeT, leafTint(0x3d6a3e));

  // Farmhouses, barns, a village with a church near the finish
  const FBh = new Batch(), plain = new Batch(), roofsB = new Batch();
  function roof(x0, x1, z0, z1, h, col){
    const o = 0.45, zc = (z0 + z1) / 2, ph = h + (z1 - z0) * 0.42;
    roofsB.quad([x1 + o, h - 0.2, z0 - o], [x0 - o, h - 0.2, z0 - o], [x0 - o, ph, zc], [x1 + o, ph, zc], [0, 0.7, -0.7], [0, 0, 1, 1], col);
    roofsB.quad([x0 - o, h - 0.2, z1 + o], [x1 + o, h - 0.2, z1 + o], [x1 + o, ph, zc], [x0 - o, ph, zc], [0, 0.7, 0.7], [0, 0, 1, 1], col);
    return ph;
  }
  function gable(batch, x0, x1, z0, z1, y, h, col){
    const zc = (z0 + z1) / 2, ph = y + h + (z1 - z0) * 0.42;
    batch.quad([x0, y + h, z0], [x0, y + h, z1], [x0, ph, zc], [x0, ph, zc], [-1, 0, 0], [0, 0, 0, 0], col);
    batch.quad([x1, y + h, z1], [x1, y + h, z0], [x1, ph, zc], [x1, ph, zc], [1, 0, 0], [0, 0, 0, 0], col);
  }
  function house(x, z, w, d, floors, barn){
    if (roadDist(x, z) < Math.max(w, d) / 2 + 7) return;
    const y = terrainH(x, z) - 0.3, x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, h = floors * FLOOR + 0.4;
    if (barn){ plain.sides(x0, x1, y, y + h, z0, z1, C(0x7a2b22)); gable(plain, x0, x1, z0, z1, y, h, C(0x7a2b22)); }
    else {
      const wall = C([0xeee6d6, 0xe3d3b8, 0xd8c8b0, 0xf0ece4][Math.floor(rng() * 4)]);
      FBh.sides(x0, x1, y, y + h, z0, z1, wall, TU, TV, Math.floor(rng() * 8) / 8, 0);
      gable(plain, x0, x1, z0, z1, y, h, wall);
    }
    roof(x0, x1, z0, z1, y + h, C(barn ? 0x3b3d42 : [0x8a3a2a, 0x6b2f26, 0x4a4d55][Math.floor(rng() * 3)]));
    gridAdd({ t: 'b', x0, x1, z0, z1 });
  }
  for (let k = 0; k < 14; k++){
    const s = 220 + rng() * (L - 800), side = rng() < 0.5 ? -1 : 1, pt = roadPoint(s, side * (28 + rng() * 40));
    house(pt.x, pt.z, 12, 9, 2, false);
    if (rng() < 0.7) house(pt.x + 18, pt.z + (rng() - 0.5) * 10, 15, 12, 2, true);
  }
  for (let k = 0; k < 16; k++){
    const s = L - 470 + k * 26, side = k % 2 ? 1 : -1, pt = roadPoint(s, side * (15 + rng() * 5));
    house(pt.x, pt.z, rng() < 0.5 ? 9 : 12, 9, 2 + (rng() < 0.3 ? 1 : 0), false);
  }
  {
    const pt = roadPoint(L - 250, -26), y = terrainH(pt.x, pt.z) - 0.3;
    plain.box(pt.x - 2.6, pt.x + 2.6, y, y + 20, pt.z - 2.6, pt.z + 2.6, C(0xe6dccb));
    const spire = new THREE.Mesh(new THREE.ConeGeometry(3.4, 11, 4).rotateY(Math.PI / 4).translate(pt.x, y + 25.5, pt.z), new THREE.MeshStandardMaterial({ color: 0x3b4a44, roughness: 0.6, metalness: 0.3 }));
    spire.castShadow = true; grp.add(spire);
    house(pt.x + 10, pt.z, 15, 9, 2, false);
    gridAdd({ t: 'b', x0: pt.x - 2.6, x1: pt.x + 2.6, z0: pt.z - 2.6, z1: pt.z + 2.6 });
  }
  const addM = (mesh, cast) => { mesh.castShadow = cast; mesh.receiveShadow = true; grp.add(mesh); };
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
  addM(FBh.mesh(MAT.brick), true); addM(plain.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })), true); addM(roofsB.mesh(roofMat), true);

  // Distant mountain ridges
  const mtnMat = new THREE.MeshStandardMaterial({ color: 0x2c3448, roughness: 1, flatShading: true });
  for (let k = 0; k < 34; k++){
    const side = k % 2 ? 1 : -1, z = TERR.z0 + rng() * (NZ * CL), r = 160 + rng() * 200;
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, 90 + rng() * 150, 7, 1), mtnMat);
    m.position.set((side > 0 ? maxX + 640 : minX - 640) + side * rng() * 300, 20, z); m.rotation.y = rng() * 6;
    grp.add(m);
  }

  // Country traffic: cars, SUVs and lorries in both directions
  const rnd = mulberry32(17);
  ctryFleets = { sedan: new Fleet(grp, PARTS.sedan, 10, rnd), suv: new Fleet(grp, PARTS.suv, 5, rnd), truck: new Fleet(grp, PARTS.truck, 3, rnd) };
  ctryHead = new GlowPts(grp, 36, 0xfff1cc, 3.0); ctryTail = new GlowPts(grp, 36, 0xff3344, 2.0);
  for (const type of ['sedan', 'suv', 'truck']) for (let i = 0; i < ctryFleets[type].meshes[0].count; i++)
    ctraffic.push({ type, mi: i, s: 0, dir: 1, lat: ROAD.lane, speed: 0, cruise: 22, on: false, stun: 0, x: 0, z: 0, h: 0 });
  tuneEnv(grp);
  CTRY.built = true;
}
function spawnCountryVehicle(t, sMin, sMax){
  for (let k = 0; k < 20; k++){
    const s = sMin + Math.random() * (sMax - sMin);
    if (s < 30 || s > ROAD.len - 40) continue;
    const dir = Math.random() < 0.5 ? 1 : -1, lat = dir * ROAD.lane;
    if (ctraffic.some(o => o !== t && o.on && o.dir === dir && Math.abs(o.s - s) < 45)) continue;
    if (Math.abs(s - roadPos.s) < 60 && Math.abs(lat - roadPos.lat) < 3) continue;
    Object.assign(t, { s, dir, lat, on: true, stun: 0, cruise: t.type === 'truck' ? 19 + Math.random() * 3 : 22 + Math.random() * 6 });
    t.speed = t.cruise;
    return;
  }
  t.on = false;
}
function resetCountryTraffic(){
  ctraffic.forEach(t => { t.on = false; });
  ctraffic.forEach(t => spawnCountryVehicle(t, roadPos.s - 150, roadPos.s + 800));
}
function updateCountryTraffic(dt){
  for (const t of ctraffic){
    if (!t.on){ if (Math.random() < dt * 1.5) spawnCountryVehicle(t, roadPos.s + 350, roadPos.s + 800); continue; }
    if (t.stun > 0) t.stun -= dt;
    let gap = Infinity, aheadV = 0;
    const len = VDIM[t.type].len;
    const test = (s, lat, v) => {
      if (Math.abs(lat - t.lat) > 2.4) return;
      const d = (s - t.s) * t.dir;
      if (d <= 0) return;
      const g = d - len / 2 - 2.5;
      if (g < gap){ gap = g; aheadV = Math.max(0, v * t.dir); }
    };
    for (const o of ctraffic) if (o !== t && o.on) test(o.s, o.lat, o.speed * o.dir);
    test(roadPos.s, roadPos.lat, car.speed * Math.cos(car.heading - roadHeadingAt(roadPos.s)));
    for (const p of police) if (p.active && p.road) test(p.road.s, p.road.lat, p.speed * Math.cos(p.heading - roadHeadingAt(p.road.s)));
    let desired = t.stun > 0 ? 0 : t.cruise;
    if (gap < 40) desired = Math.min(desired, aheadV + (gap - 8) * 0.5);
    t.speed = Math.max(0, t.speed + clamp((desired - t.speed) * Math.min(1, dt * 3), -14 * dt, 3 * dt));
    t.s += t.speed * t.dir * dt;
    const rel = t.s - roadPos.s;
    if (rel > 900 && t.dir > 0) spawnCountryVehicle(t, roadPos.s - 200, roadPos.s - 120);
    else if (rel < -220 || rel > 900 || t.s < 20 || t.s > ROAD.len - 20) spawnCountryVehicle(t, roadPos.s + 350, roadPos.s + 800);
  }
  ctraffic.forEach((t, i) => {
    const pt = roadPoint(t.s, t.lat), h = pt.h + (t.dir < 0 ? Math.PI : 0), d = VDIM[t.type];
    t.x = pt.x; t.z = pt.z; t.h = h;
    ctryFleets[t.type].set(t.mi, pt.x, 0.03, pt.z, h, t.on);
    vehicleGlow(ctryHead, ctryTail, i, pt.x, pt.z, h, d.front, d.back, d.y + 0.03, d.off, t.on);
  });
  Object.values(ctryFleets).forEach(f => f.commit());
  ctryHead.commit(); ctryTail.commit();
}

function routeProgress(){ return mode === 'highway' ? [car.z, HW.LEN] : [roadPos.s, ROAD.len - 60]; }

// ---------- Player vehicles ----------
// ### Builds the three getaway vehicles the player can choose: muscle coupe, inline-four superbike with a rider in leathers,
// ### and a European cab-over tractor unit with an open chassis, fifth wheel and twin rear tyres.
// ### Wheels are separate so they spin and steer. setVehicle swaps the visible model, headlights and engine sound type.
const carGroup = new THREE.Group(), carTilt = new THREE.Group();
carGroup.add(carTilt); scene.add(carGroup);
const PAINT_DEAD = C(0x2a2522);
// A tapered tube from point a to point b, and a scaled ball: limbs, pipes and joints
const limb = (a, b, r0, r1, seg) => {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), L = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, seg || 10), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
  const M = A.clone().add(B).multiplyScalar(0.5); g.translate(M.x, M.y, M.z);
  return g;
};
const ball = (p, r, sx, sy, sz) => new THREE.SphereGeometry(r, 12, 9).scale(sx || 1, sy || 1, sz || 1).translate(p[0], p[1], p[2]);
const MODELS = {};
const headlights = [], beams = [];
(function buildPlayerModels(){
  const mk = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; parent.add(m); return m; };
  const paintMat = (hex, rough, metal) => { const m = new THREE.MeshPhysicalMaterial({ color: hex, roughness: rough, metalness: metal, clearcoat: 1, clearcoatRoughness: 0.05 }); m.userData.env = 1.15; return m; };
  const shp = pts => { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath(); return s; };
  const cyl = (r0, r1, len, seg) => new THREE.CylinderGeometry(r0, r1, len, seg || 14);
  const pipe = (pts, r) => pts.slice(1).flatMap((p, i) => [limb(pts[i], p, r, r, 8), ball(p, r)]);
  // A thin side panel with optional holes, on both sides of the centre line
  const sidePanels = (pts, x, thick, holes) => [-1, 1].map(side => {
    const sh = shp(pts); (holes || []).forEach(h => { const p = new THREE.Path(); h.forEach((q, i) => i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])); p.closePath(); sh.holes.push(p); });
    return extrudeProfile(sh, thick, thick * 0.3).translate(side * x, 0, 0);
  });
  const led = new THREE.MeshBasicMaterial({ color: 0xeef6ff });
  const red = SHARED.tail;
  const gun = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.32, metalness: 0.85 }); gun.userData.env = 1;
  const alu = new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.18, metalness: 0.95 }); alu.userData.env = 1.25;
  const smoke = new THREE.MeshStandardMaterial({ color: 0x10141c, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.6 }); smoke.userData.env = 1.3;
  const plateMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.5 });
  const darkGrille = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.55, metalness: 0.4 });

  // Torus tyre, open rim barrel, spokes or a solid face, brake rotor and caliper
  function wheel(group, o){
    const pivot = new THREE.Group(); pivot.position.set(o.x, o.r, o.z); group.add(pivot);
    const tube = o.r * (o.tyre || 0.27), mid = o.r - tube;
    const tg = new THREE.TorusGeometry(mid, tube, 12, 30); tg.rotateY(Math.PI / 2); tg.scale(o.w / (tube * 2), 1, 1);
    const w = new THREE.Mesh(tg, SHARED.tire); w.castShadow = true;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(mid, mid, o.w * 0.9, 24, 1, !!o.rotors).rotateZ(Math.PI / 2), o.rim);
    w.add(barrel);
    if (o.solid){
      const face = cyl(mid * 0.98, mid * 0.98, o.w * 0.94, 24).rotateZ(Math.PI / 2);
      w.add(new THREE.Mesh(face, o.rim));
      const hub = cyl(mid * 0.38, mid * 0.44, o.w * 1.02, 10).rotateZ(Math.PI / 2);
      w.add(new THREE.Mesh(hub, gun));
      // ten wheel nuts and the ventilation holes of a truck wheel
      const nuts = [], holes = [];
      for (let k = 0; k < 10; k++){ const a = k / 10 * Math.PI * 2; for (const side of [-1, 1]) nuts.push(cyl(0.022, 0.022, 0.03, 6).rotateZ(Math.PI / 2).translate(side * o.w * 0.51, Math.cos(a) * mid * 0.5, Math.sin(a) * mid * 0.5)); }
      for (let k = 0; k < 8; k++){ const a = (k + 0.5) / 8 * Math.PI * 2; holes.push(cyl(0.045, 0.045, o.w * 0.96, 8).rotateZ(Math.PI / 2).translate(0, Math.cos(a) * mid * 0.74, Math.sin(a) * mid * 0.74)); }
      w.add(new THREE.Mesh(mergeGeos(nuts), gun), new THREE.Mesh(mergeGeos(holes), SHARED.trim));
    } else {
      if (o.rotors) o.rotors.forEach(x => {
        w.add(new THREE.Mesh(cyl(o.rotorR, o.rotorR, 0.008, 28).rotateZ(Math.PI / 2).translate(x, 0, 0), alu));
        w.add(new THREE.Mesh(cyl(o.rotorR * 0.72, o.rotorR * 0.72, 0.012, 20).rotateZ(Math.PI / 2).translate(x, 0, 0), gun));
      });
      else w.add(new THREE.Mesh(cyl(mid * 0.95, mid * 0.95, 0.02, 24).rotateZ(Math.PI / 2), alu));
      for (let k = 0; k < o.spokes; k++){
        const g = new THREE.BoxGeometry(o.rotors ? 0.03 : o.w * 0.86, mid * 0.92, mid * (o.rotors ? 0.11 : 0.16)); g.translate(0, mid * 0.46, 0);
        const s = new THREE.Mesh(g, o.rim); s.rotation.x = k / o.spokes * Math.PI * 2; w.add(s);
      }
      w.add(new THREE.Mesh(cyl(mid * 0.2, mid * 0.2, o.w * 0.9, 10).rotateZ(Math.PI / 2), o.rim));
      if (o.caliper){
        const c = new THREE.Mesh(new THREE.BoxGeometry(o.w * 0.5, mid * 0.38, mid * 0.32), new THREE.MeshStandardMaterial({ color: o.caliper, roughness: 0.4, metalness: 0.3 }));
        c.position.set(0, mid * 0.55, -mid * 0.35); c.rotation.x = 0.6; pivot.add(c);
      }
    }
    pivot.add(w); o.list.push(w); if (o.front) o.pivots.push(pivot);
  }

  // Car: fastback muscle coupe in steel blue
  {
    const g = new THREE.Group(), base = 0x56688f, pm = paintMat(base, 0.2, 0.72);
    const s = new THREE.Shape();
    s.moveTo(-2.3, 0.28); s.lineTo(-1.88, 0.28);
    s.absarc(-1.35, 0.38, 0.52, Math.PI, 0, true);
    s.lineTo(0.93, 0.28);
    s.absarc(1.45, 0.38, 0.52, Math.PI, 0, true);
    s.lineTo(2.3, 0.26); s.lineTo(2.42, 0.42); s.lineTo(2.36, 0.66); s.lineTo(2.2, 0.78);
    s.lineTo(0.55, 0.96); s.lineTo(-1.6, 0.98); s.lineTo(-2.25, 0.93); s.lineTo(-2.4, 0.78); s.lineTo(-2.42, 0.5);
    s.closePath();
    mk(smoothGeo(shapeBody(extrudeProfile(s, 1.92, 0.12), { half: 2.5, belt: 0.8, roof: 1.42, tumble: 0.1, plan: 0.13 })), pm, g);
    const hr = new THREE.Shape();
    hr.moveTo(-2.05, 0.42); hr.lineTo(-1.9, 0.42); hr.absarc(-1.35, 0.38, 0.55, Math.PI, 0, true); hr.lineTo(-0.72, 0.42); hr.lineTo(-0.88, 0.8); hr.lineTo(-1.98, 0.86); hr.closePath();
    mk(smoothGeo(extrudeProfile(hr, 2.04, 0.1)), pm, g);
    const fr = new THREE.Shape();
    fr.moveTo(0.85, 0.42); fr.absarc(1.45, 0.38, 0.54, Math.PI, 0, true); fr.lineTo(2.05, 0.45); fr.lineTo(1.95, 0.74); fr.lineTo(0.95, 0.84); fr.closePath();
    mk(smoothGeo(extrudeProfile(fr, 1.98, 0.1)), pm, g);
    mk(smoothGeo(shapeBody(extrudeProfile(shp([[0.55, 0.95], [-0.25, 1.33], [-0.95, 1.36], [-2.15, 0.98]]), 1.58, 0.06), { half: 2.5, belt: 0.98, roof: 1.4, tumble: 0.24, plan: 0.08 })), SHARED.glass, g);
    mk(smoothGeo(shapeBody(extrudeProfile(shp([[-0.22, 1.31], [-0.28, 1.38], [-0.97, 1.41], [-1.95, 1.06], [-1.88, 1.0], [-0.95, 1.35]]), 1.62, 0.04), { half: 2.5, belt: 0.98, roof: 1.4, tumble: 0.24, plan: 0.08 })), pm, g);
    mk(mergeGeos([boxG(0.48, 0.11, 0.05, 0.66, 0.69, 2.49), boxG(0.48, 0.11, 0.05, -0.66, 0.69, 2.49), boxG(0.34, 0.15, 0.05, 0.72, 0.8, -2.52), boxG(0.34, 0.15, 0.05, -0.72, 0.8, -2.52)]), SHARED.lens, g);
    mk(boxG(0.5, 0.07, 0.66, 0, 0.99, 1.3, 0.11), darkGrille, g);
    mk(mergeGeos([
      boxG(1.86, 0.04, 0.34, 0, 0.27, 2.42), boxG(1.5, 0.12, 0.05, 0, 0.35, 2.5),
      boxG(0.06, 0.1, 2.1, 0.99, 0.33, 0.05), boxG(0.06, 0.1, 2.1, -0.99, 0.33, 0.05),
      boxG(1.5, 0.14, 0.3, 0, 0.33, -2.46)
    ]), SHARED.trim, g);
    mk(boxG(1.26, 0.27, 0.05, 0, 0.53, 2.52), darkGrille, g);
    mk(mergeGeos([
      boxG(0.42, 0.05, 0.05, 0.66, 0.69, 2.45), boxG(0.42, 0.05, 0.05, -0.66, 0.69, 2.45),
      boxG(0.045, 0.14, 0.05, 0.47, 0.6, 2.5), boxG(0.045, 0.14, 0.05, -0.47, 0.6, 2.5)
    ]), led, g);
    mk(mergeGeos([boxG(1.7, 0.045, 0.04, 0, 0.87, -2.45), boxG(0.3, 0.12, 0.04, 0.72, 0.8, -2.49), boxG(0.3, 0.12, 0.04, -0.72, 0.8, -2.49)]), red, g);
    mk(mergeGeos([-0.62, -0.46, 0.46, 0.62].map(x => cyl(0.055, 0.055, 0.24, 12).rotateX(Math.PI / 2).translate(x, 0.31, -2.54))), alu, g);
    mk(mergeGeos([boxG(0.52, 0.12, 0.02, 0, 0.42, 2.56), boxG(0.52, 0.12, 0.02, 0, 0.62, -2.54)]), plateMat, g);
    mk(mergeGeos([boxG(0.22, 0.1, 0.16, 1.04, 0.99, 0.42), boxG(0.22, 0.1, 0.16, -1.04, 0.99, 0.42)]), pm, g);
    const wheels = [], pivots = [];
    [[0.86, 1.45, true], [-0.86, 1.45, true], [0.88, -1.35, false], [-0.88, -1.35, false]].forEach(([x, z, f]) =>
      wheel(g, { x, z, r: 0.38, w: 0.3, rim: gun, spokes: 5, caliper: 0xd0202a, front: f, list: wheels, pivots }));
    MODELS.car = { g, paint: pm, base: C(base), wheels, pivots, r: 0.38 };
  }

  // Motorcycle: superbike with an inline four, twin-spar frame, upside-down fork and a tucked rider in leathers.
  // The fairing is separate panels with vents, so the engine and its header pipes show through as on a real bike.
  {
    // everything above the axles is drawn slightly tall and scaled down to a real seat height of about 0.9 m
    const root = new THREE.Group(), g = new THREE.Group(), base = 0x30343c, pm = paintMat(base, 0.28, 0.6);
    root.add(g); g.scale.y = 0.84; g.position.y = 0.31 * (1 - 0.84);
    const acc = new THREE.MeshStandardMaterial({ color: 0xd4f21a, roughness: 0.35, metalness: 0.2, emissive: 0x1e2600 });
    const matte = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.75 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xc9a04a, roughness: 0.25, metalness: 0.9 }); gold.userData.env = 1.2;
    const leather = new THREE.MeshStandardMaterial({ color: 0x3a3e47, roughness: 0.48, metalness: 0.1 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8d9299, roughness: 0.35, metalness: 0.9 }); steel.userData.env = 1.1;
    const carbon = new THREE.MeshStandardMaterial({ color: 0x2d3036, roughness: 0.28, metalness: 0.55 }); carbon.userData.env = 1.1;
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.35, metalness: 0.5, side: THREE.DoubleSide });
    const skin = new THREE.MeshStandardMaterial({ color: 0x0e0f12, roughness: 0.35, metalness: 0.2 });

    // nose with its pointed plan, windscreen, headlights and the air intake under them
    mk(smoothGeo(shapeBody(extrudeProfile(shp([[1.0, 0.86], [0.92, 0.97], [0.76, 1.06], [0.58, 1.11], [0.44, 1.1], [0.38, 0.98], [0.42, 0.8], [0.62, 0.76], [0.84, 0.76], [0.96, 0.8]]), 0.42, 0.035), { half: 0.62, zc: 0.42, belt: 0.82, roof: 1.12, tumble: 0.28, plan: 0.78 })), pm, g);
    mk(extrudeProfile(shp([[0.76, 1.08], [0.5, 1.29], [0.44, 1.27], [0.56, 1.12]]), 0.27, 0.01), smoke, g);
    mk(boxG(0.13, 0.05, 0.04, 0, 0.8, 1.01), skin, g);
    mk(mergeGeos([-1, 1].map(sd => ball([sd * 0.052, 0.905, 0.955], 0.05, 1, 0.34, 0.6))), led, g);
    mk(mergeGeos([-1, 1].map(sd => boxG(0.012, 0.02, 0.14, sd * 0.12, 0.84, 0.86))), acc, g);
    // side panels with cooling vents; yellow graphics on top of them; a belly pan under the engine
    const side = [[0.5, 0.98], [0.3, 0.96], [0.14, 0.82], [0.0, 0.55], [0.06, 0.4], [0.32, 0.36], [0.42, 0.56], [0.52, 0.72]];
    mk(mergeGeos(sidePanels(side, 0.205, 0.025, [[[0.42, 0.74], [0.24, 0.8], [0.12, 0.58], [0.3, 0.46]]])), pm, g);
    mk(mergeGeos(sidePanels([[0.48, 0.95], [0.3, 0.93], [0.18, 0.82], [0.22, 0.81], [0.32, 0.89], [0.49, 0.9]], 0.219, 0.008)), acc, g);
    mk(mergeGeos(sidePanels([[0.33, 0.43], [0.1, 0.45], [0.08, 0.41], [0.31, 0.39]], 0.219, 0.008)), acc, g);
    mk(smoothGeo(extrudeProfile(shp([[0.38, 0.32], [0.26, 0.2], [-0.02, 0.19], [-0.08, 0.3], [0.08, 0.3]]), 0.3, 0.025)), carbon, g);
    // tank, seat, tail and its LED, number-plate hanger
    mk(smoothGeo(shapeBody(extrudeProfile(shp([[0.38, 1.05], [0.16, 1.2], [-0.12, 1.2], [-0.27, 1.05], [-0.22, 0.9], [0.26, 0.92]]), 0.44, 0.08), { half: 0.5, zc: 0.05, belt: 0.95, roof: 1.2, tumble: 0.42, plan: 0.28 })), pm, g);
    mk(extrudeProfile(shp([[0.2, 1.07], [-0.1, 1.14], [-0.14, 1.11], [0.18, 1.03]]), 0.05, 0.01).translate(0.13, 0, 0), acc, g);
    mk(extrudeProfile(shp([[0.2, 1.07], [-0.1, 1.14], [-0.14, 1.11], [0.18, 1.03]]), 0.05, 0.01).translate(-0.13, 0, 0), acc, g);
    mk(smoothGeo(shapeBody(extrudeProfile(shp([[-0.24, 1.03], [-0.56, 1.1], [-0.68, 1.1], [-0.62, 1.02], [-0.26, 0.94]]), 0.28, 0.04), { half: 0.5, zc: -0.3, belt: 0.95, roof: 1.1, tumble: 0.1, plan: 0.5 })), matte, g);
    mk(smoothGeo(shapeBody(extrudeProfile(shp([[-0.58, 1.1], [-0.72, 1.14], [-1.06, 1.27], [-1.09, 1.21], [-0.88, 1.05], [-0.56, 0.92], [-0.3, 0.9]]), 0.28, 0.045), { half: 0.8, zc: -0.3, belt: 0.9, roof: 1.3, tumble: 0.2, plan: 0.82 })), pm, g);
    mk(mergeGeos(sidePanels([[-0.72, 1.12], [-1.02, 1.24], [-1.02, 1.2], [-0.78, 1.06]], 0.095, 0.01)), acc, g);
    mk(boxG(0.1, 0.03, 0.03, 0, 1.235, -1.09, 0.5), red, g);
    mk(mergeGeos([boxG(0.04, 0.03, 0.34, 0, 0.95, -0.98, 0.75), boxG(0.16, 0.02, 0.2, 0, 0.84, -1.1, 0.75)]), matte, g);
    mk(boxG(0.17, 0.1, 0.012, 0, 0.77, -1.2), plateMat, g);
    mk(mergeGeos([limb([0.08, 0.86, -1.07], [0.2, 0.86, -1.07], 0.008, 0.008, 6), limb([-0.08, 0.86, -1.07], [-0.2, 0.86, -1.07], 0.008, 0.008, 6)]), matte, g);
    mk(mergeGeos([ball([0.21, 0.86, -1.07], 0.022, 1.3, 0.7, 0.7), ball([-0.21, 0.86, -1.07], 0.022, 1.3, 0.7, 0.7)]), new THREE.MeshBasicMaterial({ color: 0xff9a2a }), g);
    // the engine: crankcase, four-cylinder block leaning forwards, clutch and alternator covers
    mk(mergeGeos([
      boxG(0.42, 0.2, 0.44, 0, 0.33, 0.16), boxG(0.38, 0.3, 0.2, 0, 0.56, 0.3, 0.3), boxG(0.4, 0.09, 0.22, 0, 0.73, 0.25, 0.3),
      cyl(0.11, 0.11, 0.44, 18).rotateZ(Math.PI / 2).translate(0, 0.34, 0.1)
    ]), gun, g);
    mk(mergeGeos([0, 1, 2, 3].flatMap(i => [-1, 1].map(sd => boxG(0.37, 0.012, 0.21, 0, 0.47 + i * 0.05, 0.27 + i * 0.015 + sd * 0.001, 0.3)))), steel, g);
    mk(mergeGeos([cyl(0.1, 0.1, 0.03, 18).rotateZ(Math.PI / 2).translate(0.225, 0.34, 0.04), cyl(0.08, 0.08, 0.03, 16).rotateZ(Math.PI / 2).translate(-0.225, 0.36, 0.16)]), steel, g);
    mk(boxG(0.3, 0.2, 0.05, 0, 0.62, 0.5, 0.25), SHARED.trim, g);
    // four header pipes into one, and a short silencer
    mk(mergeGeos([-0.135, -0.045, 0.045, 0.135].flatMap(x => pipe([[x, 0.62, 0.42], [x * 1.08, 0.52, 0.5], [x * 1.05, 0.34, 0.5], [x * 0.8, 0.22, 0.36], [0.05 + x * 0.3, 0.2, 0.12], [0.08, 0.21, -0.04]], 0.019))), steel, g);
    mk(mergeGeos(pipe([[0.08, 0.21, -0.04], [0.16, 0.3, -0.26]], 0.03)), steel, g);
    mk(limb([0.16, 0.3, -0.26], [0.205, 0.45, -0.64], 0.055, 0.082, 14), carbon, g);
    mk(cyl(0.05, 0.05, 0.03, 12).rotateX(Math.PI / 2 - 0.37).translate(0.207, 0.457, -0.655), matte, g);
    mk(mergeGeos([limb([0.17, 0.33, -0.3], [0.17, 0.33, -0.3], 0.06, 0.06, 4), cyl(0.086, 0.086, 0.02, 14).rotateX(Math.PI / 2 - 0.37).translate(0.2, 0.43, -0.58)]), alu, g);
    // frame, rear subframe, swingarm, shock, chain and rear brake
    mk(mergeGeos([-1, 1].flatMap(sd => [
      limb([sd * 0.05, 0.98, 0.46], [sd * 0.2, 0.92, 0.22], 0.038, 0.038, 6), limb([sd * 0.2, 0.92, 0.22], [sd * 0.17, 0.72, -0.12], 0.038, 0.04, 6), limb([sd * 0.17, 0.72, -0.12], [sd * 0.14, 0.46, -0.15], 0.04, 0.034, 6),
      limb([sd * 0.1, 0.46, -0.15], [sd * 0.11, 0.31, -0.74], 0.042, 0.026, 6), limb([sd * 0.1, 0.34, -0.16], [sd * 0.11, 0.31, -0.74], 0.016, 0.016, 6),
      limb([sd * 0.08, 0.82, -0.14], [sd * 0.08, 1.0, -0.75], 0.014, 0.012, 6)
    ])), alu, g);
    mk(mergeGeos([limb([0, 0.7, -0.26], [0, 0.42, -0.34], 0.033, 0.033, 10)]), matte, g);
    const coil = []; for (let k = 0; k < 7; k++) coil.push(new THREE.TorusGeometry(0.038, 0.007, 5, 12).rotateX(Math.PI / 2 + 0.28).translate(0, 0.46 + k * 0.035, -0.33 + k * 0.0095));
    mk(mergeGeos(coil), gold, g);
    mk(mergeGeos([boxG(0.012, 0.012, 0.66, -0.135, 0.42, -0.42, 0.13), boxG(0.012, 0.012, 0.66, -0.135, 0.28, -0.42, 0.02)]), SHARED.trim, g);
    mk(mergeGeos([boxG(0.03, 0.02, 0.03, 0.14, 0.45, -0.72), boxG(0.03, 0.09, 0.09, 0.13, 0.38, -0.8, 0.6)]), gold, g);
    // clip-on bars, levers, instruments, mirrors; rear-set pegs
    mk(mergeGeos([-1, 1].flatMap(sd => [limb([sd * 0.07, 1.12, 0.47], [sd * 0.3, 1.08, 0.5], 0.014, 0.014, 8), limb([sd * 0.21, 1.1, 0.53], [sd * 0.31, 1.09, 0.58], 0.006, 0.005, 6), limb([sd * 0.25, 1.1, 0.74], [sd * 0.2, 1.1, 0.65], 0.008, 0.008, 6)])), matte, g);
    mk(mergeGeos([-1, 1].map(sd => boxG(0.1, 0.055, 0.03, sd * 0.28, 1.12, 0.76, 0.15))), matte, g);
    mk(mergeGeos([-1, 1].map(sd => boxG(0.085, 0.04, 0.008, sd * 0.28, 1.12, 0.742, 0.15))), smoke, g);
    mk(boxG(0.13, 0.03, 0.09, 0, 1.17, 0.5, 0.6), SHARED.trim, g);
    mk(mergeGeos([-1, 1].flatMap(sd => [limb([sd * 0.15, 0.56, -0.22], [sd * 0.22, 0.5, -0.27], 0.014, 0.012, 6), boxG(0.04, 0.09, 0.03, sd * 0.15, 0.6, -0.2, 0.3)])), alu, g);
    // the rider: arms to the bars, knees against the tank, feet on the pegs, head down behind the screen
    const J = { hip: [0.11, 1.09, -0.38], knee: [0.27, 0.85, 0.06], ankle: [0.22, 0.56, -0.25], sh: [0.18, 1.39, 0.03], el: [0.3, 1.2, 0.26], wr: [0.25, 1.09, 0.46] };
    const lr = (p, sd) => [p[0] * sd, p[1], p[2]];
    mk(mergeGeos([
      limb([0, 1.08, -0.38], [0, 1.38, 0.0], 0.155, 0.185, 14).scale(1.14, 1, 1), ball([0, 1.1, -0.38], 0.175, 1.1, 0.88, 1.05), ball([0, 1.38, 0.02], 0.185, 1.16, 0.8, 0.84),
      ...[-1, 1].flatMap(sd => [
        limb(lr(J.hip, sd), lr(J.knee, sd), 0.105, 0.072, 12), ball(lr(J.knee, sd), 0.076), limb(lr(J.knee, sd), lr(J.ankle, sd), 0.07, 0.046, 12),
        limb(lr(J.sh, sd), lr(J.el, sd), 0.072, 0.052, 12), ball(lr(J.sh, sd), 0.08), ball(lr(J.el, sd), 0.054), limb(lr(J.el, sd), lr(J.wr, sd), 0.052, 0.036, 12)
      ])
    ]), leather, g);
    // armour and stripes on the suit, hump behind the helmet
    mk(mergeGeos([ball([0, 1.47, -0.09], 0.075, 0.9, 1.25, 1), ...[-1, 1].flatMap(sd => [ball(lr(J.sh, sd), 0.052, 1.25, 0.9, 1).translate(0, 0.045, 0), ball(lr(J.el, sd), 0.036, 1, 1, 1.2).translate(sd * 0.02, 0, 0)])]), matte, g);
    mk(mergeGeos([-1, 1].flatMap(sd => [ball(lr(J.knee, sd), 0.05, 1.05, 0.7, 1.1).translate(sd * 0.04, -0.01, 0.03), limb([sd * 0.2, 1.3, -0.1], [sd * 0.2, 1.12, -0.33], 0.016, 0.016, 6)])), acc, g);
    // boots and gloves
    mk(mergeGeos([-1, 1].flatMap(sd => [
      limb(lr(J.ankle, sd), lr([0.22, 0.5, -0.28], sd), 0.046, 0.05, 10), boxG(0.09, 0.05, 0.25, sd * 0.225, 0.47, -0.19, 0.08), ball([sd * 0.225, 0.48, -0.07], 0.046, 1, 0.65, 1.1),
      ball(lr(J.wr, sd), 0.042, 1.1, 0.8, 1.35), ball([sd * 0.25, 1.09, 0.51], 0.038, 1.2, 0.72, 0.8)
    ])), matte, g);
    // full-face helmet with chin bar, visor and a small aero fin
    mk(mergeGeos([ball([0, 1.54, 0.22], 0.137, 0.96, 0.96, 1.08), ball([0, 1.47, 0.3], 0.1, 0.92, 0.72, 1.1), limb([0, 1.42, 0.08], [0, 1.47, 0.17], 0.065, 0.075, 10)]), carbon, g);
    const visor = new THREE.MeshStandardMaterial({ color: 0x3f7c9c, roughness: 0.08, metalness: 0.95 }); visor.userData.env = 1.5;
    mk(ball([0, 1.555, 0.298], 0.094, 1.17, 0.46, 0.8), visor, g);
    mk(mergeGeos([ball([0, 1.62, 0.16], 0.1, 0.22, 0.62, 1.05), ...[-1, 1].map(sd => boxG(0.012, 0.028, 0.15, sd * 0.126, 1.5, 0.14))]), acc, g);
    const wheels = [], pivots = [];
    const rimF = rimMat, rimR = rimMat;
    wheel(root, { x: 0, z: 0.76, r: 0.31, w: 0.12, rim: rimF, spokes: 6, tyre: 0.16, rotors: [0.058, -0.058], rotorR: 0.158, front: true, list: wheels, pivots });
    wheel(root, { x: 0, z: -0.74, r: 0.31, w: 0.19, rim: rimR, spokes: 6, tyre: 0.18, rotors: [0.075], rotorR: 0.11, front: false, list: wheels, pivots });
    // the fork turns with the front wheel: thick outer tubes above, gold inner tubes and radial calipers at the axle
    const fork = new THREE.Group(); pivots[0].add(fork);
    mk(mergeGeos([-1, 1].map(sd => limb([sd * 0.09, 0.26, -0.1], [sd * 0.08, 0.62, -0.25], 0.041, 0.041, 12))), gun, fork);
    mk(mergeGeos([-1, 1].map(sd => limb([sd * 0.09, 0.0, 0], [sd * 0.09, 0.3, -0.115], 0.027, 0.027, 12))), gold, fork);
    mk(mergeGeos([boxG(0.25, 0.035, 0.1, 0, 0.6, -0.24), boxG(0.26, 0.05, 0.1, 0, 0.49, -0.2), ...[-1, 1].map(sd => boxG(0.045, 0.07, 0.07, sd * 0.09, -0.005, 0.005))]), alu, fork);
    mk(mergeGeos([-1, 1].flatMap(sd => [boxG(0.05, 0.13, 0.05, sd * 0.09, 0.09, -0.135, -0.5), boxG(0.03, 0.05, 0.05, sd * 0.06, 0.12, -0.13)])), gold, fork);
    const fender = new THREE.Mesh(extrudeProfile(shp([[0.25, 0.14], [0.14, 0.3], [-0.06, 0.345], [-0.25, 0.2], [-0.2, 0.2], [-0.06, 0.31], [0.12, 0.27], [0.21, 0.13]]), 0.13, 0.008), carbon); fork.add(fender);
    MODELS.bike = { g: root, paint: pm, base: C(base), wheels, pivots, r: 0.31 };
  }

  // Truck: European cab-over tractor unit in sage green. A tall sleeper cab sits over the front axle; behind it the
  // chassis is open: tanks, air and electric lines to the trailer, a fifth wheel over twin rear tyres, mudguards and tail lights.
  {
    const g = new THREE.Group(), base = 0xa8c6bc, pm = paintMat(base, 0.26, 0.55);
    const plastic = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.62, metalness: 0.1 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x585e65, roughness: 0.5, metalness: 0.45 }); grey.userData.env = 0.8;
    const amber = new THREE.MeshBasicMaterial({ color: 0xff9a2a });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.85 });
    // cab shell above the door sills
    mk(smoothGeo(shapeBody(extrudeProfile(shp([[0.72, 1.26], [3.0, 1.26], [3.03, 1.7], [2.98, 2.42], [2.87, 3.12], [2.74, 3.44], [2.38, 3.72], [1.6, 3.86], [0.84, 3.84], [0.72, 3.68]]), 2.5, 0.1), { half: 1.5, zc: 1.86, belt: 1.5, roof: 3.9, tumble: 0.075, plan: 0.09 })), pm, g);
    // lower cab and bumper in grey plastic with the front wheel arch cut out
    const low = new THREE.Shape();
    low.moveTo(0.62, 0.6); low.lineTo(1.3, 0.6); low.absarc(2.0, 0.56, 0.7, Math.PI, 0, true);
    low.lineTo(3.0, 0.46); low.lineTo(3.2, 0.46); low.lineTo(3.25, 0.68); low.lineTo(3.23, 1.2); low.lineTo(0.62, 1.2); low.closePath();
    mk(extrudeProfile(low, 2.44, 0.03), plastic, g);
    mk(mergeGeos([boxG(2.5, 0.17, 2.3, 0, 1.3, 1.86), boxG(2.5, 0.03, 2.3, 0, 1.43, 1.86)]), new THREE.MeshStandardMaterial({ color: 0x3f5a54, roughness: 0.4, metalness: 0.4 }), g);
    // windscreen in a rubber frame, wipers, sun visor
    mk(extrudeProfile(shp([[3.11, 2.4], [2.98, 3.14], [2.9, 3.14], [3.03, 2.4]]), 2.28, 0.015), rubber, g);
    mk(extrudeProfile(shp([[3.125, 2.45], [3.0, 3.1], [2.95, 3.1], [3.08, 2.45]]), 2.18, 0.01), SHARED.glass, g);
    mk(mergeGeos([limb([0.08, 2.47, 3.14], [1.0, 2.62, 3.1], 0.012, 0.012, 5), limb([-1.0, 2.47, 3.14], [-0.08, 2.62, 3.1], 0.012, 0.012, 5)]), rubber, g);
    mk(smoothGeo(extrudeProfile(shp([[3.08, 3.22], [3.0, 3.34], [2.84, 3.44], [2.84, 3.36], [2.96, 3.25]]), 2.3, 0.015)), pm, g);
    // door and sleeper windows run across the cab, so only their outer faces show; door seams, handles, grab rails
    mk(extrudeProfile(shp([[2.89, 2.28], [2.76, 3.06], [1.82, 3.06], [1.78, 2.28]]), 2.44, 0.015), SHARED.glass, g);
    mk(extrudeProfile(shp([[1.1, 2.86], [1.1, 3.14], [0.72, 3.14], [0.72, 2.86]]), 2.43, 0.012), SHARED.glass, g);
    mk(mergeGeos([
      boxG(2.5, 1.86, 0.018, 0, 2.12, 2.92), boxG(2.5, 1.9, 0.018, 0, 2.15, 1.7), boxG(2.5, 0.018, 1.2, 0, 1.2, 2.31),
      boxG(2.47, 0.018, 1.0, 0, 3.12, 2.27), boxG(2.44, 0.03, 1.22, 0, 3.16, 2.27)
    ]), rubber, g);
    mk(mergeGeos([-1, 1].flatMap(sd => [boxG(0.04, 0.05, 0.22, sd * 1.235, 2.12, 1.88), limb([sd * 1.255, 1.3, 2.86], [sd * 1.225, 2.2, 2.86], 0.016, 0.016, 6), limb([sd * 1.25, 1.3, 1.74], [sd * 1.23, 2.0, 1.74], 0.016, 0.016, 6)])), plastic, g);
    // steps in a recess behind the wheel arch
    mk(mergeGeos([-1, 1].map(sd => boxG(0.04, 0.72, 0.56, sd * 1.21, 0.86, 1.02))), SHARED.trim, g);
    mk(mergeGeos([-1, 1].flatMap(sd => [boxG(0.2, 0.035, 0.52, sd * 1.15, 0.62, 1.02), boxG(0.2, 0.035, 0.52, sd * 1.15, 0.98, 1.02)])), alu, g);
    // grille with its horizontal bars, front panel, headlights in the bumper
    mk(boxG(2.12, 0.86, 0.04, 0, 1.76, 3.125), plastic, g);
    mk(mergeGeos([1.45, 1.62, 1.79, 1.96, 2.12].map(y => boxG(2.06 - (y - 1.45) * 0.05, 0.075, 0.05, 0, y, 3.15))), grey, g);
    mk(mergeGeos([boxG(2.3, 0.13, 0.05, 0, 1.28, 3.16), boxG(0.42, 0.1, 0.04, 0, 2.26, 3.11)]), pm, g);
    mk(boxG(0.34, 0.06, 0.02, 0, 2.26, 3.135), alu, g);
    mk(mergeGeos([-1, 1].flatMap(sd => [boxG(0.56, 0.3, 0.05, sd * 0.87, 0.95, 3.235), boxG(0.5, 0.1, 0.05, sd * 0.87, 0.66, 3.225)])), SHARED.trim, g);
    mk(mergeGeos([-1, 1].flatMap(sd => [boxG(0.22, 0.17, 0.04, sd * 0.97, 0.95, 3.26), boxG(0.18, 0.17, 0.04, sd * 0.72, 0.95, 3.26)])), SHARED.lens, g);
    mk(mergeGeos([-1, 1].flatMap(sd => [boxG(0.5, 0.025, 0.04, sd * 0.87, 1.06, 3.265), boxG(0.14, 0.06, 0.04, sd * 0.87, 0.66, 3.26)])), led, g);
    mk(mergeGeos([-1, 1].flatMap(sd => [boxG(0.1, 0.1, 0.04, sd * 1.14, 0.95, 3.25), boxG(0.03, 0.05, 0.14, sd * 1.23, 1.13, 2.92)])), amber, g);
    mk(mergeGeos([boxG(0.56, 0.13, 0.02, 0, 0.72, 3.26)]), plateMat, g);
    mk(boxG(0.6, 0.1, 0.05, 0, 0.53, 3.21), grey, g);
    // roof: marker lights, hatch, aerial; large mirrors on arms, a kerb mirror over the door
    mk(mergeGeos([-0.7, -0.35, 0, 0.35, 0.7].map(x => boxG(0.13, 0.04, 0.05, x, 3.86, 2.3, -0.5))), amber, g);
    mk(mergeGeos([boxG(0.82, 0.07, 0.72, 0, 3.98, 1.3), limb([0.76, 3.92, 0.9], [0.8, 4.3, 0.75], 0.007, 0.005, 5)]), plastic, g);
    mk(mergeGeos([-1, 1].flatMap(sd => [
      limb([sd * 1.15, 3.2, 2.72], [sd * 1.5, 3.14, 2.92], 0.02, 0.02, 6), limb([sd * 1.18, 2.42, 2.82], [sd * 1.5, 2.56, 2.92], 0.02, 0.02, 6),
      boxG(0.25, 0.56, 0.1, sd * 1.54, 2.86, 2.92), boxG(0.25, 0.2, 0.1, sd * 1.54, 2.46, 2.92),
      limb([sd * 0.72, 3.3, 2.9], [sd * 0.72, 3.36, 3.16], 0.012, 0.012, 5), boxG(0.28, 0.17, 0.06, sd * 0.72, 3.3, 3.2)
    ])), plastic, g);
    mk(mergeGeos([-1, 1].flatMap(sd => [boxG(0.21, 0.5, 0.012, sd * 1.54, 2.86, 2.865), boxG(0.21, 0.16, 0.012, sd * 1.54, 2.46, 2.865)])), SHARED.glass, g);
    // side fairings behind the cab close the gap to a trailer
    mk(mergeGeos(sidePanels([[0.66, 3.7], [0.26, 3.56], [0.26, 1.62], [0.66, 1.3]], 1.215, 0.05)), pm, g);
    mk(boxG(2.4, 2.4, 0.04, 0, 2.5, 0.6), plastic, g);
    // chassis: two rails with cross members, catwalk plate behind the cab
    mk(mergeGeos([
      boxG(0.09, 0.28, 4.75, 0.42, 0.88, -0.82), boxG(0.09, 0.28, 4.75, -0.42, 0.88, -0.82),
      boxG(0.9, 0.1, 0.1, 0, 0.8, 0.5), boxG(0.9, 0.1, 0.1, 0, 0.8, -0.9), boxG(0.9, 0.2, 0.12, 0, 0.86, -3.1), boxG(0.24, 0.5, 0.6, 0, 0.56, -1.7)
    ]), SHARED.trim, g);
    mk(boxG(1.5, 0.05, 0.62, 0, 1.08, 0.12), grey, g);
    // fifth wheel: the coupling plate with its slot, on two mounting rails
    mk(mergeGeos([boxG(0.14, 0.16, 1.1, 0.42, 1.09, -1.55), boxG(0.14, 0.16, 1.1, -0.42, 1.09, -1.55)]), grey, g);
    mk(cyl(0.68, 0.72, 0.09, 26).translate(0, 1.2, -1.55), SHARED.trim, g);
    mk(mergeGeos([extrudeProfile(shp([[-1.5, 1.255], [-2.26, 1.255], [-2.26, 1.24], [-1.5, 1.24]]), 0.2, 0.002), boxG(0.1, 0.02, 0.1, 0, 1.25, -1.5)]), grey, g);
    // fuel tank with straps on the right, air tanks and battery box on the left, and the silencer
    mk(mergeGeos([cyl(0.33, 0.33, 1.42, 22).rotateX(Math.PI / 2).translate(0.86, 0.72, -0.25)]), alu, g);
    mk(mergeGeos([-0.72, -0.25, 0.22].map(z => new THREE.TorusGeometry(0.335, 0.012, 5, 22).translate(0.86, 0.72, z))), SHARED.trim, g);
    mk(mergeGeos([boxG(0.62, 0.62, 0.92, -0.86, 0.72, -0.42)]), plastic, g);
    mk(boxG(0.03, 0.5, 0.8, -1.18, 0.72, -0.42), grey, g);
    mk(mergeGeos([0.56, 0.72, 0.88].map(y => boxG(0.03, 0.03, 0.74, -1.2, y, -0.42))), SHARED.trim, g);
    mk(mergeGeos([limb([-0.72, 0.56, 0.1], [-0.72, 0.56, 0.5], 0.13, 0.13, 12), limb([-0.72, 0.84, 0.1], [-0.72, 0.84, 0.5], 0.1, 0.1, 12)]), grey, g);
    mk(limb([0.72, 0.62, 0.55], [0.72, 0.62, 1.05], 0.2, 0.2, 14), grey, g);
    // air and electric lines to the trailer, coiled, on a rack behind the cab
    [[0x2a6fd0, -0.28], [0xd8392f, 0], [0xe6c52a, 0.28]].forEach(([hex, x]) => {
      const rings = []; for (let k = 0; k < 5; k++) rings.push(new THREE.TorusGeometry(0.11, 0.012, 5, 12).rotateX(Math.PI / 2 + 0.35).translate(x, 1.42 + k * 0.17, 0.4 - k * 0.01));
      mk(mergeGeos(rings), new THREE.MeshStandardMaterial({ color: hex, roughness: 0.5 }), g);
    });
    mk(mergeGeos([limb([-0.5, 1.1, 0.5], [-0.5, 2.3, 0.5], 0.02, 0.02, 6), limb([0.5, 1.1, 0.5], [0.5, 2.3, 0.5], 0.02, 0.02, 6), limb([-0.5, 2.3, 0.5], [0.5, 2.3, 0.5], 0.02, 0.02, 6)]), SHARED.trim, g);
    // mudguards over the twin tyres, mud flaps, tail-light bar, underrun bar
    mk(mergeGeos([-1, 1].flatMap(sd => [boxG(0.72, 0.03, 0.82, sd * 0.93, 1.2, -1.7), boxG(0.72, 0.03, 0.46, sd * 0.93, 1.06, -1.05, 0.72), boxG(0.72, 0.03, 0.44, sd * 0.93, 1.06, -2.34, -0.72)])), plastic, g);
    mk(mergeGeos([-1, 1].flatMap(sd => [boxG(0.72, 0.5, 0.02, sd * 0.93, 0.62, -2.5), boxG(0.5, 0.42, 0.02, sd * 1.0, 0.34, 1.15)])), rubber, g);
    mk(mergeGeos([boxG(2.3, 0.1, 0.1, 0, 0.7, -3.22), ...[-1, 1].map(sd => boxG(0.5, 0.18, 0.07, sd * 0.86, 0.86, -3.22))]), SHARED.trim, g);
    mk(mergeGeos([-1, 1].map(sd => boxG(0.22, 0.12, 0.04, sd * 0.98, 0.86, -3.26))), red, g);
    mk(mergeGeos([-1, 1].flatMap(sd => [boxG(0.11, 0.12, 0.04, sd * 0.8, 0.86, -3.26)])), amber, g);
    mk(mergeGeos([-1, 1].map(sd => boxG(0.08, 0.12, 0.04, sd * 0.69, 0.86, -3.26))), led, g);
    mk(boxG(0.52, 0.12, 0.02, 0, 0.7, -3.285), plateMat, g);
    const wheels = [], pivots = [];
    [[1.1, 2.0, true, 0.32], [-1.1, 2.0, true, 0.32], [0.76, -1.7, false, 0.26], [1.06, -1.7, false, 0.26], [-0.76, -1.7, false, 0.26], [-1.06, -1.7, false, 0.26]].forEach(([x, z, f, w]) =>
      wheel(g, { x, z, r: 0.52, w, tyre: 0.22, rim: alu, solid: true, front: f, list: wheels, pivots }));
    MODELS.truck = { g, paint: pm, base: C(base), wheels, pivots, r: 0.52 };
  }

  Object.values(MODELS).forEach(m => { m.g.visible = false; carTilt.add(m.g); });
  [-0.62, 0.62].forEach(x => {
    const s = new THREE.SpotLight(0xf2f7ff, 2.2, 85, 0.5, 0.55, 1.2);
    s.position.set(x, 0.85, 2.4); s.target.position.set(x * 2, -0.5, 16);
    carTilt.add(s, s.target);
    headlights.push(s);
    const beam = new THREE.Mesh(BEAM_GEO, BEAM_MAT); beam.rotation.x = 0.06; carTilt.add(beam); beams.push(beam);
  });
})();
function setVehicle(key){
  V = VEH[key];
  Object.entries(MODELS).forEach(([k, m]) => { m.g.visible = k === key; });
  headlights.forEach((s, i) => {
    const x = key === 'bike' ? 0 : (i ? 0.62 : -0.62) * (key === 'truck' ? 1.45 : 1.05);
    s.position.set(x, V.lightY, V.light);
    s.target.position.set(x * 2, -0.5, V.light + 16);
    s.intensity = key === 'bike' ? 1.4 : 2.2;
    beams[i].position.copy(s.position); beams[i].visible = key !== 'bike' || i === 0;
  });
  if (audio) setEngineVoice();
}
const car = { x: 0, z: 0, y: 0, heading: 0, speed: 0, steer: 0, pitch: 0, roll: 0, bodyPitch: 0, shake: 0, wheelRot: 0, prevSpeed: 0, lean: 0 };

// ---------- Police ----------
// ### Up to four police cars with flashing light bars, a real point light and a siren. Wanted stars (Core.wantedStars) rise
// ### with time and progress and set how many chase you, how fast, and how quickly wrecked cars come back. In the city police follow the street grid until they see you (line of sight),
// ### on the highway they weave around traffic, in the countryside they follow the road. They reverse when stuck, can be
// ### rammed until wrecked, and fill the bust meter when they are right next to you while you are nearly stopped.
const police = [];
const policeTex = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = '#f2f3f6'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#1e3fa8'; g.fillRect(0, 44, 256, 10);
  g.fillStyle = '#10131a'; g.font = '800 34px "Bricolage Grotesque", "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('POLICE', 128, 24);
  const t = new THREE.CanvasTexture(c); t.anisotropy = ANISO; t.encoding = THREE.sRGBEncoding; return t;
})();
(function buildPolice(){
  const P = PARTS.sedan;
  const black = new THREE.MeshPhysicalMaterial({ color: 0x14161c, roughness: 0.3, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.06 }); black.userData.env = 0.9;
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf2f3f6, roughness: 0.3, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 }); white.userData.env = 0.8;
  const doorMat = new THREE.MeshStandardMaterial({ map: policeTex, roughness: 0.35, metalness: 0.2 });
  for (let i = 0; i < Core.pursuit(Core.MAX_STARS).cops; i++){
    const g = new THREE.Group();
    const mk = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; g.add(m); return m; };
    mk(P.bodyOnly, black); mk(P.roof, white); mk(P.glass, SHARED.glass); mk(P.trim, SHARED.trim); mk(P.chrome, SHARED.chrome); mk(P.tire, SHARED.tire); mk(P.head, SHARED.head); mk(P.tail, SHARED.tail); mk(P.lens, SHARED.lens);
    for (const s of [-1, 1]){
      const door = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.52), doorMat);
      door.position.set(s * 0.95, 0.7, 0.05); door.rotation.y = s * Math.PI / 2; g.add(door);
    }
    mk(boxG(1.84, 0.06, 0.9, 0, 0.99, 1.3), white);
    mk(boxG(1.3, 0.1, 0.36, 0, 1.52, -0.3), SHARED.trim);
    const red = new THREE.MeshBasicMaterial({ color: 0xff2a3a }), blue = new THREE.MeshBasicMaterial({ color: 0x2a6bff });
    mk(boxG(0.56, 0.15, 0.32, -0.33, 1.64, -0.3), red); mk(boxG(0.56, 0.15, 0.32, 0.33, 1.64, -0.3), blue);
    const sRed = glowSprite(C(0xff2a3a), 4.5), sBlue = glowSprite(C(0x2a6bff), 4.5);
    sRed.position.set(-0.4, 1.7, -0.3); sBlue.position.set(0.4, 1.7, -0.3); g.add(sRed, sBlue);
    const light = new THREE.PointLight(0xff2a3a, 0, 26, 2); scene.add(light);
    g.visible = false;
    scene.add(g);
    police.push({ g, red, blue, sRed, sBlue, light, idx: i, active: false, x: 0, z: 0, heading: 0, speed: 0, steer: 0, hp: 3, stun: 0, stuck: 0, rev: 0, wp: null, respawn: 0, hitCool: 0 });
  }
})();
let spawnTimer = 0, bust = 0, copsWrecked = 0, copsWarned = false, nearestCop = Infinity, stars = 1;
function updateWanted(){
  let progress;
  if (M.linear){ const [done, total] = routeProgress(); progress = done / total; }
  else progress = gate && gate.active ? 1 : collected / Math.max(1, M.shards);
  const next = Core.wantedStars(stars, M.time - timeLeft, M.time, progress, copsWrecked);
  if (next === stars) return;
  stars = next;
  if (Core.helicopterDue(stars)) toast('Five stars: police helicopter overhead! Stay out of its light.', 'red', 3600);
  else if (stars >= 3) toast('Wanted level up: ' + stars + ' stars. More police, and faster.', 'red', 2400);
}
const snapI = v => clamp(Math.round(v / PITCH) * PITCH, -3 * PITCH, 3 * PITCH);
function segmentBlocked(x0, z0, x1, z1){
  const dx = x1 - x0, dz = z1 - z0;
  for (const c of CITY.colliders){
    if (c.t !== 'b') continue;
    if (c.x1 < Math.min(x0, x1) || c.x0 > Math.max(x0, x1) || c.z1 < Math.min(z0, z1) || c.z0 > Math.max(z0, z1)) continue;
    let t0 = 0, t1 = 1, ok = true;
    for (const [o, d, lo, hi] of [[x0, dx, c.x0, c.x1], [z0, dz, c.z0, c.z1]]){
      if (Math.abs(d) < 1e-6){ if (o < lo || o > hi){ ok = false; break; } continue; }
      let a = (lo - o) / d, b = (hi - o) / d;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1){ ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}
function spawnPolice(p){
  let x, z;
  if (mode === 'city'){
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const cands = intersections.filter(q => { const d = Math.hypot(q.x - car.x, q.z - car.z); return d > 70 && d < 150; })
      .sort((a, b) => ((a.x - car.x) * fx + (a.z - car.z) * fz) - ((b.x - car.x) * fx + (b.z - car.z) * fz));
    if (!cands.length) return false;
    const q = cands[Math.floor(Math.random() * Math.min(4, cands.length))];
    x = q.x; z = q.z;
  } else if (mode === 'country'){
    if (roadPos.s < 170) return false;
    const pt = roadPoint(roadPos.s - 120 - Math.random() * 40, ROAD.lane); x = pt.x; z = pt.z;
  } else {
    if (car.z < HW.Z0 + 150) return false;
    x = HW.our[Math.floor(Math.random() * 3)]; z = car.z - 120 - Math.random() * 40;
  }
  Object.assign(p, { x, z, heading: Math.atan2(car.x - x, car.z - z), speed: mode !== 'city' ? Math.max(20, car.speed) : 6, ri: undefined, road: null, steer: 0, hp: Core.pursuit(stars).hp, stun: 0, stuck: 0, rev: 0, wp: null, active: true, hitCool: 0 });
  p.g.visible = true;
  return true;
}
function wreckPolice(p){
  p.active = false; p.respawn = Core.pursuit(stars).respawn; copsWrecked++;
  burst(p.x, 1.2, p.z, SPARKS, 40, 1);
  burst(p.x, 1.2, p.z, C(0x2a6bff), 16, 0.8);
  p.g.visible = false; p.light.intensity = 0;
  toast('Police car taken out!', 'gold', 2000);
}
function updatePolice(dt){
  const live = state === 'play';
  if (live){
    updateWanted();
    spawnTimer -= dt;
    police.forEach(p => { if (!p.active && p.respawn > 0) p.respawn -= dt; });
    const active = police.filter(p => p.active).length;
    if (active < Core.pursuit(stars).cops && spawnTimer <= 0){
      const p = police.find(q => !q.active && q.respawn <= 0);
      if (p && spawnPolice(p)){
        spawnTimer = Core.pursuit(stars).spawn;
        if (!copsWarned){ copsWarned = true; toast("Police on your tail! Don't let them box you in.", 'red', 3200); }
      } else spawnTimer = 1;
    }
  }
  const pvx = Math.sin(car.heading) * car.speed, pvz = Math.cos(car.heading) * car.speed;
  nearestCop = Infinity;
  for (const p of police){
    if (!p.active) continue;
    const dist = Math.hypot(car.x - p.x, car.z - p.z);
    nearestCop = Math.min(nearestCop, dist);
    if (live && dist > (mode === 'city' ? 230 : 320)){ spawnPolice(p); continue; }
    if (mode === 'country') p.road = roadQuery(p.x, p.z, p);
    let tx = car.x + pvx * 0.35, tz = car.z + pvz * 0.35;
    if (mode === 'city'){
      const los = dist < (heli.spotted ? 170 : 110) && !segmentBlocked(p.x, p.z, car.x, car.z);
      if (!los){
        if (!p.wp || Math.hypot(p.wp.x - p.x, p.wp.z - p.z) < 6){
          const ix = snapI(p.x), iz = snapI(p.z);
          if (Math.hypot(ix - p.x, iz - p.z) > 8) p.wp = { x: ix, z: iz };
          else {
            const dx = car.x - ix, dz = car.z - iz;
            p.wp = Math.abs(dx) > Math.abs(dz) ? { x: snapI(ix + Math.sign(dx) * PITCH), z: iz } : { x: ix, z: snapI(iz + Math.sign(dz) * PITCH) };
          }
        }
        tx = p.wp.x; tz = p.wp.z;
      } else p.wp = null;
    } else if (mode === 'country'){
      if (dist > 40){ const dirS = Math.sign(roadPos.s - p.road.s) || 1, pt = roadPoint(p.road.s + dirS * 24, dirS * ROAD.lane); tx = pt.x; tz = pt.z; }
    } else {
      tx = clamp(tx, -12.6, -2.2);
      for (const t of traffic){
        if (!t.on || t.dir < 0) continue;
        const ahead = t.z - p.z;
        if (ahead > 0 && ahead < 28 && Math.abs(t.x - p.x) < 2.6){ tx = clamp(t.x + (car.x < t.x ? -3.75 : 3.75), -12.6, -2.2); if (Math.abs(tx - t.x) < 2) tx = t.x + (t.x < -7 ? 3.75 : -3.75); break; }
      }
    }
    const desired = Math.atan2(tx - p.x, tz - p.z);
    const diff = wrapAngle(desired - p.heading);
    const maxP = Core.copTopSpeed(M.police, stars, dist, heli.spotted);
    if (!live){ p.speed *= Math.exp(-dt * 2); }
    else if (p.rev > 0){ p.rev -= dt; p.speed = Math.max(p.speed - 30 * dt, -8); p.steer = -Math.sign(diff) || 1; }
    else {
      p.steer += (clamp(diff * 2.2, -1, 1) - p.steer) * Math.min(1, 10 * dt);
      let target = maxP * (1 - Math.min(0.65, Math.abs(diff) / Math.PI * 1.5));
      if (dist < 14) target = Math.min(target, Math.abs(car.speed) + 7);
      if (mode === 'country' && p.road && Math.abs(p.road.lat) > 5.5) target *= 0.6;
      if (p.stun > 0){ p.stun -= dt; target = 0; }
      p.speed += clamp(target - p.speed, -32 * dt, 17 * dt);
      if (p.speed < 2 && target > 8){ p.stuck += dt; if (p.stuck > 1.2){ p.rev = 0.9; p.stuck = 0; } } else p.stuck = Math.max(0, p.stuck - dt);
    }
    const sp = Math.abs(p.speed);
    p.heading += p.steer * Math.min(1, sp / 5) * (2.6 / (1 + sp * 0.035)) * dt * (p.speed >= 0 ? 1 : -1);
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    p.x += fx * p.speed * dt; p.z += fz * p.speed * dt;
    for (const c of collidersNear(p.x, p.z)){
      const hit = collidePoint(p.x, p.z, 1.9, c);
      if (!hit) continue;
      p.x += hit[0] * hit[2]; p.z += hit[1] * hit[2];
      if (-(fx * hit[0] + fz * hit[1]) * p.speed > 3) p.speed *= 0.35;
    }
    for (const o of vehicleObstacles()){
      const d = Math.hypot(p.x - o.x, p.z - o.z), rr = 1.9 + o.r;
      if (d < rr && d > 0.001){ const nx = (p.x - o.x) / d, nz = (p.z - o.z) / d; p.x += nx * (rr - d); p.z += nz * (rr - d); p.speed *= 0.9; if (o.npc) o.npc.stun = Math.max(o.npc.stun, 1.5); }
    }
    for (const q of police){
      if (q === p || !q.active) continue;
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (d < 3.6 && d > 0.001){ const k = (3.6 - d) / 2; p.x += (p.x - q.x) / d * k; p.z += (p.z - q.z) / d * k; }
    }
    // contact with the player
    p.hitCool -= dt;
    const cfx = Math.sin(car.heading), cfz = Math.cos(car.heading);
    for (const s of V.samples){
      const sx = car.x + cfx * s, sz = car.z + cfz * s;
      const d = Math.hypot(sx - p.x, sz - p.z), rr = 1.9 + V.r;
      if (d >= rr || d < 0.001) continue;
      const nx = (sx - p.x) / d, nz = (sz - p.z) / d, pen = rr - d;
      car.x += nx * pen * 0.55; car.z += nz * pen * 0.55; p.x -= nx * pen * 0.45; p.z -= nz * pen * 0.45;
      const impact = -((pvx - fx * p.speed) * nx + (pvz - fz * p.speed) * nz);
      if (live && impact > 3 && p.hitCool <= 0){
        p.hitCool = 0.6;
        crash(impact * 0.8);
        p.hp -= impact * V.ram * 0.09;
        p.stun = Math.max(p.stun, 0.4 + V.ram * 0.5);
        car.speed *= V.key === 'truck' ? 0.92 : 0.72; p.speed *= 0.4;
        if (p.hp <= 0) wreckPolice(p);
      }
      break;
    }
  }
  if (live){
    const b = Core.bustStep(bust, nearestCop, car.speed, dt);
    bust = b.bust;
    if (b.busted) gameOver('busted');
  }
}
function updatePoliceVisuals(){
  const phase = Math.floor(clock * 8);
  police.forEach((p, i) => {
    if (!p.active) return;
    p.g.position.set(p.x, groundH(p.x, p.z), p.z); p.g.rotation.y = p.heading;
    const r = (phase + i) % 2 === 0;
    p.red.color.setHex(r ? 0xff2a3a : 0x3a0610); p.blue.color.setHex(r ? 0x0a1640 : 0x2a6bff);
    p.sRed.material.opacity = r ? 1 : 0.05; p.sBlue.material.opacity = r ? 0.05 : 1;
    p.light.color.setHex(r ? 0xff2a3a : 0x2a6bff); p.light.intensity = 3;
    p.light.position.set(p.x, p.g.position.y + 2.4, p.z);
  });
}
function resetPolice(){
  police.forEach(p => { p.active = false; p.respawn = 0; p.g.visible = false; p.light.intensity = 0; });
  spawnTimer = 4; bust = 0; copsWrecked = 0; copsWarned = false; nearestCop = Infinity; stars = 1;
  heli.on = false; heli.spotted = false; heli.g.visible = false; heli.beam.visible = false; heli.pool.visible = false;
}

// ---------- Police helicopter ----------
// ### Comes with the fifth star and stays until the run ends. It flies ahead of the player, so its searchlight is in view from
// ### the chase camera. The light follows the player a little slower than the police can drive: at full speed on a clear road
// ### you stay ahead of it, but every sharp turn or crash lets it catch you. While you are in the light the police know
// ### where you are: they drive 6 % faster and see you from further away. Its beam is a fake (a cone and a glow on the ground),
// ### not a light source, so the scene's shaders never have to change when it arrives.
const heli = (() => {
  const g = new THREE.Group(), rotor = new THREE.Group(), tail = new THREE.Group();
  // a light twin-engine police helicopter, about 12 m long with a 10 m rotor: bubble canopy, engine hump, slim boom, skids
  const white = new THREE.MeshPhysicalMaterial({ color: 0xcdd3dc, roughness: 0.3, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 }); white.userData.env = 1.2;
  const blue = new THREE.MeshPhysicalMaterial({ color: 0x173777, roughness: 0.3, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.1 }); blue.userData.env = 1.2;
  const dark = new THREE.MeshStandardMaterial({ color: 0x24272d, roughness: 0.5, metalness: 0.5 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8b9098, roughness: 0.35, metalness: 0.85 });
  const shape = pts => { const s = new THREE.Shape(); pts.forEach((p, i) => i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])); s.closePath(); return s; };
  const add = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); parent.add(m); return m; };
  const pod = { half: 2.8, zc: 0.1, belt: 1.25, roof: 2.35, tumble: 0.32, plan: 0.62 };
  add(smoothGeo(shapeBody(extrudeProfile(shape([[2.55, 1.1], [2.44, 1.42], [2.1, 1.8], [1.5, 2.14], [0.6, 2.28], [-0.9, 2.26], [-1.7, 1.94], [-2.1, 1.56], [-1.92, 1.06], [-0.8, 0.8], [0.9, 0.76], [2.0, 0.84]]), 1.72, 0.12), pod)), white, g);
  // blue belly and a blue band along the side
  add(smoothGeo(shapeBody(extrudeProfile(shape([[2.08, 0.85], [0.9, 0.72], [-0.8, 0.76], [-1.98, 1.04], [-2.08, 1.34], [-0.8, 1.14], [0.9, 1.1], [2.2, 1.12]]), 1.76, 0.1), pod)), blue, g);
  // the bubble canopy, its centre post, the door and cabin windows
  add(smoothGeo(shapeBody(extrudeProfile(shape([[2.62, 1.14], [2.5, 1.46], [2.15, 1.86], [1.56, 2.2], [1.12, 2.26], [0.86, 1.5], [1.2, 1.06], [2.06, 0.94]]), 1.74, 0.12), pod)), SHARED.glass, g);
  add(mergeGeos([limb([0, 2.38, 1.42], [0, 1.58, 2.5], 0.035, 0.035, 6), limb([0, 1.58, 2.5], [0, 1.06, 2.58], 0.03, 0.03, 6)]), dark, g);
  add(extrudeProfile(shape([[0.72, 2.02], [0.72, 1.3], [-0.12, 1.3], [-0.12, 2.04]]), 1.84, 0.012), SHARED.glass, g);
  add(extrudeProfile(shape([[-0.24, 2.04], [-0.24, 1.32], [-1.1, 1.42], [-1.2, 1.98]]), 1.76, 0.012), SHARED.glass, g);
  add(mergeGeos([boxG(1.82, 1.02, 0.02, 0, 1.68, 0.82), boxG(1.78, 1.0, 0.02, 0, 1.68, -0.18), boxG(0.04, 0.05, 0.2, 0.9, 1.5, 0.04), boxG(0.04, 0.05, 0.2, -0.9, 1.5, 0.04)]), dark, g);
  // engine hump with air intakes, twin exhausts and the rotor mast
  add(smoothGeo(extrudeProfile(shape([[0.74, 2.26], [0.42, 2.56], [-1.1, 2.6], [-1.86, 2.2], [-1.7, 1.98], [0.5, 2.1]]), 0.92, 0.06)), white, g);
  add(mergeGeos([-1, 1].map(sd => boxG(0.03, 0.17, 0.42, sd * 0.5, 2.36, 0.12))), dark, g);
  add(mergeGeos([-1, 1].map(sd => limb([sd * 0.3, 2.4, -1.5], [sd * 0.42, 2.44, -2.0], 0.1, 0.12, 10))), dark, g);
  add(limb([0, 2.55, 0.0], [0, 3.0, 0.0], 0.11, 0.075, 10), steel, g);
  // tail boom, fin with its lower skid, tailplane with end plates
  add(limb([0, 1.7, -1.7], [0, 2.1, -6.6], 0.42, 0.13, 14), white, g);
  add(limb([0, 1.42, -1.8], [0, 1.96, -6.4], 0.14, 0.05, 8), blue, g);
  add(extrudeProfile(shape([[-6.2, 2.05], [-6.92, 3.4], [-7.36, 3.46], [-7.02, 2.05]]), 0.1, 0.012), blue, g);
  add(extrudeProfile(shape([[-6.5, 2.0], [-6.96, 1.3], [-7.2, 1.3], [-6.98, 2.0]]), 0.09, 0.01), blue, g);
  add(mergeGeos([boxG(2.0, 0.05, 0.44, 0, 2.02, -5.3), boxG(0.05, 0.42, 0.5, 1.0, 2.02, -5.32), boxG(0.05, 0.42, 0.5, -1.0, 2.02, -5.32)]), white, g);
  // skids with their curved front ends, on two arched cross tubes
  add(mergeGeos([-1, 1].flatMap(sd => [
    limb([sd * 1.1, 0.06, -1.6], [sd * 1.1, 0.06, 1.3], 0.05, 0.05, 8), limb([sd * 1.1, 0.06, 1.3], [sd * 1.1, 0.26, 1.72], 0.05, 0.045, 8),
    ...[0.86, -0.82].flatMap(z => [limb([sd * 1.1, 0.06, z], [sd * 0.88, 0.5, z], 0.04, 0.04, 8), limb([sd * 0.88, 0.5, z], [sd * 0.3, 0.8, z], 0.04, 0.04, 8)])
  ])), dark, g);
  // searchlight and camera ball under the nose
  add(mergeGeos([limb([0.28, 0.82, 1.66], [0.28, 0.62, 1.66], 0.06, 0.06, 8), ball([0.28, 0.5, 1.66], 0.17), ball([-0.3, 0.6, 1.8], 0.15)]), dark, g);
  add(ball([0.28, 0.46, 1.72], 0.125), new THREE.MeshBasicMaterial({ color: 0xf6f8ff }), g);
  add(ball([-0.3, 0.6, 1.92], 0.06), SHARED.glass, g);
  // four tapered, slightly drooping blades on a hub, with a soft disc for the blur when they spin
  rotor.position.set(0, 3.02, 0);
  const blades = [];
  for (let k = 0; k < 4; k++){
    const s = new THREE.Shape(); s.moveTo(0.28, -0.13); s.lineTo(5.15, -0.1); s.lineTo(5.3, 0); s.lineTo(5.15, 0.1); s.lineTo(0.28, 0.13); s.closePath();
    blades.push(new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false }).rotateX(Math.PI / 2).rotateZ(-0.018).rotateY(k * Math.PI / 2));
  }
  add(mergeGeos(blades), dark, rotor);
  add(mergeGeos([ball([0, 0, 0], 0.22, 1, 0.5, 1), limb([0, -0.14, 0], [0, 0.14, 0], 0.08, 0.05, 8), boxG(0.72, 0.06, 0.12, 0, 0, 0), boxG(0.12, 0.06, 0.72, 0, 0, 0)]), steel, rotor);
  const blur = new THREE.MeshBasicMaterial({ color: 0x9fb0cc, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide });
  add(new THREE.CircleGeometry(5.3, 36).rotateX(-Math.PI / 2), blur, rotor);
  g.add(rotor);
  // tail rotor on the right of the fin
  tail.position.set(0.14, 2.86, -6.95);
  add(mergeGeos([boxG(0.03, 1.5, 0.13, 0, 0, 0), boxG(0.03, 0.13, 1.5, 0, 0, 0), ball([0, 0, 0], 0.09)]), dark, tail);
  add(new THREE.CircleGeometry(0.75, 18).rotateY(Math.PI / 2), blur, tail);
  g.add(tail);
  const strobeR = add(ball([0, 3.5, -7.15], 0.075), new THREE.MeshBasicMaterial({ color: 0xff2a3a }), g);
  const strobeB = add(ball([0, 0.68, -0.3], 0.1), new THREE.MeshBasicMaterial({ color: 0x4d86ff }), g);
  add(mergeGeos([ball([1.0, 2.04, -5.32], 0.045)]), new THREE.MeshBasicMaterial({ color: 0x35ff7a }), g);
  add(mergeGeos([ball([-1.0, 2.04, -5.32], 0.045)]), new THREE.MeshBasicMaterial({ color: 0xff3040 }), g);
  g.scale.setScalar(1.12);
  g.visible = false; scene.add(g);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 24, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 0.5), BEAM_MAT.clone());
  beam.material.opacity = 0.26; beam.visible = false; scene.add(beam);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTexture, color: 0xdfe9ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
  pool.scale.setScalar(Core.SPOT_RADIUS * 1.5); pool.visible = false; scene.add(pool);
  return { g, rotor, tail, beam, pool, strobeR, strobeB, on: false, spotted: false, closing: 0, x: 0, z: 0, sx: 0, sz: 0, h: 0, tilt: 0, roll: 0 };
})();
function updateHeli(dt){
  const live = state === 'play', H = heli;
  if (!H.on){
    if (!live || !Core.helicopterDue(stars)) return;
    // it arrives from behind the player and overtakes
    H.on = true; H.x = car.x - Math.sin(car.heading) * 170; H.z = car.z - Math.cos(car.heading) * 170; H.sx = H.x; H.sz = H.z; H.h = car.heading;
    H.g.visible = true; H.beam.visible = true; H.pool.visible = true;
  }
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading), v = car.speed;
  const px = H.x, pz = H.z, before = Math.hypot(H.x - car.x, H.z - car.z);
  [H.x, H.z] = Core.trackStep(H.x, H.z, car.x + fx * 82 + fz * 7, car.z + fz * 82 - fx * 7, Math.max(44, M.max * 1.5), dt);
  // the light leads the car slightly and moves a little slower than the police can drive
  [H.sx, H.sz] = Core.trackStep(H.sx, H.sz, car.x + fx * v * 0.2, car.z + fz * v * 0.2, M.police * 0.94, dt);
  H.spotted = live && Core.inSpotlight(H.sx, H.sz, car.x, car.z);
  if (dt > 0) H.closing += ((before - Math.hypot(H.x - car.x, H.z - car.z)) / dt - H.closing) * Math.min(1, dt * 2);
  const vx = dt > 0 ? (H.x - px) / dt : 0, vz = dt > 0 ? (H.z - pz) / dt : 0, sp = Math.hypot(vx, vz);
  const face = wrapAngle(Math.atan2(car.x - H.x, car.z - H.z) - H.h);
  H.h += face * Math.min(1, dt * 1.6);
  const along = vx * Math.sin(H.h) + vz * Math.cos(H.h);
  H.tilt += (clamp(along / 60, -0.3, 0.3) - H.tilt) * Math.min(1, dt * 2);
  H.roll += (clamp(face * 0.5, -0.4, 0.4) - H.roll) * Math.min(1, dt * 2);
  const y = groundH(H.x, H.z) + 31 + Math.sin(clock * 0.9) * 0.6;
  H.g.position.set(H.x, y, H.z); H.g.rotation.set(H.tilt, H.h, -H.roll, 'YXZ');
  H.rotor.rotation.y += dt * Core.ROTOR.rps * Math.PI * 2; H.tail.rotation.x += dt * 170;
  const blink = Math.floor(clock * 4) % 2 === 0; H.strobeR.visible = blink; H.strobeB.visible = !blink;
  const gy = groundH(H.sx, H.sz) + 0.3;
  H.pool.position.set(H.sx, gy, H.sz);
  H.pool.material.color.setHex(H.spotted ? 0xfff0d8 : 0xdfe9ff);
  const lx = H.x + Math.sin(H.h) * 1.92, lz = H.z + Math.cos(H.h) * 1.92;
  H.beam.position.set(lx, y + 0.5, lz); H.beam.lookAt(H.sx, gy, H.sz);
  const L = Math.hypot(H.sx - lx, gy - y - 0.5, H.sz - lz);
  H.beam.scale.set(Core.SPOT_RADIUS, Core.SPOT_RADIUS, L);
}
// moving vehicles as circles (city traffic) for collisions
let frameNo = 0, obsCache = null, obsStamp = -1;
function vehicleObstacles(){
  if (obsStamp === frameNo && obsCache) return obsCache;
  obsStamp = frameNo;
  return (obsCache = buildObstacles());
}
function buildObstacles(){
  const out = [];
  if (mode === 'country'){
    for (const t of ctraffic){
      if (!t.on) continue;
      const fx = Math.sin(t.h), fz = Math.cos(t.h), v = t.speed;
      const offs = t.type === 'truck' ? [-4.2, -1.5, 1.2, 3.6] : [-1.2, 1.2], r = t.type === 'truck' ? 1.35 : 1.05;
      for (const o of offs) out.push({ x: t.x + fx * o, z: t.z + fz * o, r, npc: t, vx: fx * v, vz: fz * v });
    }
    return out;
  }
  if (mode !== 'city') return out;
  for (const n of npcs){
    if (!n.on) continue;
    const fx = Math.sin(n.h), fz = Math.cos(n.h);
    if (n.tram){
      for (const o of [-2.9, 0, 2.9]) out.push({ x: n.x + fx * o, z: n.z + fz * o, r: 1.3, npc: n, vx: fx * n.speed, vz: fz * n.speed });
      continue;
    }
    out.push({ x: n.x + fx * 1.15, z: n.z + fz * 1.15, r: 1.05, npc: n, vx: fx * n.speed, vz: fz * n.speed });
    out.push({ x: n.x - fx * 1.15, z: n.z - fz * 1.15, r: 1.05, npc: n, vx: fx * n.speed, vz: fz * n.speed });
  }
  return out;
}

// ---------- Pickups (placed fresh every run) ----------
// ### placeRun places the star shards, the green repair kits and the finish gate for the current map.
// ### City: shards in parks, on the squares and on roads, gate under the Arco da Rua Augusta. Highway/countryside: shards along the route,
// ### each worth +4 s, gate at the end.
const gemGeo = new THREE.OctahedronGeometry(0.9, 0); gemGeo.scale(1, 1.45, 1);
const gemMat = new THREE.MeshStandardMaterial({ color: 0x9ff6ff, emissive: SPARK, emissiveIntensity: 1.4, flatShading: true, roughness: 0.2, metalness: 0.3 });
const ringGeo = new THREE.RingGeometry(1.8, 2.3, 32); ringGeo.rotateX(-Math.PI / 2);
const kitMat = new THREE.MeshStandardMaterial({ color: 0xd8ffe9, emissive: GREEN, emissiveIntensity: 1.2, flatShading: true, roughness: 0.3 });
const kitBar1 = new THREE.BoxGeometry(1.6, 0.5, 0.5), kitBar2 = new THREE.BoxGeometry(0.5, 1.6, 0.5);
let runGroup = null, items = [], kits = [], gate = null;

function glowSprite(color, size, opacity){
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: opacity || 1 }));
  s.scale.setScalar(size);
  return s;
}

function placeRun(){
  if (runGroup){
    scene.remove(runGroup);
    runGroup.traverse(o => {
      if (o.material && o.material !== gemMat && o.material !== kitMat) o.material.dispose();
      if (o.geometry && o.geometry !== gemGeo && o.geometry !== ringGeo && o.geometry !== kitBar1 && o.geometry !== kitBar2 && !o.isSprite) o.geometry.dispose();
    });
  }
  runGroup = new THREE.Group(); scene.add(runGroup);
  items = []; kits = [];
  const rnd = Math.random;
  const chosen = [], kitSpots = [];
  let gp, gateR, gateY, gateRot = 0;
  if (mode === 'city'){
    const lane = s => { const side = rnd() < 0.5 ? -3.5 : 3.5; return s.axis === 'x' ? { x: s.x, z: s.z + side } : { x: s.x + side, z: s.z }; };
    const far = (p, list, d) => list.every(q => Math.hypot(q.x - p.x, q.z - p.z) >= d);
    chosen.push({ x: -3.5, z: 24 });
    shuffle(shardSpots.slice(), rnd).forEach(p => { if (chosen.length < 4 && far(p, chosen, 36)) chosen.push(p); });
    const roads = shuffle(roadSpots.slice(), rnd);
    for (const s of roads){ if (chosen.length >= M.shards) break; const p = lane(s); if (Math.hypot(p.x, p.z) > 30 && far(p, chosen, 36)) chosen.push(p); }
    for (const s of roads){ if (kitSpots.length >= M.kits) break; const p = lane(s); if (far(p, chosen, 25) && far(p, kitSpots, 60) && Math.hypot(p.x, p.z) > 40) kitSpots.push(p); }
    gp = { x: 0, z: 83 };
    gateR = 5.4; gateY = 5.8;
  } else if (mode === 'country'){
    for (let i = 0; i < M.shards; i++){ const s = 220 + i * (ROAD.len - 480) / (M.shards - 1), pt = roadPoint(s, (rnd() < 0.5 ? -1 : 1) * ROAD.lane); chosen.push({ x: pt.x, z: pt.z, s }); }
    [0.3, 0.55, 0.8].forEach(f => { const pt = roadPoint(ROAD.len * f, (rnd() < 0.5 ? -1 : 1) * 4.7); kitSpots.push({ x: pt.x, z: pt.z }); });
    const gpt = roadPoint(ROAD.len - 60, 0); gp = { x: gpt.x, z: gpt.z }; gateRot = gpt.h; gateR = 6; gateY = 6.4;
  } else {
    for (let i = 0; i < M.shards; i++){ const z = 220 + i * 310 + (rnd() - 0.5) * 120; chosen.push({ x: HW.our[Math.floor(rnd() * 3)], z, s: z }); }
    kitSpots.push({ x: -14, z: 1300 + rnd() * 300 }, { x: -14, z: 2700 + rnd() * 300 });
    gp = { x: -7.15, z: HW.LEN }; gateR = 7.4; gateY = 8;
  }

  chosen.forEach((s, i) => {
    const g = new THREE.Group(); g.position.set(s.x, groundH(s.x, s.z) + (s.park ? 0.12 : 0), s.z);
    const gem = new THREE.Mesh(gemGeo, gemMat); gem.position.y = 1.9; gem.castShadow = true;
    const glow = glowSprite(SPARK, 7, 0.95); glow.position.y = 1.9;
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: SPARK, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.y = 0.06;
    g.add(gem, glow, ring); runGroup.add(g);
    items.push({ x: s.x, z: s.z, s: s.s, group: g, gem, glow, ring, taken: false, phase: i * 1.7 });
  });
  kitSpots.forEach((s, i) => {
    const g = new THREE.Group(); g.position.set(s.x, 0, s.z);
    const cross = new THREE.Group(); cross.position.y = 1.6;
    cross.add(new THREE.Mesh(kitBar1, kitMat), new THREE.Mesh(kitBar2, kitMat));
    const glow = glowSprite(GREEN, 5, 0.8); glow.position.y = 1.6;
    g.add(cross, glow); runGroup.add(g);
    kits.push({ x: s.x, z: s.z, group: g, cross, taken: false, phase: i * 2.1 });
  });

  const pg = new THREE.Group(); pg.position.set(gp.x, 0, gp.z); pg.rotation.y = gateRot;
  const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(gateR, 0.5, 10, 48), new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: GOLD, emissiveIntensity: 1.3, flatShading: true, roughness: 0.3, metalness: 0.4 }));
  ringMesh.position.y = gateY; ringMesh.castShadow = true;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(gateR - 0.4, 40), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  disc.position.y = gateY;
  const beamGeo = new THREE.CylinderGeometry(1.6, 1.6, 220, 16, 1, true); beamGeo.translate(0, 110, 0);
  const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  const pglow = glowSprite(GOLD, gateR * 3.3); pglow.position.y = gateY;
  pg.add(ringMesh, disc, beam, pglow);
  runGroup.add(pg);
  const active = !!M.linear;
  pg.visible = active;
  gate = { x: gp.x, z: gp.z, group: pg, ring: ringMesh, disc, beam, active, grow: active ? 1 : 0 };
}

// ---------- Particles & smoke ----------
// ### burst spawns short-lived sparks (collect, crash, wreck). Above 35 % damage the engine bay smokes, darker when critical.
const particles = [];
const partGeo = new THREE.TetrahedronGeometry(0.26, 0);
function burst(x, y, z, color, n, spread){
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), grp = { left: n };
  spread = spread || 1;
  for (let i = 0; i < n; i++){
    const m = new THREE.Mesh(partGeo, mat); m.position.set(x, y, z); scene.add(m);
    const a = Math.random() * Math.PI * 2, up = (4 + Math.random() * 9) * spread, out = (3 + Math.random() * 7) * spread;
    particles.push({ mesh: m, vx: Math.cos(a) * out, vy: up, vz: Math.sin(a) * out, life: 1, mat, grp });
  }
}
function updateParticles(dt){
  for (let i = particles.length - 1; i >= 0; i--){
    const p = particles[i];
    p.life -= dt * 1.2; p.vy -= 18 * dt;
    p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
    p.mesh.rotation.x += dt * 6; p.mesh.rotation.y += dt * 4;
    p.mat.opacity = Math.max(0, p.life);
    if (p.life <= 0){ scene.remove(p.mesh); particles.splice(i, 1); if (--p.grp.left === 0) p.mat.dispose(); }
  }
}
const smoke = [];
for (let i = 0; i < 40; i++){
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0x6f6f78, transparent: true, depthWrite: false, opacity: 0 }));
  s.visible = false; scene.add(s);
  smoke.push({ s, life: 0, vx: 0, vy: 0, vz: 0 });
}
let smokeAcc = 0, smokeIdx = 0;
function updateSmoke(dt){
  if (state === 'play' && damage > 35){
    smokeAcc += dt * (2 + (damage - 35) / 65 * 16);
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading), front = V.key === 'truck' ? 2.6 : V.key === 'bike' ? 0.4 : 1.6;
    while (smokeAcc >= 1){
      smokeAcc -= 1;
      const p = smoke[smokeIdx++ % smoke.length];
      p.life = 1; p.s.visible = true;
      p.s.position.set(car.x + fx * front + (Math.random() - 0.5) * 0.6, car.y + (V.key === 'truck' ? 3 : 1.2), car.z + fz * front + (Math.random() - 0.5) * 0.6);
      p.vx = (Math.random() - 0.5) * 1.2 - fx * car.speed * 0.25; p.vy = 1.6 + Math.random(); p.vz = (Math.random() - 0.5) * 1.2 - fz * car.speed * 0.25;
      p.s.material.color.set(damage > 75 ? 0x2e2c30 : 0x77777f);
    }
  }
  for (const p of smoke){
    if (p.life <= 0) continue;
    p.life -= dt * 0.7;
    p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
    p.s.scale.setScalar(1.2 + (1 - p.life) * 4);
    p.s.material.opacity = Math.max(0, p.life) * 0.55;
    if (p.life <= 0) p.s.visible = false;
  }
}

// ---------- Sound: engine with rpm and an automatic gearbox, plus siren ----------
// ### Everything is synthesised with the Web Audio API, no sound files. core.js models each engine (ENGINES, engineLoops) and
// ### renders loops at five rpms, each once under load and once on overrun, the way racing games use recorded engine loops.
// ### Here they are pitched to the current rpm and crossfaded by rpm and throttle. The throttle closes for each gear change, so
// ### the revs audibly fall into the next gear. Road rumble, gearbox whine, wind and tyres follow the speed; the truck adds a
// ### lagging turbo and air brakes; a second oscillator with a slow LFO is the police siren.
let audio = null, muted = false;
const ENGINES = Core.ENGINES;
const eng = { rpm: 750, gear: 1, shift: 0, load: 0, boost: 0, miss: 0, prevPedal: 0, prevBrake: false, popTime: 0 };
function initAudio(){
  if (audio){ if (audio.ctx.state === 'suspended') audio.ctx.resume(); return; }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain(); master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
    comp.connect(master); master.connect(ctx.destination);
    const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const bus = gain(0); bus.connect(comp);
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };
    const roadF = ctx.createBiquadFilter(); roadF.type = 'lowpass'; roadF.frequency.value = 240;
    const road = gain(0); noise().connect(roadF).connect(road).connect(comp);
    const windF = ctx.createBiquadFilter(); windF.type = 'highpass'; windF.frequency.value = 700;
    const wind = gain(0); noise().connect(windF).connect(wind).connect(comp);
    const tireF = ctx.createBiquadFilter(); tireF.type = 'bandpass'; tireF.frequency.value = 2300; tireF.Q.value = 9;
    const tire = gain(0); noise().connect(tireF).connect(tire).connect(comp);
    const popF = ctx.createBiquadFilter(); popF.type = 'bandpass'; popF.frequency.value = 1100; popF.Q.value = 1.6;
    popF.connect(comp);
    const airF = ctx.createBiquadFilter(); airF.type = 'highpass'; airF.frequency.value = 3000;
    airF.connect(comp);
    const rotorData = Core.rotorLoop(Core.ENGINE_SR, 7), rotorBuf = ctx.createBuffer(1, rotorData.length, Core.ENGINE_SR); rotorBuf.copyToChannel(rotorData, 0);
    const rotorSrc = ctx.createBufferSource(); rotorSrc.buffer = rotorBuf; rotorSrc.loop = true; rotorSrc.start();
    const rotorF = ctx.createBiquadFilter(); rotorF.type = 'lowpass'; rotorF.frequency.value = 900;
    const rotor = gain(0); rotorSrc.connect(rotorF).connect(rotor).connect(comp);
    const whine = ctx.createOscillator(); whine.type = 'triangle';
    const whineG = gain(0); whine.connect(whineG).connect(comp);
    const turbo = ctx.createOscillator(); turbo.type = 'sine'; turbo.frequency.value = 1800;
    const turboG = gain(0); turbo.connect(turboG).connect(comp);
    const siren = ctx.createOscillator(); siren.type = 'triangle'; siren.frequency.value = 950;
    const sirenLfo = ctx.createOscillator(); sirenLfo.frequency.value = 0.32;
    const sirenDepth = gain(330); sirenLfo.connect(sirenDepth).connect(siren.frequency);
    const sirenGain = gain(0); siren.connect(sirenGain).connect(comp);
    [turbo, whine, siren, sirenLfo].forEach(o => o.start());
    audio = { ctx, master, comp, bus, layers: [], voice: null, bufs: {}, noiseBuf, road, rotor, rotorF, rotorSrc, wind, tire, popF, airF, turbo, turboG, whine, whineG, sirenGain, sirenLfo };
    setEngineVoice();
  } catch (e) { audio = null; }
}
// Swap the engine loops when the vehicle changes: two per reference rpm, one under load and one on overrun
function setEngineVoice(){
  if (!audio || audio.voice === V.key) return;
  const E = ENGINES[V.key], ctx = audio.ctx;
  audio.layers.forEach(l => { try { l.src.stop(); } catch (e) {} l.g.disconnect(); });
  if (!audio.bufs[V.key]) audio.bufs[V.key] = Core.engineLoops(E, Core.ENGINE_SR, 101).map(l => [l.on, l.off].map(d => {
    const b = ctx.createBuffer(1, d.length, Core.ENGINE_SR); b.copyToChannel(d, 0); return b;
  }));
  audio.layers = audio.bufs[V.key].map((pair, i) => pair.map(b => {
    const src = ctx.createBufferSource(); src.buffer = b; src.loop = true;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(g).connect(audio.bus); src.start();
    return { src, g, ref: E.refs[i] };
  })).flat();
  if (E.pops) audio.popF.frequency.value = E.pops;
  audio.voice = V.key;
}
function noiseBurst(at, dest, vol, len){
  const a = audio, s = a.ctx.createBufferSource(), g = a.ctx.createGain();
  s.buffer = a.noiseBuf;
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  s.connect(g).connect(dest); s.start(at, Math.random() * 1.5, len + 0.05);
}
function tone(freqs, dur, type, vol){
  if (!audio || muted) return;
  const ctx = audio.ctx, t0 = ctx.currentTime;
  freqs.forEach((f, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.value = f;
    const st = t0 + i * dur * 0.6;
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(vol || 0.12, st + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
    o.connect(g).connect(audio.master);
    o.start(st); o.stop(st + dur + 0.05);
  });
}
const sfx = {
  collect: () => tone([880, 1175, 1568], 0.18, 'triangle', 0.14),
  repair: () => tone([392, 523, 659], 0.16, 'square', 0.06),
  gate: () => tone([523, 659, 784, 1047, 1319], 0.26, 'sine', 0.12),
  crash: k => tone([110 + k * 2, 70], 0.16, 'square', Math.min(0.14, 0.04 + k * 0.004)),
  win: () => tone([659, 784, 988, 1319], 0.3, 'triangle', 0.13),
  fail: () => tone([392, 330, 262], 0.3, 'sine', 0.12),
  zap: () => tone([180, 90], 0.14, 'sawtooth', 0.07),
};
const engineNorm = () => { const E = ENGINES[V.key]; return clamp((eng.rpm - E.idle) / (E.max - E.idle), 0, 1); };
function engineRpm(){ return eng.rpm; }
function updateEngine(dt){
  const sp = Math.abs(car.speed), live = state === 'play', E = ENGINES[V.key];
  const pedal = live && (keys.up || (keys.down && car.speed <= 0.5)) ? 1 : 0;
  const braking = live && (keys.brake || (keys.down && car.speed > 0.5));
  if (live){ const g = Core.gearFor(E, eng.gear, car.speed, pedal); if (g > eng.gear) eng.shift = E.shift; eng.gear = g; }
  else if (sp < 1) eng.gear = 1;
  if (eng.shift > 0) eng.shift -= dt;
  const throttle = eng.shift > 0 ? 0 : pedal;
  const target = Core.engineTarget(E, eng.gear, car.speed, throttle);
  eng.rpm += (target - eng.rpm) * Math.min(1, dt * (eng.shift > 0 ? E.rev[2] : target > eng.rpm ? E.rev[0] : E.rev[1]));
  eng.load += (throttle - eng.load) * Math.min(1, dt * (throttle ? 12 : 25));
  if (!audio) return;
  setEngineVoice();
  const a = audio, t = a.ctx.currentTime, norm = engineNorm(), rpm = eng.rpm, refs = E.refs;
  // equal-power crossfade between the two nearest rpms, and between load and overrun; the rev limiter cuts the fuel
  const w = refs.map(() => 0);
  if (rpm <= refs[0]) w[0] = 1;
  else if (rpm >= refs[refs.length - 1]) w[refs.length - 1] = 1;
  else { let i = 0; while (rpm > refs[i + 1]) i++; const f = Math.log(rpm / refs[i]) / Math.log(refs[i + 1] / refs[i]); w[i] = Math.cos(f * Math.PI / 2); w[i + 1] = Math.sin(f * Math.PI / 2); }
  const fuel = throttle && rpm > E.max * 0.995 && Math.sin(clock * 55) < 0 ? 0 : eng.load, onW = Math.sin(fuel * Math.PI / 2), offW = Math.cos(fuel * Math.PI / 2);
  a.layers.forEach((l, i) => { const r = i >> 1; l.src.playbackRate.setTargetAtTime(clamp(rpm / l.ref, 0.4, 2.5), t, 0.02); l.g.gain.setTargetAtTime(w[r] * (i & 1 ? offW : onW), t, 0.03); });
  const on = live && !muted;
  let vol = (0.3 + 0.06 * eng.load) * E.vol;
  // a badly damaged engine misfires
  if (live && damage >= 50 && Math.random() < dt * (damage - 40) / 10) eng.miss = 0.05;
  if (eng.miss > 0){ eng.miss -= dt; vol *= 0.4; }
  a.bus.gain.setTargetAtTime(state === 'menu' || state === 'pause' || muted ? 0 : on ? vol : vol * 0.3, t, 0.03);
  if (on && E.pops){
    if (eng.prevPedal && !pedal && norm > 0.45) eng.popTime = 0.7;
    if (eng.popTime > 0){ eng.popTime -= dt; if (Math.random() < dt * 14) noiseBurst(t + Math.random() * 0.02, a.popF, 0.1 + Math.random() * 0.14, 0.03 + Math.random() * 0.03); }
  }
  if (E.turbo){
    // the turbo spools up slowly under load and vents when the driver lifts
    const want = eng.load * norm;
    eng.boost += (want - eng.boost) * Math.min(1, dt * (want > eng.boost ? 1.3 : 4));
    a.turbo.frequency.setTargetAtTime(1400 + 4200 * eng.boost, t, 0.1);
    a.turboG.gain.setTargetAtTime(on ? E.turbo * eng.boost : 0, t, 0.1);
    if (on && eng.prevPedal && !pedal && eng.boost > 0.25) noiseBurst(t, a.airF, 0.1, 0.45);
  } else a.turboG.gain.setTargetAtTime(0, t, 0.1);
  if (on && E.air && eng.prevBrake && !braking && sp > 2) noiseBurst(t, a.airF, 0.16, 0.55);
  eng.prevPedal = pedal; eng.prevBrake = braking;
  a.whine.frequency.setTargetAtTime(Math.max(60, sp * E.whine[0] * (car.speed < 0 ? 1.8 : 1)), t, 0.05);
  a.whineG.gain.setTargetAtTime(on ? E.whine[1] * Math.min(1, sp / 12) * (car.speed < -0.3 ? 3 : 0.4 + 0.6 * eng.load) : 0, t, 0.08);
  const rough = mode === 'country' && Math.abs(roadPos.lat) > 5.4 ? 2.2 : 1;
  a.road.gain.setTargetAtTime(on ? Math.pow(sp / 55, 1.4) * 0.16 * E.road * rough : 0, t, 0.15);
  const rotorDist = heli.on ? Math.hypot(heli.x - car.x, heli.z - car.z) : 300, rotorNear = clamp(1 - rotorDist / 240, 0.2, 1);
  a.rotor.gain.setTargetAtTime(on && heli.on ? 0.42 * rotorNear : 0, t, 0.3);
  a.rotorF.frequency.setTargetAtTime(500 + 3500 * rotorNear * rotorNear, t, 0.3);
  a.rotorSrc.playbackRate.setTargetAtTime(1 + clamp(heli.closing / 340, -0.08, 0.08), t, 0.3);
  a.wind.gain.setTargetAtTime(on ? Math.pow(sp / 55, 2) * 0.09 : 0, t, 0.2);
  const squeal = (keys.brake && sp > 8 ? 0.07 : 0) + (Math.abs(car.steer) > 0.8 && sp > 24 ? 0.035 : 0);
  a.tire.gain.setTargetAtTime(on ? squeal : 0, t, 0.06);
  const sirenVol = !muted && state !== 'menu' && state !== 'pause' && nearestCop < Infinity ? 0.075 * clamp(1 - nearestCop / 220, 0, 1) : 0;
  a.sirenGain.gain.setTargetAtTime(sirenVol, t, 0.15);
  a.sirenLfo.frequency.setTargetAtTime(nearestCop < 30 ? 3.2 : 0.32, t, 0.3);
}

// ---------- Map boundary: force field and warning ----------
// ### Each map has an edge the player cannot cross. A glowing force-field wall appears only around the spot you
// ### approach (the shader fades it by distance to the player and height above the ground). Near the edge the HUD shows
// ### a red vignette and a "turn back" banner with an arrow towards the map centre; touching it sparks and zaps.
const BOUND = { mesh: null, zap: 0, pulse: 0, shown: false };
const boundMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uPlayer: { value: new THREE.Vector2() }, uGround: { value: 0 }, uPulse: { value: 0 }, uColor: { value: C(0xff4d5a) }, uColor2: { value: C(0xffc857) } },
  vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: [
    'uniform float uTime; uniform vec2 uPlayer; uniform float uGround; uniform float uPulse; uniform vec3 uColor; uniform vec3 uColor2; varying vec3 vW;',
    'void main(){',
    '  float near = 1.0 - smoothstep(6.0, 46.0, distance(vW.xz, uPlayer));',
    '  if (near <= 0.001) discard;',
    '  float h = vW.y - uGround;',
    '  float fade = 1.0 - smoothstep(0.0, 10.0, max(h, 0.0));',
    '  float run = vW.x + vW.z;',
    '  float stripes = step(0.5, fract(run * 0.18 + h * 0.18 - uTime * 0.7));',
    '  float grid = max(step(0.93, fract(h * 1.1 - uTime * 0.4)), step(0.95, fract(run * 0.45)));',
    '  float base = step(h, 0.35) * 0.9;',
    '  vec3 col = mix(uColor, uColor2, stripes * 0.4);',
    '  float a = near * fade * (0.16 + 0.42 * grid + 0.14 * stripes + base) * (0.75 + 0.25 * sin(uTime * 6.0)) + uPulse * near * fade * 0.7;',
    '  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));',
    '}'
  ].join('\n'),
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending
});
function boundaryRect(){
  if (mode === 'city') return [-LIMIT - 1.6, LIMIT + 1.6, -LIMIT - 1.6, LIMIT + 1.6];
  if (mode === 'highway') return [-17.5, 17.5, HW.Z0 + 1.5, HW.Z1 - 1.5];
  const x1 = TERR.x0 + (TERR.nx - 1) * TERR.cell, z1 = TERR.z0 + (TERR.nz - 1) * TERR.cell;
  return [TERR.x0 + 30, x1 - 30, TERR.z0 + 30, z1 - 30];
}
function buildBoundary(){
  if (BOUND.mesh){ scene.remove(BOUND.mesh); BOUND.mesh.geometry.dispose(); }
  const [x0, x1, z0, z1] = boundaryRect(), y0 = mode === 'country' ? -10 : -1, H = mode === 'country' ? 90 : 16;
  const side = (len, rot, x, z) => { const g = new THREE.PlaneGeometry(len, H, Math.max(1, Math.round(len / 20)), 1); g.rotateY(rot); g.translate(x, y0 + H / 2, z); return g; };
  const parts = mode === 'highway'
    ? [side(x1 - x0, 0, (x0 + x1) / 2, z0), side(x1 - x0, 0, (x0 + x1) / 2, z1)]
    : [side(x1 - x0, 0, (x0 + x1) / 2, z0), side(x1 - x0, 0, (x0 + x1) / 2, z1), side(z1 - z0, Math.PI / 2, x0, (z0 + z1) / 2), side(z1 - z0, Math.PI / 2, x1, (z0 + z1) / 2)];
  BOUND.mesh = new THREE.Mesh(mergeGeos(parts), boundMat);
  BOUND.mesh.frustumCulled = false; BOUND.mesh.renderOrder = 2;
  scene.add(BOUND.mesh);
}
function boundaryDistance(){
  const [x0, x1, z0, z1] = boundaryRect(), pad = mode === 'city' ? 1.6 : mode === 'highway' ? 2.3 : 0;
  return Core.edgeDistance([x0, x1, z0, z1], car.x, car.z, pad, mode === 'highway');
}
function updateBoundary(dt){
  if (!BOUND.mesh) return;
  const live = state === 'play', d = live ? boundaryDistance() : 999;
  const u = boundMat.uniforms;
  u.uTime.value = clock; u.uPlayer.value.set(car.x, car.z); u.uGround.value = car.y;
  BOUND.zap -= dt; BOUND.pulse *= Math.exp(-dt * 5); u.uPulse.value = BOUND.pulse;
  if (live && d < 1.0 && BOUND.zap <= 0){
    BOUND.zap = 0.35; BOUND.pulse = 1;
    const [x0, x1, z0, z1] = boundaryRect();
    const px = clamp(car.x, x0, x1), pz = clamp(car.z, z0, z1);
    const ex = Math.abs(car.x - x0) < Math.abs(car.x - x1) ? x0 : x1, ez = Math.abs(car.z - z0) < Math.abs(car.z - z1) ? z0 : z1;
    const onX = mode !== 'highway' && Math.min(Math.abs(car.x - ex)) < Math.min(Math.abs(car.z - ez));
    burst(onX ? ex : px, car.y + 1, onX ? pz : ez, C(0xff4d5a), 14, 0.6);
    car.shake = Math.max(car.shake, 0.3);
    sfx.zap();
  }
  const prox = clamp(1 - d / 38, 0, 1), show = d < 22;
  ui.edge.style.opacity = prox.toFixed(2);
  if (show !== BOUND.shown){ ui.edgeBanner.classList.toggle('show', show); BOUND.shown = show; }
  if (show){
    const [x0, x1, z0, z1] = boundaryRect();
    let tx = (x0 + x1) / 2, tz = (z0 + z1) / 2;
    if (mode === 'highway') tx = car.x;
    if (mode === 'country'){ const pt = roadPoint(roadPos.s, 0); tx = pt.x; tz = pt.z; }
    const rel = wrapAngle(Math.atan2(tx - car.x, tz - car.z) - car.heading);
    ui.edgeArrow.style.transform = `rotate(${(-rel * 180 / Math.PI).toFixed(1)}deg)`;
  }
}

// ---------- Input ----------
// ### Keyboard (WASD/arrows, space, P, M, Enter) and on-screen touch pads both write into the same keys object.
const keys = { up: false, down: false, left: false, right: false, brake: false };
const keyMap = Core.KEY_MAP;
addEventListener('keydown', e => {
  if (e.repeat && !Object.hasOwn(keyMap, e.code)) return;
  if (Object.hasOwn(keyMap, e.code)){ keys[keyMap[e.code]] = true; e.preventDefault(); }
  if (e.code === 'KeyP' || e.code === 'Escape'){ if (state === 'play') pause(); else if (state === 'pause') resume(); }
  if (e.code === 'KeyM') toggleSound();
  if (e.code === 'Enter' && !overlay.hidden){ const b = card.querySelector('.btn'); if (b){ e.preventDefault(); b.click(); } }
});
addEventListener('keyup', e => { if (Object.hasOwn(keyMap, e.code)) keys[keyMap[e.code]] = false; });
addEventListener('blur', () => { Object.keys(keys).forEach(k => keys[k] = false); if (state === 'play') pause(); });
// The engine must never keep running when the tab is hidden: suspend all audio, resume when visible again
// The error screen pauses the run and silences the engine
addEventListener('shardheist:fatal', () => { if (state === 'play') pause(); if (audio) audio.ctx.suspend(); });
canvas.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  ShardFatal('The graphics were reset', 'The browser stopped the 3D view, usually after a driver reset or when memory runs low. Reload to continue.');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'play') pause();
  if (audio){ if (document.hidden) audio.ctx.suspend(); else audio.ctx.resume(); }
});
addEventListener('pagehide', () => { if (audio) audio.ctx.suspend(); });
document.querySelectorAll('.pad').forEach(btn => {
  const k = btn.dataset.key;
  const on = e => { e.preventDefault(); keys[k] = true; btn.classList.add('down'); try { btn.setPointerCapture(e.pointerId); } catch (_) {} initAudio(); };
  const off = () => { keys[k] = false; btn.classList.remove('down'); };
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('pointerup', off);
  btn.addEventListener('pointercancel', off);
  btn.addEventListener('lostpointercapture', off);
  btn.addEventListener('contextmenu', e => e.preventDefault());
});

// ---------- HUD ----------
// ### Updates the on-screen panels every frame: timer, speedometer (SVG arc with ticks), gear, rpm, pedal bars, damage,
// ### pursuit/bust meter, signal strength and route progress. Values are only written to the DOM when they change.
// ### drawRadar paints the heading-up mini map on a canvas with one affine transform from world to radar coordinates.
const overlay = $('overlay'), card = $('card'), hud = $('hud');
const ui = {
  time: $('time'), speed: $('speed'), rpm: $('rpm'), chips: $('chips'), bars: $('bars'), sig: $('sigText'), toast: $('toast'),
  eye: $('missionEye'), mission: $('missionName'), prog: $('prog'), progKm: $('progKm'), pfill: $('pfill'),
  gVal: $('gVal'), gGlow: $('gGlow'), gTip: $('gTip'), gears: [...document.querySelectorAll('.gearbox [data-g]')], gearD: $('gearD'),
  pBrake: $('pBrake'), pGas: $('pGas'), pBrakeV: $('pBrakeV'), pGasV: $('pGasV'), tBrake: $('tBrake'), tGas: $('tGas'),
  dash: $('dash'), dmg: $('dmg'), dmgPct: $('dmgPct'), dmgState: $('dmgState'), dfill: $('dfill'),
  pursuit: $('pursuit'), edge: $('edgeWarn'), edgeBanner: $('ewBanner'), edgeArrow: $('ewArrow'), purState: $('purState'), cops: [...$('cops').children], stars: $('stars'), bustPct: $('bustPct'), bfill: $('bfill')
};
const DIAMOND = '<svg class="chip" viewBox="0 0 16 16"><path d="M8 1.5 14.5 8 8 14.5 1.5 8Z"/></svg>';
const STAR = '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.2 1.3-6.6L2.5 9.3l6.6-.8z"/></svg>';

const G = { cx: 80, cy: 80, r: 66, a0: 135, sweep: 270, max: 160 };
function polar(r, deg){ const a = deg * Math.PI / 180; return [G.cx + r * Math.cos(a), G.cy + r * Math.sin(a)]; }
function initGauge(){
  G.max = M.gaugeMax;
  const [x0, y0] = polar(G.r, G.a0), [x1, y1] = polar(G.r, G.a0 + G.sweep);
  const d = `M${x0.toFixed(2)} ${y0.toFixed(2)} A${G.r} ${G.r} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  ['gTrack', 'gGlow', 'gVal'].forEach(id => $(id).setAttribute('d', d));
  const step = G.max > 200 ? 20 : 10, major = G.max > 200 ? 40 : 20;
  let html = '';
  for (let v = 0; v <= G.max; v += step){
    const a = G.a0 + G.sweep * v / G.max, isMajor = v % major === 0;
    const [ax, ay] = polar(G.r - 9, a), [bx, by] = polar(G.r - (isMajor ? 15 : 12), a);
    html += `<line class="g-tick${isMajor ? ' major' : ''}${v >= M.redline ? ' red' : ''}" x1="${ax.toFixed(2)}" y1="${ay.toFixed(2)}" x2="${bx.toFixed(2)}" y2="${by.toFixed(2)}"/>`;
    if (isMajor){ const [tx, ty] = polar(G.r - 25, a); html += `<text class="g-num" x="${tx.toFixed(2)}" y="${ty.toFixed(2)}">${v}</text>`; }
  }
  $('gTicks').innerHTML = html;
  last.speed = -1;
}

let toastTimer = 0;
function toast(text, tone, ms){
  ui.toast.textContent = text;
  ui.toast.className = tone || '';
  void ui.toast.offsetWidth;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), ms || 2600);
}
function renderChips(){
  ui.chips.innerHTML = items.map(it => DIAMOND.replace('class="chip"', 'class="chip' + (it.taken ? ' on' : '') + '"')).join('') +
    `<span class="count">${collected}/${items.length}</span>`;
}
const pedal = { thr: 0, brk: 0 };
const last = { street: '', time: '', speed: -1, rpm: -1, sig: '', gear: '', hb: null, thr: -1, brk: -1, dmg: -1, km: '', pur: '', bust: -1 };
function updateHud(dt){
  // in story mode this line names the act instead
  if (mode === 'city' && !story){
    const street = Core.streetAt(car.x, car.z, car.heading);
    if (street && street !== last.street){ ui.eye.textContent = street; last.street = street; }
  }
  const tt = fmtTime(timeLeft);
  if (tt !== last.time){ ui.time.textContent = tt; ui.time.classList.toggle('low', timeLeft <= 20 && state === 'play'); last.time = tt; }
  const sp = Math.abs(car.speed), kmh = Math.round(sp * 3.6);
  if (kmh !== last.speed){
    last.speed = kmh;
    ui.speed.textContent = kmh;
    const f = Math.min(1, kmh / G.max), dash = (f * 100).toFixed(2) + ' 100', vis = f > 0.004 ? '' : '0';
    ui.gVal.style.strokeDasharray = dash; ui.gGlow.style.strokeDasharray = dash;
    ui.gVal.style.opacity = vis; ui.gGlow.style.opacity = vis;
    const [tx, ty] = polar(G.r, G.a0 + G.sweep * f);
    ui.gTip.setAttribute('cx', tx.toFixed(2)); ui.gTip.setAttribute('cy', ty.toFixed(2)); ui.gTip.setAttribute('opacity', f > 0.004 ? 1 : 0);
  }
  const rpm = Math.round(engineRpm() / 50) * 50;
  if (rpm !== last.rpm){ ui.rpm.textContent = rpm + ' rpm'; last.rpm = rpm; }

  // Pedals: S while rolling forward is the brake, S while stopped is reverse (gas in R)
  const fwd = car.speed > 0.5, back = car.speed < -0.5, live = state === 'play';
  let thr = 0, brk = 0;
  if (live && keys.up){ if (back) brk = 1; else thr = 1; }
  if (live && keys.down){ if (fwd) brk = 1; else thr = 1; }
  const k = Math.min(1, dt * 14);
  pedal.thr += (thr - pedal.thr) * k; pedal.brk += (brk - pedal.brk) * k;
  const tv = Math.round(pedal.thr * 100) / 100, bv = Math.round(pedal.brk * 100) / 100;
  if (tv !== last.thr){ [ui.pGas, ui.tGas].forEach(el => el.style.setProperty('--p', tv)); ui.pGasV.textContent = Math.round(tv * 100); ui.pGas.classList.toggle('on', tv > 0.05); last.thr = tv; }
  if (bv !== last.brk){ [ui.pBrake, ui.tBrake].forEach(el => el.style.setProperty('--p', bv)); ui.pBrakeV.textContent = Math.round(bv * 100); ui.pBrake.classList.toggle('on', bv > 0.05); last.brk = bv; }
  const gear = car.speed < -0.3 || (live && keys.down && !fwd) ? 'R' : (sp < 0.3 && !(live && keys.up)) ? 'N' : 'D';
  const gearKey = gear + eng.gear;
  if (gearKey !== last.gear){
    ui.gears.forEach(g => { if (g.dataset.g !== 'P') g.classList.toggle('on', g.dataset.g === gear); });
    ui.gearD.textContent = gear === 'D' ? 'D' + eng.gear : 'D';
    last.gear = gearKey;
  }
  const hb = live && keys.brake;
  if (hb !== last.hb){ ui.gears[0].classList.toggle('on', hb); last.hb = hb; }

  const d = Math.round(damage);
  if (d !== last.dmg){
    last.dmg = d;
    ui.dmgPct.textContent = d;
    const lvl = d >= 70 ? 'crit' : d >= 35 ? 'warn' : 'ok';
    ui.dmg.dataset.level = lvl;
    ui.dmgState.textContent = lvl === 'crit' ? 'Critical' : lvl === 'warn' ? 'Dented' : 'Good';
    ui.dfill.style.width = d + '%';
  }

  // Pursuit
  if (stars !== last.stars){
    last.stars = stars;
    [...ui.stars.children].forEach((s, i) => s.classList.toggle('on', i < stars));
    ui.stars.classList.toggle('max', Core.helicopterDue(stars));
    ui.stars.setAttribute('aria-label', 'Wanted level ' + stars + ' of ' + Core.MAX_STARS);
  }
  const active = police.filter(p => p.active).length, want = state === 'play' ? Core.pursuit(stars).cops : active;
  const stateTxt = heli.spotted ? 'In the spotlight' : !active ? (copsWarned ? 'Lost them' : 'No police yet') : nearestCop < 25 ? 'On your tail' : nearestCop < 140 ? 'In pursuit' : 'Losing them';
  const purKey = active + '|' + want + '|' + stateTxt;
  if (purKey !== last.pur){
    last.pur = purKey;
    ui.purState.textContent = stateTxt;
    ui.pursuit.classList.toggle('active', active > 0);
    ui.pursuit.classList.toggle('close', active > 0 && nearestCop < 25);
    ui.cops.forEach((c, i) => { c.classList.toggle('on', i < active); c.classList.toggle('down', i >= active && i < want); });
  }
  const bp = Math.round(bust * 100);
  if (bp !== last.bust){ ui.bustPct.textContent = bp + '%'; ui.bfill.style.width = bp + '%'; last.bust = bp; }

  let bars, txt, gold = false;
  if (M.linear){
    const [done, total] = routeProgress();
    const km = (Math.max(0, total - done) / 1000).toFixed(1);
    if (km !== last.km){ ui.progKm.textContent = km + ' km'; ui.pfill.style.width = clamp(done / total, 0, 1) * 100 + '%'; last.km = km; }
  }
  if (gate && gate.active && mode === 'city'){ bars = 4; txt = 'Gate open'; gold = true; }
  else {
    let dist = Infinity;
    items.forEach(it => { if (!it.taken && (mode === 'city' || it.s > routeProgress()[0] - 5)) dist = Math.min(dist, Math.hypot(it.x - car.x, it.z - car.z)); });
    const R = M.radar;
    bars = dist < R ? 4 : dist < R * 1.5 ? 3 : dist < R * 2.2 ? 2 : 1;
    txt = bars === 4 ? 'Shard in range' : bars === 3 ? 'Medium signal' : 'Weak signal';
    if (M.linear && dist === Infinity){ bars = 4; txt = 'Finish ahead'; gold = true; }
  }
  const key = bars + txt + gold;
  if (key !== last.sig){
    last.sig = key;
    ui.sig.textContent = txt;
    ui.bars.classList.toggle('gold', gold);
    [...ui.bars.children].forEach((b, i) => b.classList.toggle('on', i < bars));
  }
}

// Radar (heading up, world drawn to scale)
const rc = $('radar'), rx = rc.getContext('2d');
function drawRadar(){
  const S = rc.width, R = S / 2, range = M.radar, kk = R / range;
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const toScreen = (wx, wz) => {
    const dx = wx - car.x, dz = wz - car.z;
    return [R + (dx * -fz + dz * fx) * kk, R - (dx * fx + dz * fz) * kk, Math.hypot(dx, dz)];
  };
  rx.setTransform(1, 0, 0, 1, 0, 0);
  rx.clearRect(0, 0, S, S);
  rx.save();
  rx.beginPath(); rx.arc(R, R, R - 1, 0, Math.PI * 2); rx.clip();
  rx.fillStyle = 'rgba(14,16,34,0.72)'; rx.fillRect(0, 0, S, S);
  const a = -kk * fz, b = -kk * fx, c = kk * fx, d = -kk * fz;
  rx.setTransform(a, b, c, d, R - (a * car.x + c * car.z), R - (b * car.x + d * car.z));
  const reach = range * 1.5;
  for (const r of W.radar){
    if (r.x1 < car.x - reach || r.x0 > car.x + reach || r.z1 < car.z - reach || r.z0 > car.z + reach) continue;
    rx.fillStyle = r.c; rx.fillRect(r.x0, r.z0, r.x1 - r.x0, r.z1 - r.z0);
  }
  if (mode === 'country'){
    const P = ROAD.pts, ri = roadPos.ri || 0, i0 = Math.max(0, ri - 130), i1 = Math.min(P.length - 1, ri + 130);
    rx.strokeStyle = 'rgba(255,255,255,.22)'; rx.lineWidth = 8.2; rx.lineJoin = 'round'; rx.lineCap = 'round';
    rx.beginPath(); rx.moveTo(P[i0].x, P[i0].z);
    for (let i = i0 + 2; i <= i1; i += 2) rx.lineTo(P[i].x, P[i].z);
    rx.stroke();
    rx.fillStyle = 'rgba(255,255,255,.7)';
    for (const t of ctraffic){ if (t.on && Math.abs(t.x - car.x) < reach && Math.abs(t.z - car.z) < reach){ rx.beginPath(); rx.arc(t.x, t.z, 1.8, 0, Math.PI * 2); rx.fill(); } }
  } else if (mode === 'highway'){
    for (const t of traffic){
      if (!t.on || Math.abs(t.z - car.z) > reach) continue;
      rx.fillStyle = t.dir > 0 ? 'rgba(255,255,255,.7)' : 'rgba(255,170,120,.55)';
      rx.fillRect(t.x - t.hw, t.z - t.len / 2, t.hw * 2, t.len);
    }
  } else {
    rx.fillStyle = 'rgba(255,255,255,.6)';
    for (const n of npcs){ if (n.on && Math.abs(n.x - car.x) < reach && Math.abs(n.z - car.z) < reach){ rx.beginPath(); rx.arc(n.x, n.z, 1.6, 0, Math.PI * 2); rx.fill(); } }
    rx.strokeStyle = 'rgba(255,93,108,0.6)'; rx.lineWidth = 2 / kk; rx.setLineDash([6 / kk, 6 / kk]);
    rx.strokeRect(-LIMIT, -LIMIT, LIMIT * 2, LIMIT * 2); rx.setLineDash([]);
  }
  rx.setTransform(1, 0, 0, 1, 0, 0);
  if (!REDUCED){
    const sw = (clock * 1.8) % (Math.PI * 2);
    rx.fillStyle = 'rgba(85,236,255,0.08)';
    rx.beginPath(); rx.moveTo(R, R); rx.arc(R, R, R, sw - 0.6, sw); rx.closePath(); rx.fill();
  }
  const pulse = 0.5 + 0.5 * Math.sin(clock * 5);
  for (const kt of kits){
    if (kt.taken) continue;
    const [sx, sy, dist] = toScreen(kt.x, kt.z);
    if (dist > range) continue;
    rx.fillStyle = '#4ef0a0';
    rx.fillRect(sx - 7, sy - 2.5, 14, 5); rx.fillRect(sx - 2.5, sy - 7, 5, 14);
  }
  for (const it of items){
    if (it.taken) continue;
    const [sx, sy, dist] = toScreen(it.x, it.z);
    if (dist > range) continue;
    rx.fillStyle = `rgba(85,236,255,${0.18 + pulse * 0.2})`;
    rx.beginPath(); rx.arc(sx, sy, 13 + pulse * 5, 0, Math.PI * 2); rx.fill();
    rx.fillStyle = '#55ecff';
    rx.beginPath(); rx.moveTo(sx, sy - 9); rx.lineTo(sx + 7, sy); rx.lineTo(sx, sy + 9); rx.lineTo(sx - 7, sy); rx.closePath(); rx.fill();
  }
  if (gate && gate.active){
    const [sx, sy, dist] = toScreen(gate.x, gate.z);
    if (dist > range * 0.92){
      const ang = Math.atan2(sy - R, sx - R), rr = R - 18;
      rx.save(); rx.translate(R + Math.cos(ang) * rr, R + Math.sin(ang) * rr); rx.rotate(ang);
      rx.fillStyle = '#ffc857';
      rx.beginPath(); rx.moveTo(12, 0); rx.lineTo(-8, -10); rx.lineTo(-3, 0); rx.lineTo(-8, 10); rx.closePath(); rx.fill();
      rx.restore();
    } else {
      rx.strokeStyle = '#ffc857'; rx.lineWidth = 4;
      rx.beginPath(); rx.arc(sx, sy, 10 + pulse * 4, 0, Math.PI * 2); rx.stroke();
    }
  }
  const flash = Math.floor(clock * 6) % 2 === 0;
  for (const p of police){
    if (!p.active) continue;
    let [sx, sy, dist] = toScreen(p.x, p.z);
    if (dist > range * 0.92){ const ang = Math.atan2(sy - R, sx - R); sx = R + Math.cos(ang) * (R - 10); sy = R + Math.sin(ang) * (R - 10); }
    rx.fillStyle = flash ? '#ff3344' : '#2f6bff';
    rx.beginPath(); rx.arc(sx, sy, 7, 0, Math.PI * 2); rx.fill();
    rx.strokeStyle = 'rgba(255,255,255,.85)'; rx.lineWidth = 2; rx.stroke();
  }
  if (heli.on){
    let [sx, sy, dist] = toScreen(heli.sx, heli.sz);
    if (dist > range * 0.92){ const ang = Math.atan2(sy - R, sx - R); sx = R + Math.cos(ang) * (R - 10); sy = R + Math.sin(ang) * (R - 10); }
    rx.strokeStyle = heli.spotted ? '#ffd9a0' : 'rgba(255,255,255,.75)'; rx.lineWidth = 3;
    rx.beginPath(); rx.arc(sx, sy, 12, 0, Math.PI * 2); rx.stroke();
  }
  drawStoryRadar(toScreen, R, range, pulse);
  rx.fillStyle = '#ff7a3d'; rx.strokeStyle = 'rgba(255,255,255,.9)'; rx.lineWidth = 2;
  rx.beginPath(); rx.moveTo(R, R - 13); rx.lineTo(R + 9, R + 10); rx.lineTo(R, R + 5); rx.lineTo(R - 9, R + 10); rx.closePath(); rx.fill(); rx.stroke();
  rx.restore();
  rx.strokeStyle = 'rgba(255,255,255,0.22)'; rx.lineWidth = 2;
  rx.beginPath(); rx.arc(R, R, R - 1, 0, Math.PI * 2); rx.stroke();
}

// ---------- Game state ----------
// ### The state machine: menu -> play -> pause / done / over. startRun resets everything for the chosen map and vehicle,
// ### collect/repair/crash/finish/gameOver handle the events and show the result cards. The menu is a showroom: the camera
// ### orbits the selected vehicle and the stat bars are computed from the real VEH values (vehStats, zeroTo80).
let state = 'menu', collected = 0, timeLeft = M.time, damage = 0, clock = 0, orbitAngle = 0;
let edgeHint = false, warnedDamage = false;
const best = {};
for (const k of Object.keys(MODES)){ const b = Core.parseBest(readStore(MODES[k].store)); if (b) best[k] = b; }

function setMode(m){
  mode = m; M = MODES[m];
  if (m === 'highway' && !HWY.built) buildHighway();
  if (m === 'country' && !CTRY.built) buildCountry();
  W = m === 'city' ? CITY : m === 'highway' ? HWY : CTRY;
  CITY.group.visible = m === 'city';
  CTRY.group.visible = m === 'country';
  HWY.group.visible = m === 'highway';
  ui.eye.textContent = M.eyebrow;
  ui.mission.textContent = M.mission;
  ui.prog.hidden = !M.linear;
  last.km = ''; last.street = '';
  initGauge();
  buildBoundary();
}

function resetCar(){
  let x = mode === 'city' ? -3.5 : HW.our[1], z = mode === 'city' ? -6 : 5, heading = 0;
  if (mode === 'country'){ const pt = roadPoint(40, ROAD.lane); x = pt.x; z = pt.z; heading = pt.h; roadPos.ri = undefined; roadPos.s = 40; roadPos.lat = ROAD.lane; }
  Object.assign(car, { x, z, y: groundH(x, z), heading, speed: 0, steer: 0, pitch: 0, roll: 0, bodyPitch: 0, shake: 0, prevSpeed: 0, lean: 0 });
  eng.gear = 1; eng.rpm = ENGINES[V.key].idle; eng.shift = 0; eng.boost = 0; eng.miss = 0;
  camera.position.set(x - Math.sin(heading) * V.cam[0], car.y + V.cam[1], z - Math.cos(heading) * V.cam[0]);
  camera.lookAt(x + Math.sin(heading) * 4, car.y + 1.6, z + Math.cos(heading) * 4);
}

function startRun(m, v){
  initAudio();
  setVehicle(v || V.key);
  setMode(m || mode);
  placeRun();
  resetCar();
  if (mode === 'highway') resetTraffic(); else if (mode === 'country') resetCountryTraffic(); else resetNpcs();
  if (courier){ courier.on = false; courier.g.visible = false; }
  warmUp();
  resetPolice();
  collected = 0; timeLeft = M.time; damage = 0;
  edgeHint = false; warnedDamage = false;
  Object.values(MODELS).forEach(md => md.paint.color.copy(md.base));
  renderChips();
  hud.classList.remove('off');
  hideOverlay();
  state = 'play';
  if (mode === 'city') toast('Grab 8 star shards, then escape through the Arco da Rua Augusta. Every police car is looking for inmate 4471.', '', 4200);
  else if (mode === 'country') toast('Follow the country road to the village. Shards add +4 s. Watch the oncoming traffic.', '', 4500);
  else toast(`Reach the finish 4 km ahead. Shards add +${M.bonus} s. Police incoming.`, '', 4500);
}
function pause(){
  state = 'pause';
  Object.keys(keys).forEach(k => keys[k] = false);
  showCard(`
    <div class="eyebrow">${M.title} · ${V.name}</div>
    <h2>Paused</h2>
    <p>${collected} of ${items.length} shards, ${fmtTime(timeLeft)} left, damage at ${Math.round(damage)}%, bust meter at ${Math.round(bust * 100)}%.</p>
    <div class="actions">
      <button class="btn" data-action="resume">Resume</button>
      <button class="btn ghost" data-action="${story ? 'retry-act' : 'again'}">Restart</button>
      <button class="btn ghost" data-action="menu">Main menu</button>
    </div>`);
}
function resume(){ hideOverlay(); state = 'play'; initAudio(); }

function collect(it){
  it.taken = true; collected++;
  burst(it.x, it.group.position.y + 1.9, it.z, SPARK, 28);
  runGroup.remove(it.group);
  sfx.collect();
  renderChips();
  if (M.linear){ timeLeft += M.bonus; toast(`+${M.bonus} s · Shard ${collected} / ${items.length}`, 'gold', 1600); return; }
  if (collected >= items.length){
    gate.active = true; gate.group.visible = true; gate.grow = 0;
    sfx.gate();
    toast('All shards found! Escape through the Arco da Rua Augusta: follow the golden beam.', 'gold', 4500);
  } else if (collected % 3 === 0) toast(`Shard ${collected} / ${items.length}. More police are joining the chase!`, 'red', 2400);
  else toast(`Star shard ${collected} / ${items.length}`, '', 1800);
}
function repair(kt){
  kt.taken = true;
  burst(kt.x, 1.6, kt.z, GREEN, 18);
  runGroup.remove(kt.group);
  const before = damage;
  damage = Core.repairDamage(damage);
  if (damage < 35) warnedDamage = false;
  sfx.repair();
  toast(`Repair kit: damage ${Math.round(before)}% → ${Math.round(damage)}%`, 'green', 2400);
}

function crash(impact){
  const add = Core.crashDamage(impact, V);
  car.shake = Math.min(1, impact / 18);
  sfx.crash(impact);
  if (add <= 0 || state !== 'play') return;
  damage = Core.addDamage(damage, add);
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  burst(car.x + fx * 2, car.y + 0.8, car.z + fz * 2, SPARKS, Math.min(26, 6 + Math.round(impact)), 0.6);
  ui.dash.classList.remove('hit'); void ui.dash.offsetWidth; ui.dash.classList.add('hit');
  if (Core.isWrecked(damage)){ gameOver('wrecked'); return; }
  if (damage >= 50 && !warnedDamage){ warnedDamage = true; toast('Engine damaged: top speed reduced. Find a repair kit.', 'red', 3200); }
}

function finish(){
  if (story) return storyFinish();
  state = 'done';
  const used = Core.driveTime(mode, M, timeLeft, collected);
  const stars = Core.runStars(mode, M, timeLeft, used, damage);
  burst(gate.x, 6, gate.z, GOLD, 40);
  sfx.win();
  let isBest = false;
  if (Core.isNewBest(best[mode], used)){ best[mode] = used; isBest = true; writeStore(M.store, String(used)); }
  const city = mode === 'city';
  showCard(`
    <div class="eyebrow">${M.title} · ${V.name}</div>
    <h1>Clean <em>getaway</em></h1>
    <div class="stars">${[0, 1, 2].map(i => `<span class="${i < stars ? 'on' : ''}">${STAR}</span>`).join('')}</div>
    <div class="stats">
      <div class="stat"><span class="eyebrow">Drive time</span><b>${fmtTimeExact(used)}</b></div>
      <div class="stat"><span class="eyebrow">${city ? 'Time left' : 'Shards'}</span><b>${city ? fmtTime(timeLeft) : collected + '/' + items.length}</b></div>
      <div class="stat"><span class="eyebrow">Damage</span><b>${Math.round(damage)}%</b></div>
      <div class="stat"><span class="eyebrow">Cops wrecked</span><b>${copsWrecked}</b></div>
    </div>
    <p class="note">${isBest ? 'New best time!' : 'Best time: ' + fmtTimeExact(best[mode])}${damage > 50 ? ' · One star lost for heavy damage.' : ''}</p>
    <div class="actions">
      <button class="btn" data-action="again">Drive again <small class="desk-only">Enter</small></button>
      <button class="btn ghost" data-action="menu">Change vehicle</button>
    </div>`);
}

function gameOver(reason){
  if (story) return storyGameOver(reason);
  state = 'over';
  sfx.fail();
  if (reason === 'wrecked'){ const fx = Math.sin(car.heading), fz = Math.cos(car.heading); burst(car.x + fx, car.y + 1.2, car.z + fz, SPARKS, 36, 0.9); }
  const title = reason === 'busted' ? 'Busted!' : reason === 'wrecked' ? 'Vehicle wrecked' : "Time's up";
  const text = reason === 'busted'
    ? `The police boxed you in with ${collected} of ${items.length} shards. Keep moving: the bust meter only fills while you are slow and a cop is right next to you.`
    : reason === 'wrecked'
      ? `Damage hit 100% with ${collected} of ${items.length} shards collected. Grab the green repair kits and avoid head-on hits.`
      : `You found ${collected} of ${items.length} shards. ${mode === 'city' ? 'The signal bars under the radar tell you whether you are getting closer.' : (mode === 'country' ? 'Overtake on the straights and keep an eye on oncoming traffic.' : 'Stay in the fast left lane where you can.')}`;
  showCard(`
    <div class="eyebrow">${M.title} · ${V.name}</div>
    <h2>${title}</h2>
    <p>${text}</p>
    <div class="actions">
      <button class="btn" data-action="again">Try again <small class="desk-only">Enter</small></button>
      <button class="btn ghost" data-action="menu">Change vehicle</button>
    </div>`);
}

const ICONS = {
  car: '<svg viewBox="0 0 120 44" aria-hidden="true"><path d="M6 31h106c1.2 0 2-.8 2-2v-4.5c0-1.6-.8-2.6-2.4-3L96 18 75 9.6C72 8.5 68.5 8 64 8H53c-4.5 0-7.5.9-10.5 2.6L22 21 9.5 23.2C7.3 23.6 6 25 6 27z" fill="#56688f"/><path d="M51 11h13v8.5H34zM67 11.6c2.8.2 4.6.8 6.4 1.8l5.6 5.4-12 .9z" fill="#1c2533"/><path d="M84 15l9 1.5" stroke="#0c0d10" stroke-width="2"/><rect x="103" y="21.5" width="8" height="1.8" rx=".9" fill="#eef6ff"/><rect x="6" y="23" width="5" height="1.8" fill="#ff2a3a"/><circle cx="30" cy="31" r="8" fill="#111215"/><circle cx="90" cy="31" r="8" fill="#111215"/><circle cx="30" cy="31" r="5.2" fill="#2a2d33"/><circle cx="90" cy="31" r="5.2" fill="#2a2d33"/><circle cx="90" cy="31" r="2.6" fill="#d0202a"/><circle cx="30" cy="31" r="2.6" fill="#d0202a"/></svg>',
  bike: '<svg viewBox="0 0 120 44" aria-hidden="true"><circle cx="32" cy="32" r="10" fill="#111215"/><circle cx="90" cy="32" r="10" fill="#111215"/><circle cx="32" cy="32" r="6.6" fill="none" stroke="#c8202a" stroke-width="2.4"/><circle cx="90" cy="32" r="6.6" fill="none" stroke="#c8202a" stroke-width="2.4"/><path d="M90 32l-7-16" stroke="#c9a04a" stroke-width="3"/><path d="M32 32l20-8" stroke="#9aa0aa" stroke-width="3"/><path d="M99 22l-6-9-21-2-9 4-9 13 15 4 18-2z" fill="#2a2d33"/><path d="M80 15l-11 13h-5l11-13z" fill="#d4f21a"/><path d="M93 13l5-6 2 3-4 5z" fill="#3b4250"/><path d="M58 16l-24 2-9 6 10 1 12-4h12z" fill="#2a2d33"/><path d="M38 19.5l-10 3" stroke="#d4f21a" stroke-width="1.6"/><path d="M56 13l7-6 8 3-4 6z" fill="#1b1d22"/><circle cx="69" cy="6.5" r="4.6" fill="#1b1d22"/><rect x="96" y="20" width="4" height="1.6" fill="#eef6ff"/></svg>',
  truck: '<svg viewBox="0 0 120 44" aria-hidden="true"><rect x="10" y="27" width="96" height="4" fill="#15171d"/><rect x="24" y="23" width="26" height="3" fill="#2a2d33"/><path d="M58 3h31c4.5 0 6.5 2.4 7.5 5.5L101 27H58z" fill="#a8c6bc"/><path d="M92 9h4.5l3 13H94z" fill="#1c2533"/><rect x="65" y="11" width="15" height="10" rx="1.5" fill="#1c2533"/><path d="M90 6.5h9" stroke="#0c0d10" stroke-width="2"/><rect x="95" y="22" width="9" height="6" fill="#0c0d10"/><rect x="100" y="24" width="5" height="1.6" fill="#eef6ff"/><circle cx="30" cy="33" r="7" fill="#111215"/><circle cx="30" cy="33" r="4.2" fill="#d9dde3"/><circle cx="88" cy="33" r="7" fill="#111215"/><circle cx="88" cy="33" r="4.2" fill="#d9dde3"/></svg>'
};
const MAP_THUMB = {
  country: '<svg viewBox="0 0 52 38" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="tco" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#060a1c"/><stop offset="1" stop-color="#463352"/></linearGradient></defs><rect width="52" height="38" fill="url(#tco)"/><path d="M0 22c8-6 16-7 26-3s18 2 26-4v23H0z" fill="#2c4529"/><path d="M0 27c10-4 20-3 30 1s16 2 22-1v11H0z" fill="#5f7c3a"/><path d="M30 38c-2-6 4-9 0-13s-5-4-3-6" stroke="#2b2f3b" stroke-width="5" fill="none"/><path d="M30 38c-2-6 4-9 0-13s-5-4-3-6" stroke="#e6e8ee" stroke-width=".6" stroke-dasharray="1.5 1.5" fill="none"/><path d="M8 24l2-6 2 6z" fill="#1e3322"/><path d="M42 21l2-6 2 6z" fill="#1e3322"/></svg>',
  city: '<svg viewBox="0 0 52 38" aria-hidden="true"><defs><linearGradient id="tc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#060a1c"/><stop offset="1" stop-color="#463352"/></linearGradient></defs><rect width="52" height="38" fill="url(#tc)"/><path d="M0 24h13v14H0zM39 24h13v14H39z" fill="#e8bb45"/><path d="M13 38V11h26v27h-6V25a7 7 0 0 0-14 0v13z" fill="#d6ccb4"/><path d="M19 11V7h14v4zM24.6 7V2h2.8v5z" fill="#d6ccb4"/><circle cx="26" cy="15" r="2.2" fill="#fff4d8"/><path d="M0 24l13-4v4zM52 24l-13-4v4z" fill="#a45a3d"/></svg>',
  highway: '<svg viewBox="0 0 52 38" aria-hidden="true"><defs><linearGradient id="th" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#060a1c"/><stop offset="1" stop-color="#463352"/></linearGradient></defs><rect width="52" height="38" fill="url(#th)"/><path d="M0 18h52v20H0z" fill="#26332b"/><path d="M22 18h8l16 20H6z" fill="#2b2f3b"/><path d="M25.6 18h.8l1 20h-2.8z" fill="#b4b6c2"/><circle cx="19" cy="31" r="1.4" fill="#ff3344"/><circle cx="21.5" cy="31" r="1.4" fill="#ff3344"/><circle cx="33" cy="24" r="1.1" fill="#fff1cc"/><circle cx="34.6" cy="24" r="1.1" fill="#fff1cc"/></svg>'
};
const STAT_NAMES = ['Top speed', 'Acceleration', 'Handling', 'Durability', 'Ramming'];
const STAT_WORDS = ['', 'Low', 'Fair', 'Good', 'High', 'Max'];
const { vehStats, zeroTo80 } = Core;
function renderVehDetail(){
  const v = VEH[sel.veh], el = card.querySelector('#vehDetail');
  if (!el) return;
  const st = vehStats(v);
  const value = i => i === 0 ? Math.round(MODES[sel.mode].max * v.speed * 3.6) + ' km/h' : i === 1 ? '0–80 ' + zeroTo80(v, MODES[sel.mode]).toFixed(1) + ' s' : STAT_WORDS[st[i]];
  el.innerHTML = `<div class="vd-head"><b>${v.name}</b><span class="vd-cls">${v.cls}</span></div><p>${v.blurb}</p>
    <div class="vd-stats">${STAT_NAMES.map((n, i) => `<div class="vd-row"><span>${n}</span><span class="vd-bar">${[0, 1, 2, 3, 4].map(j => `<i class="${j < st[i] ? 'on' : ''}"></i>`).join('')}</span><b>${value(i)}</b></div>`).join('')}</div>`;
  $('showName').textContent = v.cls;
}
function showMenu(){
  state = 'menu';
  hud.classList.add('off');
  const bestNote = k => best[k] ? fmtTimeExact(best[k]) : 'no run yet';
  showCard(`
    <div class="m-top">
      <div class="m-brand"><span class="m-dot"></span>Escaped · Inmate 4471 · 02:30</div>
      <h1 class="m-logo">Shard<br><em>Heist</em></h1>
      <p class="m-lede">You are out of Cell Block D, and every police car in town knows it. Grab the star shards, ram the police, outrun them or lose them in traffic, then escape through the gate.</p>
    </div>
    <button class="story-card" data-action="story"><span class="sc-eyebrow">Story mode · after the tunnel · 3 acts · 3 endings</span><b>The Necklace Job</b><span>You escaped. Now prove who framed you: recover the Starfall necklace across the city, the highway and the countryside, with Officer Hale on the radio.</span><em>Play the story →</em></button>
    <section class="m-sec">
      <div class="m-label"><span>01</span>Free ride · Map</div>
      <div class="maps">
        <button class="map" data-pick="mode" data-val="city" aria-pressed="${sel.mode === 'city'}">${MAP_THUMB.city}<span><b>Lisbon · Baixa</b><small>8 shards · 3:00 · trams</small></span></button>
        <button class="map" data-pick="mode" data-val="highway" aria-pressed="${sel.mode === 'highway'}">${MAP_THUMB.highway}<span><b>Highway</b><small>4 km · traffic both ways</small></span></button>
        <button class="map" data-pick="mode" data-val="country" aria-pressed="${sel.mode === 'country'}">${MAP_THUMB.country}<span><b>Countryside</b><small>Hills · farms · village</small></span></button>
      </div>
    </section>
    <section class="m-sec">
      <div class="m-label"><span>02</span>Choose your getaway vehicle</div>
      <div class="vtabs">${['car', 'bike', 'truck'].map(k => `<button class="vtab" data-pick="veh" data-val="${k}" aria-pressed="${sel.veh === k}">${ICONS[k]}<span>${VEH[k].name}</span></button>`).join('')}</div>
      <div class="vdetail" id="vehDetail"></div>
    </section>
    <button class="btn m-start" data-action="go"><span>Start the getaway</span><kbd class="desk-only">Enter</kbd></button>
    <div class="m-foot">
      <span class="desk-only"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive · <kbd>Space</kbd> handbrake · <kbd>P</kbd> pause · <kbd>M</kbd> sound</span>
      <span class="touch-only">Steer on the left, brake and gas on the right.</span>
      <span>Best · Lisbon ${bestNote('city')} · Highway ${bestNote('highway')} · Country ${bestNote('country')}</span>
      <span class="gfx">Graphics <button data-gfx="ultra" aria-pressed="${gfx === 'ultra'}">Ultra</button><button data-gfx="balanced" aria-pressed="${gfx === 'balanced'}">Balanced</button></span>
    </div>`, 'menu');
  renderVehDetail();
}
// In the menu the camera frames the vehicle off-centre so it sits beside the panel
function menuFraming(on){
  if (on){
    const w = innerWidth, h = innerHeight;
    if (w > 820) camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
    else camera.setViewOffset(w, h, 0, h * 0.24, w, h);
  } else camera.clearViewOffset();
}

function showCard(html, kind){
  const isMenu = kind === 'menu';
  card.innerHTML = html;
  overlay.classList.toggle('menu', isMenu); card.classList.toggle('menu', isMenu);
  menuFraming(isMenu);
  overlay.hidden = false;
  const b = card.querySelector('.btn'); if (b && !COARSE) b.focus({ preventScroll: true });
}
function hideOverlay(){ overlay.hidden = true; menuFraming(false); }
function backToMenu(){
  setMode('city'); placeRun(); resetCar(); resetPolice(); damage = 0;
  Object.values(MODELS).forEach(md => md.paint.color.copy(md.base));
  setVehicle(sel.veh);
  showMenu();
}

card.addEventListener('click', e => {
  const gb = e.target.closest('[data-gfx]');
  if (gb){
    gfx = gb.dataset.gfx;
    card.querySelectorAll('[data-gfx]').forEach(b => b.setAttribute('aria-pressed', String(b === gb)));
    writeStore('shard-heist-gfx', gfx);
    applyGfx();
    return;
  }
  const pick = e.target.closest('[data-pick]');
  if (pick){
    if (!Core.applyPick(sel, pick.dataset.pick, pick.dataset.val)) return;
    card.querySelectorAll(`[data-pick="${pick.dataset.pick}"]`).forEach(b => b.setAttribute('aria-pressed', String(b === pick)));
    if (pick.dataset.pick === 'veh') setVehicle(sel.veh);
    renderVehDetail();
    writeStore('shard-heist-pick', JSON.stringify(sel));
    return;
  }
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const a = b.dataset.action;
  if (!Core.actionAllowed(a, { state, story })) return;
  initAudio();
  if (a === 'go'){ story = null; startRun(sel.mode, sel.veh); }
  else if (a === 'again') startRun(mode, V.key);
  else if (a === 'resume') resume();
  else if (a === 'menu'){ story = null; backToMenu(); }
  else if (a === 'story') showStoryIntro();
  else if (a === 'act') startStoryAct(story.act);
  else if (a === 'next-act') startStoryAct(story.act + 1);
  else if (a === 'retry-act') startStoryAct(Core.retryAct(story));
});
$('btnPause').addEventListener('click', e => { e.currentTarget.blur(); if (state === 'play') pause(); else if (state === 'pause') resume(); });
function toggleSound(){
  muted = !muted;
  $('soundWaves').style.display = muted ? 'none' : '';
  $('btnSound').setAttribute('aria-label', muted ? 'Turn sound on' : 'Mute sound');
  if (!muted) initAudio();
}
$('btnSound').addEventListener('click', e => { e.currentTarget.blur(); toggleSound(); });

// ---------- Physics ----------
// ### Arcade car physics: throttle, brake, coasting drag, speed-dependent steering and a top speed reduced by damage and
// ### off-road driving. Collisions test a few circles along the vehicle against boxes and circles and push the car out;
// ### the impact speed along the contact normal decides the damage. The chase camera follows smoothly and is kept out of
// ### buildings (camClip) and above hills.
const collidePoint = Core.collidePoint;
function updateCar(dt){
  if (mode === 'country') Object.assign(roadPos, roadQuery(car.x, car.z, roadPos));
  const offRoad = mode === 'country' && Math.abs(roadPos.lat) > 5.4;
  const maxNow = Core.topSpeed(M, V, damage, offRoad);
  if (offRoad && Math.abs(car.speed) > 8) car.shake = Math.max(car.shake, 0.06);
  car.speed = Core.stepSpeed(car.speed, keys, dt, maxNow, V);

  const steerIn = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
  car.steer += (steerIn - car.steer) * Math.min(1, 8 * dt);
  const sp = Math.abs(car.speed);
  const turn = car.steer * Math.min(1, sp / 6) * (2.5 * V.handling / (1 + sp * 0.035)) * (keys.brake ? 1.5 : 1);
  car.heading += turn * dt * (car.speed >= 0 ? 1 : -1);

  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  car.x += fx * car.speed * dt;
  car.z += fz * car.speed * dt;

  let worst = 0;
  const hitWith = (hit, vxOther, vzOther) => {
    const [nx, nz, pen] = hit;
    car.x += nx * pen; car.z += nz * pen;
    const impact = -((fx * car.speed - (vxOther || 0)) * nx + (fz * car.speed - (vzOther || 0)) * nz);
    return impact;
  };
  const nearC = collidersNear(car.x, car.z);
  for (const s of V.samples){
    for (const c of nearC){
      const hit = collidePoint(car.x + fx * s, car.z + fz * s, V.r, c);
      if (!hit) continue;
      const impact = hitWith(hit);
      if (impact > 2){ worst = Math.max(worst, impact); car.speed *= 0.3; } else car.speed *= 0.985;
    }
  }
  if (mode === 'highway'){
    for (const t of (courier && courier.on ? traffic.concat(courier) : traffic)){
      if (!t.on || Math.abs(t.z - car.z) > t.len / 2 + 6) continue;
      for (const s of V.samples){
        const hit = collidePoint(car.x + fx * s, car.z + fz * s, V.r, { x0: t.x - t.hw, x1: t.x + t.hw, z0: t.z - t.len / 2, z1: t.z + t.len / 2 });
        if (!hit) continue;
        const vtz = t.dir * t.speed, impact = hitWith(hit, 0, vtz);
        if (impact > 2){
          worst = Math.max(worst, impact);
          car.speed = vtz * fz * 0.85 + (V.key === 'truck' ? car.speed * 0.4 : 0);
          t.speed = Math.max(0, t.speed + (-hit[1] * t.dir) * impact * 0.3 * V.ram);
        }
        break;
      }
    }
  } else {
    for (const o of vehicleObstacles()){
      for (const s of V.samples){
        const hit = collidePoint(car.x + fx * s, car.z + fz * s, V.r, { t: 'c', x: o.x, z: o.z, r: o.r });
        if (!hit) continue;
        const impact = hitWith(hit, o.vx, o.vz);
        o.npc.stun = Math.max(o.npc.stun, 2.5);
        if (impact > 2){ worst = Math.max(worst, impact); car.speed *= V.key === 'truck' ? 0.7 : 0.4; }
        break;
      }
    }
  }
  if (worst > 0) crash(worst);
  if (state !== 'play') return;

  if (mode === 'city' && (Math.abs(car.x) > LIMIT || Math.abs(car.z) > LIMIT)){
    car.x = clamp(car.x, -LIMIT, LIMIT); car.z = clamp(car.z, -LIMIT, LIMIT); car.speed *= 0.9;
  }

  if (mode === 'country'){
    const mx = TERR.x0 + (TERR.nx - 1) * TERR.cell, mz = TERR.z0 + (TERR.nz - 1) * TERR.cell;
    car.x = clamp(car.x, TERR.x0 + 30, mx - 30); car.z = clamp(car.z, TERR.z0 + 30, mz - 30);
  }
  const rxv = -fz, rzv = fx, half = V.key === 'truck' ? 3 : 1.5;
  const hF = groundH(car.x + fx * half, car.z + fz * half), hB = groundH(car.x - fx * half, car.z - fz * half);
  const hR = groundH(car.x + rxv * 1.1, car.z + rzv * 1.1), hL = groundH(car.x - rxv * 1.1, car.z - rzv * 1.1);
  car.pitch += (Math.atan2(hF - hB, half * 2) - car.pitch) * Math.min(1, 10 * dt);
  car.roll += (Math.atan2(hL - hR, 2.2) - car.roll) * Math.min(1, 10 * dt);
  const ty = Math.max((hF + hB + hL + hR) / 4, groundH(car.x, car.z));
  car.y += (ty - car.y) * Math.min(1, 18 * dt);
  const accel = (car.speed - car.prevSpeed) / Math.max(dt, 1e-4);
  car.prevSpeed = car.speed;
  car.bodyPitch += (clamp(accel * 0.0025, -0.06, 0.05) - car.bodyPitch) * Math.min(1, 6 * dt);
  car.wheelRot += car.speed * dt;
}

function applyCarMesh(dt){
  carGroup.position.set(car.x, car.y, car.z);
  carGroup.rotation.y = car.heading;
  const sp = Math.abs(car.speed), md = MODELS[V.key];
  carTilt.rotation.x = -(car.pitch + car.bodyPitch);
  if (V.key === 'bike'){
    car.lean += (-car.steer * Math.min(1, sp / 18) * 0.5 - car.lean) * Math.min(1, 8 * dt);
    carTilt.rotation.z = car.lean;
  } else carTilt.rotation.z = car.roll + car.steer * Math.min(1, sp / 34) * (V.key === 'truck' ? 0.04 : 0.07);
  md.wheels.forEach(w => w.rotation.x = car.wheelRot / md.r);
  md.pivots.forEach(p => p.rotation.y = car.steer * 0.45);
  md.paint.color.copy(md.base).lerp(PAINT_DEAD, damage / 100 * 0.65);
}

// Keeps the chase camera out of buildings
function camClip(tx, tz){
  if (mode !== 'city') return 1;
  const ox = car.x, oz = car.z, dx = tx - ox, dz = tz - oz;
  let tmin = 1;
  for (const c of W.colliders){
    if (c.t !== 'b') continue;
    if (c.x1 < Math.min(ox, tx) - 1 || c.x0 > Math.max(ox, tx) + 1 || c.z1 < Math.min(oz, tz) - 1 || c.z0 > Math.max(oz, tz) + 1) continue;
    let t0 = 0, t1 = 1, ok = true;
    for (const [o, dd, lo, hi] of [[ox, dx, c.x0 - 0.6, c.x1 + 0.6], [oz, dz, c.z0 - 0.6, c.z1 + 0.6]]){
      if (Math.abs(dd) < 1e-6){ if (o < lo || o > hi){ ok = false; break; } continue; }
      let a = (lo - o) / dd, b = (hi - o) / dd;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1){ ok = false; break; }
    }
    if (ok && t0 < tmin) tmin = t0;
  }
  return Math.max(0.22, tmin - 0.03);
}

function chaseCam(dt){
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading), sp = Math.abs(car.speed);
  const dist = V.cam[0] + sp * 0.07;
  let tx = car.x - fx * dist, tz = car.z - fz * dist;
  const f = camClip(tx, tz);
  tx = car.x + (tx - car.x) * f; tz = car.z + (tz - car.z) * f;
  const h = V.cam[1] + sp * 0.025 + (1 - f) * 2.5;
  const k = 1 - Math.exp(-dt * 4.5);
  camera.position.x += (tx - camera.position.x) * k;
  camera.position.z += (tz - camera.position.z) * k;
  camera.position.y += (car.y + h - camera.position.y) * k;
  if (mode === 'country'){ const gh = groundH(camera.position.x, camera.position.z) + 1.5; if (camera.position.y < gh) camera.position.y = gh; }
  camera.lookAt(car.x + fx * 4, car.y + 1.6, car.z + fz * 4);
  if (car.shake > 0.01 && !REDUCED){
    camera.position.x += (Math.random() - 0.5) * car.shake * 0.6;
    camera.position.y += (Math.random() - 0.5) * car.shake * 0.6;
  }
  car.shake *= Math.exp(-dt * 6);
  const fov = 62 + sp / (M.max * V.speed) * 14;
  if (Math.abs(camera.fov - fov) > 0.05){ camera.fov = fov; camera.updateProjectionMatrix(); }
}
function orbitCam(dt){
  orbitAngle += dt * (REDUCED ? 0.03 : 0.12);
  const [r, h, look] = V.show;
  const tx = car.x + Math.sin(orbitAngle) * r, tz = car.z + Math.cos(orbitAngle) * r;
  const f = camClip(tx, tz);
  camera.position.set(car.x + (tx - car.x) * f, car.y + h, car.z + (tz - car.z) * f);
  camera.lookAt(car.x, car.y + look, car.z);
  if (camera.fov !== 42){ camera.fov = 42; camera.updateProjectionMatrix(); }
}

// Showroom lighting and turntable ring, only while the menu is open
const showKey = new THREE.SpotLight(0xe6eeff, 0, 40, 0.55, 0.6, 1.2);
const showRim = new THREE.PointLight(0x55ecff, 0, 16, 2);
const turntable = new THREE.Group();
(() => {
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.7, 2.82, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x55ecff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(2.7, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTexture, color: 0x2a3a7a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.position.y = 0.035; disc.position.y = 0.03;
  turntable.add(disc, ring);
  scene.add(showKey, showKey.target, showRim, turntable);
})();
function updateShowroom(){
  const on = state === 'menu';
  turntable.visible = on;
  showKey.intensity = on ? 3.2 : 0;
  showRim.intensity = on ? 2.4 : 0;
  if (!on) return;
  const s = V.key === 'truck' ? 1.65 : V.key === 'bike' ? 0.62 : 1;
  turntable.position.set(car.x, car.y, car.z); turntable.scale.setScalar(s);
  turntable.children[1].material.opacity = 0.5 + 0.25 * Math.sin(clock * 2);
  showKey.position.set(car.x + 4 * s, car.y + 9 * s, car.z + 5 * s); showKey.target.position.set(car.x, car.y, car.z);
  showRim.position.set(car.x - Math.sin(orbitAngle) * 4 * s, car.y + 2.2 * s, car.z - Math.cos(orbitAngle) * 4 * s);
}

function updatePickups(dt, live){
  for (const it of items){
    if (it.taken) continue;
    it.gem.rotation.y += dt * 1.6;
    const y = 1.9 + Math.sin(clock * 2.2 + it.phase) * 0.35;
    it.gem.position.y = y; it.glow.position.y = y;
    it.ring.material.opacity = 0.3 + 0.25 * Math.sin(clock * 3 + it.phase);
    if (live){ const dx = it.x - car.x, dz = it.z - car.z; if (dx * dx + dz * dz < 3.8 * 3.8) collect(it); }
  }
  for (const kt of kits){
    if (kt.taken) continue;
    kt.cross.rotation.y += dt * 1.2;
    kt.cross.position.y = 1.6 + Math.sin(clock * 2 + kt.phase) * 0.25;
    if (live && damage > 0){ const dx = kt.x - car.x, dz = kt.z - car.z; if (dx * dx + dz * dz < 3.6 * 3.6) repair(kt); }
  }
  if (gate && gate.active){
    gate.grow = Math.min(1, gate.grow + dt * 1.5);
    const s = Math.max(0.01, 1 - Math.pow(1 - gate.grow, 3));
    gate.ring.scale.setScalar(s); gate.disc.scale.setScalar(s);
    gate.ring.rotation.z += dt * 0.8;
    gate.disc.material.opacity = 0.22 + 0.15 * Math.sin(clock * 4);
    gate.beam.material.opacity = 0.18 + 0.08 * Math.sin(clock * 2.5);
    if (live && gate.grow > 0.6){
      if (mode === 'city' && Math.hypot(gate.x - car.x, gate.z - car.z) < 5.5) finish();
      else if (mode === 'highway' && car.z >= HW.LEN){ if (Core.finishOpen(story)) finish(); else if (!story.tollHint){ story.tollHint = true; toast('The toll will not let you through without the clasp. Find the courier lorry.', 'red', 3200); } }
      else if (mode === 'country' && roadPos.s >= ROAD.len - 60 && Math.abs(roadPos.lat) < 9) finish();
    }
  }
}

// ---------- Graphics quality & post-processing (bloom, multisampling) ----------
// ### Ultra renders through an EffectComposer: multisampled scene -> UnrealBloom (glow) -> gamma correction.
// ### Balanced renders directly at lower resolution with smaller shadows. The choice is stored in localStorage.
const GFX = { ultra: { ratio: 2, shadow: 4096, post: true }, balanced: { ratio: 1.25, shadow: 2048, post: false } };
let gfx = COARSE ? 'balanced' : 'ultra';
{ const g = readStore('shard-heist-gfx'); if (g && Object.hasOwn(GFX, g)) gfx = g; }
let composer = null, fxaaPass = null;
function buildComposer(){
  if (!THREE.EffectComposer || !THREE.RenderPass || !THREE.UnrealBloomPass || !THREE.ShaderPass || !THREE.GammaCorrectionShader) return null;
  try {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const half = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    const opts = { format: THREE.RGBAFormat, type: half ? THREE.HalfFloatType : THREE.UnsignedByteType };
    let rt;
    if (renderer.capabilities.isWebGL2 && THREE.WebGLMultisampleRenderTarget){ rt = new THREE.WebGLMultisampleRenderTarget(size.x, size.y, opts); rt.samples = 4; }
    else rt = new THREE.WebGLRenderTarget(size.x, size.y, opts);
    const c = new THREE.EffectComposer(renderer, rt);
    c.addPass(new THREE.RenderPass(scene, camera));
    c.addPass(new THREE.UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.7, 0.45, 0.82));
    c.addPass(new THREE.ShaderPass(THREE.GammaCorrectionShader));
    if (!renderer.capabilities.isWebGL2 && THREE.FXAAShader){ fxaaPass = new THREE.ShaderPass(THREE.FXAAShader); c.addPass(fxaaPass); }
    return c;
  } catch (e) { return null; }
}
function applyGfx(){
  const q = GFX[gfx];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.ratio));
  if (sun.shadow.mapSize.x !== q.shadow){
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    if (sun.shadow.map){ sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  if (q.post && !composer) composer = buildComposer();
  resize();
}

// ---------- Story mode: The Necklace Job ----------
// ### A three-act campaign that follows room 1 (the escape room). The detective, framed for stealing the Starfall
// ### necklace and jailed as inmate 4471, has escaped through the tunnel. Officer Hale, who opened the way, helps over
// ### the radio. The police hunt the escaped inmate across the city, the highway and the countryside. An optional sealed
// ### letter hidden in the Baixa (not shown on the radar) decides the ending: with it the truth comes out (Ending A),
// ### without it the detective goes back to cell 4471 (Ending B). Busted, wrecked or out of time is Ending C.
let story = null, courier = null;
const STORY = {
  acts: [
    { mode: 'city', title: 'The Scatter', goal: 'Recover the eight star shards hidden in Lisbon’s Baixa.' },
    { mode: 'highway', title: 'The Courier', goal: 'Catch the gold-marked courier lorry and take the clasp.' },
    { mode: 'country', title: 'Homecoming', goal: 'Drive back to the Ashford mansion.' }
  ],
  // [seconds into the act, text, tone]: Hale's lines are orange (tone 'hale'), police dispatch is red
  radio: [
    [[5, 'HALE: You made it out. Eight shards of the Starfall necklace are hidden in the Baixa. Find them before the police find you.', 'hale'],
     [9, 'DISPATCH: All units, inmate 4471 has escaped from Cell Block D. %V. Approach with caution.', 'red'],
     [32, 'HALE: Ashford’s people used the parks as dead drops. Look there. Not everything shows up on your radar.', 'hale'],
     [58, 'DISPATCH: Escaped inmate still in the Baixa. Roadblocks on the waterfront.', 'red'],
     [95, 'DISPATCH: Lady Ashford has been told about the escape. Bring 4471 in.', 'red']],
    [[5, 'HALE: The clasp is on a gold-marked courier lorry heading north. Catch it before the toll.', 'hale'],
     [12, 'DISPATCH: Inmate 4471 on the motorway, northbound. %V. All units intercept.', 'red'],
     [38, 'HALE: Pull up right behind the lorry to grab the clasp.', 'hale'],
     [70, 'DISPATCH: Toll station on alert. Do not let 4471 through.', 'red']],
    [[5, 'HALE: Drive to the Ashford mansion. I will be there. Bring everything you found.', 'hale'],
     [15, 'DISPATCH: 4471 on the country road to Ashford village. Units, block the lane.', 'red'],
     [45, 'HALE: The insurance claim was filed the morning after the theft, before anyone knew the necklace was gone.', 'hale'],
     [85, 'DISPATCH: Lady Ashford asks that the escaped inmate be brought to the mansion.', 'red']]
  ]
};
const VEH_DESC = { car: 'Steel-blue coupe', bike: 'Black superbike', truck: 'Green tractor unit' };

function showStoryIntro(){
  story = Core.newStory();
  showCard(`
    <div class="eyebrow">Story mode · After the tunnel · 02:30</div>
    <h1>The Necklace <em>Job</em></h1>
    <p>The tunnel under Cell Block D ends in a lock-up garage. Officer Hale’s note was true: a vehicle is waiting, the keys in the ignition, a radio on the seat.</p>
    <p>Three weeks ago you were framed for stealing the Starfall necklace. Tonight it has been broken into eight star shards and scattered across Lisbon’s Baixa. Hale believes you but cannot prove it. You can, if you recover the necklace before the police recover you.</p>
    <div class="acts">${STORY.acts.map((a, i) => `<div><span>Act ${i + 1}</span><b>${a.title}</b><small>${a.goal}</small></div>`).join('')}</div>
    <p class="note">Hale helps over the radio. Look carefully: not everything you need shows up on the radar.</p>
    <div class="actions">
      <button class="btn" data-action="act">Start Act 1 <small class="desk-only">Enter</small></button>
      <button class="btn ghost" data-action="menu">Back</button>
    </div>`);
}

function startStoryAct(i){
  if (!Core.beginAct(story, i)) return;
  story.env = null;
  const A = STORY.acts[i];
  startRun(A.mode, sel.veh);
  ui.eye.textContent = `Act ${i + 1} · ${A.title}`;
  if (i === 0 && !story.letter) placeEnvelope();
  if (i === 1) setupCourier();
  warmUp();
  toast(`Act ${i + 1} · ${A.title}: ${A.goal}`, 'gold', 4200);
}

// The optional sealed letter: hidden in a park, never drawn on the radar
function placeEnvelope(){
  const cands = shardSpots.filter(p => p.park && items.every(u => Math.hypot(u.x - p.x, u.z - p.z) > 15));
  const p = cands[Math.floor(Math.random() * cands.length)] || shardSpots[0];
  const g = new THREE.Group(); g.position.set(p.x, groundH(p.x, p.z) + 0.12, p.z);
  const env = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.62), new THREE.MeshStandardMaterial({ color: 0xf3e2b0, emissive: GOLD, emissiveIntensity: 0.5, roughness: 0.4 }));
  const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0x9c1f2a, roughness: 0.5 }));
  seal.position.y = 0.05; env.add(seal);
  env.position.y = 1.2; env.castShadow = true;
  const glow = glowSprite(GOLD, 2.6, 0.7); glow.position.y = 1.2;
  g.add(env, glow); runGroup.add(g);
  story.env = { x: p.x, z: p.z, g, env, glow, taken: false };
}

// The courier lorry carrying the clasp in act 2
function setupCourier(){
  if (!courier){
    const g = new THREE.Group(), P = PARTS.truck;
    const paint = new THREE.MeshPhysicalMaterial({ color: 0xd8a63a, roughness: 0.3, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.06 });
    paint.userData.env = 1.1;
    for (const [k, mat] of [['body', paint], ['glass', SHARED.glass], ['cargo', SHARED.cargo], ['trim', SHARED.trim], ['chrome', SHARED.chrome], ['tire', SHARED.tire], ['head', SHARED.head], ['tail', SHARED.tail], ['lens', SHARED.lens]]){
      if (!P[k]) continue;
      const m = new THREE.Mesh(P[k], mat); m.castShadow = true; g.add(m);
    }
    const mark = glowSprite(GOLD, 7); mark.position.y = 6.2; g.add(mark);
    HWY.group.add(g);
    tuneEnv(g);
    courier = { g, mark, type: 'truck', x: HW.our[2], z: 0, speed: 0, on: false, dir: 1, hw: 1.3, len: 9.7 };
  }
  Object.assign(courier, { x: HW.our[2], z: car.z + 600, speed: 26, on: true });
  courier.g.visible = true; courier.mark.visible = true;
  courier.g.position.set(courier.x, 0, courier.z);
}

function updateStory(dt){
  // Radio and narrator lines on a timeline
  story.clock += dt;
  const lines = STORY.radio[story.act];
  const radio = Core.dueRadio(lines, story.radioIdx, story.clock);
  story.radioIdx = radio.idx;
  for (const [, text, tone] of radio.due) toast(text.replace('%V', VEH_DESC[V.key]), tone, 4200);
  const env = story.env;
  if (env && !env.taken){
    env.env.rotation.y += dt * 1.4;
    env.env.position.y = env.glow.position.y = 1.2 + Math.sin(clock * 2.4) * 0.15;
    if (Math.hypot(env.x - car.x, env.z - car.z) < 3.4){
      env.taken = true; story.letter = true;
      runGroup.remove(env.g);
      burst(env.x, 1.4, env.z, GOLD, 20);
      sfx.collect();
      toast('You found a sealed letter from the mansion. It might prove who framed you.', 'gold', 4200);
    }
  }
  if (courier && courier.on){
    let gap = Infinity, aheadV = 0;
    for (const t of traffic){
      if (!t.on || t.dir < 0 || Math.abs(t.x - courier.x) > 1) continue;
      const d = t.z - courier.z - (t.len + courier.len) / 2;
      if (d > -courier.len && d < gap){ gap = Math.max(0, d); aheadV = t.speed; }
    }
    let desired = courier.z > HW.LEN - 70 ? 0 : 27;
    if (gap < 40) desired = Math.min(desired, aheadV + (gap - 8) * 0.5);
    courier.speed = Math.max(0, courier.speed + clamp((desired - courier.speed) * Math.min(1, dt * 3), -14 * dt, 3 * dt));
    courier.z += courier.speed * dt;
    courier.g.position.set(courier.x, 0, courier.z);
    if (!story.clasp && Math.hypot(car.x - courier.x, car.z - courier.z) < 9){
      story.clasp = true; courier.mark.visible = false;
      burst(courier.x, 3, courier.z, GOLD, 30);
      sfx.gate();
      toast('Clasp recovered! Now get through the toll at the finish.', 'gold', 3600);
    }
  }
}

function drawStoryRadar(toScreen, R, range, pulse){
  if (!story || !courier || !courier.on || story.clasp || mode !== 'highway') return;
  let [sx, sy, dist] = toScreen(courier.x, courier.z);
  if (dist > range * 0.92){ const ang = Math.atan2(sy - R, sx - R); sx = R + Math.cos(ang) * (R - 12); sy = R + Math.sin(ang) * (R - 12); }
  rx.fillStyle = '#ffc857';
  rx.fillRect(sx - 6 - pulse * 2, sy - 9 - pulse * 2, 12 + pulse * 4, 18 + pulse * 4);
  rx.strokeStyle = '#1b1406'; rx.lineWidth = 2; rx.strokeRect(sx - 6, sy - 9, 12, 18);
}

function storyFinish(){
  state = 'done';
  const used = Core.driveTime(mode, M, timeLeft, collected);
  story.times[story.act] = used; story.cops += copsWrecked;
  burst(gate.x, 6, gate.z, GOLD, 40);
  sfx.win();
  const stats = `<div class="stats">
      <div class="stat"><span class="eyebrow">Drive time</span><b>${fmtTimeExact(used)}</b></div>
      <div class="stat"><span class="eyebrow">Damage</span><b>${Math.round(damage)}%</b></div>
      <div class="stat"><span class="eyebrow">Cops wrecked</span><b>${copsWrecked}</b></div>
    </div>`;
  if (story.act === 0){
    showCard(`
      <div class="eyebrow">Act 1 complete · The Scatter</div>
      <h2>Eight shards, one necklace</h2>
      <p>The shards are safe in your glovebox, but the necklace is not complete. Hale on the radio: the clasp is on a courier lorry heading out of the city to a fence.</p>
      ${story.letter ? '<p>The sealed letter lies on the passenger seat. Its wax seal bears the Ashford crest.</p>' : ''}
      ${stats}
      <div class="actions"><button class="btn" data-action="next-act">Start Act 2: The Courier <small class="desk-only">Enter</small></button><button class="btn ghost" data-action="menu">Main menu</button></div>`);
  } else if (story.act === 1){
    showCard(`
      <div class="eyebrow">Act 2 complete · The Courier</div>
      <h2>The clasp and a signature</h2>
      <p>Behind the lorry's seat you find an insurance claim for the Starfall necklace. It was filed the morning after the theft and signed by Lady Ashford, the owner of the necklace.</p>
      ${stats}
      <div class="actions"><button class="btn" data-action="next-act">Start Act 3: Homecoming <small class="desk-only">Enter</small></button><button class="btn ghost" data-action="menu">Main menu</button></div>`);
  } else showEnding();
}

function showEnding(){
  const total = story.times.reduce((a, b) => a + (b || 0), 0);
  const good = Core.storyEnding(story) === 'A';
  const stats = `<div class="stats">
      <div class="stat"><span class="eyebrow">Total time</span><b>${fmtTimeExact(total)}</b></div>
      <div class="stat"><span class="eyebrow">Cops wrecked</span><b>${story.cops}</b></div>
      <div class="stat"><span class="eyebrow">Letter</span><b>${good ? 'Found' : 'Missing'}</b></div>
    </div>`;
  showCard(good ? `
    <div class="eyebrow">Finale · Ending A of 3 · The truth</div>
    <h1>Case <em>closed</em></h1>
    <p>The whole house is gathered in the hall, and Officer Hale stands at the door. You lay the shards and the clasp on the table, then unfold the letter. It is in Lady Ashford’s hand: <i>“Break it. Scatter it. Pin it on the detective.”</i></p>
    <p>Next to the insurance claim, it leaves no doubt. The butler confesses that he only followed orders. Lady Ashford is led out in handcuffs, and the Starfall necklace is whole again. Hale hands you back your badge: “Took you long enough.”</p>
    ${stats}
    <div class="actions"><button class="btn" data-action="story">Play the story again <small class="desk-only">Enter</small></button><button class="btn ghost" data-action="menu">Main menu</button></div>` : `
    <div class="eyebrow">Finale · Ending B of 3 · Framed</div>
    <h1>Back in <em>4471</em></h1>
    <p>You lay the shards and the clasp on the table. “Thank you, inmate 4471,” says Lady Ashford, and turns to the officers behind you. “There is your thief. Broke out of prison, too.”</p>
    <p>Without proof, the insurance claim is just paper. By morning you are back in cell 4471, and Hale cannot help you twice. Somewhere in the Baixa, a sealed letter is still waiting in a park.</p>
    ${stats}
    <div class="actions"><button class="btn" data-action="story">Try for the true ending <small class="desk-only">Enter</small></button><button class="btn ghost" data-action="menu">Main menu</button></div>`);
}

function storyGameOver(reason){
  state = 'over';
  sfx.fail();
  if (reason === 'wrecked'){ const fx = Math.sin(car.heading), fz = Math.cos(car.heading); burst(car.x + fx, car.y + 1.2, car.z + fz, SPARKS, 36, 0.9); }
  const A = STORY.acts[story.act];
  const text = reason === 'busted'
    ? 'The police box you in. From the back of the squad car you hear the radio: “Inmate 4471 in custody. Lady Ashford has been informed.” Next stop: Cell Block D.'
    : reason === 'wrecked'
      ? 'Your vehicle gives up. By the time the smoke clears, blue lights surround you. The shards go into an evidence bag, and you go back to cell 4471.'
      : 'You ran out of time. The fence has the necklace, and Cell Block D has its inmate back.';
  showCard(`
    <div class="eyebrow">Act ${story.act + 1} · ${A.title} · Ending C of 3</div>
    <h2>${reason === 'busted' ? 'Busted' : reason === 'wrecked' ? 'Wrecked' : 'Too late'}</h2>
    <p>${text}</p>
    <div class="actions"><button class="btn" data-action="retry-act">Retry Act ${story.act + 1} <small class="desk-only">Enter</small></button><button class="btn ghost" data-action="menu">Main menu</button></div>`);
}

// Compiles the shaders of everything in the scene, hidden objects included, before they are first seen
function warmUp(){
  const hidden = [];
  scene.traverse(o => { if (!o.visible && !o.isLight){ hidden.push(o); o.visible = true; } });
  try { renderer.compile(scene, camera); } catch (e) {}
  hidden.forEach(o => { o.visible = false; });
}

// ---------- Loop ----------
// ### frame() runs once per display refresh: update player, police, pickups, traffic and signals, then effects, camera,
// ### sound, HUD and radar, and finally render. dt is capped at 50 ms so a hiccup never teleports anything.
function resize(){
  renderer.setSize(innerWidth, innerHeight, false);
  if (composer){
    const pr = renderer.getPixelRatio();
    composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
    if (fxaaPass) fxaaPass.material.uniforms.resolution.value.set(1 / (innerWidth * pr), 1 / (innerHeight * pr));
  }
  camera.aspect = innerWidth / innerHeight;
  if (state === 'menu' && !overlay.hidden) menuFraming(true);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
applyGfx();

let lastT = performance.now();
function frame(now){
  requestAnimationFrame(frame);
  const dt = Core.frameDt(now - lastT);
  lastT = now;
  const paused = state === 'pause';
  frameNo++;
  if (!paused) clock += dt;

  if (state === 'play'){
    updateCar(dt);
    if (state === 'play') updatePolice(dt);
    if (state === 'play'){
      timeLeft -= dt;
      updatePickups(dt, true);
      if (story && state === 'play') updateStory(dt);
      if (state === 'play' && timeLeft <= 0){ timeLeft = 0; gameOver('time'); }
    }
    chaseCam(dt);
  } else if (!paused){
    car.speed *= Math.exp(-dt * 3);
    updatePickups(dt, false);
    if (state !== 'menu') updatePolice(dt);
    if (state === 'menu') orbitCam(dt); else chaseCam(dt);
  }
  if (!paused){
    if (mode === 'highway' && state !== 'menu') updateTraffic(dt);
    if (mode === 'country' && state !== 'menu') updateCountryTraffic(dt);
    if (mode === 'city'){ updateSignals(); updateNpcs(dt); }
    if (state !== 'menu') updateHeli(dt);
    updateParticles(dt); updateSmoke(dt);
  }
  updatePoliceVisuals();
  updateShowroom();
  updateBoundary(dt);
  applyCarMesh(dt);

  sky.position.copy(camera.position);
  sun.position.set(car.x + SUN_OFF[0], SUN_OFF[1], car.z + SUN_OFF[2]);
  sun.target.position.set(car.x, 0, car.z);

  updateEngine(dt);
  updateHud(dt);
  if (state !== 'menu') drawRadar();
  if (composer && GFX[gfx].post) composer.render(); else renderer.render(scene, camera);
}

buildCity();
tuneEnv(scene);
setVehicle(sel.veh);
setMode('city');
placeRun();
resetCar();
resetNpcs();
renderChips();
showMenu();
warmUp();
requestAnimationFrame(frame);
})();
