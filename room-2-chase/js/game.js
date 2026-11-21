// Framed: One Night in Lisbon, room 2 (the chase; its working title was Shard Heist): the game (rendering, the city, AI, sound, HUD, story mode). The rules it plays by live in room-2-chase/js/core.js.
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
// ### The tuning tables (MODES for the maps, VEH for the vehicles) and every game rule live in room-2-chase/js/core.js, where the
// ### tests can reach them. Change a number there and the whole game, including the stat bars in the menu, follows it.
const { MODES, VEH, REV_SPEED, REPAIR_AMOUNT } = Core;
let mode = 'city', M = MODES.city, V = VEH.car;
// ### Reads a saved value; returns null when the browser blocks storage, so private windows still work.
const readStore = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
// ### Saves a value and ignores a blocked or full storage: losing a setting must never stop the game.
const writeStore = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const sel = Core.parsePick(readStore('shard-heist-pick'));

const PITCH = 48, HALF_BLOCK = 17, LIMIT = 150;
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

// ### The night sky: a gradient from the haze at the horizon to near black overhead. dawn (0 at night) adds the first light of
// ### the morning for the finale: a warm glow low in the east-south-east that fades upwards.
const skyMat = new THREE.ShaderMaterial({
  uniforms: { top: { value: C(0x03050f) }, mid: { value: C(0x111735) }, horizon: { value: C(0x463352) }, fogc: { value: C(FOG) },
    dawn: { value: 0 }, dawnCol: { value: C(0xff9a5a) }, dawnDir: { value: new THREE.Vector3(0.75, 0.04, 0.66).normalize() } },
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 fogc; uniform float dawn; uniform vec3 dawnCol; uniform vec3 dawnDir; varying vec3 vP; void main(){ float t = vP.y; vec3 c = mix(horizon, mid, smoothstep(0.02, 0.22, t)); c = mix(c, top, smoothstep(0.22, 0.75, t)); float g = pow(max(dot(normalize(vP), dawnDir), 0.0), 4.0); c += dawn * dawnCol * (0.15 + 0.85 * g) * (1.0 - smoothstep(-0.02, 0.45, t)); c = mix(fogc, c, smoothstep(-0.03, 0.06, t)); gl_FragColor = linearToOutputTexel(vec4(c, 1.0)); }',
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
// ### Sets how strongly each material reflects the sky, using the strength stored on that material.
function tuneEnv(root){
  root.traverse(o => {
    if (!o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if (m.isMeshStandardMaterial) m.envMapIntensity = m.userData.env !== undefined ? m.userData.env : 0.4;
    });
  });
}

const hemi = new THREE.HemisphereLight(0x6f7cc8, 0x1b1b28, 0.52);
scene.add(hemi);
// the "sun" is the moon: cold, weak, high; street lamps, windows and headlights do the rest
const sun = new THREE.DirectionalLight(0xaabfff, 0.42);
sun.castShadow = true;
sun.shadow.mapSize.set(COARSE ? 1024 : 2048, COARSE ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 320 });
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);
// ### The first light of the morning, only for the finale over the bridge. 0 is the night of the game, 1 the moment before the sun
// ### comes up: the sky turns a deep blue with a warm glow in the east, the haze lifts and warms, and the light grows softly.
// ### Kept faint on purpose: it is the very beginning of the sunrise, not the day.
const NIGHT = { top: C(0x03050f), mid: C(0x111735), horizon: C(0x463352), fog: C(FOG), hemiSky: C(0x6f7cc8), hemiGround: C(0x1b1b28), hemiI: 0.52, sunC: C(0xaabfff), sunI: 0.42 };
const DAWN = { top: C(0x0d1838), mid: C(0x34477e), horizon: C(0xc98a7a), fog: C(0x6c6280), hemiSky: C(0xa7b4e6), hemiGround: C(0x3a3036), hemiI: 0.85, sunC: C(0xffc49a), sunI: 0.8 };
let dawn = 0;
function setDawn(a){
  dawn = a;
  const U = skyMat.uniforms, mix = (k, out) => out.copy(NIGHT[k]).lerp(DAWN[k], a);
  mix('top', U.top.value); mix('mid', U.mid.value); mix('horizon', U.horizon.value); mix('fog', U.fogc.value); U.dawn.value = a * 0.55;
  mix('fog', scene.fog.color); renderer.setClearColor(scene.fog.color);
  mix('hemiSky', hemi.color); mix('hemiGround', hemi.groundColor); hemi.intensity = NIGHT.hemiI + (DAWN.hemiI - NIGHT.hemiI) * a;
  mix('sunC', sun.color); sun.intensity = NIGHT.sunI + (DAWN.sunI - NIGHT.sunI) * a;
}
const SUN_NIGHT = Object.freeze([-90, 60, -40]), SUN_OFF = SUN_NIGHT.slice();
// ### Down in the garage the moon is replaced by the light of the strip lights: the same two lights (hemi and sun) turn white
// ### and even, and the sun comes from almost straight above, so it lights the floor and the vehicles cast their shadows under
// ### them, but it never falls across the walls in bright wedges. GARAGE_LIGHT.k is how far it has gone (1 in the garage); on
// ### the way out it fades back to the night as the roller door rolls up (garageLight).
const GARAGE_LIGHT = { hemiSky: C(0xdfe4ec), hemiGround: C(0x6a6c70), hemiI: 0.56, sunC: C(0xf2f5ff), sunI: 0.5, off: [-4, 60, -9], k: 0 };

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
// ---------- Tree shapes ----------
// ### Trees for all maps. A broadleaf crown is a cluster of lumps around a main one, each lump a sphere with a bumpy outline, so the
// ### outline is irregular like foliage. Normals point away from each lump's centre, which shades the crown softly instead of in facets.
// ### The colours of the vertices are an ambient shading: dark at the bottom and inside, light at the top. The instance colour of each
// ### tree multiplies them, so trees differ in hue. Pines are layers of drooping cones. The bark has a few branches into the crown.
// a repeatable pseudo-random number for a point, so lumps sharing a vertex move it the same way and stay closed
const hash3 = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };
function mergeColored(list){
  const pos = [], nor = [], col = [];
  for (const g0 of list){
    const g = g0.index ? g0.toNonIndexed() : g0, p = g.attributes.position.array, n = g.attributes.normal.array, c = g.attributes.color ? g.attributes.color.array : null;
    for (let i = 0; i < p.length; i++){ pos.push(p[i]); nor.push(n[i]); col.push(c ? c[i] : 1); }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
// ### A broadleaf crown: lumps around the centre (cx 0, y), r the size of the main lump, detail 0 or 1.
function treeCrown(lumps, detail, r, y, seed){
  const rnd = mulberry32(seed), parts = [], bottom = y - r * 1.05, span = r * 2.3;
  for (let k = 0; k < lumps; k++){
    const a = k * 2.399 + rnd(), d = k ? r * (0.55 + 0.35 * rnd()) : 0, lr = k ? r * (0.55 + 0.3 * rnd()) : r;
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d, cy = y + (k ? (rnd() - 0.4) * r * 0.9 : 0);
    const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, n = g.attributes.normal, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++){
      const nx = p.getX(i), ny = p.getY(i), nz = p.getZ(i), bump = 1 + 0.26 * (hash3(nx + k, ny, nz) - 0.5);
      const x = cx + nx * lr * bump, yy = cy + ny * lr * bump * 0.92, z = cz + nz * lr * bump;
      p.setXYZ(i, x, yy, z); n.setXYZ(i, nx, ny, nz);
      const up = clamp((yy - bottom) / span, 0, 1), out = Math.min(1, Math.hypot(x, z) / (r * 1.4));
      const c = (0.42 + 0.5 * up) * (0.8 + 0.2 * out) * (0.9 + 0.2 * hash3(x, yy, z));
      col[i * 3] = c; col[i * 3 + 1] = c; col[i * 3 + 2] = c;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    parts.push(g);
  }
  return mergeColored(parts);
}
// ### A pine: drooping, slightly ragged cone layers from the bottom (y0) to the top (y1), widest at the bottom.
function treePine(layers, r, y0, y1, seed){
  const parts = [], step = (y1 - y0) / (layers + 0.6);
  for (let k = 0; k < layers; k++){
    const lr = r * (1 - k / (layers + 0.4)), h = step * 1.9, base = y0 + k * step;
    const g = new THREE.ConeGeometry(lr, h, 9, 1).toNonIndexed(), p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++){
      const x = p.getX(i), yv = p.getY(i), z = p.getZ(i), rim = yv < 0 ? 1 : 0, rag = 1 + 0.18 * (hash3(x + k, yv, z) - 0.5) * rim;
      p.setXYZ(i, x * rag, base + h / 2 + yv - rim * lr * 0.12 * (0.6 + 0.4 * hash3(x + seed, k, z)), z * rag);
      const c = rim ? 0.45 + 0.1 * hash3(x, k, z) : 0.95;
      col[i * 3] = c; col[i * 3 + 1] = c; col[i * 3 + 2] = c;
    }
    g.computeVertexNormals();
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    parts.push(g);
  }
  return mergeColored(parts);
}
// ### A tapered trunk of height h, with branches that reach up into the crown.
function treeTrunk(h, r0, branches, seed){
  const rnd = mulberry32(seed), parts = [];
  const t = new THREE.CylinderGeometry(r0 * 0.6, r0, h, 7); t.translate(0, h / 2, 0); parts.push(t);
  for (let k = 0; k < branches; k++){
    const len = h * (0.45 + 0.2 * rnd()), b = new THREE.CylinderGeometry(r0 * 0.22, r0 * 0.4, len, 5);
    b.translate(0, len / 2, 0); b.rotateZ(0.6 + rnd() * 0.35); b.rotateY(k * 2.1 + rnd()); b.translate(0, h * (0.62 + 0.12 * rnd()), 0);
    parts.push(b);
  }
  return mergeGeos(parts);
}
const leafMat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.92 });
const barkMat = () => new THREE.MeshStandardMaterial({ color: 0x4f3a2b, roughness: 0.95 });

// ### Merges many geometries into one, so a whole street can be drawn in a single draw call.
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
// ### Builds the simple tyres and rims that traffic and police cars share.
function wheelSet(positions, r, w){
  const tires = [], rims = [];
  positions.forEach(([x, z]) => {
    const t = new THREE.CylinderGeometry(r, r, w, 18); t.rotateZ(Math.PI / 2); t.translate(x, r, z); tires.push(t);
    const rim = new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 10); rim.rotateZ(Math.PI / 2); rim.translate(x, r, z); rims.push(rim);
  });
  return { tire: mergeGeos(tires), rim: mergeGeos(rims) };
}
// ### Builds the shared parts of a traffic car or SUV. Each part is drawn with instancing, so many cars stay cheap.
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
// ### Builds the shared parts of the traffic lorry.
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
// ### A railway wheel, turned on a lathe: a hub, a thin dished disc, the rim, a tread that narrows slightly outwards and the flange
// ### on the inner side that keeps the wheel on the rail. side +1 is a right-hand wheel (flange towards -x), -1 a left-hand one.
const RAIL_WHEEL_R = 0.33;
function railWheel(side, x, y, z){
  const P = [[0.001, -0.09], [0.08, -0.09], [0.08, -0.04], [0.25, -0.022], [0.27, -0.062], [0.352, -0.064], [0.362, -0.05], [0.354, -0.034], [0.333, -0.026],
    [0.33, 0.0], [0.322, 0.062], [0.31, 0.072], [0.27, 0.072], [0.248, 0.032], [0.09, 0.042], [0.09, 0.078], [0.001, 0.078]].map(([r, a]) => new THREE.Vector2(r, a));
  const g = new THREE.LatheGeometry(P, 22);
  g.rotateZ(side > 0 ? -Math.PI / 2 : Math.PI / 2); g.translate(x, y, z);
  return g;
}
// The yellow Lisbon tram: lit windows between white pillars, a yellow body and a trolley pole on the roof. It runs on one
// two-axle truck: four steel railway wheels on the rails (0.72 m either side of the middle), axles, side frames with axle boxes,
// coil springs under the body and a brake block on each wheel. Short aprons cover only the platforms at both ends.
function makeTramParts(){
  const pillars = [];
  for (let z = -3.6; z <= 3.61; z += 1.2) pillars.push(boxG(2.26, 1.2, 0.16, 0, 2.25, z));
  const G = Core.RAIL.half, R = RAIL_WHEEL_R, Y = R + 0.035, AX = [1.5, -1.5], steel = [], tread = [], truck = [];
  for (const z of AX){
    for (const sd of [-1, 1]){
      steel.push(railWheel(sd, sd * G, Y, z));
      // the polished running surface, where the wheel touches the rail
      const t = new THREE.CylinderGeometry(R + 0.002, R - 0.006, 0.07, 22, 1, true); t.rotateZ(Math.PI / 2); t.translate(sd * (G + 0.018), Y, z); tread.push(t);
      // axle box with its cover, and the brake block against the inner side of the tread
      truck.push(boxG(0.13, 0.2, 0.24, sd * (G + 0.19), Y, z), boxG(0.03, 0.12, 0.14, sd * (G + 0.265), Y, z));
      truck.push(boxG(0.07, 0.2, 0.07, sd * (G + 0.02), Y + 0.04, z - Math.sign(z) * (R + 0.05)));
    }
    const axle = new THREE.CylinderGeometry(0.055, 0.055, 2 * G + 0.32, 10); axle.rotateZ(Math.PI / 2); axle.translate(0, Y, z); truck.push(axle);
  }
  for (const sd of [-1, 1]){
    const x = sd * (G + 0.19);
    // side frame over the axle boxes, the lower tie bar, the brake hanger rod, and two coil springs that carry the body
    truck.push(boxG(0.09, 0.13, 3.9, x, Y + 0.17, 0), boxG(0.06, 0.06, 3.5, x, Y - 0.16, 0), boxG(0.04, 0.04, 2.3, sd * (G + 0.02), Y + 0.13, 0));
    for (const z of [-0.55, 0.55]){
      const coil = new THREE.TorusGeometry(0.07, 0.016, 5, 10);
      for (let i = 0; i < 4; i++){ const c = coil.clone(); c.rotateX(Math.PI / 2); c.translate(x, Y + 0.25 + i * 0.035, z); truck.push(c); }
    }
  }
  // cross beams of the truck, and the lifeguard trays that hang low in front of each end
  truck.push(boxG(2 * G + 0.4, 0.08, 0.12, 0, Y + 0.17, 0.9), boxG(2 * G + 0.4, 0.08, 0.12, 0, Y + 0.17, -0.9));
  for (const e of [-1, 1]) truck.push(boxG(1.7, 0.04, 0.34, 0, 0.17, e * 4.42), boxG(1.7, 0.18, 0.04, 0, 0.27, e * 4.28));
  return {
    body: mergeGeos([boxG(2.2, 1.0, 8.4, 0, 1.15, 0), boxG(2.1, 0.16, 7.8, 0, 3.12, 0), boxG(2.24, 1.25, 0.12, 0, 2.25, 4.14), boxG(2.24, 1.25, 0.12, 0, 2.25, -4.14)]),
    cargo: mergeGeos([boxG(2.24, 0.14, 8.4, 0, 1.6, 0), boxG(2.24, 0.26, 8.2, 0, 2.92, 0), ...pillars]),
    lit: mergeGeos([boxG(2.16, 1.2, 8.1, 0, 2.25, 0), boxG(1.3, 0.72, 0.04, 0, 2.32, 4.21), boxG(1.3, 0.72, 0.04, 0, 2.32, -4.21)]),
    trim: mergeGeos([boxG(1.9, 0.3, 1.9, 0, 0.52, 3.25), boxG(1.9, 0.3, 1.9, 0, 0.52, -3.25), ...truck, boxG(2.0, 0.2, 0.2, 0, 0.75, 4.25), boxG(2.0, 0.2, 0.2, 0, 0.75, -4.25), boxG(0.06, 0.06, 3.2, 0, 3.9, -0.9, -0.5)]),
    chrome: mergeGeos(tread), steel: mergeGeos(steel),
    head: boxG(0.34, 0.34, 0.06, 0, 1.3, 4.23),
    tail: mergeGeos([boxG(0.3, 0.16, 0.06, 0.7, 1.3, -4.23), boxG(0.3, 0.16, 0.06, -0.7, 1.3, -4.23)])
  };
}
// ### A 12 m bus with a low floor: a long window band over a painted lower body, skirts between the wheel arches, a big
// ### windscreen, a lit destination sign and the air-conditioning box on the roof. coach: a taller touring coach.
function makeBusParts(coach){
  const top = coach ? 3.4 : 3.05, belt = coach ? 1.75 : 1.45, H = 5.95;
  const pillars = [];
  for (let z = -4.6; z <= 4.61; z += 1.84) pillars.push(boxG(2.52, top - 0.3 - belt, 0.14, 0, (belt + top - 0.3) / 2, z));
  const wheels = wheelSet(coach ? [[1.1, 3.9], [-1.1, 3.9], [1.1, -2.6], [-1.1, -2.6], [1.1, -3.85], [-1.1, -3.85]] : [[1.1, 3.6], [-1.1, 3.6], [1.1, -2.6], [-1.1, -2.6]], 0.5, 0.3);
  const skirtY = 0.68, skirt = (z0, z1) => boxG(2.5, 0.46, z1 - z0, 0, skirtY, (z0 + z1) / 2);
  const skirts = coach ? [skirt(4.55, H), skirt(-1.95, 3.25), skirt(-H, -4.5)] : [skirt(4.25, H), skirt(-1.95, 2.95), skirt(-H, -3.25)];
  return {
    body: mergeGeos([boxG(2.5, belt - 0.9, 2 * H, 0, (0.9 + belt) / 2, 0), ...skirts, boxG(2.5, 0.32, 2 * H - 0.1, 0, top - 0.14, 0), ...pillars,
      boxG(2.5, top - 0.3 - belt, 0.12, 0, (belt + top - 0.3) / 2, -H + 0.06)]),
    glass: mergeGeos([boxG(2.44, top - 0.3 - belt, 2 * H - 0.3, 0, (belt + top - 0.3) / 2, -0.05), boxG(2.3, top - 0.55 - 0.95 * (coach ? 1.2 : 1), 0.06, 0, (top - 0.3 + 0.95 * (coach ? 1.2 : 1)) / 2, H - 0.02)]),
    lit: boxG(1.7, 0.26, 0.04, 0, top - 0.3, H + 0.02),
    trim: mergeGeos([boxG(2.54, 0.34, 0.18, 0, 0.55, H), boxG(2.54, 0.34, 0.18, 0, 0.55, -H), boxG(2.52, 0.08, 2 * H, 0, belt + 0.02, 0)]),
    cargo: boxG(1.5, 0.3, coach ? 1.8 : 2.6, 0, top + 0.12, -1.2),
    chrome: wheels.rim, tire: wheels.tire,
    head: mergeGeos([boxG(0.42, 0.18, 0.05, 0.86, 0.85, H + 0.04), boxG(0.42, 0.18, 0.05, -0.86, 0.85, H + 0.04)]),
    tail: mergeGeos([boxG(0.22, 0.42, 0.05, 1.05, 1.1, -H - 0.04), boxG(0.22, 0.42, 0.05, -1.05, 1.1, -H - 0.04)]),
    reach: 4.5
  };
}
// ### A motorcycle with its rider tucked in: tank, fairing and tail in the paint colour (the helmet matches), engine, fork and
// ### rider in dark leathers. Upright: it does not tilt with the road across.
function makeMotoParts(){
  const cyl = (r0, r1, len, x, y, z, rx) => { const g = new THREE.CylinderGeometry(r1, r0, len, 10); if (rx) g.rotateX(rx); g.translate(x, y, z); return g; };
  const wheels = wheelSet([[0, 0.74], [0, -0.7]], 0.32, 0.15);
  const rider = [];
  for (const sd of [-1, 1]){
    rider.push(boxG(0.13, 0.13, 0.5, sd * 0.17, 1.0, 0.02, -0.15));   // thigh
    rider.push(boxG(0.11, 0.46, 0.11, sd * 0.21, 0.76, 0.2, 0.45));  // shin
    rider.push(boxG(0.09, 0.09, 0.55, sd * 0.24, 1.32, 0.24, -0.62)); // arm to the bar
  }
  rider.push(boxG(0.38, 0.6, 0.27, 0, 1.36, -0.14, 0.55));            // torso, leaning forward
  return {
    body: mergeGeos([boxG(0.34, 0.26, 0.55, 0, 0.98, 0.14), boxG(0.44, 0.42, 0.36, 0, 0.98, 0.6, -0.25), boxG(0.26, 0.18, 0.55, 0, 0.98, -0.46, -0.12),
      new THREE.SphereGeometry(0.15, 12, 9).scale(1, 1.05, 1.15).translate(0, 1.74, 0.08)]),
    trim: mergeGeos([boxG(0.36, 0.34, 0.46, 0, 0.56, 0.04), boxG(0.08, 0.86, 0.08, 0.1, 0.7, 0.62, -0.32), boxG(0.08, 0.86, 0.08, -0.1, 0.7, 0.62, -0.32),
      boxG(0.62, 0.05, 0.05, 0, 1.14, 0.46), boxG(0.06, 0.06, 0.8, 0.14, 0.62, -0.38, 0.22), boxG(0.06, 0.06, 0.8, -0.14, 0.62, -0.38, 0.22), ...rider]),
    glass: mergeGeos([boxG(0.3, 0.22, 0.03, 0, 1.24, 0.78, -0.65), boxG(0.2, 0.08, 0.03, 0, 1.75, 0.24)]),
    chrome: mergeGeos([wheels.rim, cyl(0.06, 0.05, 0.62, 0.2, 0.46, -0.52, Math.PI / 2 - 0.12)]),
    tire: wheels.tire,
    head: boxG(0.17, 0.1, 0.04, 0, 1.02, 0.8),
    tail: boxG(0.14, 0.06, 0.04, 0, 1.02, -0.75),
    upright: true, reach: 0.72
  };
}
const PARTS = { sedan: makeCarParts(false), suv: makeCarParts(true), truck: Object.assign(makeTruckParts(), { reach: 3.5 }), tram: makeTramParts(), bus: makeBusParts(false), coach: makeBusParts(true), moto: makeMotoParts() };
const BUS_COL = 0xeceee9, COACH_COL = 0xd8dee6;
const SHARED = {
  glass: (() => { const m = new THREE.MeshStandardMaterial({ color: 0x1c2533, roughness: 0.08, metalness: 0.85 }); m.userData.env = 1.3; return m; })(),
  trim: new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 0.75 }),
  chrome: (() => { const m = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.25, metalness: 0.9 }); m.userData.env = 1.1; return m; })(),
  tire: new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.92 }),
  // the tram's railway wheels: dark, oily steel
  steel: (() => { const m = new THREE.MeshStandardMaterial({ color: 0x6a6e76, roughness: 0.4, metalness: 0.7 }); m.userData.env = 1.2; return m; })(),
  head: new THREE.MeshBasicMaterial({ color: 0xfff4d6 }),
  tail: new THREE.MeshBasicMaterial({ color: 0xff2a3a }),
  cargo: new THREE.MeshStandardMaterial({ color: 0xe6e8ee, roughness: 0.55, metalness: 0.15 }),
  lit: new THREE.MeshBasicMaterial({ color: 0xe8bd78 }),
  lens: (() => { const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.28, clearcoat: 1, depthWrite: false }); m.userData.env = 1.4; return m; })(),
  // traffic paint reflects the sky a little more, so even a black car standing in the dark shows its outline
  paint: (() => { const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.07 }); m.userData.env = 1.6; return m; })()
};
// the two darkest paints are a shade lighter than true black, which disappears completely at night
const CAR_COLS = [0xe8e8ec, 0x363b48, 0x9c2d3a, 0x2f5d8c, 0xc9a24a, 0x5b6b5e, 0x7d8494, 0x2a2d36, 0xd06030, 0xb8c4cf, 0x6e2340, 0x2f6b6a];

// Instanced fleet of identical vehicles; each part one InstancedMesh
class Fleet {
  constructor(group, parts, n, rnd, color){
    this.meshes = []; this.reach = parts.reach || 2; this.upright = !!parts.upright;
    for (const k of ['body', 'glass', 'cargo', 'lit', 'trim', 'chrome', 'tire', 'steel', 'head', 'tail', 'lens']){
      if (!parts[k]) continue;
      const m = new THREE.InstancedMesh(parts[k], k === 'body' ? SHARED.paint : SHARED[k], n);
      m.frustumCulled = false; m.userData.dynamic = true;
      m.castShadow = k === 'body' || k === 'cargo' || k === 'glass';
      m.receiveShadow = k === 'body' || k === 'cargo';
      if (k === 'body') for (let i = 0; i < n; i++) m.setColorAt(i, tint.set(color || CAR_COLS[Math.floor((rnd ? rnd() : Math.random()) * CAR_COLS.length)]));
      group.add(m); this.meshes.push(m);
    }
  }
  // Places one vehicle on the hills: nose up or down with the slope under it, and tilted sideways when the road falls
  // across, so on a hillside street no wheel sinks into the road and none floats above it
  set(i, x, y, z, h, on){
    const fx = Math.sin(h), fz = Math.cos(h);
    let pitch = 0, roll = 0, ground = hill(x, z);
    if (on){
      // reach: from the middle to the axles, so a long bus or lorry follows the slope under its own wheels
      const r = this.reach, hF = hill(x + fx * r, z + fz * r), hB = hill(x - fx * r, z - fz * r);
      const hL = hill(x + fz * 0.9, z - fx * 0.9), hR = hill(x - fz * 0.9, z + fx * 0.9);
      pitch = -Math.atan2(hF - hB, 2 * r); roll = this.upright ? 0 : Math.atan2(hL - hR, 1.8);
      // the hill is made of flat triangles; where the car straddles a crease, it rests on the higher side
      ground = Math.max(ground, (hF + hB + hL + hR) / 4);
    }
    dummy.position.set(x, y + ground, z); dummy.rotation.set(pitch, h, roll, 'YXZ'); dummy.scale.setScalar(on ? 1 : 0.0001); dummy.updateMatrix();
    dummy.rotation.order = 'XYZ';
    for (const m of this.meshes) m.setMatrixAt(i, dummy.matrix);
  }
  commit(){ for (const m of this.meshes) m.instanceMatrix.needsUpdate = true; }
}
// ### A cloud of glowing points, used for the head and tail lights of traffic that is too far away to light the scene.
class GlowPts {
  constructor(group, n, color, size){
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(-999), 3));
    this.p = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTexture, color, size, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.p.frustumCulled = false; this.p.userData.dynamic = true; group.add(this.p); this.a = g.attributes.position;
  }
  set(i, x, y, z){ this.a.setXYZ(i, x, y, z); }
  commit(){ this.a.needsUpdate = true; }
}
// ### The light that traffic throws on the road: a soft, widening pool ahead of each vehicle. Without it a car waiting at a dark
// ### crossing is only two small dots; with it you see the car, and the road it lights, from far away. One instanced mesh per map.
const roadLightTex = (() => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  for (let y = 0; y < 128; y++){
    // the bottom row of the canvas lies at the vehicle, the top row at the far end
    const t = (127 - y) / 127, a = Math.min(1, t / 0.1) * Math.pow(1 - t, 1.6), w = 32 * (0.3 + 0.7 * Math.sqrt(t));
    const gr = g.createLinearGradient(32 - w, 0, 32 + w, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,' + a.toFixed(3) + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, y, 64, 1);
  }
  return new THREE.CanvasTexture(c);
})();
class RoadLights {
  constructor(group, n){
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).rotateY(Math.PI).translate(0, 0, 0.5);
    this.m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: roadLightTex, color: 0xfff0d8, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), n);
    this.m.frustumCulled = false; this.m.userData.dynamic = true; this.m.renderOrder = 1; group.add(this.m);
  }
  // starts at the front of the vehicle and reaches len metres down the road, wid wide at the far end, tipped with the slope
  set(i, x, z, h, front, len, wid, on){
    const fx = Math.sin(h), fz = Math.cos(h), x0 = x + fx * front, z0 = z + fz * front, y0 = hill(x0, z0), y1 = hill(x0 + fx * len, z0 + fz * len);
    dummy.position.set(x0, y0 + 0.035, z0); dummy.rotation.set(-Math.atan2(y1 - y0, len), h, 0, 'YXZ');
    dummy.scale.set(on ? wid : 0.0001, 1, on ? len : 0.0001); dummy.updateMatrix(); dummy.rotation.order = 'XYZ';
    this.m.setMatrixAt(i, dummy.matrix);
  }
  commit(){ this.m.instanceMatrix.needsUpdate = true; }
}
// the bright brake lights of a vehicle that slows down or waits, on top of its dim tail lights
function stopGlow(pts, i, x, z, h, back, y, off, on){
  const fx = Math.sin(h), fz = Math.cos(h), rx = -fz, rz = fx, Y = on ? y + hill(x, z) : -999;
  pts.set(i * 2, x - fx * back + rx * off, Y, z - fz * back + rz * off); pts.set(i * 2 + 1, x - fx * back - rx * off, Y, z - fz * back - rz * off);
}
// a vehicle brakes when it is slower than it wants to be and not speeding up; standing, it holds the brake
function braking(v, speed, cruise){ const b = speed < 0.5 || (speed < cruise * 0.8 && speed <= (v.prevSpeed === undefined ? speed : v.prevSpeed) + 0.002); v.prevSpeed = speed; return b; }
// head/tail glow for a vehicle at heading h
function vehicleGlow(head, tail, i, x, z, h, front, back, y, off, on){
  const fx = Math.sin(h), fz = Math.cos(h), rx = -fz, rz = fx, Y = on ? y + hill(x, z) : -999;
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
// ### Paints a modern facade texture on a canvas: windows, some lit, in a pattern set by the seed.
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
  (h, p) => { const wet = sstep(0.42, 0.28, p), k = 54 + h * 34 - wet * 7 + (h > 0.97 ? 40 : 0); return [k, k, k + 5]; },
  (h, p) => { const wet = sstep(0.42, 0.28, p); return 0.6 + h * 0.32 - wet * (0.32 + h * 0.2); }, 2.4);
// Calçada: the small limestone cobbles of Lisbon's pavements, and the black waves of the Rossio on top of them
function cobbleJoints(set){
  const c = set.map.image, g = c.getContext('2d'), r = mulberry32(5), n = 16, s = c.width / n;
  g.fillStyle = 'rgba(58,52,46,.6)';
  for (let j = 0; j < n; j++){
    g.fillRect(0, j * s, c.width, Math.max(1, s * 0.09));
    for (let i = 0; i < n; i++) g.fillRect((i + (j % 2) * 0.5 + (r() - 0.5) * 0.2) * s, j * s, Math.max(1, s * 0.09), s);
  }
}
// ### Gives the black and white waves of Portuguese pavement (calçada) their colour at a point.
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
// ### The river Tejo, the way real-time ocean shaders do it (three.js's ocean example, jbouny/ocean): long Gerstner swells move
// ### the surface itself; shorter waves and fine ripples only tip the normal, pixel by pixel. What you see is a Fresnel mix: looking
// ### down you see into the dark water, towards the horizon it turns into a mirror of the sky (the same colours as the sky dome, so
// ### the morning of the finale shows up in the river by itself). The lights of the far bank are reflected as the long, trembling
// ### streaks real night water makes, and the moon leaves a glitter path. The waves calm down towards the quay wall.
function riverMaterial(){
  const U = skyMat.uniforms;
  return new THREE.ShaderMaterial({
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      time: { value: 0 }, top: U.top, mid: U.mid, horizon: U.horizon, dawn: U.dawn, dawnCol: U.dawnCol, dawnDir: U.dawnDir,
      moonDir: { value: new THREE.Vector3(...SUN_OFF).normalize() }, deep: { value: C(0x020a12) }, lamp: { value: C(0xffb46a) }
    }),
    fog: true,
    vertexShader: `
      uniform float time;
      varying vec3 vW;
      #include <fog_pars_vertex>
      // one Gerstner wave: direction d, wavelength L, steepness s; moves the point and returns nothing
      void gerstner(inout vec3 p, vec3 w, vec2 d, float L, float s){
        float k = 6.2831853 / L, c = sqrt(9.8 / k), f = k * (dot(d, w.xz) - c * time), a = s / k;
        p.x += d.x * a * cos(f); p.z += d.y * a * cos(f); p.y += a * sin(f);
      }
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 w = wp.xyz, p = vec3(0.0);
        gerstner(p, w, normalize(vec2(-1.0, 0.3)), 28.0, 0.05);
        gerstner(p, w, normalize(vec2(-0.6, -0.8)), 19.0, 0.04);
        wp.xyz += p * smoothstep(157.0, 185.0, w.z);
        vW = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float time, dawn;
      uniform vec3 top, mid, horizon, dawnCol, dawnDir, moonDir, deep, lamp;
      varying vec3 vW;
      #include <fog_pars_fragment>
      float h1(float n){ return fract(sin(n * 91.345) * 43758.5453); }
      // the slope of one wave at w: d its direction, L its wavelength, s its steepness
      vec2 slope(vec2 w, vec2 d, float L, float s){ float k = 6.2831853 / L, c = sqrt(9.8 / k); return d * s * cos(k * (dot(d, w) - c * time)); }
      vec3 skyAt(vec3 r){
        float t = max(r.y, 0.0);
        vec3 c = mix(horizon, mid, smoothstep(0.02, 0.22, t)); c = mix(c, top, smoothstep(0.22, 0.75, t));
        float g = pow(max(dot(r, dawnDir), 0.0), 4.0);
        return c + dawn * dawnCol * (0.15 + 0.85 * g) * (1.0 - smoothstep(-0.02, 0.45, t));
      }
      void main(){
        vec2 w = vW.xz;
        float dist = length(cameraPosition - vW), calm = smoothstep(157.0, 175.0, vW.z), fine = calm / (1.0 + dist * 0.025);
        vec2 s = slope(w, normalize(vec2(-1.0, 0.3)), 28.0, 0.05) + slope(w, normalize(vec2(-0.6, -0.8)), 19.0, 0.04);
        s += (slope(w, normalize(vec2(-0.3, 1.0)), 7.3, 0.07) + slope(w, normalize(vec2(0.9, 0.45)), 4.1, 0.06) + slope(w, normalize(vec2(-0.95, -0.2)), 2.7, 0.05)) * (0.4 + 0.6 * fine);
        // fine ripples in many directions, fading with distance so far water stays a smooth mirror instead of flickering
        for (int i = 0; i < 6; i++){ float a = h1(float(i) + 1.0) * 6.2831853; s += slope(w, vec2(cos(a), sin(a)), 0.6 + h1(float(i) + 7.0) * 1.6, 0.11) * fine; }
        vec3 n = normalize(vec3(-s.x, 1.0, -s.y));
        vec3 v = normalize(cameraPosition - vW), r = reflect(-v, n);
        r.y = abs(r.y);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec3 col = mix(deep * (1.0 + dawn * 3.0), skyAt(r), fres);
        // the far bank's windows and street lamps, about 680 m out: where the reflected ray meets that wall, sparse warm lights
        if (r.z > 0.02){
          vec3 hit = vW + r * ((680.0 - vW.z) / r.z);
          // fewer, brighter lights than the windows themselves: the ripples stretch each one into its own trembling column
          float cell = floor(hit.x / 11.0), yc = 6.0 + 24.0 * h1(cell + 3.1), on = step(0.5, h1(cell)) * (0.6 + 0.8 * h1(cell + 9.7));
          float bump = (1.0 - smoothstep(0.6, 2.6, abs(fract(hit.x / 11.0) - 0.5) * 11.0)) * (1.0 - smoothstep(1.5, 6.0, abs(hit.y - yc)));
          col += lamp * on * bump * (0.3 + 0.7 * fres) * 2.2;
        }
        // the glitter path of the moon, and of the first sun in the finale
        col += vec3(0.75, 0.8, 1.0) * pow(max(dot(r, moonDir), 0.0), 420.0) * 3.0;
        col += dawnCol * dawn * pow(max(dot(r, dawnDir), 0.0), 160.0) * 4.0;
        gl_FragColor = linearToOutputTexel(vec4(col, 1.0));
        #include <fog_fragment>
      }`
  });
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
  return new THREE.Mesh(mergeGeos(list), new THREE.MeshBasicMaterial({ map: coneTex, color: 0xffd9a8, transparent: true, opacity: opacity || 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
}
// ### Street lamps: a soft halo around each lamp head and a faint pool on the road. They are kept dim on purpose: bright
// ### additive dots set off the bloom and dot the whole city like confetti, and a bright pool hides the road under it.
const LAMP_HALO = 0.5, LAMP_POOL = 0.28;
const lampHalo = (size, color) => new THREE.PointsMaterial({ map: glowTexture, color: color || 0xffd79a, size, sizeAttenuation: true, transparent: true, opacity: LAMP_HALO, depthWrite: false, blending: THREE.AdditiveBlending });
const lampPool = () => new THREE.MeshBasicMaterial({ map: glowTexture, vertexColors: true, transparent: true, opacity: LAMP_POOL, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
const BEAM_MAT = new THREE.MeshBasicMaterial({ map: coneTex, color: 0xe8f0ff, transparent: true, opacity: 0.055, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
// the player's headlight haze: short and narrow, so it never reaches the road and draws no hard edge on it
const HAZE_GEO = new THREE.ConeGeometry(0.7, 6, 20, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 3);
const HAZE_MAT = new THREE.MeshBasicMaterial({ map: coneTex, color: 0xfff4e4, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

// ---------- Worlds ----------
// ### Each map is a "world" object: a scene group, a list of colliders (boxes, circles, walls) and radar shapes.
// ### groundH returns the ground height at any point: the hills, and in the streets the kerbs.
// ### Traffic lights: every corner lamp post carries one signal head; two groups of intersections switch in turn.
// ### buildCity lays out Lisbon's Baixa as a 6x6 grid of closed blocks of Pombaline houses, plain and even in height, with
// ### arched ground floors and tile roofs with dormers; heights come from OpenStreetMap (most have 5 levels). In the north the
// ### Rossio with the National Theatre and the station, and the Praca da Figueira; in the south the yellow arcades and towers
// ### of the Praca do Comercio, the Arco da Rua Augusta and the river Tejo. Beyond them the Santa Justa lift, the cathedral,
// ### the castle on its hill, the 25 de Abril bridge and Cristo Rei.
// ### The grid is simplified: real blocks are longer than wide, here they are square. x grows east, z grows south.
const CITY = { group: new THREE.Group(), colliders: [], radar: [], built: false };
scene.add(CITY.group);
let W = CITY;
const shardSpots = [], roadSpots = [], intersections = [];

// ### The lock-up garage under Lisbon where a run begins (built and run further down, "The garage"). While it is on, the ground
// ### is the garage floor and its ramp. phase: 'pick' (on foot among the three vehicles), 'board' (walking to the door and
// ### getting in), 'drive' and 'exit' (over the top of the ramp the vehicle drives itself out through the roller door to the street). live: the player is at the wheel.
// ### shift is null down in the garage and, once the vehicle has been moved up into the city, the step it was moved by (see
// ### garageSwap); open is how far the roller door is rolled up; run is true while Shift is held.
const garage = { on: false, live: false, phase: '', t: 0, sit: -1, path: [], shift: null, open: 0, run: false, way: [], wi: 0, near: 1,
  from: new THREE.Vector3(), seat: new THREE.Vector3(), look: new THREE.Vector3(), turn: new THREE.Quaternion(), spin: new THREE.Quaternion(), mid: new THREE.Vector3(), ride: null };
const hill = (x, z) => Core.hillMesh(mode, x, z);
function groundH(x, z){
  if (garage.on) return garageGround(x, z);
  if (Math.abs(x) > 192 || Math.abs(z) > 192) return hill(x, z);
  const lx = x - Math.floor(x / PITCH) * PITCH - PITCH / 2, lz = z - Math.floor(z / PITCH) * PITCH - PITCH / 2;
  return hill(x, z) + ((Math.abs(lx) <= HALF_BLOCK && Math.abs(lz) <= HALF_BLOCK) ? 0.18 : 0);
}
// ### A street lamp's pool of light, laid on the ground as it really is: cut along the kerbs, the part on the pavement lies just
// ### above the pavement (18 cm up) and the part on the street just above the asphalt. One flat square at pavement height used
// ### to float 21 cm over the street and hid the wheels of the cars parked under the lamp, so they seemed sunk into the road.
// ### The texture runs across the whole square, so the cut pieces still make one round pool. (The hills come later, laySlopes.)
function groundPool(batch, x, z, r, col){
  const X0 = x - r, X1 = x + r, Z0 = z - r, Z1 = z + r, LIFT = 0.025;
  // the kerb lines that cross the square: each block edge, HALF_BLOCK either side of the block centres
  const kerbs = (a0, a1) => {
    const cuts = [a0];
    for (let k = Math.floor(a0 / PITCH) - 1; k <= Math.ceil(a1 / PITCH) + 1; k++){
      for (const e of [k * PITCH + PITCH / 2 - HALF_BLOCK, k * PITCH + PITCH / 2 + HALF_BLOCK]) if (e > a0 && e < a1) cuts.push(e);
    }
    cuts.push(a1); return cuts.sort((p, q) => p - q);
  };
  const xs = kerbs(X0, X1), zs = kerbs(Z0, Z1);
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++){
    const xa = xs[i], xb = xs[i + 1], za = zs[j], zb = zs[j + 1], mx = (xa + xb) / 2, mz = (za + zb) / 2;
    const lx = mx - Math.floor(mx / PITCH) * PITCH - PITCH / 2, lz = mz - Math.floor(mz / PITCH) * PITCH - PITCH / 2;
    const y = (Math.abs(lx) <= HALF_BLOCK && Math.abs(lz) <= HALF_BLOCK ? 0.18 : 0) + LIFT;
    batch.top(xa, xb, y, za, zb, col, [(xa - X0) / (2 * r), (Z1 - zb) / (2 * r), (xb - X0) / (2 * r), (Z1 - za) / (2 * r)]);
  }
}
// ### Bends a finished, flat world over the hills. Ground-level triangles are cut along the grid of Core.hillMesh, so road, kerb,
// ### markings and tracks stay exactly parallel, the same small distance apart as when they were flat. Taller walls only get extra
// ### vertices where they are long. Then each vertex moves up or down, and the road's normals tilt with the slope. Small objects and instances simply
// ### move as one, so lamps and trees stay upright. Vehicles are placed every frame on the hills, so they are left alone.
function laySlopes(group, key){
  const H = (x, z) => Core.hillMesh(key, x, z), [bx0, bx1, bz0, bz1] = Core.HILL_BOX[key];
  const fine = Core.HILL_GRID[key], coarse = 18;
  const tmp = new THREE.Vector3(), mat4 = new THREE.Matrix4();
  const shift = o => { o.getWorldPosition(tmp); o.position.y += H(tmp.x, tmp.z); };
  function tessellate(geo, mw){
    const src = geo.index ? geo.toNonIndexed() : geo, names = Object.keys(src.attributes), e = mw.elements;
    const attrs = names.map(n => src.attributes[n]), sizes = attrs.map(a => a.itemSize), count = src.attributes.position.count;
    const out = names.map(() => []), wx = (x, y, z) => e[0] * x + e[4] * y + e[8] * z + e[12], wz = (x, y, z) => e[2] * x + e[6] * y + e[10] * z + e[14];
    const emit = v => v.forEach((a, k) => { for (let i = 0; i < a.length; i++) out[k].push(a[i]); });
    const read = i => attrs.map((a, k) => { const r = []; for (let c = 0; c < sizes[k]; c++) r.push(a.array[i * sizes[k] + c]); return r; });
    const xz = v => { const p = v[names.indexOf('position')]; return [wx(p[0], p[1], p[2]), wz(p[0], p[1], p[2])]; };
    const mid = (a, b) => a.map((q, k) => q.map((c, i) => (c + b[k][i]) / 2));
    const split = (a, b, c, L, depth) => {
      const A = xz(a), B = xz(b), C = xz(c), ab = Math.hypot(A[0] - B[0], A[1] - B[1]), bc = Math.hypot(B[0] - C[0], B[1] - C[1]), ca = Math.hypot(C[0] - A[0], C[1] - A[1]), m = Math.max(ab, bc, ca);
      if (m <= L || depth > 10){ emit(a); emit(b); emit(c); return; }
      if (m === ab){ const d = mid(a, b); split(a, d, c, L, depth + 1); split(d, b, c, L, depth + 1); }
      else if (m === bc){ const d = mid(b, c); split(a, b, d, L, depth + 1); split(a, d, c, L, depth + 1); }
      else { const d = mid(c, a); split(a, b, d, L, depth + 1); split(d, b, c, L, depth + 1); }
    };
    // Cuts a convex polygon along coord(v) = value into the parts below and above
    const slice = (poly, coord, value) => {
      const lo = [], hi = [];
      poly.forEach((v, i) => {
        const w = poly[(i + 1) % poly.length], cv = coord(v), cw = coord(w);
        if (cv <= value) lo.push(v);
        if (cv >= value) hi.push(v);
        if ((cv < value && cw > value) || (cv > value && cw < value)){ const f = (value - cv) / (cw - cv), m = v.map((q, k) => q.map((c, n) => c + (w[k][n] - c) * f)); lo.push(m); hi.push(m); }
      });
      return [lo, hi];
    };
    const cut = (polys, coord, step) => {
      const out2 = [];
      for (let rest of polys){
        const cs = rest.map(coord), lo = Math.min(...cs), hi = Math.max(...cs);
        for (let k = Math.floor(lo / step) + 1; k * step < hi; k++){
          const parts = slice(rest, coord, k * step);
          if (parts[0].length >= 3) out2.push(parts[0]);
          rest = parts[1];
          if (rest.length < 3) break;
        }
        if (rest.length >= 3) out2.push(rest);
      }
      return out2;
    };
    const atX = v => { const p = v[posI]; return wx(p[0], p[1], p[2]); }, atZ = v => { const p = v[posI]; return wz(p[0], p[1], p[2]); };
    const fan = poly => { for (let i = 1; i + 1 < poly.length; i++){ emit(poly[0]); emit(poly[i]); emit(poly[i + 1]); } };
    // A ground-level triangle: the part outside the hills stays whole, the part inside is cut on the grid lines and their diagonals
    const onGrid = tri => {
      let inside = [tri];
      for (const [coord, v, keepHigh] of [[atX, bx0, true], [atX, bx1, false], [atZ, bz0, true], [atZ, bz1, false]]){
        if (!Number.isFinite(v)) continue;
        const next = [];
        for (const poly of inside){
          const parts = slice(poly, coord, v), keep = parts[keepHigh ? 1 : 0], away = parts[keepHigh ? 0 : 1];
          if (keep.length >= 3) next.push(keep);
          if (away.length >= 3) fan(away);
        }
        inside = next;
      }
      let cells = cut(inside, atZ, fine);
      cells = cut(cells, atX, fine); cells = cut(cells, v => atX(v) + atZ(v), fine);
      cells.forEach(fan);
    };
    const P = src.attributes.position.array, posI = names.indexOf('position');
    for (let t = 0; t < count; t += 3){
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = -Infinity;
      for (let i = t; i < t + 3; i++){
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], X = wx(x, y, z), Z = wz(x, y, z);
        x0 = Math.min(x0, X); x1 = Math.max(x1, X); z0 = Math.min(z0, Z); z1 = Math.max(z1, Z); y1 = Math.max(y1, y);
      }
      const inside = x1 >= bx0 && x0 <= bx1 && z1 >= bz0 && z0 <= bz1, a = read(t), b = read(t + 1), c = read(t + 2);
      if (inside && y1 < 1.2) onGrid([a, b, c]);
      else if (inside && Math.max(x1 - x0, z1 - z0) > coarse) split(a, b, c, coarse, 0);
      else { emit(a); emit(b); emit(c); }
    }
    const g = new THREE.BufferGeometry();
    names.forEach((n, k) => g.setAttribute(n, new THREE.Float32BufferAttribute(out[k], sizes[k])));
    return g;
  }
  function displace(g, mw){
    const p = g.attributes.position, N = g.attributes.normal, e = mw.elements;
    for (let i = 0; i < p.count; i++){
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const X = e[0] * x + e[4] * y + e[8] * z + e[12], Z = e[2] * x + e[6] * y + e[10] * z + e[14];
      p.setY(i, y + H(X, Z));
      if (N && y < 1.2 && N.getY(i) > 0.7){
        const gx = Core.gradeAt(key, X, Z, Math.PI / 2), gz = Core.gradeAt(key, X, Z, 0), ny = N.getY(i), nx = N.getX(i) - gx * ny, nz = N.getZ(i) - gz * ny, len = Math.hypot(nx, ny, nz);
        N.setXYZ(i, nx / len, ny / len, nz / len);
      }
    }
    p.needsUpdate = true; if (N) N.needsUpdate = true; g.computeBoundingSphere(); g.computeBoundingBox();
  }
  const hasInstances = o => { let f = false; o.traverse(c => { if (c.isInstancedMesh) f = true; }); return f; };
  const visit = o => {
    if (o.userData.dynamic) return;
    if (o.isInstancedMesh){
      for (let i = 0; i < o.count; i++){
        o.getMatrixAt(i, mat4); const m = mat4.elements;
        m[13] += H(m[12], m[14]); o.setMatrixAt(i, mat4);
      }
      o.instanceMatrix.needsUpdate = true;
    } else if (o.isPoints || o.isLine){
      const g = o.geometry.clone(); displace(g, o.matrixWorld); o.geometry = g;
    } else if (o.isMesh){
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox, big = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) > 24;
      // a small mesh moves by the height under its own vertices, which need not be where its origin is
      if (!big){ const c = b.getCenter(tmp).applyMatrix4(o.matrixWorld); o.position.y += H(c.x, c.z); }
      else {
        // bake the mesh's own turn and position into its vertices first: "up" must be world up. The big ground planes are built
        // lying on their side, and bending them along their own y axis would leave them flat while everything else follows the hills.
        const world = o.geometry.clone().applyMatrix4(o.matrixWorld), identity = new THREE.Matrix4();
        const g = tessellate(world, identity); displace(g, identity);
        if (o.parent) g.applyMatrix4(new THREE.Matrix4().copy(o.parent.matrixWorld).invert());
        o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.updateMatrixWorld(true);
        o.geometry = g;
      }
    } else if (o === group || o.children.length && (hasInstances(o) || new THREE.Box3().setFromObject(o).getSize(tmp).x > 40 || new THREE.Box3().setFromObject(o).getSize(tmp).z > 40)){
      o.children.slice().forEach(visit);
    } else shift(o);
  };
  group.updateMatrixWorld(true);
  visit(group);
}

const dummy = new THREE.Object3D(), tint = new THREE.Color();
// ### Draws many copies of one object in one draw call; place() positions each copy.
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
// ### Runs the traffic lights: north-south and east-west streets take turns, with a short all-red gap.
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

// ### Builds Lisbon's Baixa: the street grid, Pombaline blocks, landmarks, tram tracks and the river. Everything static is merged by material.
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
  const bronze = new THREE.MeshStandardMaterial({ color: 0x5c7a6c, roughness: 0.5, metalness: 0.45, emissive: 0x1c2a24 });
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
  // ### Dressed stone for the landmarks (the cathedral, the castle, the station): one picture of limestone ashlar, laid over
  // ### every face in the same bond, a material that glows a little so a floodlit wall shows its blocks at night, and the
  // ### round-arched openings and mouldings that all of them use.
  const sr = mulberry32(1147);
  // limestone ashlar: courses of blocks with staggered joints, each block a little different, darker with age near the joints
  const ashlarOf = (R, G, B) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const g = cv.getContext('2d'), rows = 8, rh = 512 / rows;
    g.fillStyle = `rgb(${Math.round(R * 0.93)},${Math.round(G * 0.93)},${Math.round(B * 0.93)})`; g.fillRect(0, 0, 512, 512);
    for (let r = 0; r < rows; r++){
      const n = 4, bw = 512 / n, off = (r % 2) * bw / 2;
      for (let k = -1; k <= n; k++){
        const v = 0.86 + sr() * 0.22, x0 = k * bw + off;
        g.fillStyle = `rgb(${Math.min(255, Math.round(R * v))},${Math.min(255, Math.round(G * v))},${Math.min(255, Math.round(B * v))})`;
        g.fillRect(x0 + 2, r * rh + 2, bw - 4, rh - 4);
        const sh = g.createLinearGradient(0, r * rh, 0, (r + 1) * rh); sh.addColorStop(0, 'rgba(255,255,255,.10)'); sh.addColorStop(1, 'rgba(0,0,0,.16)');
        g.fillStyle = sh; g.fillRect(x0 + 2, r * rh + 2, bw - 4, rh - 4);
      }
    }
    for (let i = 0; i < 5000; i++){ const d = sr() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${d},${d},${d},${(sr() * 0.07).toFixed(3)})`; g.fillRect(sr() * 512, sr() * 512, 1 + sr() * 3, 1 + sr() * 3); }
    for (let i = 0; i < 26; i++){ const sx = sr() * 512, sy = sr() * 512, len = 30 + sr() * 110; const st = g.createLinearGradient(0, sy, 0, sy + len); st.addColorStop(0, 'rgba(40,30,18,.22)'); st.addColorStop(1, 'rgba(40,30,18,0)'); g.fillStyle = st; g.fillRect(sx, sy, 3 + sr() * 9, len); }
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = ANISO; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  // warm limestone for the cathedral and the castle, and a pale one for the white fronts of the theatre and the station
  const ashlar = ashlarOf(203, 184, 148), paleAshlar = ashlarOf(236, 231, 220);
  // every stone lies in the same bond: the picture is laid over each face by its place in the world (one picture is 4 m by 4 m)
  const bond = geo => {
    const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++){
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      uv[i * 2] = (ax > az && ax > ay ? p.getZ(i) : p.getX(i)) / 4; uv[i * 2 + 1] = (ay > ax && ay > az ? p.getZ(i) : p.getY(i)) / 4;
    }
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return geo;
  };
  const stoneMat = (tint, glow, pale) => { const map = pale ? paleAshlar : ashlar, m = new THREE.MeshStandardMaterial({ map, color: tint, roughness: 0.92, emissive: C(glow), emissiveMap: map }); m.userData.env = 0.2; return m; };
  // a round-arched opening, standing upright and facing west (w wide, h to the top of the arch), as a dark panel just in front of the wall
  // faceZ: nothing for a wall that faces west, 1 south, -1 north, 'e' east
  const archPanel = (w, h, px, py, pz, faceZ) => {
    const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - w / 2); s.absarc(0, h - w / 2, w / 2, 0, Math.PI, false); s.lineTo(-w / 2, 0);
    const g = new THREE.ShapeGeometry(s, 10); g.rotateY(faceZ === undefined ? -Math.PI / 2 : faceZ === 'e' ? Math.PI / 2 : faceZ > 0 ? 0 : Math.PI); g.translate(px, py, pz); return g;
  };
  // a round arch of stone over an opening (r to the middle of the moulding), with its two jambs
  const archivolt = (r, tube, px, py, pz, jamb) => {
    const out = [new THREE.TorusGeometry(r, tube, 6, 18, Math.PI).rotateY(-Math.PI / 2).translate(px, py, pz)];
    for (const sd of [-1, 1]) out.push(new THREE.CylinderGeometry(tube, tube, jamb, 8).translate(px, py - jamb / 2, pz + sd * r));
    return out;
  };
  const STONE = { bond, mat: stoneMat, archPanel, archivolt };

  function torreao(x0, x1, z0, z1, top){
    // ### One of the two towers where the wings of the square meet the river, after the real ones: a storey above the roofs
    // ### with stone quoins at its corners, a cornice, a stone balustrade round the top, a steep slate pavilion roof and a
    // ### small lantern with a finial on it.
    const h = top + FLOOR + 1.2, slate = C(0x5e625f), w = x1 - x0, d = z1 - z0, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    FB.pombal.sides(x0, x1, top - 0.4, h, z0, z1, C(0xdbbe39), TU, TV, 0, 0.25);
    for (const qx of [x0, x1]) for (const qz of [z0, z1]) trim.box(qx - 0.5, qx + 0.5, top - 0.4, h, qz - 0.5, qz + 0.5, stoneCol);
    trim.box(x0 - 0.55, x1 + 0.55, h, h + 0.45, z0 - 0.55, z1 + 0.55, stoneCol);
    // the balustrade: a post about every 1.2 m and a rail on top
    const by = h + 0.45, posts = (a0, a1, put) => { const n = Math.round((a1 - a0) / 1.2); for (let k = 0; k <= n; k++) put(a0 + k * (a1 - a0) / n); };
    posts(x0 - 0.3, x1 + 0.3, x => { trim.box(x - 0.13, x + 0.13, by, by + 0.8, z0 - 0.43, z0 - 0.17, stoneCol); trim.box(x - 0.13, x + 0.13, by, by + 0.8, z1 + 0.17, z1 + 0.43, stoneCol); });
    posts(z0 - 0.3, z1 + 0.3, z => { trim.box(x0 - 0.43, x0 - 0.17, by, by + 0.8, z - 0.13, z + 0.13, stoneCol); trim.box(x1 + 0.17, x1 + 0.43, by, by + 0.8, z - 0.13, z + 0.13, stoneCol); });
    trim.box(x0 - 0.5, x1 + 0.5, by + 0.8, by + 0.98, z0 - 0.5, z0 - 0.1, stoneCol); trim.box(x0 - 0.5, x1 + 0.5, by + 0.8, by + 0.98, z1 + 0.1, z1 + 0.5, stoneCol);
    trim.box(x0 - 0.5, x0 - 0.1, by + 0.8, by + 0.98, z0 - 0.5, z1 + 0.5, stoneCol); trim.box(x1 + 0.1, x1 + 0.5, by + 0.8, by + 0.98, z0 - 0.5, z1 + 0.5, stoneCol);
    // the pavilion roof, steep and nearly a pyramid, with the lantern on its flat top
    hipRoof(x0 + 0.5, x1 - 0.5, by, z0 + 0.5, z1 - 0.5, 7, slate, Math.min(w, d) / 2 - 1.9);
    trim.box(mx - 1.05, mx + 1.05, by + 7, by + 8.7, mz - 1.05, mz + 1.05, stoneCol);
    hipRoof(mx - 1.3, mx + 1.3, by + 8.7, mz - 1.3, mz + 1.3, 1.9, slate, 1.2);
    trim.box(mx - 0.07, mx + 0.07, by + 10.6, by + 12.4, mz - 0.07, mz + 0.07, C(0x3a3d42));
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
    // the five doors and the five windows over them, each in a stone surround: jambs, a lintel, and a small cornice over the window
    for (let k = -2; k <= 2; k++){
      const x = cx + k * 3.6;
      for (const sd of [-1, 1]) parts.push(boxG(0.28, 4.7, 0.34, x + sd * 0.96, 3.25, front + 0.15), boxG(0.22, 3.3, 0.3, x + sd * 0.7, 8.5, front + 0.13));
      parts.push(boxG(2.3, 0.38, 0.42, x, 5.75, front + 0.18), boxG(1.75, 0.2, 0.36, x, 6.92, front + 0.15), boxG(1.9, 0.28, 0.4, x, 10.2, front + 0.17), boxG(2.2, 0.16, 0.5, x, 10.45, front + 0.2));
    }
    // the balcony in front of those windows: a slab, a rail, and a baluster about every 0.6 m
    parts.push(boxG(18.6, 0.24, 1.05, cx, 6.6, front + 0.55), boxG(18.6, 0.12, 0.14, cx, 7.55, front + 1.0));
    for (let bx = -9.2; bx <= 9.21; bx += 0.613) parts.push(boxG(0.1, 0.85, 0.1, cx + bx, 7.1, front + 1.0));
    // the windows of the two wings in their surrounds, and the figures at the ends of the pediment
    for (const sx of [-1, 1]) for (let k = 0; k < 2; k++){
      const wx = cx + sx * (17.5 + k * 3.2);
      for (const y of [5.15, 9.55]) parts.push(boxG(1.7, 0.26, 0.36, wx, y, cz + 8.16));
      for (const y of [1.9, 6.5]) parts.push(boxG(1.6, 0.18, 0.34, wx, y, cz + 8.15));
      for (const sd of [-1, 1]) parts.push(boxG(0.2, 7.6, 0.26, wx + sd * 0.72, 5.7, cz + 8.1));
    }
    for (const sx of [-1, 1]) parts.push(boxG(0.7, 1.5, 0.7, cx + sx * 11, 14.1, front + 2));
    // white stone, floodlit from the square like the other landmarks
    const body = new THREE.Mesh(STONE.bond(mergeGeos(parts)), STONE.mat(0xffffff, 0x565248, true)); body.castShadow = true; grp.add(body);
    for (let k = -3; k <= 3; k++) glowPts.push(cx + k * 5.2, 1.2, front + 6.5);
    for (let k = -2; k <= 2; k++){
      // a door of glass in a dark frame, the foyer lit behind it: two leaves and a fanlight
      neon.box(cx + k * 3.6 - 0.8, cx + k * 3.6 + 0.8, 1.1, 5.4, front - 0.05, front + 0.02, C(0xa9773c));
      neon.box(cx + k * 3.6 - 0.05, cx + k * 3.6 + 0.05, 1.1, 4.3, front + 0.02, front + 0.05, C(0x23170d));
      neon.box(cx + k * 3.6 - 0.8, cx + k * 3.6 + 0.8, 4.25, 4.37, front + 0.02, front + 0.05, C(0x23170d));
      for (const sd of [-1, 1]) neon.box(cx + k * 3.6 + sd * 0.42 - 0.03, cx + k * 3.6 + sd * 0.42 + 0.03, 1.1, 4.3, front + 0.02, front + 0.04, C(0x3a2616));
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
    // ### The front is a picture; these parts stand out from it so it has depth, as the real front has: a plinth, pilasters at
    // ### the corners, the two horseshoe arches as stone mouldings on short columns, the niche with its figure between them, two
    // ### cornices, and a row of round-arched windows under the battlements. The side walls get three rows of windows.
    const dark = [];
    parts.push(boxG(27, 1.3, 0.9, cx, 0.83, fz + 0.3), boxG(27.2, 0.7, 1.1, cx, 19.9, fz + 0.4), boxG(26.8, 0.45, 0.8, cx, 25.6, fz + 0.3));
    for (const sd of [-1, 1]) parts.push(boxG(1.7, 24.4, 0.9, cx + sd * 12.25, 12.9, fz + 0.32));
    for (const px of [-4.62, 4.62]){
      parts.push(new THREE.TorusGeometry(5.05, 0.36, 8, 40, Math.PI * 1.5).rotateZ(-Math.PI / 4).translate(cx + px, 12.7, fz + 0.32), new THREE.TorusGeometry(4.35, 0.2, 6, 40, Math.PI * 1.5).rotateZ(-Math.PI / 4).translate(cx + px, 12.7, fz + 0.2));
      for (const sd of [-1, 1]) parts.push(new THREE.CylinderGeometry(0.3, 0.36, 7.9, 10).translate(cx + px + sd * 3.57, 5.25, fz + 0.34), boxG(0.9, 0.35, 0.9, cx + px + sd * 3.57, 9.35, fz + 0.34), boxG(0.9, 0.4, 0.9, cx + px + sd * 3.57, 1.5, fz + 0.34));
    }
    parts.push(boxG(1.5, 0.5, 1.0, cx, 8.6, fz + 0.45), new THREE.CylinderGeometry(0.34, 0.42, 2.5, 8).translate(cx, 10.1, fz + 0.5), new THREE.SphereGeometry(0.33, 10, 8).translate(cx, 11.6, fz + 0.5), boxG(1.9, 0.3, 1.1, cx, 12.6, fz + 0.45));
    for (let k = -4; k <= 4; k++){
      dark.push(STONE.archPanel(1.15, 3.1, cx + k * 2.7, 21.4, fz + 0.07, 1));
      parts.push(boxG(1.6, 0.22, 0.4, cx + k * 2.7, 21.3, fz + 0.18), new THREE.TorusGeometry(0.72, 0.13, 6, 14, Math.PI).translate(cx + k * 2.7, 23.92, fz + 0.1));
    }
    for (const sd of [-1, 1]) for (const y of [3.2, 10.6, 18]) for (let z = fz - 19; z < fz - 2; z += 4.2) dark.push(STONE.archPanel(1.4, 3.8, cx + sd * 13.07, y, z, sd > 0 ? 'e' : undefined));
    grp.add(new THREE.Mesh(mergeGeos(dark), new THREE.MeshBasicMaterial({ color: 0x15100a, side: THREE.DoubleSide })));
    // dressed stone, floodlit from the square like the cathedral and the castle
    const body = new THREE.Mesh(STONE.bond(mergeGeos(parts)), STONE.mat(0xf0e9d8, 0x4e4636, true)); body.castShadow = true; grp.add(body);
    for (const sx of [-9, -3, 3, 9]) glowPts.push(cx + sx, 1.2, fz + 3.5);
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
  // ### Bronze figures are modelled from rounded parts, as a sculptor builds up clay: clayBall is an egg shape (its three half
  // ### sizes, where it is, and how far it is tipped forward), clayLimb a tapering round bar from one point to another.
  const clayBall = (rx, ry, rz, x, y, z, tip) => { const g = new THREE.SphereGeometry(1, 16, 12).scale(rx, ry, rz); if (tip) g.rotateX(tip); return g.translate(x, y, z); };
  const clayLimb = (r0, r1, p, q) => {
    const d = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]), len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, 10).translate(0, len / 2, 0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())));
    return g.translate(p[0], p[1], p[2]);
  };
  // a standing man in a long coat, his feet at y: for the top of a column
  const standing = y => [clayLimb(0.15, 0.12, [-0.14, y + 0.95, 0], [-0.16, y, 0.03]), clayLimb(0.15, 0.12, [0.14, y + 0.95, 0], [0.17, y, -0.03]),
    clayBall(0.34, 0.52, 0.25, 0, y + 1.42, 0), clayBall(0.4, 0.62, 0.2, 0, y + 1.05, -0.14, -0.12), clayLimb(0.1, 0.08, [0, y + 1.85, 0], [0, y + 2.0, 0.01]), clayBall(0.19, 0.22, 0.2, 0, y + 2.16, 0.01),
    clayLimb(0.11, 0.09, [-0.36, y + 1.78, 0], [-0.44, y + 1.25, 0.06]), clayLimb(0.09, 0.07, [-0.44, y + 1.25, 0.06], [-0.4, y + 0.82, 0.16]),
    clayLimb(0.11, 0.09, [0.36, y + 1.78, 0], [0.48, y + 1.3, 0.14]), clayLimb(0.09, 0.07, [0.48, y + 1.3, 0.14], [0.36, y + 1.22, 0.42]),
    clayLimb(0.03, 0.03, [0.36, y + 0.95, 0.44], [0.36, y + 1.5, 0.44]), boxG(0.9, 0.12, 0.9, 0, y - 0.06, 0)];
  // Rossio: the wave pavement, the column of Dom Pedro IV and two fountains
  function rossio(cx, cz){
    // the column: a stepped base, a pedestal, the shaft with its base ring and its capital, and the king in bronze on top
    const column = new THREE.Mesh(mergeGeos([new THREE.CylinderGeometry(2.2, 2.4, 0.5, 20).translate(0, 0.43, 0), new THREE.CylinderGeometry(1.5, 1.8, 2.2, 16).translate(0, 1.3, 0), new THREE.CylinderGeometry(1.7, 1.7, 0.3, 16).translate(0, 2.5, 0),
      new THREE.CylinderGeometry(0.85, 0.95, 0.5, 16).translate(0, 2.9, 0), new THREE.CylinderGeometry(0.55, 0.68, 13.6, 16).translate(0, 9.9, 0), new THREE.CylinderGeometry(0.95, 0.6, 0.7, 16).translate(0, 16.85, 0), new THREE.BoxGeometry(1.7, 0.4, 1.7).translate(0, 17.4, 0)]), stone);
    column.position.set(cx, 0, cz); column.castShadow = true;
    const figure = new THREE.Mesh(mergeGeos(standing(17.72)), bronze);
    figure.position.set(cx, 0, cz); figure.castShadow = true;
    grp.add(column, figure);
    colliders.push({ t: 'c', x: cx, z: cz, r: 1.8 });
    radarRects.push({ x0: cx - 1.8, x1: cx + 1.8, z0: cz - 1.8, z1: cz + 1.8, c: 'rgba(255,255,255,.3)' });
    fountain(cx - 10, cz); fountain(cx + 10, cz);
    shardSpots.push({ x: cx, z: cz + 10.5 }, { x: cx, z: cz - 10.5 });
  }
  // ### A horse and rider in bronze on a stone pedestal: Dom Jose I on the Praca do Comercio, Dom Joao I on the Praca da
  // ### Figueira. The horse walks, one foreleg raised: a barrel of a body with a deep chest and round quarters, an arched neck,
  // ### a long head with ears, four legs with knees and hooves, and a tail. The king sits upright in the saddle on a cloth, in a
  // ### cloak and a plumed helmet, the sceptre in his right hand and the reins in his left. The pedestal is a tall block of
  // ### pale stone on two steps, with a plinth, a panel on each long side, a medallion on the front and a cornice.
  function equestrian(x, z, s){
    const P = [boxG(4.4, 0.45, 6.0, 0, 0.4, 0), boxG(3.7, 0.45, 5.3, 0, 0.85, 0), boxG(3.0, 0.8, 4.6, 0, 1.45, 0), boxG(2.5, 3.6, 4.1, 0, 3.65, 0), boxG(2.8, 0.25, 4.4, 0, 2.0, 0),
      boxG(3.0, 0.35, 4.6, 0, 5.6, 0), boxG(3.3, 0.3, 4.9, 0, 5.92, 0), boxG(2.9, 0.33, 4.5, 0, 6.23, 0)];
    for (const sd of [-1, 1]) P.push(boxG(0.12, 2.3, 2.9, sd * 1.27, 3.75, 0), boxG(0.1, 2.6, 0.16, sd * 1.28, 3.75, -1.55), boxG(0.1, 2.6, 0.16, sd * 1.28, 3.75, 1.55));
    P.push(new THREE.CylinderGeometry(0.75, 0.75, 0.12, 20).rotateX(Math.PI / 2).translate(0, 3.9, 2.08), new THREE.TorusGeometry(0.78, 0.07, 6, 20).translate(0, 3.9, 2.1));
    const ped = new THREE.Mesh(STONE.bond(mergeGeos(P)), STONE.mat(0xf6f1e6, 0x2c2922, true));
    ped.scale.set(s, 1, s); ped.position.set(x, 0, z); ped.castShadow = true; ped.receiveShadow = true;
    const H = [
      // the horse: body, chest, quarters, the neck in two parts, head, muzzle, ears, mane, tail
      clayBall(0.6, 0.66, 1.4, 0, 3.05, -0.05), clayBall(0.58, 0.74, 0.68, 0, 3.14, 1.02), clayBall(0.64, 0.76, 0.78, 0, 3.12, -1.08),
      clayLimb(0.44, 0.34, [0, 3.45, 1.2], [0, 4.2, 1.72]), clayLimb(0.34, 0.25, [0, 4.2, 1.72], [0, 4.82, 1.98]),
      clayBall(0.22, 0.27, 0.5, 0, 4.86, 2.24, 0.55), clayBall(0.16, 0.18, 0.28, 0, 4.58, 2.56, 0.6),
      new THREE.ConeGeometry(0.07, 0.24, 6).translate(-0.12, 5.22, 2.06), new THREE.ConeGeometry(0.07, 0.24, 6).translate(0.12, 5.22, 2.06),
      clayBall(0.07, 0.5, 0.32, 0, 4.42, 1.5, -0.6), clayBall(0.06, 0.3, 0.2, 0, 5.0, 1.82, -0.5),
      clayLimb(0.17, 0.12, [0, 3.42, -1.72], [0, 2.7, -2.12]), clayLimb(0.12, 0.05, [0, 2.7, -2.12], [0, 1.5, -2.08]),
      // the hind legs, both on the ground
      ...[-1, 1].flatMap(sd => [clayLimb(0.29, 0.17, [sd * 0.36, 2.85, -1.15], [sd * 0.4, 1.72, -1.42]), clayLimb(0.14, 0.1, [sd * 0.4, 1.72, -1.42], [sd * 0.4, 0.5, -1.22]),
        clayBall(0.13, 0.12, 0.13, sd * 0.4, 1.72, -1.42), new THREE.CylinderGeometry(0.13, 0.17, 0.26, 10).translate(sd * 0.4, 0.38, -1.2)]),
      // the right foreleg stands, the left one is raised and bent at the knee
      clayLimb(0.24, 0.14, [0.34, 2.8, 1.02], [0.36, 1.6, 1.14]), clayLimb(0.12, 0.09, [0.36, 1.6, 1.14], [0.36, 0.5, 1.08]), clayBall(0.12, 0.11, 0.12, 0.36, 1.6, 1.14), new THREE.CylinderGeometry(0.13, 0.17, 0.26, 10).translate(0.36, 0.38, 1.1),
      clayLimb(0.24, 0.14, [-0.34, 2.8, 1.02], [-0.36, 2.02, 1.74]), clayLimb(0.12, 0.09, [-0.36, 2.02, 1.74], [-0.36, 1.2, 1.42]), clayBall(0.12, 0.11, 0.12, -0.36, 2.02, 1.74), new THREE.CylinderGeometry(0.13, 0.16, 0.24, 10).rotateX(-0.5).translate(-0.36, 1.12, 1.38),
      // the saddle cloth, with its hem hanging down on both sides
      clayBall(0.66, 0.1, 0.72, 0, 3.72, -0.12), boxG(1.36, 0.5, 1.15, 0, 3.42, -0.12),
      // the king: legs, boots, body, cloak, neck, head, helmet and plume
      ...[-1, 1].flatMap(sd => [clayLimb(0.21, 0.16, [sd * 0.2, 3.98, -0.3], [sd * 0.64, 3.4, 0.22]), clayLimb(0.14, 0.11, [sd * 0.64, 3.4, 0.22], [sd * 0.68, 2.6, 0.08]), clayBall(0.11, 0.1, 0.24, sd * 0.68, 2.52, 0.2)]),
      clayBall(0.4, 0.6, 0.29, 0, 4.58, -0.2), clayBall(0.3, 0.26, 0.26, 0, 4.02, -0.22), clayBall(0.52, 0.8, 0.16, 0, 4.3, -0.56, -0.28), clayBall(0.5, 0.2, 0.3, 0, 5.0, -0.24),
      clayLimb(0.11, 0.1, [0, 5.05, -0.18], [0, 5.24, -0.16]), clayBall(0.2, 0.23, 0.21, 0, 5.42, -0.15),
      clayBall(0.24, 0.16, 0.26, 0, 5.56, -0.16), boxG(0.5, 0.04, 0.3, 0, 5.5, 0.02), clayBall(0.09, 0.26, 0.36, 0, 5.84, -0.36, -0.6),
      // the right arm with the sceptre, the left one holding the reins, and the reins to the bit
      clayLimb(0.12, 0.1, [0.4, 4.95, -0.2], [0.62, 4.45, 0.1]), clayLimb(0.1, 0.08, [0.62, 4.45, 0.1], [0.6, 4.4, 0.58]), clayBall(0.09, 0.09, 0.1, 0.6, 4.4, 0.62),
      clayLimb(0.035, 0.035, [0.6, 3.95, 0.6], [0.6, 5.35, 0.74]), clayBall(0.08, 0.08, 0.08, 0.6, 5.4, 0.745),
      clayLimb(0.12, 0.1, [-0.4, 4.95, -0.2], [-0.5, 4.4, 0.14]), clayLimb(0.1, 0.08, [-0.5, 4.4, 0.14], [-0.22, 4.18, 0.62]), clayBall(0.09, 0.09, 0.1, -0.2, 4.17, 0.66),
      clayLimb(0.02, 0.02, [-0.2, 4.17, 0.66], [-0.17, 4.52, 2.5]), clayLimb(0.02, 0.02, [-0.2, 4.17, 0.66], [0.17, 4.52, 2.5]),
      // the bronze ground the horse stands on
      boxG(1.5, 0.26, 3.9, 0, 0.13, -0.05)
    ];
    const statue = new THREE.Mesh(mergeGeos(H), bronze);
    statue.scale.setScalar(s); statue.position.set(x, 6.38, z); statue.castShadow = true;
    grp.add(ped, statue);
    groundPool(pools, x, z, 9, C(0xffc98a));
    // floodlights at the four corners, so the bronze is not a black shape against the night sky
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) glowPts.push(x + sx * 3.4 * s, 0.6, z + sz * 4.2 * s);
    colliders.push({ t: 'b', x0: x - 2.2 * s, x1: x + 2.2 * s, z0: z - 3.0 * s, z1: z + 3.0 * s });
    radarRects.push({ x0: x - 2.2 * s, x1: x + 2.2 * s, z0: z - 3.0 * s, z1: z + 3.0 * s, c: 'rgba(255,255,255,.3)' });
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
      groundPool(pools, x, z, 8, C(0xffc98a));
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
  trim.box(-153, 700, 0, 0.35, 151, 157, stoneCol);
  const pillars = mergeGeos([-6, 6].flatMap(x => [new THREE.CylinderGeometry(0.5, 0.6, 6, 12).translate(x, 3.3, 155), new THREE.BoxGeometry(1.5, 0.6, 1.5).translate(x, 6.5, 155)]));
  const colunas = new THREE.Mesh(pillars, stone); colunas.castShadow = true; grp.add(colunas);
  const river = new THREE.Mesh(new THREE.PlaneGeometry(1400, 640, 280, 128).rotateX(-Math.PI / 2), riverMaterial());
  river.position.set(0, 0.08, 157 + 320); river.userData.dynamic = true; river.frustumCulled = false;
  grp.add(river); CITY.water = river;
  // ### West of the Baixa the river comes in behind a quay wall, up to the road along the bank and round the foot of the hill, so
  // ### the approach road to the bridge runs out over the water and its loop stands in the river. It is the same water (one
  // ### material, so it moves with the river), calm in there as the waves die down north of the quay.
  for (const [x0, x1, z0, z1] of [[-700, -455, -700, 157], [-455, -153, 124, 157]]){
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, Math.round((x1 - x0) / 6), Math.round((z1 - z0) / 6)).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const basin = new THREE.Mesh(g, river.material);
    basin.position.y = 0.08; basin.userData.dynamic = true; basin.frustumCulled = false; grp.add(basin);
  }
  trim.box(-156, -153, 0, 0.35, 124, 157, stoneCol); trim.box(-458, -153, 0, 0.35, 121, 124, stoneCol); trim.box(-458, -455, 0, 0.35, -700, 124, stoneCol);
  radarRects.push({ x0: -300, x1: 300, z0: 157, z1: 340, c: 'rgba(70,140,230,.28)' });

  // The hills around the valley: Bairro Alto in the west, the castle hill in the east, the Avenida in the north
  const HILLS = [[330, -110, 175, 64, 240], [-345, -60, 150, 60, 320], [0, -470, 340, 45, 190]];
  // ### A hill is a bell, flat at its foot and round on top, so it never stands up like a wall. It only starts outside the street grid
  // ### of the Baixa, and the flat city meets it at the edge. Towards the river it runs out before the bank, where the road up to
  // ### the bridge passes.
  const hillH = (x, z) => sstep(186, 216, Math.max(Math.abs(x), Math.abs(z))) * (1 - sstep(30, 132, z)) * Math.max(0, ...HILLS.map(([cx, cz, rx, ry, rz]) => ry * Math.pow(Math.max(0, 1 - ((x - cx) / rx) ** 2 - ((z - cz) / rz) ** 2), 1.4)));
  // ### The real surface of the hills: the dome plus small banks and terraces of up to about 2 m, and what each spot is.
  // ### Streets wind along the slope at fixed heights, gardens sit in patches, everything else is built up.
  const hillBump = (x, z) => 1.3 * Math.sin(x * 0.13 + z * 0.07) * Math.sin(z * 0.11 - x * 0.05) + 0.7 * Math.sin(x * 0.37 + z * 0.29) * Math.sin(z * 0.23 + 1.7);
  const hillSurf = (x, z) => { const h = hillH(x, z); return h + hillBump(x, z) * clamp((h - 1) / 6, 0, 1); };
  const hillPatch = (x, z) => Math.sin(x * 0.083 + z * 0.047) * Math.sin(z * 0.071 - x * 0.039) + 0.5 * Math.sin(x * 0.21 + z * 0.17);
  const hillKind = (x, y, z) => Math.sin(y * 0.55 + hillPatch(x, z) * 1.6) > 0.975 ? 'street' : hillPatch(x, z) < -0.45 ? 'garden' : 'built';
  const hillLots = [];
  // ### Night and fog would turn a plainly lit hill into the colour of the sky, and the houses on it would seem to hang in the air. So
  // ### the hills paint their own colours and ignore the fog: dark gardens, built-up terracotta patches and streets along the slope,
  // ### shaded by the direction each slope faces, with the small lights of the quarter on top.
  {
    // the ground of the hills is rough, not a smooth dome: small terraces and banks follow hillBump
    // one grid of about 6 m per hill, lifted to the real surface; where the hill is flat it stays just under the street
    const geo = (() => {
      const x0 = Math.min(...HILLS.map(([cx, , rx]) => cx - rx)), x1 = Math.max(...HILLS.map(([cx, , rx]) => cx + rx));
      const z0 = Math.min(...HILLS.map(([, cz, , , rz]) => cz - rz)), z1 = Math.max(...HILLS.map(([, cz, , , rz]) => cz + rz));
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, Math.round((x1 - x0) / 6), Math.round((z1 - z0) / 6)).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0, (z0 + z1) / 2), q = g.attributes.position;
      for (let i = 0; i < q.count; i++){ const h = hillSurf(q.getX(i), q.getZ(i)); q.setY(i, h > 0.2 ? h : -0.6); }
      const idx = g.index.array, keep = [];
      for (let i = 0; i < idx.length; i += 3) if (q.getY(idx[i]) > 0 || q.getY(idx[i + 1]) > 0 || q.getY(idx[i + 2]) > 0) keep.push(idx[i], idx[i + 1], idx[i + 2]);
      g.setIndex(keep); g.computeVertexNormals();
      return mergeGeos([g]);
    })();
    const p = geo.attributes.position, col = new Float32Array(p.count * 3), L = Math.hypot(0.35, 0.8, 0.45);
    const n = geo.attributes.normal;
    for (let i = 0; i < p.count; i++){
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), lit = Math.max(0, (n.getX(i) * -0.35 + n.getY(i) * 0.8 + n.getZ(i) * 0.45) / L);
      const kind = hillKind(x, y, z), grain = 0.82 + 0.36 * hash3(Math.round(x), Math.round(y), Math.round(z));
      // night colours: lit streets, built-up ground between the houses, and gardens with trees
      const c = kind === 'street' ? [0.065, 0.056, 0.045] : kind === 'garden' ? [0.013, 0.024, 0.015] : [0.03, 0.026, 0.023], s = (0.6 + 0.8 * lit) * grain;
      col[i * 3] = c[0] * s; col[i * 3 + 1] = c[1] * s; col[i * 3 + 2] = c[2] * s;
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    // ### Seen from the city a slope in one flat colour looks like a painted backdrop with houses stuck on it. So the colours
    // ### above are laid over a picture of what really covers such a hill: small plots, yards and flat roofs in slightly
    // ### different tones with dark lanes between them, and the dark crowns of trees. It repeats every 44 m.
    const quarter = (() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 512;
      const g = cv.getContext('2d'), qr = mulberry32(2211);
      g.fillStyle = '#6b655b'; g.fillRect(0, 0, 512, 512);
      for (let gy = 0; gy < 512;){
        const rh = 26 + Math.floor(qr() * 30);
        for (let gx = 0; gx < 512;){
          const rw = 22 + Math.floor(qr() * 44), v = 150 + Math.floor(qr() * 105), warm = qr();
          g.fillStyle = `rgb(${v},${Math.round(v * (0.9 + 0.06 * warm))},${Math.round(v * (0.78 + 0.1 * warm))})`;
          g.fillRect(gx + 2, gy + 2, rw - 4, rh - 4);
          if (qr() < 0.3){ g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(gx + 5, gy + 5, (rw - 10) * (0.3 + qr() * 0.5), (rh - 10) * (0.3 + qr() * 0.5)); }
          gx += rw;
        }
        gy += rh;
      }
      for (let i = 0; i < 90; i++){ const x = qr() * 512, y = qr() * 512, r = 5 + qr() * 11, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(20,34,22,.9)'); gr.addColorStop(1, 'rgba(20,34,22,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
      for (let i = 0; i < 4000; i++){ const d = qr() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${d},${d},${d},${(qr() * 0.08).toFixed(3)})`; g.fillRect(qr() * 512, qr() * 512, 2, 2); }
      const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = ANISO; t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    })();
    { const uv = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++){ uv[i * 2] = p.getX(i) / 44; uv[i * 2 + 1] = p.getZ(i) / 44; } geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); }
    // the picture is darker than white, so the colours are raised to keep the slope a little brighter than before
    for (let i = 0; i < col.length; i++) col[i] *= 2.3;
    // still its own colours and no fog, as before; the picture only adds the detail
    const hillMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }); hillMat.map = quarter;
    grp.add(new THREE.Mesh(geo, hillMat));
    const lights = [], hr = mulberry32(77);
    for (const [hx, hz, rx, , rz] of HILLS) for (let k = 0; k < 170; k++){
      const a = hr() * Math.PI * 2, q = Math.sqrt(hr()) * 0.95, x = hx + Math.cos(a) * q * rx, z = hz + Math.sin(a) * q * rz;
      if (Math.max(Math.abs(x), Math.abs(z)) >= 200 && z <= 124) lights.push(x, hillSurf(x, z) + 3, z);
    }
    // street lamps along the winding streets of the slopes
    const lr = mulberry32(78);
    for (const [hx, hz, rx, , rz] of HILLS) for (let k = 0; k < 2400; k++){
      const a = lr() * Math.PI * 2, q = Math.sqrt(lr()) * 0.95, x = hx + Math.cos(a) * q * rx, z = hz + Math.sin(a) * q * rz, y = hillSurf(x, z);
      if (Math.max(Math.abs(x), Math.abs(z)) >= 200 && z <= 124 && hillKind(x, y, z) === 'street' && lr() < 0.3) lights.push(x, y + 4.5, z);
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lights, 3));
    grp.add(new THREE.Points(lg, new THREE.PointsMaterial({ map: glowTexture, color: 0xffcf8c, size: 2.0, sizeAttenuation: true, transparent: true, opacity: LAMP_HALO, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
  }
  // west of the Baixa the road up to the bridge runs along the river: a house that would stand on it moves up the slope instead
  const clearOfApproach = (x, z) => x < -150 && z > 118 ? 118 - (z - 118) * 2 : z;
  for (let n = 0; n < 240; n++){
    const a = rng() * Math.PI * 2, r = 205 + rng() * 240, x = Math.cos(a) * r, z = clearOfApproach(x, Math.sin(a) * r);
    if (Math.max(Math.abs(x), Math.abs(z)) < 200 || z > 145 || (x > 186 && x < 220 && Math.abs(z) < 8)) continue;
    const w = 12 + Math.floor(rng() * 4) * 3, d = 12 + Math.floor(rng() * 4) * 3, h = (3 + Math.floor(rng() * 3)) * FLOOR;
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].map(([sx, sz]) => hillSurf(x + sx * w / 2, z + sz * d / 2)), base = Math.max(...corners), low = Math.min(...corners);
    const style = rng() < 0.88 ? 'pombal' : 'tileB';
    facade(style, x - w / 2, x + w / 2, low - 3, base + h, z - d / 2, z + d / 2, pick(style).multiplyScalar(0.85));
    hipRoof(x - w / 2, x + w / 2, base + h, z - d / 2, z + d / 2, 3, roofTile());
    hillLots.push([x - w / 2, x + w / 2, z - d / 2, z + d / 2]);
  }
  // Houses climbing the hills, so the slopes are not empty at night
  for (const [hx, hz, rx, , rz] of HILLS) for (let n = 0; n < 190; n++){
    const a = rng() * Math.PI * 2, q = Math.sqrt(rng()) * 0.96, x = hx + Math.cos(a) * q * rx, z = clearOfApproach(x, hz + Math.sin(a) * q * rz);
    if (Math.max(Math.abs(x), Math.abs(z)) < 200 || z > 145 || (x > 186 && x < 220 && Math.abs(z) < 8)) continue;
    const w = 10 + Math.floor(rng() * 3) * 3, d = 10 + Math.floor(rng() * 3) * 3, h = (2 + Math.floor(rng() * 3)) * FLOOR;
    // the foundations reach below the lowest corner of the plot, so no house hangs over a steep slope
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].map(([sx, sz]) => hillSurf(x + sx * w / 2, z + sz * d / 2)), base = Math.max(...corners), low = Math.min(...corners);
    const style = rng() < 0.88 ? 'pombal' : 'tileG';
    facade(style, x - w / 2, x + w / 2, low - 3, base + h, z - d / 2, z + d / 2, pick(style).multiplyScalar(0.85));
    hipRoof(x - w / 2, x + w / 2, base + h, z - d / 2, z + d / 2, 2.6, roofTile());
    hillLots.push([x - w / 2, x + w / 2, z - d / 2, z + d / 2]);
  }
  // ### Lisbon's hills are built up almost to the top: rows of houses step up the slopes that face the city, with gardens and
  // ### trees in between and streets winding along. They use their own random numbers, so the rest of the city stays as it was.
  {
    const hr = mulberry32(4471), gardenTrees = [], free = (x0, x1, z0, z1) => hillLots.every(([a, b, c, d]) => x1 + 2 < a || x0 - 2 > b || z1 + 2 < c || z0 - 2 > d);
    for (const [hx, hz, rx, ry, rz] of HILLS){
      const toCity = Math.hypot(hx, hz);
      for (let gx = hx - rx; gx < hx + rx; gx += 12.5) for (let gz = hz - rz; gz < hz + rz; gz += 12.5){
        const x = gx + (hr() - 0.5) * 6, z = gz + (hr() - 0.5) * 6, q = Math.hypot((x - hx) / rx, (z - hz) / rz);
        if (q > 0.97 || Math.max(Math.abs(x), Math.abs(z)) < 198 || z > 122) continue;
        if ((x > 186 && x < 280 && Math.abs(z) < 32) || Math.hypot(x - 300, z + 115) < 60) continue;
        // only the sides the city can see
        if (((x - hx) * -hx + (z - hz) * -hz) / (Math.hypot(x - hx, z - hz) * toCity + 1e-6) < -0.35) continue;
        const y = hillSurf(x, z), kind = hillKind(x, y, z);
        if (kind === 'garden'){ if (hr() < 0.8) gardenTrees.push({ x, z, y, s: 1.1 + hr() * 0.8, rot: hr() * 6.28, v: hr() }); continue; }
        if (kind === 'street'){ if (hr() < 0.35) gardenTrees.push({ x, z, y, s: 0.9 + hr() * 0.5, rot: hr() * 6.28, v: hr() }); continue; }
        const w = 9 + Math.floor(hr() * 3) * 2, d = 9 + Math.floor(hr() * 3) * 2, h = (2 + Math.floor(hr() * 3)) * FLOOR;
        if (!free(x - w / 2, x + w / 2, z - d / 2, z + d / 2)) continue;
        const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => hillSurf(x + sx * w / 2, z + sz * d / 2)), top = Math.max(...corners), low = Math.min(...corners);
        const style = hr() < 0.85 ? 'pombal' : hr() < 0.5 ? 'tileG' : 'tileB', pal = PAL[style];
        FB[style].sides(x - w / 2, x + w / 2, low - 3, top + h, z - d / 2, z + d / 2, C(pal[Math.floor(hr() * pal.length)]).multiplyScalar(0.8), TU, TV, Math.floor(hr() * 8) / 8, Math.floor(hr() * 8) / 8);
        hipRoof(x - w / 2, x + w / 2, top + h, z - d / 2, z + d / 2, 2.4, C(TILE_ROOFS[Math.floor(hr() * TILE_ROOFS.length)]));
        hillLots.push([x - w / 2, x + w / 2, z - d / 2, z + d / 2]);
      }
    }
    // ### Two kinds of tree, as on Lisbon's hills: broad crowns of several rounded lumps, and about a third dark cypresses,
    // ### tall and narrow, which break the line of the roofs.
    const crown = treeCrown(6, 1, 1.9, 4.4, 41), trunk = treeTrunk(2.8, 0.3, 2, 42);
    const cypress = (() => {
      const g = new THREE.ConeGeometry(0.95, 7.6, 9, 4).translate(0, 4.6, 0), q = g.attributes.position, col = new Float32Array(q.count * 3);
      for (let i = 0; i < q.count; i++){
        const y = q.getY(i), k = 1 + 0.16 * (hash3(q.getX(i) * 3, y, q.getZ(i) * 3) - 0.5), sh = 0.55 + 0.45 * (y - 0.8) / 7.6;
        q.setX(i, q.getX(i) * k * (y < 2 ? 0.8 : 1)); q.setZ(i, q.getZ(i) * k * (y < 2 ? 0.8 : 1));
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = sh;
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
      return g;
    })();
    const broad = gardenTrees.filter(o => o.v >= 0.32), slim = gardenTrees.filter(o => o.v < 0.32);
    const placeG = (o, dm) => { dm.position.set(o.x, o.y - 0.3, o.z); dm.rotation.set(0, o.rot, 0); dm.scale.setScalar(o.s); };
    const placeC = (o, dm) => { dm.position.set(o.x, o.y - 0.4, o.z); dm.rotation.set(0, o.rot, 0); dm.scale.set(o.s * 0.95, o.s * (1.05 + o.v), o.s * 0.95); };
    const gt = instanced(grp, trunk, barkMat(), broad, placeG), gc = instanced(grp, crown, leafMat(), broad, placeG, (o, t) => t.set(0x3f6e45).offsetHSL((o.v - 0.5) * 0.08, 0, (o.v - 0.5) * 0.12));
    const cy = instanced(grp, cypress, leafMat(), slim, placeC, (o, t) => t.set(0x27432f).offsetHSL(0, 0, (o.v - 0.16) * 0.2));
    // far away: no shadows needed, which keeps them cheap
    for (const m of [gt, gc, cy]) if (m){ m.castShadow = false; m.receiveShadow = false; }
    // ### The side of the west hill that turns away from the city faces the bridge and its loop, and from there it was bare,
    // ### painted ground. Like Monsanto park above the real bridge it is wooded: umbrella pines, broad crowns and cypresses close
    // ### together between the houses that stand there. Own random numbers, so the rest of the hill stays as it was.
    {
      const wr = mulberry32(1966), pines = [], broads = [], slims = [], [hx, hz, rx, , rz] = HILLS[1], toCity = Math.hypot(hx, hz);
      for (let gx = hx - rx; gx < hx + rx; gx += 7) for (let gz = hz - rz; gz < hz + rz; gz += 7){
        const x = gx + (wr() - 0.5) * 5, z = gz + (wr() - 0.5) * 5, v = wr(), s = 0.95 + wr() * 0.7, rot = wr() * 6.28;
        if (Math.hypot((x - hx) / rx, (z - hz) / rz) > 0.97 || z > 118 || Math.max(Math.abs(x), Math.abs(z)) < 205) continue;
        if (((x - hx) * -hx + (z - hz) * -hz) / (Math.hypot(x - hx, z - hz) * toCity + 1e-6) >= -0.35 || !free(x - 1.5, x + 1.5, z - 1.5, z + 1.5)) continue;
        const y = hillSurf(x, z); if (y < 1) continue;
        (v < 0.45 ? pines : v < 0.8 ? broads : slims).push({ x, z, y, s, rot, v });
      }
      const tint = base => (o, t) => t.set(base).offsetHSL((o.v - 0.5) * 0.06, (o.v - 0.5) * 0.08, (o.v - 0.5) * 0.12);
      const wood = [
        instanced(grp, treeTrunk(2.4, 0.27, 0, 51), barkMat(), pines, placeG), instanced(grp, treePine(4, 2.2, 1.6, 8.2, 52), leafMat(), pines, placeG, tint(0x35614a)),
        instanced(grp, trunk, barkMat(), broads, placeG), instanced(grp, crown, leafMat(), broads, placeG, tint(0x3f6e45)),
        instanced(grp, cypress, leafMat(), slims, placeC, (o, t) => t.set(0x27432f).offsetHSL(0, 0, (o.v - 0.9) * 0.2))
      ];
      for (const m of wood) if (m){ m.castShadow = false; m.receiveShadow = false; }
    }
  }
  // ### The Se, Lisbon's cathedral, on the slope at the end of Rua da Conceicao, facing west down the street, after the real
  // ### one: a Romanesque front of pale limestone, two square towers with a string course, two round-arched bell openings on
  // ### each side and battlements on top; between them the round-arched portal under its archivolts, the rose window, and a
  // ### battlemented gable; behind them the nave with its buttresses, small windows and tile roof. It stands on a terrace of
  // ### the same stone, with a parapet and a broad flight of steps down to the street, and is floodlit from the terrace, as
  // ### every night. All of it is scenery beyond the edge of the map: nothing here can be driven on or hit.
  {
    const x = 222, under = [], { bond, archPanel, archivolt } = STONE, stoneMat = STONE.mat;
    // the terrace is as high as the slope under the towers; further back the church stands in the hill, which rises behind it
    for (let gx = x - 3; gx <= x + 10; gx += 4) for (let gz = -20; gz <= 20; gz += 4) under.push(hillSurf(gx, gz));
    const b = Math.max(...under) - 2.5, T = b + 3;
    const lime = [], dark = [], sill = [], treads = [];
    for (const sz of [-8.5, 8.5]){
      // the tower: its shaft, a plinth, corner buttresses, the string course under the belfry, and the cornice under the battlements
      lime.push(boxG(11, 34, 10, x + 5, b + 17, sz), boxG(11.8, 2.2, 10.8, x + 5, T + 1.1, sz));
      for (const cx of [-0.5, 10.5]) for (const cz of [-5, 5]) lime.push(boxG(1.5, 30, 1.5, x + cx, b + 15, sz + cz));
      sill.push(boxG(11.7, 0.6, 10.7, x + 5, T + 19.6, sz), boxG(12.1, 0.8, 11.1, x + 5, b + 34.2, sz));
      // battlements all round: a low wall with merlons
      for (let k = 0; k < 4; k++){
        const o = -4.6 + k * 3.07;
        lime.push(boxG(1.7, 2.2, 1.2, x + 5 + o, b + 35.7, sz - 5), boxG(1.7, 2.2, 1.2, x + 5 + o, b + 35.7, sz + 5), boxG(1.2, 2.2, 1.7, x - 0.5, b + 35.7, sz + o * 0.92), boxG(1.2, 2.2, 1.7, x + 10.5, b + 35.7, sz + o * 0.92));
      }
      // two bell openings on each side of the belfry, a narrow window in the stage below, and a slit in the plinth stage
      for (const dz of [-2.3, 2.3]){
        dark.push(archPanel(2.3, 6.4, x - 0.56, T + 21.2, sz + dz));
        lime.push(...archivolt(1.35, 0.2, x - 0.6, T + 26.45, sz + dz, 5.2));
      }
      for (const dx of [-2.3, 2.3]) for (const fz of [-1, 1]) dark.push(archPanel(2.3, 6.4, x + 5 + dx, T + 21.2, sz + fz * 5.06, fz));
      dark.push(archPanel(1.0, 3.6, x - 0.56, T + 10.5, sz), archPanel(0.6, 2.2, x - 0.56, T + 4.4, sz));
    }
    // between the towers: the front wall, set back a little, its battlemented top, the portal and the rose window
    lime.push(boxG(8.2, 24, 7.6, x + 4.6, b + 12, 0));
    sill.push(boxG(8.4, 0.5, 7.8, x + 4.6, T + 9.2, 0), boxG(8.6, 0.7, 7.9, x + 4.6, b + 24.2, 0));
    for (let k = -1; k <= 1; k++) lime.push(boxG(1.1, 1.8, 1.5, x + 0.5, b + 25.4, k * 2.5));
    dark.push(archPanel(3.4, 6.6, x + 0.42, T, 0));
    for (let k = 0; k < 4; k++) lime.push(...archivolt(1.85 + k * 0.42, 0.21, x + 0.38 - k * 0.24, T + 4.9, 0, 4.9));
    for (let k = 0; k < 5; k++) sill.push(boxG(1.4, 0.3, 8.6 + k * 0.9, x - 1.2 - k * 0.55, T - 0.15 - k * 0.3 + 0.3, 0));
    lime.push(new THREE.TorusGeometry(2.75, 0.3, 8, 28).rotateY(-Math.PI / 2).translate(x + 0.42, T + 14, 0), new THREE.TorusGeometry(3.25, 0.16, 6, 28).rotateY(-Math.PI / 2).translate(x + 0.46, T + 14, 0));
    for (let k = 0; k < 12; k++){ const a = k * Math.PI / 6; lime.push(new THREE.BoxGeometry(0.12, 2.5, 0.13).translate(0, 1.25, 0).rotateX(a).translate(x + 0.36, T + 14, 0)); }
    lime.push(new THREE.TorusGeometry(0.55, 0.12, 6, 14).rotateY(-Math.PI / 2).translate(x + 0.34, T + 14, 0));
    // the nave behind: walls with buttresses and small round-arched windows, a cornice and a tile roof
    lime.push(boxG(32, 18, 18, x + 26, b + 9, 0));
    sill.push(boxG(32.6, 0.6, 18.6, x + 26, b + 18.2, 0));
    for (let k = 0; k < 5; k++) for (const sd of [-1, 1]){
      lime.push(boxG(1.4, 15, 1.3, x + 12.5 + k * 6.6, b + 7.5, sd * 9.5));
      if (k < 4) dark.push(archPanel(1.2, 4, x + 15.8 + k * 6.6, T + 8.2, sd * 9.06, sd));
    }
    hipRoof(x + 10.2, x + 42, b + 18.5, -9.2, 9.2, 3.2, C(0x8f4a26), 6);
    // the terrace: a retaining wall of the same stone, darker, with buttresses, a coping and a parapet round its edge
    const tx0 = x - 3, tx1 = x + 43, tz = 20, terr = [boxG(tx1 - tx0, T, tz * 2, (tx0 + tx1) / 2, T / 2, 0)], cope = [];
    for (let z = -tz + 3; z <= tz - 3; z += 6.8) if (Math.abs(z) > 8) terr.push(boxG(1.3, T, 2.2, tx0 - 0.5, T / 2, z));
    for (let gx = tx0 + 4; gx < tx1; gx += 7) for (const sd of [-1, 1]) terr.push(boxG(2.2, T, 1.3, gx, T / 2, sd * (tz + 0.5)));
    cope.push(boxG(tx1 - tx0 + 0.8, 0.35, 0.9, (tx0 + tx1) / 2, T + 1.05, -tz), boxG(tx1 - tx0 + 0.8, 0.35, 0.9, (tx0 + tx1) / 2, T + 1.05, tz));
    terr.push(boxG(tx1 - tx0, 0.9, 0.6, (tx0 + tx1) / 2, T + 0.45, -tz), boxG(tx1 - tx0, 0.9, 0.6, (tx0 + tx1) / 2, T + 0.45, tz));
    for (const sd of [-1, 1]){ terr.push(boxG(0.6, 0.9, tz - 7, tx0, T + 0.45, sd * (tz + 7) / 2)); cope.push(boxG(0.9, 0.35, tz - 6.6, tx0, T + 1.05, sd * (tz + 7) / 2)); }
    // the steps down to the street, 14 m wide, until they meet the ground: flights of thirteen steep steps (0.6 m high, 0.7 m
    // deep) with a landing after each, low walls at their sides, and a lamp on a post at both ends of every landing. They end
    // on the last stretch of Rua da Conceicao, about 30 m beyond the edge of the map (LIMIT), where no vehicle drives.
    for (let k = 0, edge = tx0, y = T; k < 110; k++){
      const landing = k % 14 === 13, len = landing ? 3.2 : 0.7, sx = edge - len / 2; y -= 0.6; edge -= len;
      const g0 = Math.min(hillSurf(sx, -7), hillSurf(sx, 0), hillSurf(sx, 7));
      if (y <= g0 + 0.1) break;
      treads.push(boxG(len, 0.6, 14, sx, y + 0.3, 0));
      terr.push(boxG(len, Math.max(0.5, y - g0 + 2), 14, sx, (y + g0 - 2) / 2, 0));
      for (const sd of [-1, 1]) terr.push(boxG(len, Math.max(1.4, y - g0 + 3.5), 0.7, sx, (y + 1.5 + g0 - 2) / 2, sd * 7.35));
      if (landing) for (const sd of [-1, 1]){ cope.push(boxG(0.16, 3.4, 0.16, sx, y + 3.2, sd * 7.35), boxG(0.9, 0.3, 0.9, sx, y + 1.65, sd * 7.35)); glowPts.push(sx, y + 5.1, sd * 7.35); }
    }
    const church = new THREE.Mesh(bond(mergeGeos(lime)), stoneMat(0xf2e3c2, 0x5a4a30)); grp.add(church);
    grp.add(new THREE.Mesh(bond(mergeGeos(sill)), stoneMat(0xfff2d6, 0x6a583a)));
    grp.add(new THREE.Mesh(bond(mergeGeos(terr)), stoneMat(0x9a8a6c, 0x1e1810)));
    grp.add(new THREE.Mesh(bond(mergeGeos(cope)), stoneMat(0xc9b996, 0x2c2418)));
    if (treads.length) grp.add(new THREE.Mesh(bond(mergeGeos(treads)), stoneMat(0xd8c9a6, 0x3a301f)));
    grp.add(new THREE.Mesh(mergeGeos(dark), new THREE.MeshBasicMaterial({ color: 0x120d08, side: THREE.DoubleSide })));
    // the glass of the rose window, dimly lit from inside: twelve petals of deep blue and red round an amber eye
    const glass = (() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d');
      g.fillStyle = '#0b0906'; g.fillRect(0, 0, 128, 128);
      for (let k = 0; k < 12; k++){ g.fillStyle = ['#12284e', '#4e1513', '#143a35'][k % 3]; g.beginPath(); g.moveTo(64, 64); g.arc(64, 64, 60, k * Math.PI / 6 + 0.04, (k + 1) * Math.PI / 6 - 0.04); g.fill(); }
      const eye = g.createRadialGradient(64, 64, 0, 64, 64, 22); eye.addColorStop(0, '#9a7230'); eye.addColorStop(1, 'rgba(120,70,20,0)'); g.fillStyle = eye; g.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; return t;
    })();
    const rose = new THREE.Mesh(new THREE.CircleGeometry(2.6, 28), new THREE.MeshBasicMaterial({ map: glass })); rose.rotation.y = -Math.PI / 2; rose.position.set(x + 0.3, T + 14, 0); grp.add(rose);
    // floodlights on the terrace and on the steps, and the lamps of the street that climbs up to it
    for (const sz of [-13, -8.5, -4, 4, 8.5, 13]) glowPts.push(x - 2.2, T + 1.2, sz);
    for (const sz of [-7, 7]) for (let k = 0; k < 5; k++) glowPts.push(x - 44 + k * 10, hillSurf(x - 44 + k * 10, sz) + 4, sz);
  }
  // ### The Castelo de Sao Jorge on its hill, floodlit like every night, after the real one: an outer curtain wall of warm
  // ### limestone with square towers at the corners and along the sides, battlements on every wall and tower, arrow slits, and
  // ### a gatehouse with a round-arched gate in the wall that faces the city. Inside it stands the citadel: a second, higher
  // ### ring of walls with its own towers, and the keep above them all with the flag. It is scenery far beyond the map.
  {
    const cx = 300, cz = -115, W2 = 40, D2 = 28, H = 13, ground = [];
    for (let gx = -W2 - 5; gx <= W2 + 5; gx += 5) for (let gz = -D2 - 5; gz <= D2 + 5; gz += 5) ground.push(hillSurf(cx + gx, cz + gz));
    const b = hillSurf(cx, cz) - 3, low = Math.min(...ground) - 2, wallG = [], towerG = [], capG = [], slits = [];
    const span = (x0, x1, y0, y1, z0, z1) => boxG(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    // battlements round the top of a rectangle: a low parapet and a merlon about every 3 m, on its outer edge
    const crenel = (list, x0, x1, z0, z1, y, m) => {
      const nx = Math.max(2, Math.round((x1 - x0) / 3.1)), nz = Math.max(2, Math.round((z1 - z0) / 3.1));
      for (let k = 0; k < nx; k++){ const x = x0 + (k + 0.5) * (x1 - x0) / nx; list.push(boxG(m, 1.9, 0.9, x, y + 0.95, z0 + 0.45), boxG(m, 1.9, 0.9, x, y + 0.95, z1 - 0.45)); }
      for (let k = 0; k < nz; k++){ const z = z0 + (k + 0.5) * (z1 - z0) / nz; list.push(boxG(0.9, 1.9, m, x0 + 0.45, y + 0.95, z), boxG(0.9, 1.9, m, x1 - 0.45, y + 0.95, z)); }
      list.push(span(x0, x1, y, y + 0.8, z0, z0 + 0.5), span(x0, x1, y, y + 0.8, z1 - 0.5, z1), span(x0, x0 + 0.5, y, y + 0.8, z0, z1), span(x1 - 0.5, x1, y, y + 0.8, z0, z1));
    };
    // a square tower: the shaft from below the ground, a cornice that juts out under its battlements, and arrow slits on the
    // two sides the city sees (west and south)
    const tower = (tx, tz, half, top) => {
      const x0 = cx + tx - half, x1 = cx + tx + half, z0 = cz + tz - half, z1 = cz + tz + half;
      towerG.push(span(x0, x1, low, top, z0, z1));
      capG.push(span(x0 - 0.35, x1 + 0.35, top - 0.6, top, z0 - 0.35, z1 + 0.35));
      crenel(towerG, x0 - 0.35, x1 + 0.35, z0 - 0.35, z1 + 0.35, top, 1.5);
      for (const y of [top - 5.5, top - 11]) slits.push(STONE.archPanel(0.45, 2.4, x0 - 0.06, y, cz + tz), STONE.archPanel(0.45, 2.4, cx + tx, y, z1 + 0.06, 1));
    };
    // the outer curtain: four walls with a walk on top
    const top = b + H;
    wallG.push(span(cx - W2, cx + W2, low, top, cz - D2, cz - D2 + 3), span(cx - W2, cx + W2, low, top, cz + D2 - 3, cz + D2), span(cx - W2, cx - W2 + 3, low, top, cz - D2, cz + D2), span(cx + W2 - 3, cx + W2, low, top, cz - D2, cz + D2));
    crenel(wallG, cx - W2, cx + W2, cz - D2, cz + D2, top, 1.6);
    for (const [tx, tz] of [[-W2, -D2], [W2, -D2], [-W2, D2], [W2, D2], [-13, D2], [13, D2], [-13, -D2], [13, -D2], [W2, 0]]) tower(tx, tz, 4.6, top + 7);
    // the gatehouse in the west wall: two towers and the gate between them, under a round arch
    for (const tz of [-7.5, 7.5]) tower(-W2 - 1.5, tz, 3.6, top + 9);
    wallG.push(span(cx - W2 - 4, cx - W2 + 3, low, top + 4, cz - 4, cz + 4));
    crenel(wallG, cx - W2 - 4, cx - W2 + 3, cz - 4, cz + 4, top + 4, 1.4);
    const gateY = Math.max(low + 2, hillSurf(cx - W2 - 6, cz) - 1);
    slits.push(STONE.archPanel(4.6, 7.2, cx - W2 - 4.07, gateY, cz));
    wallG.push(...STONE.archivolt(2.6, 0.3, cx - W2 - 4.1, gateY + 4.9, cz, 4.9));
    // the citadel inside, higher than the curtain, with its own towers, and the keep
    const kx = cx + 10, kw = 16, kd = 12, ktop = top + 6;
    wallG.push(span(kx - kw, kx + kw, low, ktop, cz - kd, cz - kd + 2.4), span(kx - kw, kx + kw, low, ktop, cz + kd - 2.4, cz + kd), span(kx - kw, kx - kw + 2.4, low, ktop, cz - kd, cz + kd), span(kx + kw - 2.4, kx + kw, low, ktop, cz - kd, cz + kd));
    crenel(wallG, kx - kw, kx + kw, cz - kd, cz + kd, ktop, 1.5);
    for (const [tx, tz] of [[-kw, -kd], [kw, -kd], [-kw, kd], [kw, kd], [0, kd], [0, -kd]]) tower(10 + tx, tz, 3.4, ktop + 6);
    tower(10 - kw + 5, 0, 4.4, ktop + 13);
    const stoneA = STONE.mat(0xf2d3a2, 0x8a6836), stoneB = STONE.mat(0xfbe0b4, 0x9a743c);
    grp.add(new THREE.Mesh(STONE.bond(mergeGeos(wallG)), stoneA), new THREE.Mesh(STONE.bond(mergeGeos(towerG)), stoneB), new THREE.Mesh(STONE.bond(mergeGeos(capG)), STONE.mat(0xfff0d0, 0xa88048)));
    grp.add(new THREE.Mesh(mergeGeos(slits), new THREE.MeshBasicMaterial({ color: 0x1a1108, side: THREE.DoubleSide, fog: false })));
    // the flag of Portugal on the keep: a green hoist and a red fly
    const fx = kx - kw + 5, fy = ktop + 13 + 1.9;
    grp.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 7, 6).translate(fx, fy + 3.5, cz), new THREE.MeshBasicMaterial({ color: 0xbfc2c8 })));
    grp.add(new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.4).rotateY(Math.PI / 2).translate(fx, fy + 5.7, cz + 0.75), new THREE.MeshBasicMaterial({ color: 0x1f6b3a, side: THREE.DoubleSide })));
    grp.add(new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.4).rotateY(Math.PI / 2).translate(fx, fy + 5.7, cz + 2.65), new THREE.MeshBasicMaterial({ color: 0xb3261e, side: THREE.DoubleSide })));
    // floodlights at the foot of the walls the city sees
    for (let k = -3; k <= 3; k++){ glowPts.push(cx - W2 - 7, hillSurf(cx - W2 - 7, cz + k * 8) + 1.5, cz + k * 8); glowPts.push(cx + k * 12, hillSurf(cx + k * 12, cz + D2 + 7) + 1.5, cz + D2 + 7); }
  }
  // Far across the water (no fog, or the night would swallow them): the south bank, Cristo Rei and the 25 de Abril bridge
  // ### Almada, the town on the south bank, after the real one: a quay along the water (Cacilhas and the Cais do Ginjal), a cliff
  // ### of ochre rock about 45 m high, and on top of it the town, white and pastel houses with terracotta roofs and a few
  // ### taller blocks in the centre, with lit windows at night. The land is one grid bent over southBank(x, z); it is lit like
  // ### everything else, so it is a dark shape with lights at night and shows its colours in the morning light of the finale. The
  // ### road of the bridge meets the top of the cliff at its south end.
  // ### QUAY: the top of the quay along the water, high enough above the river that the houses on it do not seem to stand in it
  const CRISTO = { x: -150, z: 748 }, BR_END = { x: -273, z: 736 }, QUAY = 4.2, shoreZ = x => 648 + 14 * Math.sin(x * 0.004 + 1);
  const southBank = (x, z) => {
    const d = z - shoreZ(x);
    if (d < 0) return -6;
    let top = 44 + 9 * Math.sin(x * 0.006) + 5 * Math.sin(x * 0.017 + 2);
    const wb = Math.exp(-((x - BR_END.x) ** 2 + (z - BR_END.z) ** 2) / 8100); top = top * (1 - wb) + 42.4 * wb;
    top += 15 * Math.exp(-((x - CRISTO.x) ** 2 + (z - CRISTO.z) ** 2) / 2000);
    const up = clamp((d - 36) / 44, 0, 1), rise = up * up * (3 - 2 * up);
    return QUAY + (top - QUAY) * rise - clamp((d - 260) / 300, 0, 1) * 12;
  };
  const bankGeo = new THREE.PlaneGeometry(2600, 370, 130, 62).rotateX(-Math.PI / 2).translate(0, 0, 815);
  {
    const P = bankGeo.attributes.position, col = new Float32Array(P.count * 3), c = new THREE.Color();
    const quay = C(0x6f6a62), rock = C(0x8a6f4c), grass = C(0x4c5a36), town = C(0x77705f);
    for (let i = 0; i < P.count; i++){
      const x = P.getX(i), z = P.getZ(i), h = southBank(x, z), slope = Math.abs(southBank(x, z + 5) - southBank(x, z - 5)) / 10;
      P.setY(i, h);
      const n = 0.5 + 0.5 * Math.sin(x * 0.031 + z * 0.047) * Math.sin(x * 0.011 - z * 0.019);
      if (h < QUAY + 0.8) c.copy(quay); else if (slope > 0.35) c.copy(rock).lerp(grass, 0.6 + n * 0.3); else c.copy(grass).lerp(town, n * 0.8);
      c.multiplyScalar(0.8 + 0.3 * n);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    bankGeo.setAttribute('color', new THREE.BufferAttribute(col, 3)); bankGeo.computeVertexNormals();
  }
  const farLit = o => new THREE.MeshLambertMaterial(Object.assign({ fog: false }, o));
  const bank = new THREE.Mesh(bankGeo, farLit({ vertexColors: true, emissive: 0x0a0c16 }));
  // ### The quay wall: a straight face of stone blocks out of the water, a little in front of the edge of the land (whose grid
  // ### would otherwise show as a muddy slope), darker and wet at the foot, with a pale coping and a paved walk along the top.
  {
    const pos = [], col = [], wet = C(0x4a4640), stone = C(0x8e877b), cope = C(0xc4bcac), walk = C(0xa69f92);
    const quad = (a, b, c, d, ca, cb) => { for (const [p, k] of [[a, ca], [b, ca], [c, cb], [a, ca], [c, cb], [d, cb]]){ pos.push(...p); col.push(k.r, k.g, k.b); } };
    for (let x = -1300; x < 1300; x += 8){
      const za = shoreZ(x) - 7, zb = shoreZ(x + 8) - 7;
      quad([x, -1.5, za], [x + 8, -1.5, zb], [x + 8, 0.6, zb], [x, 0.6, za], wet, stone);
      quad([x, 0.6, za], [x + 8, 0.6, zb], [x + 8, QUAY, zb], [x, QUAY, za], stone, stone);
      quad([x, QUAY, za], [x + 8, QUAY, zb], [x + 8, QUAY + 0.5, zb - 0.1], [x, QUAY + 0.5, za - 0.1], cope, cope);
      quad([x, QUAY + 0.5, za - 0.1], [x + 8, QUAY + 0.5, zb - 0.1], [x + 8, QUAY + 0.5, zb + 0.7], [x, QUAY + 0.5, za + 0.7], cope, cope);
      quad([x, QUAY + 0.06, za + 0.7], [x + 8, QUAY + 0.06, zb + 0.7], [x + 8, QUAY + 0.06, zb + 13], [x, QUAY + 0.06, za + 13], walk, walk);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    grp.add(new THREE.Mesh(g, farLit({ vertexColors: true, emissive: 0x0a0c16, side: THREE.DoubleSide })));
  }
  // ### The houses of Almada, three kinds, after the real town: small two-storey houses, town houses of three or four floors
  // ### with a shop or a door on the ground floor and iron balconies, and a few apartment blocks of eight floors with a balcony
  // ### band on every floor. Each kind has a facade painted once on a canvas (plinth, cornice, windows with stone frames and
  // ### shutters, doors, balconies) and a second picture of its lit windows, which glow at night. The walls are tinted per house
  // ### in the pastel colours of Lisbon. Houses and town houses carry a hipped tile roof with eaves, a ridge and a chimney; the
  // ### blocks a flat roof with a parapet and a lift house. Every kind is one instanced mesh, so 600 houses stay cheap.
  const bl = [];
  {
    const facade = (cols, floors, kind) => {
      const W = 64 * cols, H = 72 * floors + 12, cv = document.createElement('canvas'), lit = document.createElement('canvas');
      cv.width = lit.width = W; cv.height = lit.height = H;
      const g = cv.getContext('2d'), e = lit.getContext('2d'), r = mulberry32(cols * 31 + floors * 7);
      g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, W, H); e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
      // cornice under the roof, a stone plinth, and a band between the floors
      g.fillStyle = '#d9d4c8'; g.fillRect(0, 0, W, 9); g.fillStyle = '#b9b3a6'; g.fillRect(0, H - 9, W, 9);
      for (let fl = 0; fl < floors; fl++){
        const y0 = 12 + fl * 72, ground = fl === floors - 1;
        if (fl) { g.fillStyle = 'rgba(0,0,0,.07)'; g.fillRect(0, y0 - 2, W, 3); }
        for (let c = 0; c < cols; c++){
          const x0 = c * 64, door = ground && (kind === 'block' ? c === Math.floor(cols / 2) : c === (kind === 'house' ? 1 : 0));
          const shop = ground && kind === 'town' && c > 0 && c < cols - 1;
          const on = !door && r() < (kind === 'block' ? 0.34 : 0.3);
          if (door){
            g.fillStyle = '#cfc8b8'; g.fillRect(x0 + 17, y0 + 14, 30, 58 - 9);
            g.fillStyle = kind === 'block' ? '#2b3440' : ['#1f4a3a', '#5a2a22', '#243b5a'][Math.floor(r() * 3)]; g.fillRect(x0 + 21, y0 + 18, 22, 45);
            g.fillStyle = '#3a4756'; g.fillRect(x0 + 23, y0 + 20, 18, 10);
          } else if (shop){
            g.fillStyle = '#cfc8b8'; g.fillRect(x0 + 6, y0 + 16, 52, 47);
            g.fillStyle = '#26303c'; g.fillRect(x0 + 9, y0 + 24, 46, 36);
            g.fillStyle = ['#8f2d2a', '#2d5a46', '#b7892c'][Math.floor(r() * 3)]; g.fillRect(x0 + 6, y0 + 16, 52, 8);
            if (r() < 0.5){ e.fillStyle = '#ffd9a0'; e.fillRect(x0 + 9, y0 + 24, 46, 36); }
          } else {
            const tall = kind !== 'house' && !ground, wy = y0 + (tall ? 12 : 18), wh = tall ? 46 : 34;
            // stone frame, glass with glazing bars, and green shutters folded back on the small houses
            g.fillStyle = '#d6d0c2'; g.fillRect(x0 + 16, wy - 3, 32, wh + 6);
            g.fillStyle = on ? '#6b6f6a' : '#2a3442'; g.fillRect(x0 + 19, wy, 26, wh);
            g.fillStyle = '#e9e5da'; g.fillRect(x0 + 31, wy, 2, wh); g.fillRect(x0 + 19, wy + wh * 0.45, 26, 2);
            if (kind === 'house'){ g.fillStyle = '#35604c'; g.fillRect(x0 + 10, wy, 7, wh); g.fillRect(x0 + 47, wy, 7, wh); }
            if (on){ e.fillStyle = r() < 0.7 ? '#ffd28a' : '#cfe0ff'; e.fillRect(x0 + 19, wy, 26, wh); }
            // a balcony: a slab and an iron railing (a band right across on the blocks)
            if (tall && kind === 'town' && r() < 0.6){
              g.fillStyle = '#8f897c'; g.fillRect(x0 + 10, wy + wh + 2, 44, 4);
              g.strokeStyle = '#22262c'; g.lineWidth = 1.5; g.strokeRect(x0 + 11, wy + wh - 14, 42, 16);
              for (let k = 0; k < 7; k++){ g.beginPath(); g.moveTo(x0 + 14 + k * 6, wy + wh - 14); g.lineTo(x0 + 14 + k * 6, wy + wh + 2); g.stroke(); }
            }
          }
        }
        if (kind === 'block' && !ground){ g.fillStyle = '#c9c4b6'; g.fillRect(0, y0 + 50, W, 14); g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, y0 + 64, W, 3); }
      }
      const tex = c2 => { const t = new THREE.CanvasTexture(c2); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t; };
      return { map: tex(cv), emissiveMap: tex(lit) };
    };
    const KINDS = {
      house: { cols: 3, floors: 2, w: [8.5, 11], d: [7, 9], h: [6, 7], roof: true },
      town: { cols: 4, floors: 4, w: [10, 13], d: [8, 10.5], h: [12, 14], roof: true },
      block: { cols: 6, floors: 8, w: [16, 20], d: [10, 13], h: [23, 26], roof: false }
    };
    // a hipped roof on a 1 x 1 footprint, 1 high: eaves that stand out, four tiled slopes up to a ridge, and a chimney
    const hip = (() => {
      const E = 0.56, R = 0.2, v = [[-E, 0, -E], [E, 0, -E], [E, 0, E], [-E, 0, E], [-R, 1, 0], [R, 1, 0]];
      const tri = [[0, 4, 5], [0, 5, 1], [2, 5, 4], [2, 4, 3], [1, 5, 2], [3, 4, 0], [0, 1, 2], [0, 2, 3]], pos = [];
      tri.forEach(t => t.forEach(i => pos.push(...v[i])));
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2)); g.computeVertexNormals();
      return mergeGeos([g, boxG(0.09, 0.5, 0.12, 0.26, 0.75, 0.12)]);
    })();
    // the flat roof of a block: a parapet all round and the lift house
    const flat = mergeGeos([boxG(1.0, 0.5, 0.04, 0, 0.25, 0.48), boxG(1.0, 0.5, 0.04, 0, 0.25, -0.48), boxG(0.03, 0.5, 1.0, 0.485, 0.25, 0), boxG(0.03, 0.5, 1.0, -0.485, 0.25, 0), boxG(0.22, 1.0, 0.3, 0.2, 0.5, 0.1)]);
    const WALLS = [0xf2ede2, 0xead9bd, 0xf3dc9c, 0xe6bfa3, 0xcdd9e6, 0xefc7b8, 0xc9dcc9, 0xe9e2d2], ROOFS = [0xb5573a, 0xa84e36, 0xc0623f, 0x9c4a3a];
    const spots = { house: [], town: [], block: [] };
    const bdx = Math.cos(1.2), bdz = Math.sin(1.2); // the direction of the bridge on the ground
    // the town is laid out on a grid of 13 m plots: a plot holds one house (a block takes its neighbours too), so no two
    // houses stand in each other, and the plots left over are gardens and trees
    const taken = new Set(), plot = (x, z) => Math.round(x / 13) + ',' + Math.round(z / 13);
    const free = (x, z, r) => { for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if (taken.has(plot(x + i * 13, z + j * 13))) return false; return true; };
    const claim = (x, z, r) => { for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) taken.add(plot(x + i * 13, z + j * 13)); };
    const clear = (x, z, margin) => {
      const along = (x + 400) * bdx + (z - 410) * bdz, off = Math.abs(-(x + 400) * bdz + (z - 410) * bdx);
      return !(off < margin && along < 420) && Math.hypot(x - CRISTO.x, z - CRISTO.z) >= 44;
    };
    let n = 0;
    for (let tries = 0; tries < 30000 && n < 1250; tries++){
      const water = rng() < 0.14, centre = rng() < 0.6;
      const x0 = centre ? -120 + (rng() + rng() - 1) * 640 : (rng() - 0.5) * 2400;
      const shore = shoreZ(x0), z0 = shore + (water ? 18 + rng() * 12 : 92 + rng() * (centre ? 235 : 200));
      // on the plot grid, so the houses line up along streets
      const x = Math.round(x0 / 13) * 13, z = water ? z0 : Math.round(z0 / 13) * 13;
      // keep the bridge's way and the hill of the statue free
      if (!clear(x, z, 26)) continue;
      const kind = water ? 'house' : centre ? (rng() < 0.045 ? 'block' : rng() < 0.5 ? 'town' : 'house') : (rng() < 0.2 ? 'town' : 'house');
      const r = kind === 'block' ? 1 : 0;
      if (!free(x, z, r)) continue;
      claim(x, z, r);
      const K = KINDS[kind], pick = ([lo, hi]) => lo + rng() * (hi - lo);
      // streets run along the river, so most houses stand square to it
      spots[kind].push({ x, z, y: southBank(x, z) - 0.6, w: pick(K.w), d: pick(K.d), h: pick(K.h), rot: (rng() < 0.8 ? 0 : Math.PI / 2) + (rng() - 0.5) * 0.08 });
      n++;
    }
    // ### Trees: umbrella pines and dark cypresses, as on the real hillside. They cover the cliff under the town, stand in the
    // ### plots between the houses and along the quay, and thin out towards the back. Crowns and trunks are two instanced meshes.
    {
      const tmp = new THREE.Object3D(), tc = new THREE.Color();
      const NT = 3600, crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), farLit({ color: 0xffffff, emissive: 0x04070a, flatShading: true }), NT);
      const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.7, 1, 6).translate(0, 0.5, 0), farLit({ color: 0x4a3a2c, emissive: 0x050403 }), NT);
      const GREENS = [0x3f6b3a, 0x4d7a3e, 0x35582f, 0x5a8546, 0x2f4f33];
      let t = 0;
      for (let tries = 0; tries < 60000 && t < NT; tries++){
        const slope = rng() < 0.58, x = (rng() - 0.5) * 2500, shore = 648 + 14 * Math.sin(x * 0.004 + 1);
        const z = shore + (slope ? 34 + rng() * 52 : rng() < 0.06 ? 5 + rng() * 6 : 88 + rng() * 250);
        if (!clear(x, z, 16) || (!slope && taken.has(plot(x, z)))) continue;
        const y = southBank(x, z) - 0.3, cypress = rng() < 0.22, th = cypress ? 1.5 : 3 + rng() * 3.5, cw = cypress ? 1.1 + rng() * 0.5 : 2.6 + rng() * 2.2, chh = cypress ? 4.5 + rng() * 3 : cw * (0.5 + rng() * 0.2);
        tmp.position.set(x, y, z); tmp.rotation.set(0, rng() * 6.28, 0); tmp.scale.set(cypress ? 0.5 : 0.6, th, cypress ? 0.5 : 0.6); tmp.updateMatrix(); trunks.setMatrixAt(t, tmp.matrix);
        tmp.position.y = y + th + chh * 0.7; tmp.scale.set(cw, chh, cw); tmp.updateMatrix(); crowns.setMatrixAt(t, tmp.matrix);
        crowns.setColorAt(t, tc.setHex(cypress ? 0x24402c : GREENS[Math.floor(rng() * GREENS.length)]).multiplyScalar(0.85 + rng() * 0.3));
        t++;
      }
      crowns.count = t; trunks.count = t; crowns.frustumCulled = false; trunks.frustumCulled = false;
      grp.add(crowns, trunks);
    }
    const tmp = new THREE.Object3D(), tc = new THREE.Color();
    for (const kind of Object.keys(KINDS)){
      const K = KINDS[kind], list = spots[kind], F = facade(K.cols, K.floors, kind);
      const wall = farLit({ color: 0xffffff, map: F.map, emissive: 0xffffff, emissiveMap: F.emissiveMap, emissiveIntensity: 0.9 }), plain = farLit({ color: 0xd8d2c4, emissive: 0x08090c });
      const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), [wall, wall, plain, plain, wall, wall], list.length);
      const roofs = new THREE.InstancedMesh(K.roof ? hip : flat, farLit({ color: 0xffffff, emissive: 0x0c0605 }), list.length);
      list.forEach((p, i) => {
        tmp.position.set(p.x, p.y, p.z); tmp.rotation.y = p.rot; tmp.scale.set(p.w, p.h, p.d); tmp.updateMatrix();
        walls.setMatrixAt(i, tmp.matrix); walls.setColorAt(i, tc.setHex(WALLS[Math.floor(rng() * WALLS.length)]));
        tmp.position.y = p.y + p.h; tmp.scale.set(p.w, K.roof ? 2.2 + rng() * 1.2 : 2.4, p.d); tmp.updateMatrix();
        roofs.setMatrixAt(i, tmp.matrix); roofs.setColorAt(i, K.roof ? tc.setHex(ROOFS[Math.floor(rng() * ROOFS.length)]) : tc.setHex(0xbcb6a8));
        // a street lamp in front of some houses, on the side that faces Lisbon
        if (rng() < 0.3) bl.push(p.x + (rng() - 0.5) * p.w, p.y + 5, p.z - p.d / 2 - 2.5);
      });
      walls.frustumCulled = false; roofs.frustumCulled = false;
      grp.add(walls, roofs);
    }
    // lamps along the quay
    for (let x = -1100; x < 1100; x += 34) bl.push(x, 5.5, 652 + 14 * Math.sin(x * 0.004 + 1));
  }
  // ### Cristo Rei, after the real monument above Almada (1959): a base building, then the tall pedestal of four slender pillars
  // ### that lean together and are joined near the top by arches under a platform, and on it the statue of Christ in a long
  // ### robe with both arms held out wide, facing Lisbon. Pale concrete, floodlit at night.
  const cristo = new THREE.Group();
  {
    const stone = farLit({ color: 0xe2ddd0, emissive: 0x4f5058 }), shade = farLit({ color: 0xbdb7a8, emissive: 0x3a3b42 });
    const PH = 56, W0 = 8.2, W1 = 5.6, T = 2.5, parts = [], dark = [];
    // one face of the pedestal: two leaning pillars and the arch that joins them, as a flat shape with a tall arched opening
    const face = () => {
      const sh = new THREE.Shape();
      sh.moveTo(-W0, 0); sh.lineTo(W0, 0); sh.lineTo(W1, PH); sh.lineTo(-W1, PH); sh.closePath();
      const hole = new THREE.Path(), a0 = W0 - T, a1 = W1 - T * 0.8, yA = PH - 11;
      hole.moveTo(-a0, 0); hole.lineTo(-a1, yA); hole.absarc(0, yA, a1, Math.PI, 0, true); hole.lineTo(a0, 0); hole.closePath();
      sh.holes.push(hole);
      return new THREE.ExtrudeGeometry(sh, { depth: T, bevelEnabled: false, curveSegments: 10 });
    };
    for (let k = 0; k < 4; k++){
      // each face leans in with the pillars: it stands on the edge of the base and tilts towards the middle
      const g = face(); g.translate(0, 0, -T / 2); g.rotateX(-Math.atan2(W0 - W1, PH)); g.translate(0, 0, W0 - T / 2); g.rotateY(k * Math.PI / 2);
      parts.push(g);
    }
    // the platform with its rim, and the base building with a door towards the river
    parts.push(boxG(2 * W1 + 3, 1.6, 2 * W1 + 3, 0, PH + 0.8, 0), boxG(2 * W1 + 1.2, 1.4, 2 * W1 + 1.2, 0, PH + 2.3, 0));
    dark.push(boxG(30, 7, 24, 0, -3.5, 0), boxG(34, 1.2, 28, 0, -7.6, 0), boxG(2 * W1 + 3.6, 0.5, 2 * W1 + 3.6, 0, PH + 0.1, 0));
    // the statue, 22 m: robe from the feet to the shoulders, neck and head, hair, and the two arms with wide sleeves and open hands
    const Y = PH + 3, st = [];
    st.push(loft([[0, Y, 0, 2.3, 1.7], [0, Y + 3, 0, 2.05, 1.5], [0, Y + 8, 0, 1.85, 1.3], [0, Y + 12.5, 0.1, 2.0, 1.35], [0, Y + 15.6, 0.1, 2.75, 1.4], [0, Y + 17.0, 0, 2.5, 1.25], [0, Y + 17.9, 0, 0.9, 0.8]], 18));
    st.push(limbLoft([0, Y + 17.4, 0], [0, Y + 18.7, 0], [0.62, 0.55, 0.55], 10), ball([0, Y + 19.9, -0.08], 1.12, 0.84, 1.08, 0.92));
    st.push(ball([0, Y + 20.1, 0.22], 1.2, 0.9, 1.0, 0.85), ball([0, Y + 18.9, 0.5], 1.0, 1.0, 1.3, 0.6));
    for (const sd of [-1, 1]){
      st.push(loft([[sd * 2.2, Y + 16.4, 0, 1.0, 1.15], [sd * 4.6, Y + 16.6, 0, 0.95, 1.0], [sd * 7.2, Y + 16.5, -0.1, 0.9, 1.05], [sd * 8.6, Y + 16.3, -0.15, 0.55, 0.9]], 12));
      // the sleeve hangs down from the forearm; the hand is open, palm to the front
      st.push(loft([[sd * 5.2, Y + 16.2, 0, 0.5, 0.75], [sd * 6.6, Y + 13.9, 0, 0.6, 0.55], [sd * 8.1, Y + 15.9, 0, 0.3, 0.6]], 8));
      st.push(ball([sd * 9.5, Y + 16.3, -0.2], 0.62, 1.35, 0.55, 1.0));
    }
    // folds of the robe down the front, and the mantle over the left shoulder
    for (const x of [-1.1, -0.35, 0.4, 1.15]) st.push(limb([x, Y + 0.3, -1.45], [x * 0.75, Y + 12, -1.2], 0.22, 0.16, 5));
    st.push(limb([1.9, Y + 16.6, -0.9], [-1.3, Y + 9.5, -1.35], 0.5, 0.35, 6));
    const body = new THREE.Mesh(mergeGeos(parts.concat(st)), stone), base = new THREE.Mesh(mergeGeos(dark), shade);
    cristo.add(body, base);
    cristo.position.set(CRISTO.x, southBank(CRISTO.x, CRISTO.z) + 7, CRISTO.z);
    // floodlights at its foot and the glow on the statue at night
    for (const [dx, dz] of [[-12, -10], [12, -10], [0, -14]]) bl.push(CRISTO.x + dx, cristo.position.y + 1, CRISTO.z + dz);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xfff0d0, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    halo.scale.set(70, 70, 1); halo.position.y = PH + 13; cristo.add(halo);
  }
  // ### The 25 de Abril bridge, after the real one (a suspension bridge built in 1966, painted red): two towers on concrete
  // ### foundations in the river, each with two legs joined by cross beams at four heights; two main cables, one over each edge
  // ### of the deck, hanging between the towers and running down to the anchor blocks at both ends; a hanger every 10 m from
  // ### each cable to the deck; under the six-lane road a deep steel truss (top and bottom chords, posts and diagonals) with the
  // ### lower deck of the railway inside it; concrete piers under the side spans; lamps on both sides and red warning lights on
  // ### the towers. The steel is lit like everything else (it catches the morning light in the finale), with a faint glow of its
  // ### own so the night does not swallow it from the city. Shorter than the real one (main span 300 m instead of 1013 m), so it
  // ### fits the view. x runs along the bridge, z across it, y is up; the road surface is at y = 42.12.
  // ### The concrete of the piers: the colour of the viaduct, darker towards the water (the bottom 18 m), as the foot of a real
  // ### pier is wet and dirty, which also shows how tall they are. parts are geometries or flat lists of triangle corners.
  // ### A block whose corners are chamfered by c and whose walls may lean in: w0 x d0 at y0, w1 x d1 at y1, centred on x (along
  // ### the bridge) and z = 0. It goes into list as plain triangle corners, each face turned outwards, for pierMesh.
  const chamfered = (list, x, w0, d0, w1, d1, c, y0, y1) => {
    const ring = (w, d, y) => { const a = w / 2, b = d / 2, k = Math.min(c, a, b); return [[a, -b + k], [a, b - k], [a - k, b], [-a + k, b], [-a, b - k], [-a, -b + k], [-a + k, -b], [a - k, -b]].map(([px, pz]) => [x + px, y, pz]); };
    const lo = ring(w0, d0, y0), hi = ring(w1, d1, y1), my = (y0 + y1) / 2;
    const tri = (p, q, r) => {
      const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const o = [(p[0] + q[0] + r[0]) / 3 - x, (p[1] + q[1] + r[1]) / 3 - my, (p[2] + q[2] + r[2]) / 3];
      list.push(...p, ...(n[0] * o[0] + n[1] * o[1] + n[2] * o[2] < 0 ? [...r, ...q] : [...q, ...r]));
    };
    for (let i = 0; i < 8; i++){ const j = (i + 1) % 8; tri(lo[i], lo[j], hi[j]); tri(lo[i], hi[j], hi[i]); }
    for (let i = 1; i < 7; i++){ tri(hi[0], hi[i], hi[i + 1]); tri(lo[0], lo[i], lo[i + 1]); }
  };
  const pierMesh = parts => {
    const pos = [];
    for (const g of parts){ if (g.isBufferGeometry){ const a = (g.index ? g.toNonIndexed() : g).attributes.position.array; for (let i = 0; i < a.length; i++) pos.push(a[i]); } else pos.push(g); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
    const col = [];
    for (let i = 1; i < pos.length; i += 3){ const k = 0.55 + 0.45 * sstep(0, 18, pos[i]); col.push(k, k * 0.98, k * 0.95); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x9a968e, roughness: 0.88, emissive: 0x101010, vertexColors: true, fog: false }));
  };
  const bridge = new THREE.Group();
  {
    const TX = 150, HALF = 350, CZ = 9.5, ROAD = 42.12, TOP = 41.6, BOT = 35.6, TRUSS_Z = 8;
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xb4422a, roughness: 0.55, metalness: 0.35, emissive: 0x2a0b05, fog: false });
    const concreteMat = new THREE.MeshStandardMaterial({ color: 0x8d8a84, roughness: 0.9, emissive: 0x101010, fog: false });
    const bar = (a, b, r) => limb(a, b, r, r, 6);
    // the main cable: a parabola from tower top (112 m) down to 4 m above the road in the middle; then straight-ish to the anchors
    const cableY = x => Math.abs(x) <= TX ? 46.5 + 65.5 * (x / TX) ** 2 : 112 - (Math.abs(x) - TX) / (HALF - TX) * 66 - Math.sin(Math.PI * (Math.abs(x) - TX) / (HALF - TX)) * 5;
    const steel = [], concrete = [];
    for (const tx of [-TX, TX]){
      for (const z of [-CZ, CZ]) steel.push(limb([tx, 0, z], [tx, 116, z], 3.0, 2.2, 8));
      for (const [y, h] of [[29, 4], [70, 3.5], [92, 3.5], [113, 3]]) steel.push(boxG(4.5, h, 2 * CZ + 3, tx, y, 0));
      concrete.push(boxG(16, 7, 2 * CZ + 10, tx, 1.5, 0));
    }
    for (const z of [-CZ, CZ]){
      for (let x = -HALF; x < HALF; x += 10) steel.push(bar([x, cableY(x), z], [x + 10, cableY(x + 10), z], 0.55));
      for (let x = -HALF + 10; x < HALF; x += 10) if (Math.abs(Math.abs(x) - TX) > 3) steel.push(bar([x, cableY(x), z], [x, TOP + 0.6, z > 0 ? TRUSS_Z : -TRUSS_Z], 0.09));
    }
    // the truss girder: chords along both edges, a post every 10 m and a diagonal in between, cross beams and the railway deck
    for (const z of [-TRUSS_Z, TRUSS_Z]){
      steel.push(boxG(2 * HALF, 0.7, 0.7, 0, TOP, z), boxG(2 * HALF, 0.7, 0.7, 0, BOT, z));
      for (let x = -HALF; x < HALF; x += 10){
        steel.push(boxG(0.45, TOP - BOT, 0.45, x, (TOP + BOT) / 2, z));
        steel.push(bar([x, BOT, z], [x + 5, TOP, z], 0.18), bar([x + 5, TOP, z], [x + 10, BOT, z], 0.18));
      }
    }
    for (let x = -HALF; x <= HALF; x += 10) steel.push(boxG(0.5, 0.5, 2 * TRUSS_Z, x, BOT, 0));
    steel.push(boxG(2 * HALF, 0.4, 2 * TRUSS_Z - 4, 0, BOT + 0.6, 0));
    // ### Concrete piers under the side spans, like those of the approach: two octagonal columns on a footing in the river,
    // ### narrowing towards a cap under the truss, joined by two cross beams (pierMesh darkens them towards the water). And the
    // ### anchor blocks that hold the cables at the ends.
    const piers = [];
    for (const sx of [-1, 1]){
      for (const px of [215, 265]){
        const x = sx * px;
        piers.push(boxG(7, 2.4, 2 * TRUSS_Z + 5, x, 0.6, 0));
        for (const z of [-5.6, 5.6]) piers.push(new THREE.CylinderGeometry(1.5, 2.0, BOT - 2.6, 8).rotateY(Math.PI / 8).translate(x, (BOT - 2.6) / 2, z));
        piers.push(boxG(4.4, 2.2, 2 * TRUSS_Z + 2, x, BOT - 1.5, 0));
        for (const y of [BOT * 0.36, BOT * 0.7]) piers.push(boxG(2.4, 1.6, 9.2, x, y, 0));
      }
      // ### The anchor block ends under the road, which runs on over it; the cables go into a saddle on each side. After the real
      // ### anchorage it is a mass of concrete that steps in twice as it rises: three tiers whose walls lean in a little, with
      // ### chamfered corners, a band at each step, a footing and plinth below and a flared cornice under the road. It darkens
      // ### towards the water like the piers.
      const ax = sx * (HALF + 8), AW = 2 * CZ + 8;
      for (const [w0, d0, w1, d1, c, y0, y1] of [
        [30, AW + 8, 30, AW + 8, 2.4, 0, 3], [27, AW + 5, 26, AW + 4, 2.4, 3, 6],
        [24, AW + 2, 23, AW + 1, 2.2, 6, 18], [23.8, AW + 1.8, 23.8, AW + 1.8, 2.2, 18, 18.8],
        [22.4, AW + 0.4, 21.6, AW - 0.4, 2, 18.8, 30], [22.4, AW + 0.4, 22.4, AW + 0.4, 2, 30, 30.8],
        [21, AW - 1, 20.4, AW - 1.6, 1.8, 30.8, 39.6], [20.4, AW - 1.6, 23, AW + 1, 1.8, 39.6, 40.6], [23, AW + 1, 23, AW + 1, 1.8, 40.6, 41.4]
      ]) chamfered(piers, ax, w0, d0, w1, d1, c, y0, y1);
      for (const z of [-CZ, CZ]) concrete.push(boxG(9, 6, 2.6, sx * (HALF + 3), 44, z));
    }
    bridge.add(new THREE.Mesh(mergeGeos(steel), steelMat), new THREE.Mesh(mergeGeos(concrete), concreteMat), pierMesh(piers));
    // the road: six lanes on a deck slab, dashed lane lines, a solid edge line, a concrete barrier in the middle, steel railings
    const deckRoad = new THREE.Mesh(new THREE.BoxGeometry(2 * HALF, 0.5, 2 * TRUSS_Z + 1).translate(0, ROAD - 0.25, 0), new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.9 }));
    const lines = [];
    for (let x = -HALF + 5; x < HALF; x += 9) for (const z of [-5.27, -2.93, 2.93, 5.27]) lines.push(boxG(4.5, 0.02, 0.14, x, ROAD + 0.01, z));
    for (const z of [-7.6, -0.6, 0.6, 7.6]) lines.push(boxG(2 * HALF, 0.02, 0.14, 0, ROAD + 0.01, z));
    const deckLines = new THREE.Mesh(mergeGeos(lines), new THREE.MeshStandardMaterial({ color: 0xd8dbe4, roughness: 0.7 }));
    const barrier = new THREE.Mesh(mergeGeos([boxG(2 * HALF, 0.8, 0.5, 0, ROAD + 0.4, 0), boxG(2 * HALF, 0.12, 0.8, 0, ROAD + 0.06, 0)]), new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: 0.85 }));
    const rails = [];
    for (const z of [-8.3, 8.3]){
      rails.push(boxG(2 * HALF, 0.08, 0.1, 0, ROAD + 1.0, z), boxG(2 * HALF, 0.06, 0.08, 0, ROAD + 0.5, z));
      for (let x = -HALF + 1; x <= HALF; x += 3) rails.push(boxG(0.08, 1.0, 0.08, x, ROAD + 0.5, z));
    }
    // a lamp every 30 m on each side: a post with an arm over the road
    const posts = [], lamps = [];
    for (let x = -HALF + 15; x < HALF; x += 30) for (const s of [-1, 1]){
      posts.push(boxG(0.2, 8, 0.2, x, ROAD + 4, s * 8.6), boxG(0.14, 0.14, 1.6, x, ROAD + 7.9, s * 7.9));
      lamps.push(x, ROAD + 7.7, s * 7.2);
    }
    const deckRails = new THREE.Mesh(mergeGeos(rails.concat(posts)), new THREE.MeshStandardMaterial({ color: 0x8e3a26, roughness: 0.5, metalness: 0.4 }));
    bridge.add(deckRoad, deckLines, barrier, deckRails);
    CITY.bridge = bridge;
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lamps, 3));
    bridge.add(new THREE.Points(lg, new THREE.PointsMaterial({ map: glowTexture, color: 0xffcf8c, size: 5, sizeAttenuation: true, transparent: true, opacity: LAMP_HALO, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute([-TX, 116.5, -CZ, -TX, 116.5, CZ, TX, 116.5, -CZ, TX, 116.5, CZ, -TX, 70, -CZ - 1.6, TX, 70, CZ + 1.6], 3));
    bridge.add(new THREE.Points(rg, new THREE.PointsMaterial({ map: glowTexture, color: 0xff3344, size: 9, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
    bridge.position.set(-400, 0, 410); bridge.rotation.y = -1.2;
  }
  // ### The way up to the bridge, after the real one: the north approach of the 25 de Abril bridge is a concrete viaduct on
  // ### tall twin piers that carries the six lanes from the low streets by the river up to the deck, 42 m above the ground. Here
  // ### it starts behind the golden gate at the south-west corner of the Baixa, runs west along the river, passes under the side
  // ### span of the bridge, and climbs round in a loop to meet the deck at the north anchorage. The loop is banked towards its
  // ### inside, like a fast motorway curve. It lies outside the force field, so you only drive on it in the finale: through the
  // ### gate you drive it up to the deck yourself (CITY.approach, updateRamp).
  {
    const DECK = 42.12, R = 50, X0 = -144, Z0 = 144, bdx = Math.cos(1.2), bdz = Math.sin(1.2);
    const N = { x: -400 - 350 * bdx, z: 410 - 350 * bdz };  // the north end of the bridge deck
    // straight west from the gate, a right-hand loop of 249 degrees, then a few metres straight onto the deck
    const tEnd = (N.z - Z0 + R * (1 + bdx)) / bdz, ax = N.x - tEnd * bdx - R * bdz, cz = Z0 - R;
    const L1 = X0 - ax, L2 = L1 + R * (Math.PI + 1.2), LEN = L2 + tEnd;
    // the climb: gentle at both ends, an even 8 % in between
    const rise = s => { const e = 0.2, u = clamp((s - 12) / (LEN - 24), 0, 1); return DECK * (u < e ? u * u / (2 * e * (1 - e)) : u > 1 - e ? 1 - (1 - u) ** 2 / (2 * e * (1 - e)) : (u - e / 2) / (1 - e)); };
    // the bank of the loop: the road falls 9 cm per metre towards the inside (the right), easing in and out at both ends; it is
    // level again where the loop ends, so the road meets the flat bridge deck without a step
    const BANK = 0.09, bank = s => BANK * sstep(L1 - 25, L1 + 25, s) * (1 - sstep(L2 - 45, L2, s));
    // a point on the approach: s is metres from the gate along the middle of the road, side is metres to the right of it
    const at = (s, side = 0) => {
      s = clamp(s, 0, LEN);
      let x, z, h;
      if (s <= L1){ x = X0 - s; z = Z0; h = -Math.PI / 2; }
      else if (s <= L2){ const th = (s - L1) / R; x = ax - R * Math.sin(th); z = cz + R * Math.cos(th); h = Math.atan2(-Math.cos(th), -Math.sin(th)); }
      else { const k = LEN - s; x = N.x - k * bdx; z = N.z - k * bdz; h = Math.atan2(bdx, bdz); }
      return { x: x - Math.cos(h) * side, z: z + Math.sin(h) * side, y: rise(s) - side * bank(s), h, slope: (rise(s + 1) - rise(s - 1)) / 2, bank: bank(s) };
    };
    // half the width of the road: as wide as the river avenue at the gate, as wide as the bridge deck further up
    const hw = s => 7 + 1.5 * sstep(8, 60, s);
    CITY.approach = { len: LEN, at, hw };
    // where the loop begins: the finale cuts from the river straight to here (see RAMP_CUT)
    CITY.approach.loop = L1;
    // pulls a cross-section ([side, up] points, up measured from the road) along the road and returns the triangles
    const sweep = (out, s0, s1, step, section, open) => {
      let prev = null;
      for (let s = s0; ; s = Math.min(s1, s + step)){
        const ring = section(s).map(([side, up]) => { const p = at(s, side); return [p.x, p.y + up, p.z]; });
        if (prev) for (let i = 0; i < ring.length - (open ? 1 : 0); i++){ const j = (i + 1) % ring.length; out.push(...prev[i], ...prev[j], ...ring[j], ...prev[i], ...ring[j], ...ring[i]); }
        prev = ring; if (s >= s1) break;
      }
    };
    const solid = (out, g) => { const a = g.toNonIndexed().attributes.position.array; for (let i = 0; i < a.length; i++) out.push(a[i]); };
    const mesh = (pos, mat) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return new THREE.Mesh(g, mat); };
    const concrete = [], road = [], lines = [], lamps = [];
    // the box girder with the road on top, a concrete parapet on each side and a barrier in the middle
    sweep(concrete, 8, LEN, 2.5, s => { const w = hw(s); return [[-w, 0], [w, 0], [w, -0.5], [w - 3, -2], [3 - w, -2], [-w, -0.5]]; });
    sweep(road, 8, LEN, 2.5, s => [[0.4 - hw(s), 0.03], [hw(s) - 0.4, 0.03]], true);
    for (const sg of [-1, 1]) sweep(concrete, 8, LEN, 2.5, s => { const w = hw(s) * sg; return [[w - 0.35 * sg, 0], [w, 0], [w, 0.95], [w - 0.35 * sg, 0.95]]; });
    sweep(concrete, 90, LEN, 2.5, () => [[-0.25, 0], [0.25, 0], [0.25, 0.8], [-0.25, 0.8]]);
    // ### The markings of the bridge deck: solid lines at the edges and in the middle, dashes between the lanes. They start right
    // ### at the gate, so the lanes are there from the first metre (before the barrier begins at 90 m, the middle line
    // ### runs on its own). Where the road is narrower, by the gate, the three lanes share its width evenly.
    const stripe = (s0, s1, side) => sweep(lines, s0, s1, 1.5, () => [[side - 0.07, 0.05], [side + 0.07, 0.05]], true);
    for (const sg of [-1, 1]){
      sweep(lines, 0, LEN, 2.5, s => { const c = (hw(s) - 0.9) * sg; return [[c - 0.07, 0.05], [c + 0.07, 0.05]]; }, true);
      stripe(0, LEN, 0.6 * sg);
      for (let s = 1; s < LEN - 5; s += 9){ const e = (hw(s) - 1.5) / 3; for (const c of [0.6 + e, 0.6 + 2 * e]) stripe(s, s + 4.5, c * sg); }
    }
    // ### A pair of piers every 36 m: octagonal concrete columns that narrow a little towards the top, each on a footing at the
    // ### water, with a hammerhead cap under the girder (its ends chamfered) and a cross beam half-way up the tall ones. They
    // ### go into piers, which darkens towards the water (pierMesh), as the foot of a real pier is wet and dirty.
    const piers = [];
    for (let s = 70; s < LEN - 24; s += 36){
      const p = at(s); if (p.y < 4.5) continue;
      const put = (g, side, y) => { const q = at(s, side); solid(piers, g.rotateY(p.h).translate(q.x, y, q.z)); };
      const top = p.y - 2.9, thick = 1.05 + Math.min(0.45, p.y / 90);
      for (const side of [-4.6, 4.6]){
        put(new THREE.CylinderGeometry(thick * 0.82, thick, top, 8).rotateY(Math.PI / 8), side, top / 2);
        put(new THREE.BoxGeometry(thick * 2.6, 1.2, thick * 2.6), side, 0.4);
      }
      put(new THREE.BoxGeometry(9.6, 1.4, 2.8), 0, p.y - 2.4);
      for (const sd of [-1, 1]) put(new THREE.BoxGeometry(1.8, 0.8, 2.8), sd * 5.7, p.y - 2.1);
      if (p.y > 20) put(new THREE.BoxGeometry(9.2, 1.1, 1.5), 0, p.y * 0.5);
    }
    // lamps as on the bridge: a post with an arm over the road, every 30 m on both sides
    for (let s = 45; s < LEN - 25; s += 30) for (const sg of [-1, 1]){
      const p = at(s), w = hw(s), a = at(s, sg * (w + 0.1)), b = at(s, sg * (w - 0.6)), c = at(s, sg * (w - 1.3));
      solid(concrete, new THREE.BoxGeometry(0.2, 8, 0.2).translate(a.x, a.y + 4, a.z));
      solid(concrete, new THREE.BoxGeometry(1.6, 0.14, 0.14).rotateY(p.h).translate(b.x, b.y + 7.9, b.z));
      lamps.push(c.x, c.y + 7.7, c.z);
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lamps, 3));
    grp.add(mesh(concrete, new THREE.MeshStandardMaterial({ color: 0x8d8a84, roughness: 0.9, emissive: 0x101010, side: THREE.DoubleSide, fog: false })),
      pierMesh(piers),
      mesh(road, new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.9, side: THREE.DoubleSide, fog: false })),
      mesh(lines, new THREE.MeshStandardMaterial({ color: 0xd8dbe4, roughness: 0.7, side: THREE.DoubleSide, fog: false })),
      new THREE.Points(lg, new THREE.PointsMaterial({ map: glowTexture, color: 0xffcf8c, size: 5, sizeAttenuation: true, transparent: true, opacity: LAMP_HALO, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
  }
  const blg =new THREE.BufferGeometry(); blg.setAttribute('position', new THREE.Float32BufferAttribute(bl, 3));
  grp.add(bank, cristo, bridge, new THREE.Points(blg, new THREE.PointsMaterial({ map: glowTexture, color: 0xffd9a0, size: 4.6, sizeAttenuation: true, transparent: true, opacity: LAMP_HALO, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));

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
      // each parked car keeps its collider box and radar block, so a push (see pushParked) moves them with it
      const hx = axis === 'x' ? 2.3 : 0.95, hz = axis === 'x' ? 0.95 : 2.3;
      const pc = { x, z, h: (axis === 'x' ? Math.PI / 2 : 0) + (rng() < 0.5 ? Math.PI : 0), suv: rng() < 0.3, hx, hz };
      pc.col = { t: 'p', x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, car: pc };
      pc.rr = { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, c: 'rgba(255,255,255,.3)' };
      resetShove(pc); parked.push(pc); colliders.push(pc.col); radarRects.push(pc.rr);
    }
  }
  for (const suv of [false, true]){
    const list = parked.filter(p => p.suv === suv);
    const f = new Fleet(grp, suv ? PARTS.suv : PARTS.sedan, list.length, rng);
    list.forEach((p, i) => { p.fleet = f; p.i = i; f.set(i, p.x, 0, p.z, p.h, true); });
    f.commit();
  }
  CITY.parked = parked;

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
  add(pools.mesh(lampPool()), false, false);
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
  grp.add(new THREE.Points(pg, lampHalo(1.8)));

  const tTrunk = treeTrunk(3.0, 0.24, 3, 11), tCrown = treeCrown(7, 1, 1.45, 3.9, 12);
  // ### Places one tree, unless it would stand on a road or in a building.
  const placeTree = (o, d) => { d.position.set(o.x, 0.3, o.z); d.rotation.set(0, o.rot, 0); d.scale.setScalar(o.s); };
  instanced(grp, tTrunk, barkMat(), trees, placeTree);
  instanced(grp, tCrown, leafMat(), trees, placeTree, (o, t) => t.set(0x427a48).offsetHSL((o.v - 0.5) * 0.08, (o.v - 0.5) * 0.1, (o.v - 0.5) * 0.12));
  initCityTraffic();
  CITY.built = true;
}

// ---------- City traffic: lane following, turns at intersections, obeys the signals ----------
// ### Each city car drives in the right-hand lane towards the next intersection (node), decides straight/left/right there,
// ### and follows a circular arc through the turn. It stops at red lights, keeps distance to the car ahead and to the player,
// ### and is stunned for a moment when hit. Leftover distance is carried over between straight and arc so motion stays smooth.
// ### Trams use the same logic, but Core.tramNext keeps them on the loop, which is where buildCity lays the tracks.
const npcs = [];
let npcFleets = null, npcHead = null, npcTail = null, npcStop = null, npcPools = null;
const N_NPC = 26, NPC_SUV = 8, N_TRAM = 3, N_BUS = 2, N_MOTO = 4;
// half the length of each kind of city vehicle, and where its lights sit: [front, back, height, half the gap between the pair]
const NPC_KIND = { sedan: { half: 2.3, glow: [2.3, 2.3, 0.75, 0.62] }, suv: { half: 2.3, glow: [2.3, 2.3, 0.75, 0.62] }, tram: { half: 4.25, glow: [4.25, 4.25, 1.3, 0.1] },
  bus: { half: 6, glow: [6, 6, 0.85, 0.86] }, moto: { half: 1.05, glow: [0.8, 0.75, 1.02, 0.01] } };
const { TRAM_LOOP } = Core;
const TRAM_SEGS = (() => {
  const T = TRAM_LOOP, out = [];
  for (let x = T.x0; x < T.x1; x += PITCH) out.push({ x, z: T.z0, dx: 1, dz: 0 }, { x: x + PITCH, z: T.z1, dx: -1, dz: 0 });
  for (let z = T.z0; z < T.z1; z += PITCH) out.push({ x: T.x1, z, dx: 0, dz: 1 }, { x: T.x0, z: z + PITCH, dx: 0, dz: -1 });
  return out;
})();
const rightOf = (dx, dz) => [-dz, dx];
const inGrid = (x, z) => Math.abs(x) <= 3 * PITCH + 1 && Math.abs(z) <= 3 * PITCH + 1;
// ### Creates the city traffic and the trams, and places them at crossings.
function initCityTraffic(){
  const grp = CITY.group, rnd = mulberry32(99);
  npcFleets = { sedan: new Fleet(grp, PARTS.sedan, N_NPC - NPC_SUV, rnd), suv: new Fleet(grp, PARTS.suv, NPC_SUV, rnd), tram: new Fleet(grp, PARTS.tram, N_TRAM, rnd, 0xf2bd1c),
    bus: new Fleet(grp, PARTS.bus, N_BUS, rnd, BUS_COL), moto: new Fleet(grp, PARTS.moto, N_MOTO, rnd) };
  const all = N_NPC + N_TRAM + N_BUS + N_MOTO;
  npcHead = new GlowPts(grp, all * 2, 0xfff1cc, 1.5); npcTail = new GlowPts(grp, all * 2, 0xff3344, 1.1);
  npcStop = new GlowPts(grp, all * 2, 0xff1e2a, 2.1); npcPools = new RoadLights(grp, all);
  const add = (fleet, fi, extra) => npcs.push(Object.assign({ fleet, fi, half: NPC_KIND[fleet].half, x: 0, z: 0, dx: 0, dz: 1, node: null, next: 's', speed: 0, cruise: 10, turn: null, stun: 0, on: false, h: 0 }, extra));
  for (let i = 0; i < N_NPC; i++){
    const suv = i >= N_NPC - NPC_SUV;
    add(suv ? 'suv' : 'sedan', suv ? i - (N_NPC - NPC_SUV) : i);
  }
  for (let i = 0; i < N_TRAM; i++) add('tram', i, { fleet: 'tram', tram: true, dx: 1, dz: 0, cruise: 8 });
  for (let i = 0; i < N_BUS; i++) add('bus', i, { bus: true });
  for (let i = 0; i < N_MOTO; i++) add('moto', i, { moto: true });
}
// ### Decides where a city car goes at the next crossing. Trams ask Core.tramNext, so they stay on their rails.
function chooseNext(n){
  if (n.tram) return Core.tramNext(n.node.x, n.node.z, n.dx, n.dz);
  const [rx, rz] = rightOf(n.dx, n.dz), opts = [];
  if (inGrid(n.node.x + n.dx * PITCH, n.node.z + n.dz * PITCH)) opts.push(['s', 0.55]);
  // a 12 m bus cannot take the tight right-hand corner, so it goes straight on or turns left in the wide arc
  if (!n.bus && inGrid(n.node.x + rx * PITCH, n.node.z + rz * PITCH)) opts.push(['r', 0.25]);
  if (inGrid(n.node.x - rx * PITCH, n.node.z - rz * PITCH)) opts.push(['l', 0.2]);
  if (!opts.length) opts.push(['r', 1]); // a corner of the grid where only a right turn is left
  let tot = opts.reduce((s, o) => s + o[1], 0), r = Math.random() * tot;
  for (const [k, w] of opts){ r -= w; if (r <= 0) return k; }
  return opts[0][0];
}
// ### Puts a city car back into the street network, out of sight of the player.
function spawnNpc(n, minDist){
  resetShove(n);
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
    if (npcs.some(o => o !== n && o.on && Math.hypot(o.x - x, o.z - z) < n.half + o.half + 8)) continue;
    n.x = x; n.z = z; n.dx = dx; n.dz = dz;
    n.node = { x: sx + dx * PITCH, z: sz + dz * PITCH };
    n.next = chooseNext(n); n.turn = null; n.stun = 0; n.on = true;
    n.cruise = n.tram ? 8 : n.bus ? 8 + Math.random() * 2 : n.moto ? 11 + Math.random() * 4 : 9 + Math.random() * 4; n.speed = n.cruise * 0.6;
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
// ### Measures the free road ahead of a city car, so it keeps its distance and stops behind others. The gap is from the middle
// ### of this vehicle to the back of the one ahead, so nobody drives into the long tail of a bus or a tram.
function npcGap(n, fx, fz){
  const rx = -fz, rz = fx;
  let gap = Infinity;
  const test = (x, z, lat, half) => {
    const rel = (x - n.x) * fx + (z - n.z) * fz;
    if (rel <= 0 || rel > 46) return;
    if (Math.abs((x - n.x) * rx + (z - n.z) * rz) < lat && rel - half < gap) gap = rel - half;
  };
  for (const o of npcs) if (o !== n && o.on) test(o.x, o.z, o.tram || o.bus ? 2.6 : 2.2, o.half);
  test(car.x, car.z, 2.6, 2.3);
  for (const p of police) if (p.active || p.g.visible) test(p.x, p.z, 2.4, 2.3);
  // a parked car pushed out into the lane
  if (CITY.parked) for (const p of CITY.parked) if (p.moved) test(p.x + p.px, p.z + p.pz, 2.2, 2.3);
  return gap;
}
// ### Moves the city traffic each frame: follows lanes, turns on arcs, obeys signals, and keeps its distance.
function updateNpcs(dt){
  for (const n of npcs){
    if (!n.on){ if (Math.random() < dt) spawnNpc(n, 60); continue; }
    if (n.stun > 0){ n.stun -= dt; n.speed = Math.max(0, n.speed - 25 * dt); }
    if (n.turn){
      const T = n.turn;
      const fx0 = -Math.sin(T.a0 + T.delta * T.t) * Math.sign(T.delta), fz0 = Math.cos(T.a0 + T.delta * T.t) * Math.sign(T.delta);
      const gap = npcGap(n, fx0, fz0);
      const desired = n.stun > 0 ? 0 : Math.min(n.tram ? 4 : n.bus ? 4.5 : 6.5, Math.max(0, (gap - n.half - 1.8) * 1.0));
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
      desired = Math.min(desired, Math.max(0, (gap - n.half - 2.2) * 1.0));
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
  npcs.forEach((n, i) => {
    const g = NPC_KIND[n.fleet].glow;
    // drawn where a crash has pushed it (see shove)
    if (n.on) stepShove(n, dt);
    const X = n.x + (n.px || 0), Z = n.z + (n.pz || 0), Hd = n.h + (n.ph || 0);
    npcFleets[n.fleet].set(n.fi, X, 0, Z, Hd, n.on);
    vehicleGlow(npcHead, npcTail, i, X, Z, Hd, g[0], g[1], g[2], g[3], n.on);
    stopGlow(npcStop, i, X, Z, Hd, g[1] + 0.05, g[2], g[3], n.on && braking(n, n.speed, n.cruise));
    npcPools.set(i, X, Z, Hd, g[0], n.moto ? 8 : 13, n.moto ? 2.6 : 4.6, n.on);
  });
  Object.values(npcFleets).forEach(f => f.commit()); npcHead.commit(); npcTail.commit(); npcStop.commit(); npcPools.commit();
  if (CITY.water) CITY.water.material.uniforms.time.value = clock;
}
// ### Returns the city traffic to its starting places for a new run.
function resetNpcs(){ npcs.forEach(n => { n.on = false; }); npcs.forEach(n => spawnNpc(n, 25)); }

// ### The walls a moving thing can hit near a point: the city keeps them in one list.
function collidersNear(){ return W.colliders; }

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
// A smooth skin over elliptical rings [x, y, z, half width, half depth] along a path, closed at both ends: body parts
function loft(rings, seg){
  seg = seg || 14;
  const pos = [], idx = [], V3 = THREE.Vector3, X = new V3(1, 0, 0);
  const at = i => new V3(rings[i][0], rings[i][1], rings[i][2]);
  rings.forEach((r, i) => {
    const t = at(Math.min(i + 1, rings.length - 1)).sub(at(Math.max(i - 1, 0))).normalize();
    const side = X.clone().addScaledVector(t, -X.dot(t)).normalize(), up = new V3().crossVectors(t, side);
    for (let k = 0; k < seg; k++){
      const a = k / seg * Math.PI * 2, c = Math.cos(a) * r[3], s = Math.sin(a) * r[4];
      pos.push(r[0] + side.x * c + up.x * s, r[1] + side.y * c + up.y * s, r[2] + side.z * c + up.z * s);
    }
  });
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < seg; k++){
    const a = i * seg + k, b = i * seg + (k + 1) % seg, c = a + seg, d = b + seg;
    idx.push(a, b, c, b, d, c);
  }
  const first = pos.length / 3; pos.push(rings[0][0], rings[0][1], rings[0][2]);
  const lr = rings[rings.length - 1], lastC = first + 1; pos.push(lr[0], lr[1], lr[2]);
  for (let k = 0; k < seg; k++){ idx.push(first, (k + 1) % seg, k); idx.push(lastC, (rings.length - 1) * seg + k, (rings.length - 1) * seg + (k + 1) % seg); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// A limb from a to b with a radius at each ring, so it can bulge and taper like a thigh or a forearm
const limbLoft = (a, b, radii, seg) => loft(radii.map((r, i) => { const t = i / (radii.length - 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, r, r]; }), seg);
const MODELS = {};
// The paint dents and scratches as damage rises. Everything comes from smooth random noise, never from repeating waves, so
// there are no rows of dots: dents are pushed in, most of all at the nose and the tail where the crashes happen, and their
// shading crinkles; scratches are long thin streaks along the body where the bare metal shows; dirt and soot gather in
// patches, thickest low down. uDent is 0 on an undamaged vehicle, so it then looks and costs nothing extra.
const dentU = { value: 0 };
const DENT_NOISE = `
  float dHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float dNoise(vec3 x){
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dHash(i), dHash(i + vec3(1, 0, 0)), f.x), mix(dHash(i + vec3(0, 1, 0)), dHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(dHash(i + vec3(0, 0, 1)), dHash(i + vec3(1, 0, 1)), f.x), mix(dHash(i + vec3(0, 1, 1)), dHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }`;
function dentShader(shader){
  shader.uniforms.uDent = dentU;
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uDent; varying vec3 vDentP;' + DENT_NOISE)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      vec3 dN = vec3(dNoise(position * 3.1), dNoise(position * 3.1 + 7.3), dNoise(position * 3.1 + 13.1)) - 0.5;
      objectNormal = normalize(objectNormal + uDent * 0.9 * dN);`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vDentP = position;
      float dEnds = 0.45 + 0.55 * smoothstep(0.9, 2.2, abs(position.z));
      transformed -= normal * uDent * 0.085 * dEnds * smoothstep(0.42, 0.85, dNoise(position * 1.8 + 3.7));`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uDent; varying vec3 vDentP;' + DENT_NOISE)
    .replace('#include <color_fragment>', `#include <color_fragment>
      float dWarp = dNoise(vDentP * vec3(0.7, 3.0, 0.7)) * 2.5;
      float dLine = abs(fract(vDentP.y * 22.0 + dWarp) - 0.5);
      float dScratch = (1.0 - smoothstep(0.015, 0.045, dLine)) * smoothstep(0.6, 0.75, dNoise(vDentP * vec3(0.9, 5.0, 1.6) + 11.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.58, 0.58, 0.6), dScratch * min(1.0, uDent * 1.6));
      float dDirt = smoothstep(0.45, 0.85, dNoise(vDentP * 1.4 + 5.0)) * (0.5 + 0.5 * smoothstep(1.0, 0.25, vDentP.y));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.06, 0.055), dDirt * uDent * 0.6);`);
}
// ### The muscle coupe's body, built as smooth surfaces instead of extruded outlines. The body is swept along its length:
// ### at every station a cross-section runs from the rocker up the door, past the shoulder and over the bonnet or boot lid,
// ### with the wheel arches cut out of its lower edge; the glass house on top is swept the same way and is split into
// ### glass (windscreen, side windows, rear window) and painted pillars and roof. The front and rear faces carry the grille,
// ### headlights, intakes, tail lights and diffuser (see coupeParts). Returns the swept surfaces and the profiles.
function coupeBody(){
  const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t, bump = (z, c, w) => Math.exp(-((z - c) / w) * ((z - c) / w));
  const ZF = 2.41, ZR = -2.36, WHEELS = [[1.45, 0.38], [-1.35, 0.38]], ARCH = 0.47;
  // ---- profiles along the length (z): the side view and the plan view of the body
  const P = {
    // the rocker (lower edge of the side) and the floor
    rocker: z => 0.25 - 0.05 * sst(1.95, 2.35, z) + 0.05 * sst(-1.9, -2.3, z),
    // the character line where the body is widest
    cy: z => 0.6 + 0.02 * sst(0, -2, z),
    cw: z => 0.975 + 0.045 * bump(z, -1.35, 0.6) + 0.02 * bump(z, 1.45, 0.5),
    // the shoulder: the top of the front wings, the waist and the hips over the rear wheels
    sy: z => 0.8 + 0.05 * sst(2.4, 1.2, z) + 0.04 * sst(-0.2, -1.4, z) - 0.015 * sst(-2.0, -2.34, z),
    sw: z => 0.86 + 0.06 * bump(z, -1.4, 0.6) - 0.02 * sst(1.5, 2.4, z),
    // the centre line on top: the bonnet falls to the nose, the boot lid ends in a short lip
    top: z => z > 0.62 ? lerp(0.92, 0.78, sst(0.62, 2.41, z) ** 1.3) : z < -1.9 ? 0.955 + 0.04 * sst(-2.12, -2.34, z) : 0.92
  };
  // the plan view rounds the corners of the nose and the tail
  const plan = z => {
    const f = z > 2.16 ? Math.sqrt(Math.max(0, 1 - ((z - 2.16) / 0.28) ** 2)) : 1, r = z < -2.1 ? Math.sqrt(Math.max(0, 1 - ((-2.1 - z) / 0.29) ** 2)) : 1;
    return 0.84 + 0.16 * Math.min(f, r);
  };
  // the arch: how high the side's lower edge is cut over each wheel
  const edge = z => {
    let y = P.rocker(z);
    for (const [wz, r] of WHEELS){ const d = Math.abs(z - wz); if (d < ARCH) y = Math.max(y, r + Math.sqrt(ARCH * ARCH - d * d)); }
    return y;
  };
  // ---- one half cross-section (x >= 0): a dense polyline from the lower edge to the centre line, then resampled evenly
  const M = 30;
  function section(z){
    const k = plan(z), rk = P.rocker(z), cy = P.cy(z), cw = P.cw(z) * k, sy = P.sy(z), sw = P.sw(z) * k, top = P.top(z);
    const pts = [];
    const bez = (a, b, c, d, n) => { for (let i = 0; i < n; i++){ const t = i / n, u = 1 - t; pts.push([u*u*u*a[0] + 3*u*u*t*b[0] + 3*u*t*t*c[0] + t*t*t*d[0], u*u*u*a[1] + 3*u*u*t*b[1] + 3*u*t*t*c[1] + t*t*t*d[1]]); } };
    const A = [cw - 0.05, rk], B = [cw, cy], C = [sw, sy], D = [0, top + 0.012 * (z > 0.62 ? 1 : 0)];
    bez(A, [cw - 0.01, rk + 0.15], [cw, cy - 0.1], B, 20);             // the lower door, tucked under
    bez(B, [cw - 0.018, cy + 0.08], [sw + 0.016, sy - 0.07], C, 16);    // a crease, then up to the shoulder, leaning in
    bez(C, [sw - 0.014, sy + 0.022], [sw * 0.6, top + 0.002], D, 24); pts.push(D);   // a crisp shoulder, then over the top
    // the power bulge down the middle of the bonnet
    if (z > 0.7 && z < 2.3){ const b = 0.025 * sst(0.7, 1.0, z) * sst(2.3, 1.9, z); pts.forEach(p => { p[1] += b * sst(0.42, 0.28, p[0]); }); }
    const kept = pts;
    // resample evenly by length
    const L = [0]; for (let i = 1; i < kept.length; i++) L.push(L[i - 1] + Math.hypot(kept[i][0] - kept[i - 1][0], kept[i][1] - kept[i - 1][1]));
    const out = []; let j = 0;
    for (let s = 0; s <= M; s++){ const d = L[L.length - 1] * s / M; while (j < L.length - 2 && L[j + 1] < d) j++; const t = (d - L[j]) / (L[j + 1] - L[j] || 1); out.push([lerp(kept[j][0], kept[j + 1][0], t), lerp(kept[j][1], kept[j + 1][1], t)]); }
    return out;
  }
  // ---- sweep: rings of 2M+1 points (right half reversed, then the left half) at stations along z
  const NZ = 96, zs = [];
  for (let i = 0; i <= NZ; i++){ const t = i / NZ; zs.push(lerp(ZR, ZF, t)); }
  function sweep(sectionOf, zlist, closeEnds){
    const pos = [], rings = [];
    zlist.forEach(z => {
      const h = sectionOf(z), ring = [];
      for (let s = 0; s < h.length; s++) ring.push([h[s][0], h[s][1], z]);
      for (let s = h.length - 2; s >= 0; s--) ring.push([-h[s][0], h[s][1], z]);
      rings.push(ring);
    });
    const R = rings[0].length, idx = [];
    rings.forEach(r => r.forEach(p => pos.push(p[0], p[1], p[2])));
    for (let i = 0; i < rings.length - 1; i++) for (let s = 0; s < R - 1; s++){
      const a = i * R + s, b = a + 1, c = a + R, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    return { pos, idx, rings, R };
  }
  // past each end, two more rings that roll the edge in towards the middle of the face, so the corners are round
  const roll = (z, dir) => { const zz = dir > 0 ? ZF : ZR, h = section(zz); let cx = 0, cy = 0; h.forEach(p => { cy += p[1]; }); cy /= h.length;
    const k = Math.abs(z - zz) / 0.045, f = 1 - 0.1 * k * k; return h.map(p => [p[0] * f, cy + (p[1] - cy) * (1 - 0.06 * k * k)]); };
  const body = sweep(z => z > ZF ? roll(z, 1) : z < ZR ? roll(z, -1) : section(z), [ZR - 0.045, ZR - 0.025, ...zs, ZF + 0.025, ZF + 0.045]);
  // cut the wheel arches out of the sides: drop every face whose middle lies inside an arch
  { const keep = [];
    for (let i = 0; i < body.idx.length; i += 6){
      let x = 0, y = 0, z = 0; for (const k of [0, 1, 2, 4]){ const v = body.idx[i + k]; x += body.pos[v * 3] / 4; y += body.pos[v * 3 + 1] / 4; z += body.pos[v * 3 + 2] / 4; }
      const inArch = Math.abs(x) > 0.45 && WHEELS.some(([wz, r]) => Math.hypot(z - wz, y - r) < ARCH);
      if (!inArch) keep.push(...body.idx.slice(i, i + 6));
    }
    body.idx = keep; }
  // ---- the ends: the nose and the tail are closed by a face (the fascia), which carries the grille and the lights
  const capOf = (ring, z, flip) => {
    const pos = [], idx = []; let cx = 0, cy = 0;
    ring.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= ring.length; cy /= ring.length;
    // the face reaches down to the lower edge as a flat bottom line
    const n = ring.length; pos.push(cx, cy, z);
    ring.forEach(p => pos.push(p[0], p[1], z));
    for (let i = 1; i < n; i++) flip ? idx.push(0, i + 1, i) : idx.push(0, i, i + 1);
    flip ? idx.push(0, 1, n) : idx.push(0, n, 1);
    return { pos, idx };
  };
  // ---- the glass house, swept from the foot of the windscreen to the end of the fastback
  const GZF = 0.7, GZR = -1.92;
  const roof = z => z > -0.15 ? lerp(0.9, 1.32, sst(GZF, -0.15, z) ** 0.85) : z > -0.7 ? 1.32 + 0.006 * Math.sin((z + 0.15) / -0.55 * Math.PI) : lerp(1.32, 0.96, ((-0.7 - z) / 1.22) ** 1.1);
  const gsec = z => {
    const sy = P.sy(z) + 0.015, bw = P.sw(z) * plan(z) - 0.05, r = roof(z), rw = bw * lerp(0.9, 0.78, sst(0.94, 1.3, r)), h = Math.max(0.01, r - sy);
    const pts = []; const G = 64;
    for (let i = 0; i <= G; i++){
      const t = i / G;
      if (t < 0.45){ const u = t / 0.45; pts.push([lerp(bw, rw, u) + 0.02 * Math.sin(u * Math.PI), sy + h * 0.92 * u]); }   // the side, leaning in
      else { const u = (t - 0.45) / 0.55, a = u * Math.PI / 2; pts.push([rw * Math.cos(a) ** 0.55, sy + h * 0.92 + h * 0.08 * Math.sin(a) ** 0.6]); }   // the roof, crowned
    }
    return pts;
  };
  const gz = []; for (let i = 0; i <= 220; i++) gz.push(lerp(GZR, GZF, i / 220));
  const house = sweep(gsec, gz);
  // which part of the glass house each face is: by its height across the side (v) and its place along the car (z)
  const GR = house.R, half = (GR - 1) / 2;
  const kind = (s, z) => {
    const v = 1 - Math.abs(s - half) / half;        // 0 at the belt, 1 on the centre line
    if (v < 0.4){                                     // the side: the window between the screen pillar and the fastback pillar
      const front = lerp(0.52, -0.06, v / 0.4), back = lerp(-1.5, -0.95, v / 0.4);
      if (v > 0.035 && v < 0.37 && z < front && z > back) return 'glass';
      if (v > 0.02 && v < 0.39 && z < front + 0.035 && z > back - 0.035) return 'trim';
      return 'paint';
    }
    if (z > -0.1 && z < GZF - 0.03 && v > 0.46) return 'glass';        // the windscreen
    if (z < -0.84 && z > -1.78 && v > 0.47) return 'glass';             // the rear window
    if (z > -0.12 && z < GZF && v > 0.43) return 'trim';
    if (z < -0.8 && z > -1.82 && v > 0.44) return 'trim';
    return 'paint';
  };
  return { body, house, kind, half, GZF, GZR, capF: capOf(body.rings[body.rings.length - 1], ZF + 0.045, false), capR: capOf(body.rings[0], ZR - 0.045, true), P, plan, edge, section, gsec, roof, ZF, ZR };
}
// ### The coupe as geometry, one merged piece per material: the swept body and glass house, the wheel arch lips and wells,
// ### the faces at the front and back (grille, headlights, intakes, splitter, tail lights, diffuser, exhausts, plates),
// ### the mirrors, door shut lines and handles, and the cabin (coupeCabin). No badge or lettering of any make.
// ### The two doors are cut out of the body and the glass house: parts.doors[1] (left, the driver's) and [-1] (right), each
// ### per material in the car's own measures, with where its hinge, its outer handle and its inner pull are.
const COUPE_DOOR = { zf: 0.93, zb: -0.26, y0: 0.31, handle: [-0.08, 0.84] };
function coupeParts(){
  const B = coupeBody(), out = {}, doors = { 1: {}, '-1': {} };
  const put = (k, g) => (out[k] = out[k] || []).push(g);
  const dput = (sd, k, g) => (doors[sd][k] = doors[sd][k] || []).push(g);
  const geo = (pos, idx) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; };
  const D = COUPE_DOOR, inDoor = z => z < D.zf && z > D.zb, base = z => B.P.sw(z) * B.plan(z) - 0.05;
  // the body: the faces of each door go to that door; the top that runs through the cabin under the glass house is dropped,
  // so the cabin is open inside; the rest stays
  { const keep = [], dside = { 1: [], '-1': [] };
    for (let i = 0; i < B.body.idx.length; i += 6){
      let x = 0, y = 0, z = 0; for (const k of [0, 1, 2, 4]){ const v = B.body.idx[i + k]; x += B.body.pos[v * 3] / 4; y += B.body.pos[v * 3 + 1] / 4; z += B.body.pos[v * 3 + 2] / 4; }
      const ax = Math.abs(x), quad = B.body.idx.slice(i, i + 6);
      if (inDoor(z) && y > D.y0 && ax > base(z) - 0.004) dside[x > 0 ? 1 : -1].push(...quad);
      else if (!(z > B.GZR && z < B.GZF && ax < base(z) - 0.004 && y > 0.6)) keep.push(...quad);
    }
    put('paint', geo(B.body.pos, keep)); put('shell', geo(B.body.pos, keep));
    for (const sd of [1, -1]){ dput(sd, 'paint', geo(B.body.pos, dside[sd])); dput(sd, 'card', geo(B.body.pos, dside[sd])); } }
  put('paint', geo(B.capF.pos, B.capF.idx)); put('paint', geo(B.capR.pos, B.capR.idx));
  // the glass house: the door window with the strip of the belt under it goes with each door, the pillars and the roof stay
  { const H = B.house, part = {}, dpart = { 1: {}, '-1': {} };
    for (let i = 0; i < H.idx.length; i += 6){
      const a = H.idx[i], s = a % H.R + 0.5, z = (H.pos[a * 3 + 2] + H.pos[H.idx[i + 5] * 3 + 2]) / 2, k = B.kind(s, z);
      const v = 1 - Math.abs(s - B.half) / B.half, front = 0.52 - 0.58 * Math.min(1, v / 0.4);
      const tgt = inDoor(z) && v < 0.39 && (v < 0.035 || z < front + 0.035) ? dpart[H.pos[a * 3] > 0 ? 1 : -1] : part;
      (tgt[k] = tgt[k] || []).push(...H.idx.slice(i, i + 6));
    }
    for (const [k, idx] of Object.entries(part)){ put(k, geo(H.pos, idx)); if (k !== 'glass') put('liner', geo(H.pos, idx)); }
    for (const sd of [1, -1]) for (const [k, idx] of Object.entries(dpart[sd])){ dput(sd, k, geo(H.pos, idx)); if (k !== 'glass') dput(sd, 'card', geo(H.pos, idx)); } }
  // the outside of the body at height y, at station z (right side)
  const outer = (z, y) => { const h = B.section(Math.max(B.ZR, Math.min(B.ZF, z))); for (let i = 0; i < h.length - 1; i++){ const a = h[i], b = h[i + 1]; if ((a[1] - y) * (b[1] - y) <= 0 && b[1] !== a[1]) return a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]); } return h[0][0]; };
  const tube = (pts, r, seg) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), seg || pts.length * 2, r, 6, false);
  const shape = (pts, holes) => { const s = new THREE.Shape(); pts.forEach((p, i) => i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])); (holes || []).forEach(h => { const q = new THREE.Path(); h.forEach((p, i) => i ? q.lineTo(p[0], p[1]) : q.moveTo(p[0], p[1])); s.holes.push(q); }); return s; };
  const plate = (pts, z, depth, dir) => { const g = new THREE.ExtrudeGeometry(shape(pts), { depth, bevelEnabled: false }); if (dir < 0){ g.scale(-1, 1, -1); } g.translate(0, 0, z); return g; };
  const mirror = pts => pts.map(([x, y]) => [-x, y]).reverse();
  const ARCH = 0.47;
  // rubber seals along the slanted edges of the side windows, which the grid of the glass house can only follow in steps: the
  // front edge goes with the door, the back edge of the quarter window stays on the body
  { const onHouse = (z, v, sd) => { const h = B.gsec(z), f = v * (h.length - 1), i = Math.min(h.length - 2, Math.floor(f)), t = f - i; return [sd * (h[i][0] + (h[i + 1][0] - h[i][0]) * t), h[i][1] + (h[i + 1][1] - h[i][1]) * t, z]; };
    const edge = (zOf, v0, v1) => { const pts = []; for (let i = 0; i <= 14; i++){ const v = v0 + (v1 - v0) * i / 14; pts.push([zOf(v), v]); } return pts; };
    for (const sd of [1, -1]){
      dput(sd, 'trim', tube(edge(v => 0.5375 - 0.58 * Math.min(1, v / 0.4), 0.02, 0.385).map(([z, v]) => onHouse(z, v, sd)), 0.019, 40));
      const top = []; for (let z = D.zb; z <= 0.5375 - 0.58 * 0.38 / 0.4 + 0.02; z += 0.04) top.push(onHouse(z, 0.38, sd));
      dput(sd, 'trim', tube(top, 0.012, 30));
      put('trim', tube(edge(v => -1.5175 + 0.55 * Math.min(1, v / 0.4), 0.02, 0.385).map(([z, v]) => onHouse(z, v, sd)), 0.019, 40));
      put('trim', tube(edge(v => 0.56 - 0.58 * Math.min(1, v / 0.4), 0.0, 0.39).map(([z, v]) => onHouse(z, v, sd)), 0.012, 40));
    } }
  // ---- wheel arches: a rolled lip round each opening, and a dark well behind it
  for (const [wz, r] of [[1.45, 0.38], [-1.35, 0.38]]) for (const sd of [-1, 1]){
    const pts = [];
    for (let a = -0.05; a <= Math.PI + 0.05; a += Math.PI / 40){
      const z = wz + Math.cos(a) * ARCH, y = r + Math.sin(a) * ARCH;
      if (y < 0.22) continue;
      pts.push([sd * (outer(z, y) + 0.004), y, z]);
    }
    put('paint', tube(pts, 0.016, 80));
    put('well', new THREE.CylinderGeometry(ARCH - 0.005, ARCH - 0.005, 0.42, 36, 1, true, -0.25, Math.PI + 0.5).rotateZ(Math.PI / 2).translate(sd * 0.76, r, wz));
  }
  // ---- the sills: a black skirt along the lower edge between the arches
  for (const sd of [-1, 1]){
    const z0 = 1.45 - ARCH - 0.02, z1 = -1.35 + ARCH + 0.02, g = new THREE.BufferGeometry(), pos = [], idx = [];
    const N = 24; for (let i = 0; i <= N; i++){ const z = z0 + (z1 - z0) * i / N, x = outer(z, 0.27); pos.push(sd * (x + 0.012), 0.21, z, sd * (x + 0.006), 0.31, z, sd * (x - 0.1), 0.21, z); }
    for (let i = 0; i < N; i++){ const a = i * 3; sd > 0 ? idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 2, a + 5, a, a, a + 5, a + 3) : idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 2, a, a + 5, a, a + 3, a + 5); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); put('trim', g);
  }
  // ---- each door: shut lines along its front and back edges, the handle flush in it, the mirror on a slim arm at the front
  // corner of its window, and on the inside an armrest, the pull and a dark sill under the window. The pillar behind the
  // window stays on the body as a thin dark strip, so the door has an edge to close against.
  for (const sd of [-1, 1]){
    for (const z of [D.zf, D.zb]){ const pts = []; for (let y = 0.33; y <= 0.93; y += 0.05) pts.push([sd * (outer(z, y) + 0.002), y, z]); dput(sd, 'dark', tube(pts, 0.0035, pts.length * 3)); }
    const [hz, hy] = D.handle;
    dput(sd, 'dark', new THREE.BoxGeometry(0.01, 0.045, 0.22).translate(sd * (outer(hz, hy) - 0.002), hy, hz));
    const x = B.P.sw(0.5) * B.plan(0.5) - 0.06;
    const head = new THREE.SphereGeometry(1, 20, 14).scale(0.06, 0.045, 0.09).translate(0, 0, 0.03); { const p = head.attributes.position; for (let i = 0; i < p.count; i++) if (p.getZ(i) < 0.0) p.setZ(i, p.getZ(i) * 0.25); head.computeVertexNormals(); } head.translate(sd * (x + 0.09), 0.98, 0.44);
    dput(sd, 'paint', head);
    dput(sd, 'paint', tube([[sd * (x - 0.02), 0.92, 0.5], [sd * (x + 0.04), 0.95, 0.49], [sd * (x + 0.08), 0.97, 0.47]], 0.011, 10));
    dput(sd, 'glass', new THREE.CircleGeometry(1, 20).scale(0.05, 0.034, 1).rotateY(Math.PI).translate(sd * (x + 0.09), 0.98, 0.462));
    dput(sd, 'cabin', new THREE.BoxGeometry(0.09, 0.05, 0.5).translate(sd * (outer(0.2, 0.6) - 0.07), 0.62, 0.2));
    dput(sd, 'cabin', new THREE.BoxGeometry(0.05, 0.03, 0.7).translate(sd * (base(0.15) - 0.04), B.P.sy(0.15) - 0.02, 0.15));
    dput(sd, 'alu', new THREE.BoxGeometry(0.02, 0.025, 0.12).translate(sd * (outer(0.5, 0.75) - 0.05), 0.75, 0.5));
    const side = B.gsec(D.zb - 0.01).filter((p, i, a) => i < a.length * 0.42).map(p => [sd * (p[0] + 0.004), p[1], D.zb - 0.01]);
    put('trim', tube(side, 0.012, 16));
  }
  // ---- the front face. Its shape is the last ring of the body pushed onto the face plane
  const ZF = B.ZF + 0.046, ZR = B.ZR - 0.046;
  // grille: a wide opening with dark slats, the intake under the bumper and a vent in each corner
  put('dark', plate([[-0.58, 0.47], [0.58, 0.47], [0.64, 0.56], [0.6, 0.66], [-0.6, 0.66], [-0.64, 0.56]], ZF - 0.012, 0.014, 1));
  for (let y = 0.495; y < 0.65; y += 0.03) put('trim', new THREE.BoxGeometry(1.18, 0.006, 0.01).translate(0, y, ZF + 0.004));
  put('dark', plate([[-0.62, 0.25], [0.62, 0.25], [0.68, 0.33], [0.55, 0.38], [-0.55, 0.38], [-0.68, 0.33]], ZF - 0.012, 0.014, 1));
  for (const sd of [-1, 1]) put('dark', plate((sd > 0 ? x => x : mirror)([[0.72, 0.27], [0.86, 0.3], [0.84, 0.4], [0.72, 0.38]]).map(p => [p[0] * (sd > 0 ? 1 : 1), p[1]]), ZF - 0.012, 0.014, 1));
  // the splitter: a black blade under the nose
  put('trim', new THREE.BoxGeometry(1.7, 0.025, 0.12).translate(0, 0.2, ZF - 0.02));
  // headlights: slim, angled units in the corners, each with a dark housing, a projector and a light strip along its lower edge
  for (const sd of [-1, 1]){
    const lamp = [[0.6, 0.715], [0.9, 0.745], [0.9, 0.66], [0.64, 0.625]].map(([x, y]) => [x * sd, y]);
    const pts = sd > 0 ? lamp : lamp.slice().reverse();
    put('dark', plate(pts, ZF - 0.008, 0.01, 1));
    put('lens', plate(pts, ZF + 0.004, 0.006, 1));
    for (const x of [0.71, 0.8]) put('chrome', new THREE.CylinderGeometry(0.03, 0.03, 0.02, 18).rotateX(Math.PI / 2).translate(sd * x, 0.685, ZF + 0.003));
    put('led', tube([[sd * 0.62, 0.635, ZF + 0.006], [sd * 0.75, 0.645, ZF + 0.006], [sd * 0.88, 0.665, ZF + 0.006], [sd * 0.885, 0.72, ZF + 0.006]], 0.006, 12));
  }
  put('plate', new THREE.BoxGeometry(0.46, 0.11, 0.01).translate(0, 0.42, ZF + 0.004));
  // ---- the back: a black band across the tail with a slim light at each end, the diffuser, four exhausts and the plate
  put('dark', plate([[-0.78, 0.78], [0.78, 0.78], [0.76, 0.88], [-0.76, 0.88]], ZR - 0.008, 0.012, 1));
  const tail = [];
  for (const sd of [-1, 1]){
    const pts = [[0.36, 0.79], [0.79, 0.79], [0.775, 0.875], [0.38, 0.875]].map(([x, y]) => [x * sd, y]);
    tail.push(plate(sd > 0 ? pts : pts.slice().reverse(), ZR - 0.004, 0.006, 1));
    for (const y of [0.81, 0.855]) put('red', tube([[sd * 0.4, y, ZR - 0.01], [sd * 0.76, y, ZR - 0.01]], 0.006, 4));
  }
  tail.forEach(g => put('redLens', g));
  put('dark', plate([[-0.74, 0.24], [0.74, 0.24], [0.76, 0.38], [-0.76, 0.38]], ZR - 0.008, 0.012, 1));
  for (let x = -0.3; x <= 0.31; x += 0.15) put('trim', new THREE.BoxGeometry(0.012, 0.11, 0.06).translate(x, 0.295, ZR - 0.012));
  for (const x of [-0.6, -0.46, 0.46, 0.6]){
    put('alu', new THREE.CylinderGeometry(0.048, 0.048, 0.16, 18, 1, true).rotateX(Math.PI / 2).translate(x, 0.3, ZR + 0.03));
    put('dark', new THREE.CircleGeometry(0.044, 18).rotateY(Math.PI).translate(x, 0.3, ZR - 0.045));
  }
  put('plate', new THREE.BoxGeometry(0.52, 0.12, 0.01).translate(0, 0.55, ZR - 0.004));
  // keeps a piece of the cabin inside the body and under the glass house, m metres in from them
  const fit = (g, m) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++){
      const z = clamp(p.getZ(i), B.ZR, B.ZF), x = p.getX(i), ax = Math.min(Math.abs(x), base(z) - m);
      // under the glass house its section, elsewhere the body's own: the first edge from the middle outwards that passes x
      const h = z < B.GZF && z > B.GZR ? B.gsec(z) : B.section(z);
      let top = h[h.length - 1][1];
      for (let j = h.length - 2; j >= 0; j--) if (h[j][0] >= ax && h[j + 1][0] <= ax){ top = h[j][1] + (h[j + 1][1] - h[j][1]) * (h[j][0] - ax) / (h[j][0] - h[j + 1][0] || 1); break; }
      p.setXYZ(i, Math.sign(x) * ax, Math.min(p.getY(i), top - m), p.getZ(i));
    }
    g.computeVertexNormals(); return g;
  };
  coupeCabin(put, fit);
  const merge = o => { const r = {}; for (const [k, list] of Object.entries(o)) r[k] = mergeGeos(list); return r; };
  const res = merge(out);
  res.doors = { 1: merge(doors[1]), '-1': merge(doors[-1]) };
  for (const sd of [1, -1]){
    const [hz, hy] = D.handle;
    Object.assign(res.doors[sd], { hinge: [sd * outer(D.zf, 0.6), 0, D.zf], handle: [sd * (outer(hz, hy) + 0.006), hy, hz], pull: [sd * (outer(0.5, 0.75) - 0.08), 0.74, 0.48] });
  }
  return res;
}
// ### A box with round edges and corners (radius r), with smooth normals; bend leans its sides forward (for the bolsters of a seat).
function roundBox(w, h, d, r, bend){
  const g = new THREE.BoxGeometry(w, h, d, 6, 6, 6), p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3(), c = new THREE.Vector3();
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++){
    v.fromBufferAttribute(p, i); c.set(clamp(v.x, -hx, hx), clamp(v.y, -hy, hy), clamp(v.z, -hz, hz));
    v.sub(c).normalize(); n.setXYZ(i, v.x, v.y, v.z); v.multiplyScalar(r).add(c);
    p.setXYZ(i, v.x, v.y + (bend ? bend[0] * v.x * v.x : 0), v.z + (bend ? bend[1] * v.x * v.x : 0));
  }
  return g;
}
// ### Where the driver of the coupe looks from (left seat, x to the left): eye height, place along the car and how far down.
const COUPE_EYE = { pos: [0.4, 1.1, -0.32], pitch: -0.1 };
// ### The coupe's cabin, in the car's own measures: carpet on the floor, the dashboard under the windscreen with a hood over
// ### the two dials in front of the driver, the centre stack and the console with the gear lever, two bucket seats and a
// ### small bench behind them, the parcel shelf and the mirror. The steering wheel and the dials are added with the car
// ### (cabinDash), as they move.
function coupeCabin(put, fit){
  // the floor, the sills on both sides and the bulkhead in front of the feet
  put('carpet', new THREE.BoxGeometry(1.64, 0.04, 2.5).translate(0, 0.27, -0.4));
  for (const sd of [-1, 1]) put('cabin', new THREE.BoxGeometry(0.18, 0.14, 1.25).translate(sd * 0.8, 0.33, 0.33));
  put('cabin', fit(new THREE.BoxGeometry(1.5, 0.46, 0.04, 8, 1, 1).translate(0, 0.65, 0.69), 0.02));
  // the dashboard: one profile (seen from the side) carried across the car, then the strip of aluminium along its edge
  { const s = new THREE.Shape(); [[0.69, 0.885], [0.45, 0.935], [0.34, 0.925], [0.3, 0.885], [0.32, 0.76], [0.4, 0.62], [0.5, 0.42], [0.69, 0.42]].forEach((q, i) => i ? s.lineTo(q[0], q[1]) : s.moveTo(q[0], q[1]));
    const g = new THREE.ExtrudeGeometry(s, { depth: 1.52, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 4 });
    put('cabin', fit(g.rotateY(-Math.PI / 2).translate(0.76, 0, 0), 0.02)); }
  // a soft upper part in a lighter grey with a seam along its edge, an aluminium strip lower down across the whole dash, the
  // glovebox in front of the passenger, round vents at both ends
  put('soft', fit(roundBox(1.5, 0.03, 0.34, 0.012).translate(0, 0.932, 0.5), 0.022));
  put('alu', new THREE.BoxGeometry(1.4, 0.012, 0.012).translate(0, 0.8, 0.322));
  put('seam', new THREE.BoxGeometry(1.42, 0.004, 0.004).translate(0, 0.905, 0.302));
  put('dark', new THREE.BoxGeometry(0.42, 0.004, 0.004).translate(-0.4, 0.74, 0.335));
  put('dark', new THREE.BoxGeometry(0.004, 0.12, 0.004).translate(-0.2, 0.68, 0.352));
  for (const x of [-0.64, 0.64]){
    put('alu', new THREE.TorusGeometry(0.047, 0.007, 8, 24).translate(x, 0.86, 0.31));
    put('dark', new THREE.CylinderGeometry(0.045, 0.045, 0.03, 20).rotateX(Math.PI / 2).translate(x, 0.86, 0.315));
    for (let i = -2; i <= 2; i++) put('cabin', new THREE.BoxGeometry(0.08, 0.005, 0.006).translate(x, 0.86 + i * 0.016, 0.302));
  }
  // the cluster of the dials stands up from the dash in front of the driver (the dials and their hood come with cabinDash)
  put('cabin', roundBox(0.44, 0.13, 0.2, 0.04).translate(COUPE_EYE.pos[0], 0.9, 0.42));
  // the centre stack: two vents, the hazard button, the climate panel with its knobs and the start button, and on top of
  // the dash the screen of the navigation, turned to the driver
  put('cabin', new THREE.BoxGeometry(0.32, 0.42, 0.14).translate(0, 0.6, 0.38));
  for (const x of [-0.07, 0.07]){
    put('dark', roundBox(0.11, 0.06, 0.02, 0.01).translate(x, 0.85, 0.31));
    for (let i = -1; i <= 1; i++) put('alu', new THREE.BoxGeometry(0.1, 0.004, 0.008).translate(x, 0.85 + i * 0.016, 0.3));
  }
  put('button', new THREE.CylinderGeometry(0.012, 0.012, 0.012, 3).rotateX(Math.PI / 2).translate(0, 0.85, 0.305));
  put('panel', new THREE.PlaneGeometry(0.26, 0.09).rotateX(-0.12).translate(0, 0.74, 0.311));
  for (const x of [-0.095, 0.095]){ put('alu', new THREE.CylinderGeometry(0.022, 0.022, 0.02, 20).rotateX(Math.PI / 2).translate(x, 0.74, 0.32)); put('dark', new THREE.CylinderGeometry(0.016, 0.016, 0.022, 16).rotateX(Math.PI / 2).translate(x, 0.74, 0.322)); }
  put('alu', new THREE.CylinderGeometry(0.018, 0.018, 0.012, 20).rotateX(Math.PI / 2).translate(0.13, 0.64, 0.31));
  put('button', new THREE.CylinderGeometry(0.012, 0.012, 0.014, 20).rotateX(Math.PI / 2).translate(0.13, 0.64, 0.31));
  { const o = new THREE.Object3D(), eye = new THREE.Vector3(...COUPE_EYE.pos); o.position.set(0, 1.0, 0.44); o.lookAt(eye); o.updateMatrix();
    put('cabin', roundBox(0.29, 0.18, 0.025, 0.01).translate(0, 0, -0.014).applyMatrix4(o.matrix));
    put('navi', new THREE.PlaneGeometry(0.27, 0.16).applyMatrix4(o.matrix));
    put('cabin', new THREE.BoxGeometry(0.06, 0.07, 0.04).translate(0, -0.1, -0.03).applyMatrix4(o.matrix)); }
  // the console between the seats: the gear lever in its leather boot, the hand brake and an armrest at the back
  put('cabin', new THREE.BoxGeometry(0.24, 0.2, 1.0).translate(0, 0.38, -0.12));
  put('dark', new THREE.BoxGeometry(0.2, 0.005, 0.3).translate(0, 0.482, 0.12));
  put('leather', new THREE.CylinderGeometry(0.02, 0.05, 0.07, 14).translate(0, 0.52, 0.12));
  put('alu', new THREE.CylinderGeometry(0.009, 0.011, 0.1, 10).rotateX(0.2).translate(0, 0.58, 0.13));
  put('leather', new THREE.SphereGeometry(0.032, 16, 12).scale(1, 1.15, 1).translate(0, 0.645, 0.14));
  put('leather', new THREE.BoxGeometry(0.035, 0.03, 0.22).rotateX(-0.25).translate(0.06, 0.51, -0.1));
  put('leather', roundBox(0.22, 0.06, 0.32, 0.025).translate(0, 0.51, -0.45));
  // the two bucket seats: cushion, back with bolsters, a panel down the middle of each and the head rest
  for (const x of [-0.4, 0.4]){
    put('leather', roundBox(0.5, 0.13, 0.52, 0.05, [0.5, 0]).rotateX(0.08).translate(x, 0.38, -0.2));
    put('leather', roundBox(0.5, 0.62, 0.13, 0.05, [0, 0.7]).rotateX(-0.3).translate(x, 0.74, -0.58));
    put('insert', roundBox(0.24, 0.5, 0.04, 0.015).rotateX(-0.3).translate(x, 0.75, -0.5));
    put('insert', roundBox(0.24, 0.03, 0.4, 0.012).rotateX(0.08).translate(x, 0.448, -0.18));
    put('leather', roundBox(0.25, 0.17, 0.1, 0.045).rotateX(-0.2).translate(x, 1.14, -0.72));
  }
  // the bench behind, the parcel shelf under the rear window and the mirror at the top of the windscreen
  put('leather', roundBox(1.3, 0.12, 0.42, 0.05).translate(0, 0.42, -1.08));
  put('leather', roundBox(1.3, 0.48, 0.12, 0.05, [0, 0.25]).rotateX(-0.35).translate(0, 0.7, -1.36));
  put('cabin', new THREE.BoxGeometry(1.45, 0.02, 0.5).translate(0, 0.9, -1.65));
  put('cabin', new THREE.BoxGeometry(0.22, 0.065, 0.025).translate(0, 1.17, -0.04));
  put('glass', new THREE.BoxGeometry(0.2, 0.05, 0.004).translate(0, 1.17, -0.054));
  put('cabin', new THREE.BoxGeometry(0.02, 0.06, 0.02).translate(0, 1.22, -0.04));
}
// ### The materials of the coupe's cabin: dark plastics, leather seats with a lighter panel, carpet, a fabric head lining and
// ### the inside of the body (both drawn on the back of the outer panels), the door cards and the dark screen.
function cabinMats(){
  const std = (color, roughness, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness }, o));
  return { cabin: std(0x3a3b41, 0.72), shell: std(0x2c2d31, 0.85, { side: THREE.BackSide }), liner: std(0x75726c, 0.95, { side: THREE.BackSide }),
    card: std(0x3c3d43, 0.75, { side: THREE.BackSide }), carpet: std(0x2a2b2f, 1), leather: std(0x3b3936, 0.5, { metalness: 0.05 }), insert: std(0x6a6058, 0.7),
    screen: std(0x070a0e, 0.15, { metalness: 0.5 }), dial: new THREE.MeshBasicMaterial({ color: 0x2a2a2a, map: dialTexture() }), needle: new THREE.MeshBasicMaterial({ color: 0x3a1a10 }),
    wheel: std(0x2a2a2e, 0.5), soft: std(0x4a4b50, 0.85), seam: std(0x8a857c, 0.8), button: std(0xb81f1f, 0.4), panel: new THREE.MeshBasicMaterial({ color: 0x333333, map: panelTexture() }),
    navi: new THREE.MeshBasicMaterial({ color: 0x1a1a1a, map: naviTexture() }) };
}
// ### The faces of the two dials, drawn once: a speedometer (to 160 mph) and a rev counter (to 8, red from 6.5), white on black.
function dialTexture(){
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#050505'; x.fillRect(0, 0, 512, 256);
  [[128, 16, 2, 0], [384, 8, 1, 6.5]].forEach(([cx, max, step, red]) => {
    x.strokeStyle = '#d8d8d8'; x.fillStyle = '#e8e8e8'; x.lineWidth = 3;
    x.beginPath(); x.arc(cx, 128, 118, 0, Math.PI * 2); x.stroke();
    for (let i = 0; i <= max * 2; i++){
      const a = DIAL.from + (DIAL.to - DIAL.from) * i / (max * 2), big = i % 2 === 0, r0 = big ? 88 : 98;
      x.strokeStyle = red && i / 2 >= red ? '#e0302a' : '#e8e8e8'; x.lineWidth = big ? 4 : 2;
      x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, 128 + Math.sin(a) * r0); x.lineTo(cx + Math.cos(a) * 110, 128 + Math.sin(a) * 110); x.stroke();
      if (big && (i / 2) % step === 0){ x.font = 'bold 22px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = red && i / 2 >= red ? '#e0302a' : '#e8e8e8'; x.fillText(String(max === 16 ? i * 5 : i / 2), cx + Math.cos(a) * 68, 128 + Math.sin(a) * 68); }
    }
    x.font = '14px sans-serif'; x.fillStyle = '#9a9a9a'; x.fillText(max === 16 ? 'MPH' : 'x1000 RPM', cx, 176);
    // a small gauge low in each dial (fuel, temperature) and the gear in the rev counter
    x.strokeStyle = '#4a4a4a'; x.lineWidth = 6; x.beginPath(); x.arc(cx, 128, 54, Math.PI * 0.62, Math.PI * 0.38, true); x.stroke();
    x.strokeStyle = max === 16 ? '#e8e8e8' : '#7ec4ff'; x.beginPath(); x.arc(cx, 128, 54, Math.PI * 0.62, Math.PI * (max === 16 ? 0.5 : 0.48), true); x.stroke();
    if (max === 8){ x.fillStyle = '#ffffff'; x.font = 'bold 26px sans-serif'; x.fillText('D', cx, 204); }
  });
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
  return t;
}
// where the needles of the dials start and end (radians on the canvas, clockwise from the right)
const DIAL = { from: Math.PI * 0.75, to: Math.PI * 2.25 };
// ### The screen of the navigation, drawn once: a night map of the old town (blocks, streets, the river at the bottom), the
// ### route in blue from the arrow of the car, the next turn at the top and the time of arrival at the bottom.
function naviTexture(){
  const c = document.createElement('canvas'); c.width = 512; c.height = 304;
  const x = c.getContext('2d'), rnd = mulberry32(7);
  x.fillStyle = '#121a22'; x.fillRect(0, 0, 512, 304);
  x.fillStyle = '#1a2a3c'; x.beginPath(); x.moveTo(0, 250); x.bezierCurveTo(150, 232, 330, 262, 512, 240); x.lineTo(512, 304); x.lineTo(0, 304); x.fill();
  for (let i = 0; i < 26; i++){ x.fillStyle = rnd() < 0.15 ? '#1d3324' : '#1c242e'; x.fillRect(rnd() * 480, 40 + rnd() * 180, 30 + rnd() * 60, 20 + rnd() * 40); }
  x.strokeStyle = '#3b4a5c'; x.lineCap = 'round';
  [[[0, 120], [512, 140]], [[0, 200], [512, 186]], [[90, 40], [120, 250]], [[300, 40], [280, 250]], [[420, 40], [460, 245]], [[0, 70], [200, 40]], [[180, 250], [512, 60]]].forEach(([a, b], i) => {
    x.lineWidth = i < 2 ? 12 : 7; x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); });
  x.strokeStyle = '#2f9bff'; x.lineWidth = 10; x.lineJoin = 'round';
  x.beginPath(); x.moveTo(256, 268); x.lineTo(262, 193); x.lineTo(282, 192); x.lineTo(292, 132); x.lineTo(470, 141); x.stroke();
  x.fillStyle = '#ffffff'; x.beginPath(); x.moveTo(256, 250); x.lineTo(270, 284); x.lineTo(256, 276); x.lineTo(242, 284); x.closePath(); x.fill();
  x.fillStyle = 'rgba(10,18,26,0.92)'; x.fillRect(0, 0, 512, 40); x.fillRect(0, 272, 512, 32);
  x.strokeStyle = '#ffffff'; x.lineWidth = 5; x.beginPath(); x.moveTo(26, 32); x.lineTo(26, 14); x.lineTo(42, 14); x.stroke();
  x.fillStyle = '#ffffff'; x.beginPath(); x.moveTo(40, 6); x.lineTo(50, 14); x.lineTo(40, 22); x.fill();
  x.font = 'bold 22px sans-serif'; x.textBaseline = 'middle'; x.fillText('200 m', 62, 21);
  x.font = '18px sans-serif'; x.fillStyle = '#c8d4e0'; x.fillText('Rua Augusta', 150, 21);
  x.fillText('Arrival 02:47', 14, 289); x.textAlign = 'right'; x.fillText('3.4 km', 498, 289);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
  return t;
}
// ### The face of the climate panel: two temperatures, the fan and a row of small buttons, in pale blue on black.
function panelTexture(){
  const c = document.createElement('canvas'); c.width = 256; c.height = 90;
  const x = c.getContext('2d');
  x.fillStyle = '#07090c'; x.fillRect(0, 0, 256, 90);
  x.fillStyle = '#9fd4ff'; x.font = 'bold 20px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('21.0', 60, 30); x.fillText('21.5', 196, 30);
  x.font = '13px sans-serif'; x.fillText('AUTO', 128, 22); x.fillText('A/C', 128, 42);
  for (let i = 0; i < 6; i++){ x.strokeStyle = '#4a6a86'; x.lineWidth = 2; x.strokeRect(20 + i * 38, 62, 30, 18); }
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
  return t;
}
// ### Where the driver's eyes are in a vehicle (in its own measures) and which way they look: straight ahead, a little down.
// ### The camera takes this place in the cabin, so whatever is fixed to it (the steering wheel) sits where the hands hold it.
function driverEye(group, o){
  const eye = new THREE.Group(); eye.position.fromArray(o.pos); eye.rotation.set(o.pitch, Math.PI, 0, 'YXZ'); group.add(eye);
  return eye;
}
// ### A steering wheel: a thick leather rim, three spokes, the hub with its pad, and the column behind it.
function steeringWheel(mat, trimMat){
  const w = new THREE.Group();
  w.add(new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.019, 12, 48), mat));
  w.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.068, 0.045, 24).rotateX(Math.PI / 2).translate(0, -0.01, -0.01), mat));
  for (const a of [0, Math.PI, -Math.PI / 2]) w.add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.016).translate(0.1, 0, -0.012).rotateZ(a), a < 0 ? mat : trimMat));
  w.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.3, 16).rotateX(Math.PI / 2).translate(0, 0, -0.17), mat));
  // buttons on both sides of the hub and a thin bright ring round the pad
  for (const sd of [-1, 1]) for (const y of [0.012, -0.012]) w.add(new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.014, 0.008).translate(sd * 0.085, y, 0.0), trimMat));
  w.add(new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.003, 6, 32).translate(0, -0.01, 0.013), trimMat));
  return w;
}
// ### The wheel and dials of a cab: the wheel hangs from the driver's eye where the hands take it (as in the view from the
// ### seat), and the two dials under their hood (at height and place podAt, in front of the driver) face the driver. light
// ### lights the dials up with the engine, show moves the needles.
function cabinDash(group, eye, mats, podAt){
  const wheel = steeringWheel(mats.wheel, mats.cabin); wheel.position.set(0, -0.2, -0.45); wheel.rotation.x = -0.42; eye.add(wheel);
  const pod = new THREE.Group(), at = eye.position;
  pod.position.set(at.x, podAt[0], podAt[1]); group.add(pod); pod.lookAt(at.x, at.y, at.z);
  pod.add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 24, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).scale(1, 0.5, 1).translate(0, 0.01, 0.045), Object.assign(mats.cabin.clone(), { side: THREE.DoubleSide })));
  pod.add(new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.1).translate(0, -0.05, -0.004), mats.wheel));
  const needles = [];
  [[-0.075, 0], [0.075, 0.5]].forEach(([x, u]) => {
    const face = new THREE.CircleGeometry(0.06, 40), uv = face.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, u + uv.getX(i) * 0.5);
    pod.add(new THREE.Mesh(face.translate(x, 0, 0), mats.dial));
    pod.add(new THREE.Mesh(new THREE.TorusGeometry(0.061, 0.004, 6, 40).translate(x, 0, 0.003), mats.wheel));
    const n = new THREE.Group(); n.position.set(x, 0, 0.005); pod.add(n);
    n.add(new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.0035, 0.002).translate(0.021, 0, 0), mats.needle));
    n.add(new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.004, 12).rotateX(Math.PI / 2), mats.wheel));
    needles.push(n);
  });
  const set = (n, k) => { n.rotation.z = -(DIAL.from + (DIAL.to - DIAL.from) * clamp(k, 0, 1)); };
  needles.forEach(n => set(n, 0));
  return { wheel, light: k => { mats.dial.color.setScalar(0.16 + 0.84 * k); if (mats.navi){ mats.navi.color.setScalar(0.1 + 0.9 * k); mats.panel.color.setScalar(0.2 + 0.8 * k); } mats.screen.emissive.setRGB(0.02 * k, 0.09 * k, 0.16 * k); mats.needle.color.setRGB(0.23 + 0.77 * k, 0.1 + 0.25 * k, 0.06 + 0.05 * k); },
    show: (mph, rev) => { set(needles[0], mph / 160); set(needles[1], rev / 8); } };
}
const headlights = [], beams = [], headGlows = [];
// the player's tail lights: dim red, and bright with a glow around each lamp while braking
const brakeLights = { mat: new THREE.MeshBasicMaterial({ color: 0x7a0c14 }), glows: [], on: false };
// the white reversing lights: unlit glass until the vehicle rolls backwards, then a glow around each lamp and a pool of light behind it
const reverseLights = { mat: new THREE.MeshBasicMaterial({ color: 0x4a4e55 }), glows: [], on: false };
(function buildPlayerModels(){
  const mk = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; parent.add(m); return m; };
  const paintMat = (hex, rough, metal) => { const m = new THREE.MeshPhysicalMaterial({ color: hex, roughness: rough, metalness: metal, clearcoat: 1, clearcoatRoughness: 0.05 }); m.userData.env = 1.15; m.onBeforeCompile = dentShader; return m; };
  // Parts that appear (or, with gone, disappear) from a damage stage up; each returns its mesh
  const hinged = (list, stage, geo, mat, parent, pos, rot) => { const m = mk(geo, mat, parent); if (pos) m.position.set(pos[0], pos[1], pos[2]); if (rot) m.rotation.set(rot[0], rot[1], rot[2]); m.visible = false; list.push({ stage, m, show: true }); return m; };
  const gone = (list, stage, m) => list.push({ stage, m, show: false });
  const shp = pts => { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath(); return s; };
  const cyl = (r0, r1, len, seg) => new THREE.CylinderGeometry(r0, r1, len, seg || 14);
  const pipe = (pts, r) => pts.slice(1).flatMap((p, i) => [limb(pts[i], p, r, r, 8), ball(p, r)]);
  // A thin side panel with optional holes, on both sides of the centre line
  const sidePanels = (pts, x, thick, holes) => [-1, 1].map(side => {
    const sh = shp(pts); (holes || []).forEach(h => { const p = new THREE.Path(); h.forEach((q, i) => i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])); p.closePath(); sh.holes.push(p); });
    return extrudeProfile(sh, thick, thick * 0.3).translate(side * x, 0, 0);
  });
  const reverseLamps = (group, lamps, size, rearZ, pool) => {
    lamps.forEach(p => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xe8f2ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      s.position.set(p[0], p[1], p[2]); s.scale.setScalar(size); s.visible = false; group.add(s); reverseLights.glows.push(s);
    });
    const light = new THREE.Mesh(new THREE.CircleGeometry(pool, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTexture, color: 0xcfdcf2, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    light.position.set(0, 0.07, rearZ - pool * 0.8); light.visible = false; group.add(light); reverseLights.glows.push(light);
  };
  const led = new THREE.MeshBasicMaterial({ color: 0xeef6ff });
  const red = brakeLights.mat;
  // ### The passenger door on the right (-x): a group hinged at its front edge that swings out to the side, with the outer panel in
  // ### the paint, the window, the handle and the dark door card on the inside. Hidden while shut, so the body looks as before; while
  // ### it is open, a dark panel on the body (hole) shows the opening behind it.
  const cabin = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.85 });
  // ### With o.x on the left (+x) it builds the same door mirrored: the driver's door, which the player opens in the garage.
  const passengerDoor = (group, o, pm) => {
    const m = o.x < 0 ? 1 : -1;
    const pivot = new THREE.Group(); pivot.position.set(o.x, 0, o.z); pivot.visible = false; group.add(pivot);
    const L = o.len, panel = o.y1 - o.y0;
    mk(boxG(0.05, panel, L, -0.012 * m, o.y0 + panel / 2, -L / 2), pm, pivot);
    mk(boxG(0.02, panel * 0.86, L * 0.9, 0.024 * m, o.y0 + panel / 2, -L / 2), cabin, pivot);
    mk(boxG(0.025, o.w1 - o.y1, L * 0.86, -0.004 * m, (o.y1 + o.w1) / 2, -L * 0.5), SHARED.glass, pivot);
    mk(boxG(0.035, 0.045, 0.17, -0.045 * m, o.y1 - 0.12, -L + 0.2), alu, pivot);
    const hole = mk(boxG(0.02, panel - 0.06, L - 0.06, o.x + 0.012 * m, o.y0 + panel / 2, o.z - L / 2), cabin, group); hole.visible = false;
    const handle = new THREE.Object3D(), pull = new THREE.Object3D(); handle.position.set(-0.07 * m, o.y1 - 0.12, -L + 0.2); pull.position.set(0.08 * m, o.y0 + panel * 0.6, -L * 0.6); pivot.add(handle, pull);
    // the door seen from inside while it is shut (the door itself is hidden then)
    const inner = mk(boxG(0.02, panel, L, o.x + 0.06 * m, o.y0 + panel / 2, o.z - L / 2), cabin, group);
    return { pivot, hole, max: o.max * m, handle, pull, inner };
  };
  // ### A door of the coupe, cut out of its body (coupeParts): hinged at its front edge and always shown, so there is no hole
  // ### to cover. handle is the outer handle and pull the grip on its inside, both carried round with the door.
  const coupeDoor = (group, parts, mats, sd) => {
    const pivot = new THREE.Group(), [hx, hy, hz] = parts.hinge; pivot.position.set(hx, hy, hz); group.add(pivot);
    for (const [k, geo] of Object.entries(parts)) if (geo.isBufferGeometry) mk(geo.translate(-hx, -hy, -hz), mats[k], pivot);
    const spot = q => { const o = new THREE.Object3D(); o.position.set(q[0] - hx, q[1] - hy, q[2] - hz); pivot.add(o); return o; };
    const door = { pivot, hole: new THREE.Object3D(), max: -sd * 1.15, cut: true, handle: spot(parts.handle), pull: spot(parts.pull) };
    // the handle: a bar flush in its dark pocket, hinged at its front end, that swings out at the back when it is pulled;
    // the point the fingers hook round (handle, just behind and under its middle) goes out with it
    const flap = spot([parts.handle[0], parts.handle[1], parts.handle[2] + 0.1]);
    mk(new THREE.BoxGeometry(0.014, 0.032, 0.2).translate(0, 0, -0.1), mats.alu, flap);
    door.handle.position.add(new THREE.Vector3(sd * 0.02, -0.012, -0.02)); flap.attach(door.handle);
    return Object.assign(door, { flap, side: sd });
  };
  const brakeGlow = (group, lamps, size) => lamps.forEach(p => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xff2030, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.set(p[0], p[1], p[2]); s.scale.setScalar(size); s.visible = false; group.add(s); brakeLights.glows.push(s);
  });
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

  // Car: a modern American fastback coupe in bright blue, with smooth bodywork (coupeParts above): a long bonnet with a power
  // bulge, a cabin set far back under a roof that runs down to the tail in one line, a crease along the flanks, wide hips over
  // the rear wheels and a short lip on the boot lid; slim headlights in the corners of a wide grille, a slim tail light at
  // each end of a black band, a diffuser and four exhausts. It carries no badge or lettering of any make.
  {
    const g = new THREE.Group(), base = 0x1a7fd6, pm = paintMat(base, 0.3, 0.5);
    const well = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.95, side: THREE.DoubleSide });
    const tailLens = new THREE.MeshStandardMaterial({ color: 0x5a0a10, roughness: 0.15, metalness: 0.3 }); tailLens.userData.env = 1;
    const CP = coupeParts(), CAB = cabinMats();
    const MATS = Object.assign({ paint: pm, glass: SHARED.glass, trim: SHARED.trim, dark: darkGrille, well, lens: SHARED.lens, chrome: alu, led, red, redLens: tailLens, alu, plate: plateMat }, CAB);
    for (const [k, geo] of Object.entries(CP)) if (k !== 'doors') mk(geo, MATS[k], g);
    const wheels = [], pivots = [];
    [[0.86, 1.45, true], [-0.86, 1.45, true], [0.88, -1.35, false], [-0.88, -1.35, false]].forEach(([x, z, f]) =>
      wheel(g, { x, z, r: 0.38, w: 0.3, rim: gun, spokes: 10, caliper: 0xd0202a, front: f, list: wheels, pivots }));
    brakeGlow(g, [[0.58, 0.833, -2.46], [-0.58, 0.833, -2.46]], 1.25);
    mk(mergeGeos([-1, 1].map(sd => boxG(0.12, 0.05, 0.012, sd * 0.2, 0.833, -2.418))), reverseLights.mat, g);
    reverseLamps(g, [[0.2, 0.833, -2.46], [-0.2, 0.833, -2.46]], 0.95, -2.4, 3);
    // battered: smashed tail light, boot lid sprung open, bumper hanging at one end. Critical: bonnet up, a dead headlight, door ajar
    const damageParts = [];
    hinged(damageParts, 2, boxG(0.42, 0.09, 0.03, -0.57, 0.833, -2.425), SHARED.trim, g);
    hinged(damageParts, 2, boxG(1.4, 0.05, 0.45, 0, 0, -0.22), pm, g, [0, 0.97, -1.9], [0.16, 0, 0]);
    hinged(damageParts, 2, boxG(1.5, 0.16, 0.2, -0.75, 0, 0), pm, g, [0.75, 0.32, -2.42], [0, 0, 0.1]);
    hinged(damageParts, 3, boxG(1.55, 0.05, 1.6, 0, 0, 0.8), pm, g, [0, 0.93, 0.74], [-0.5, 0, 0]);
    hinged(damageParts, 3, boxG(0.3, 0.09, 0.03, -0.75, 0.685, 2.465), SHARED.trim, g);
    hinged(damageParts, 3, boxG(0.05, 0.56, 1.19, 0, 0, -0.6), pm, g, [-0.99, 0.58, 0.93], [0, -0.3, 0]);
    const door = coupeDoor(g, CP.doors[-1], MATS, -1), drive = coupeDoor(g, CP.doors[1], MATS, 1);
    const eye = driverEye(g, COUPE_EYE), dash = cabinDash(g, eye, CAB, [0.97, 0.3]);
    MODELS.car = { skid: { x: [-0.88, 0.88], z: -1.35, w: 0.28 }, g, paint: pm, base: C(base), wheels, pivots, r: 0.38, damageParts, dent: 1, smoke: [1.5, 1.1], stage: 0, door, drive, eye, dash };
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
    const screen = mk(extrudeProfile(shp([[0.76, 1.08], [0.5, 1.29], [0.44, 1.27], [0.56, 1.12]]), 0.27, 0.01), smoke, g);
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
    // the rider, a smooth body in two-tone leathers: hips back, chest low over the tank, elbows out, knees against the tank,
    // balls of the feet on the pegs. The group pivots at the hips, so the rider can tuck and lean into turns.
    const rider = new THREE.Group(); rider.position.set(0, 1.1, -0.38); g.add(rider);
    const part = (geo, mat) => mk(geo.translate(0, -1.1, 0.38), mat, rider);
    const J = { hip: [0.1, 1.1, -0.38], knee: [0.27, 0.86, 0.08], ankle: [0.2, 0.58, -0.26], sh: [0.2, 1.41, 0.06], el: [0.33, 1.23, 0.27], wr: [0.26, 1.115, 0.46] };
    const lr = (p, sd) => [p[0] * sd, p[1], p[2]];
    part(loft([[0, 1.0, -0.5, 0.1, 0.06], [0, 1.08, -0.45, 0.18, 0.13], [0, 1.2, -0.28, 0.165, 0.12], [0, 1.31, -0.1, 0.185, 0.135], [0, 1.41, 0.04, 0.225, 0.125], [0, 1.475, 0.13, 0.11, 0.08]], 18), leather);
    part(mergeGeos([
      ball([0.085, 1.09, -0.47], 0.125, 1, 0.95, 1.05), ball([-0.085, 1.09, -0.47], 0.125, 1, 0.95, 1.05),
      ...[-1, 1].flatMap(sd => [
        limbLoft(lr(J.hip, sd), lr(J.knee, sd), [0.1, 0.104, 0.09, 0.07]), ball(lr(J.knee, sd), 0.072),
        limbLoft(lr(J.knee, sd), lr(J.ankle, sd), [0.065, 0.073, 0.06, 0.045]),
        limbLoft(lr(J.sh, sd), lr(J.el, sd), [0.074, 0.07, 0.058, 0.05]), ball(lr(J.sh, sd), 0.08), ball(lr(J.el, sd), 0.052),
        limbLoft(lr(J.el, sd), lr(J.wr, sd), [0.05, 0.056, 0.045, 0.034])
      ])
    ]), leather);
    // darker stretch panels, the aero hump behind the helmet, sliders on knees, elbows and shoulders
    part(mergeGeos([
      loft([[0, 1.33, -0.17, 0.07, 0.03], [0, 1.46, -0.11, 0.125, 0.07], [0, 1.56, -0.03, 0.09, 0.06], [0, 1.6, 0.05, 0.04, 0.03]], 12),
      loft([[0, 1.14, -0.42, 0.14, 0.14], [0, 1.2, -0.285, 0.172, 0.127], [0, 1.27, -0.17, 0.176, 0.13]], 16),
      ...[-1, 1].map(sd => ball([sd * 0.2, 0.74, -0.08], 0.05, 0.9, 1.5, 0.9))
    ]), matte);
    part(mergeGeos([-1, 1].flatMap(sd => [ball(lr(J.sh, sd), 0.056, 1.15, 0.75, 1.1).translate(sd * 0.03, 0.04, 0), ball(lr(J.el, sd), 0.036, 1, 1, 1.25).translate(sd * 0.024, -0.008, 0)])), steel);
    part(mergeGeos([-1, 1].flatMap(sd => [
      ball(lr(J.knee, sd), 0.052, 0.9, 0.62, 1.15).translate(sd * 0.052, -0.022, 0.02),
      limbLoft(lr(J.wr, sd), [sd * 0.285, 1.165, 0.375], [0.036, 0.039], 10)
    ])), acc);
    part(mergeGeos([-1, 1].map(sd => loft([[sd * 0.17, 1.42, 0.0, 0.016, 0.05], [sd * 0.185, 1.3, -0.1, 0.016, 0.05], [sd * 0.17, 1.17, -0.28, 0.016, 0.05]], 8))), acc);
    // boots with soles and toe sliders, gloves with fingers round the grips
    part(mergeGeos([-1, 1].flatMap(sd => [
      limbLoft(lr(J.ankle, sd), [sd * 0.21, 0.5, -0.28], [0.05, 0.054]),
      loft([[sd * 0.215, 0.51, -0.34, 0.045, 0.045], [sd * 0.22, 0.48, -0.24, 0.05, 0.045], [sd * 0.225, 0.462, -0.11, 0.046, 0.032], [sd * 0.225, 0.452, -0.03, 0.03, 0.02]], 10),
      ball([sd * 0.265, 1.095, 0.49], 0.05, 0.95, 0.7, 1.1)
    ])), matte);
    part(mergeGeos([-1, 1].flatMap(sd => [boxG(0.08, 0.016, 0.34, sd * 0.222, 0.43, -0.17), ...[0.205, 0.235, 0.265, 0.295].flatMap(x => [
      limb([sd * x, 1.125, 0.5], [sd * x, 1.115, 0.545], 0.0135, 0.012, 6), limb([sd * x, 1.115, 0.545], [sd * x, 1.06, 0.53], 0.012, 0.011, 6), ball([sd * x, 1.06, 0.53], 0.011)
    ]), limb([sd * 0.22, 1.08, 0.46], [sd * 0.215, 1.055, 0.52], 0.014, 0.012, 6)])), skin);
    part(mergeGeos([-1, 1].map(sd => boxG(0.1, 0.018, 0.04, sd * 0.25, 1.143, 0.505))), carbon);
    part(mergeGeos([-1, 1].map(sd => boxG(0.05, 0.05, 0.05, sd * 0.2, 0.45, -0.05))), acc);
    // full-face helmet: rounded shell, chin bar with vents, a neck roll, an iridium visor over its dark seal, a small rear spoiler
    part(limbLoft([0, 1.44, 0.08], [0, 1.5, 0.17], [0.07, 0.075], 12), matte);
    part(mergeGeos([ball([0, 1.555, 0.22], 0.137, 0.95, 0.98, 1.1), ball([0, 1.47, 0.315], 0.096, 0.9, 0.64, 1.0), loft([[0, 1.61, 0.03, 0.06, 0.03], [0, 1.65, 0.06, 0.05, 0.02], [0, 1.68, 0.1, 0.02, 0.012]], 8)]), carbon);
    part(ball([0, 1.55, 0.29], 0.105, 1.15, 0.5, 0.9), skin);
    const visor = new THREE.MeshStandardMaterial({ color: 0x3f7c9c, roughness: 0.08, metalness: 0.95 }); visor.userData.env = 1.5;
    part(ball([0, 1.555, 0.3], 0.099, 1.13, 0.43, 0.87), visor);
    part(mergeGeos([ball([0, 1.64, 0.18], 0.1, 0.14, 0.55, 1.05), ...[-1, 1].map(sd => boxG(0.012, 0.024, 0.14, sd * 0.127, 1.5, 0.15))]), acc);
    part(mergeGeos([-1, 1].map(sd => boxG(0.05, 0.012, 0.03, sd * 0.035, 1.44, 0.4, 0.5))), SHARED.trim);
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
    brakeGlow(root, [[0, 1.1, -1.13]], 0.9);
    mk(mergeGeos([-1, 1].map(sd => boxG(0.035, 0.024, 0.02, sd * 0.085, 1.215, -1.075, 0.5))), reverseLights.mat, g);
    reverseLamps(root, [[0.085, 1.07, -1.1], [-0.085, 1.07, -1.1]], 0.55, -1.1, 2);
    // battered: a side panel hanging loose and a smashed tail light. Critical: the screen is gone and the tail unit cracked open
    const damageParts = [];
    hinged(damageParts, 2, extrudeProfile(shp([[0.3, 0], [0.02, -0.02], [-0.02, -0.3], [0.24, -0.26]]), 0.02, 0.005), pm, g, [0.262, 0.82, 0.14], [0.62, 0, 0.32]);
    hinged(damageParts, 2, boxG(0.13, 0.05, 0.05, 0, 1.235, -1.09, 0.5), SHARED.trim, g);
    hinged(damageParts, 3, extrudeProfile(shp([[0, 0], [-0.38, 0.03], [-0.44, -0.06], [-0.04, -0.09]]), 0.02, 0.004), pm, g, [-0.15, 1.04, -0.68], [-0.3, 0.12, -0.5]);
    gone(damageParts, 3, screen);
    MODELS.bike = { skid: { x: [0], z: -0.74, w: 0.17 }, g: root, paint: pm, base: C(base), wheels, pivots, r: 0.31, damageParts, dent: 0.35, smoke: [0.15, 0.72], stage: 0, rider, eye: driverEye(root, { pos: [0, 1.5, -0.42], pitch: -0.16 }) };
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
    const CAB = cabinMats(), cab = smoothGeo(shapeBody(extrudeProfile(shp([[0.72, 1.26], [3.0, 1.26], [3.03, 1.7], [2.98, 2.42], [2.87, 3.12], [2.74, 3.44], [2.38, 3.72], [1.6, 3.86], [0.84, 3.84], [0.72, 3.68]]), 2.5, 0.1), { half: 1.5, zc: 1.86, belt: 1.5, roof: 3.9, tumble: 0.075, plan: 0.09 }));
    mk(cab, pm, g);
    // lower cab and bumper in grey plastic with the front wheel arch cut out
    const low = new THREE.Shape();
    low.moveTo(0.62, 0.6); low.lineTo(1.3, 0.6); low.absarc(2.0, 0.56, 0.7, Math.PI, 0, true);
    low.lineTo(3.0, 0.46); low.lineTo(3.2, 0.46); low.lineTo(3.25, 0.68); low.lineTo(3.23, 1.2); low.lineTo(0.62, 1.2); low.closePath();
    mk(extrudeProfile(low, 2.44, 0.03), plastic, g);
    mk(mergeGeos([boxG(2.5, 0.17, 2.3, 0, 1.3, 1.86), boxG(2.5, 0.03, 2.3, 0, 1.43, 1.86)]), new THREE.MeshStandardMaterial({ color: 0x3f5a54, roughness: 0.4, metalness: 0.4 }), g);
    // windscreen in a rubber frame, wipers, sun visor. The glass is one sheet facing out, so the driver can see through it
    { const tilt = Math.atan2(0.125, 0.65), len = Math.hypot(0.125, 0.65);
      mk(new THREE.PlaneGeometry(2.18, len).rotateX(-tilt).translate(0, 2.775, 3.0625), SHARED.glass, g);
      mk(mergeGeos([boxG(2.28, 0.05, 0.05, 0, 0, 0).translate(0, 2.43, 3.115), boxG(2.28, 0.05, 0.05, 0, 0, 0).translate(0, 3.12, 2.985),
        ...[-1, 1].map(sd => boxG(0.05, len + 0.06, 0.05, 0, 0, 0).rotateX(-tilt).translate(sd * 1.115, 2.775, 3.05))]), rubber, g); }
    mk(mergeGeos([limb([0.08, 2.47, 3.14], [1.0, 2.62, 3.1], 0.012, 0.012, 5), limb([-1.0, 2.47, 3.14], [-0.08, 2.62, 3.1], 0.012, 0.012, 5)]), rubber, g);
    mk(smoothGeo(extrudeProfile(shp([[3.08, 3.22], [3.0, 3.34], [2.84, 3.44], [2.84, 3.36], [2.96, 3.25]]), 2.3, 0.015)), pm, g);
    // door and sleeper windows run across the cab, so only their outer faces show; door seams, handles, grab rails
    mk(extrudeProfile(shp([[2.89, 2.28], [2.76, 3.06], [1.82, 3.06], [1.78, 2.28]]), 2.44, 0.015), SHARED.glass, g);
    mk(extrudeProfile(shp([[1.1, 2.86], [1.1, 3.14], [0.72, 3.14], [0.72, 2.86]]), 2.43, 0.012), SHARED.glass, g);
    mk(mergeGeos([-1, 1].flatMap(sd => [
      boxG(0.06, 1.86, 0.018, sd * 1.235, 2.12, 2.92), boxG(0.06, 1.9, 0.018, sd * 1.235, 2.15, 1.7), boxG(0.06, 0.018, 1.2, sd * 1.235, 1.2, 2.31),
      boxG(0.06, 0.018, 1.0, sd * 1.22, 3.12, 2.27), boxG(0.06, 0.03, 1.22, sd * 1.21, 3.16, 2.27)
    ])), rubber, g);
    // the cab inside: floor, dashboard, the hump of the engine between the seats, two seats and the bunk behind them
    mk(boxG(2.3, 0.04, 1.3, 0, 1.3, 2.25), CAB.carpet, g);
    mk(mergeGeos([boxG(2.3, 1.0, 0.25, 0, 1.81, 2.875), roundBox(2.3, 0.1, 0.4, 0.04).translate(0, 2.3, 2.84)]), CAB.cabin, g);
    mk(boxG(0.5, 0.3, 0.8, 0, 1.45, 2.4), CAB.cabin, g);
    mk(mergeGeos([-0.62, 0.62].flatMap(x => [roundBox(0.55, 0.14, 0.55, 0.05, [0.5, 0]).translate(x, 1.86, 2.08), roundBox(0.55, 0.75, 0.14, 0.05, [0, 0.7]).rotateX(-0.22).translate(x, 2.3, 1.82),
      roundBox(0.28, 0.2, 0.1, 0.045).translate(x, 2.82, 1.74)])), CAB.leather, g);
    mk(roundBox(2.3, 0.14, 0.85, 0.05).translate(0, 1.75, 1.2), CAB.insert, g);
    // its walls round the windows: the panel under the windscreen, the pillars and the header, the walls of the bunk, the
    // sides above the windows, the back wall and the head lining
    mk(mergeGeos([boxG(2.3, 0.14, 0.12, 0, 2.38, 3.03), boxG(2.4, 0.04, 0.3, 0, 3.13, 2.8), boxG(2.4, 0.36, 0.03, 0, 3.32, 2.66),
      ...[-1, 1].flatMap(sd => [boxG(0.13, 0.75, 0.07, 0, 0, 0).rotateX(-Math.atan2(0.125, 0.65)).translate(sd * 1.16, 2.76, 2.97),
        boxG(0.03, 1.56, 0.97, sd * 1.2, 2.08, 1.22), boxG(0.03, 0.44, 1.8, sd * 1.2, 3.28, 2.0)]),
      boxG(2.4, 2.4, 0.03, 0, 2.5, 0.78)]), CAB.cabin, g);
    mk(boxG(2.4, 0.03, 1.86, 0, 3.5, 1.73), new THREE.MeshStandardMaterial({ color: 0x75726c, roughness: 0.95 }), g);
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
    mk(mergeGeos([-1, 1].map(sd => boxG(0.08, 0.12, 0.04, sd * 0.69, 0.86, -3.26))), reverseLights.mat, g);
    mk(boxG(0.52, 0.12, 0.02, 0, 0.7, -3.285), plateMat, g);
    const wheels = [], pivots = [];
    [[1.1, 2.0, true, 0.32], [-1.1, 2.0, true, 0.32], [0.76, -1.7, false, 0.26], [1.06, -1.7, false, 0.26], [-0.76, -1.7, false, 0.26], [-1.06, -1.7, false, 0.26]].forEach(([x, z, f, w]) =>
      wheel(g, { x, z, r: 0.52, w, tyre: 0.22, rim: alu, solid: true, front: f, list: wheels, pivots }));
    brakeGlow(g, [[0.98, 0.86, -3.32], [-0.98, 0.86, -3.32]], 1.6);
    reverseLamps(g, [[0.69, 0.86, -3.32], [-0.69, 0.86, -3.32]], 1.1, -3.3, 4);
    // battered: a torn mudguard, a smashed tail light and a mirror hanging down. Critical: bumper hanging, cracked windscreen
    const damageParts = [];
    hinged(damageParts, 2, boxG(0.74, 0.03, 0.84, 0, 0, -0.42), plastic, g, [-0.93, 1.21, -1.3], [-0.5, 0, 0.1]);
    hinged(damageParts, 2, boxG(0.26, 0.15, 0.05, -0.98, 0.86, -3.27), SHARED.trim, g);
    hinged(damageParts, 2, mergeGeos([boxG(0.25, 0.56, 0.1, 0, -0.28, 0), boxG(0.21, 0.5, 0.012, 0, -0.28, -0.058)]), plastic, g, [-1.5, 3.16, 2.86], [0.1, 0, -0.45]);
    hinged(damageParts, 3, boxG(1.3, 0.3, 0.1, -0.65, 0, 0), plastic, g, [0.12, 0.72, 3.3], [0, 0, 0.2]);
    hinged(damageParts, 3, mergeGeos([[-0.5, 2.72, 0.5, 2.84], [-0.5, 2.72, -0.2, 2.42], [-0.5, 2.72, -1.0, 2.98], [-0.5, 2.72, -0.72, 2.46], [-0.5, 2.72, 0.05, 3.06]].map(([x0, y0, x1, y1]) => limb([x0, y0, 3.09 - (y0 - 2.42) * 0.17], [x1, y1, 3.09 - (y1 - 2.42) * 0.17], 0.006, 0.006, 4))), new THREE.MeshBasicMaterial({ color: 0xc8d0da }), g);
    const eye = driverEye(g, { pos: [0.62, 2.5, 2.05], pitch: -0.12 }), dash = cabinDash(g, eye, CAB, [2.38, 2.7]);
    const door = passengerDoor(g, { x: -1.262, z: 2.9, len: 1.18, y0: 1.22, y1: 2.28, w1: 3.04, max: 1.2 }, pm);
    const drive = passengerDoor(g, { x: 1.262, z: 2.9, len: 1.18, y0: 1.22, y1: 2.28, w1: 3.04, max: 1.2 }, pm);
    MODELS.truck = { skid: { x: [-0.91, 0.91], z: -1.7, w: 0.56 }, g, paint: pm, base: C(base), wheels, pivots, r: 0.52, damageParts, dent: 1.4, smoke: [0.7, 3.95], stage: 0, door, drive, eye, dash };
  }

  Object.values(MODELS).forEach(m => { m.g.visible = false; carTilt.add(m.g); });
  // ### The headlights: two spot lights with a wide, soft edge, so the road ahead is lit in one smooth fan that fades into the
  // ### dark instead of two hard-edged triangles. A small glow sits on each lamp, and a faint haze shows the beam only close to
  // ### the lamp, as on a slightly misty night.
  [-0.62, 0.62].forEach(x => {
    const s = new THREE.SpotLight(0xfff6ea, 3.0, 95, 0.6, 0.9, 1.1);
    s.position.set(x, 0.85, 2.4); s.target.position.set(x * 2.6, -0.6, 18);
    carTilt.add(s, s.target);
    headlights.push(s);
    const beam = new THREE.Mesh(HAZE_GEO, HAZE_MAT); beam.rotation.x = -0.035; carTilt.add(beam); beams.push(beam);
    const glow = glowSprite(C(0xfff4e0), 0.85, 0.75); carTilt.add(glow); headGlows.push(glow);
  });
})();
// ### Shows the chosen vehicle and moves the headlights to fit it.
function setVehicle(key){
  V = VEH[key];
  Object.entries(MODELS).forEach(([k, m]) => { m.g.visible = k === key; });
  headlights.forEach((s, i) => {
    const x = key === 'bike' ? 0 : (i ? 0.62 : -0.62) * (key === 'truck' ? 1.45 : 1.05);
    s.position.set(x, V.lightY, V.light);
    s.target.position.set(x * 2, -0.5, V.light + 16);
    s.intensity = key === 'bike' ? 2.0 : 3.0;
    beams[i].position.copy(s.position); beams[i].visible = key !== 'bike' || i === 0;
    headGlows[i].position.set(x, V.lightY, V.light + 0.08); headGlows[i].visible = beams[i].visible;
  });
  if (audio) setEngineVoice();
}
const car = { x: 0, z: 0, y: 0, heading: 0, speed: 0, steer: 0, pitch: 0, roll: 0, bodyPitch: 0, shake: 0, wheelRot: 0, prevSpeed: 0, lean: 0, lift: 0 };

// ---------- Police ----------
// ### Up to four police cars with flashing light bars, a real point light and a siren. Wanted stars (Core.wantedStars) rise
// ### with time and progress and set how many chase you, how fast, and how quickly wrecked cars come back. In the city police follow the street grid until they see you (line of sight),
// ### They reverse when stuck, can be
// ### rammed until wrecked, and fill the bust meter when they are right next to you while you are nearly stopped.
const police = [];
const policeTex = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = '#f2f3f6'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#1e3fa8'; g.fillRect(0, 44, 256, 10);
  g.fillStyle = '#10131a'; g.font = '800 34px "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
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
    // each car its own paint, so a wreck can go dull and dented while the others stay clean
    const paint = black.clone(); paint.userData.env = black.userData.env; paint.onBeforeCompile = shader => { dentShader(shader); shader.uniforms.uDent = paint.userData.dent; };
    paint.userData.dent = { value: 0 };
    mk(P.bodyOnly, paint); mk(P.roof, white); mk(P.glass, SHARED.glass); mk(P.trim, SHARED.trim); mk(P.chrome, SHARED.chrome); mk(P.tire, SHARED.tire); mk(P.head, SHARED.head); mk(P.tail, SHARED.tail); mk(P.lens, SHARED.lens);
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
    police.push({ g, paint, red, blue, sRed, sBlue, light, idx: i, active: false, wreck: 0, x: 0, z: 0, heading: 0, speed: 0, steer: 0, hp: 3, stun: 0, stuck: 0, rev: 0, wp: null, respawn: 0, hitCool: 0 });
  }
})();
let endReason = '', bumpQuiet = 0;
let spawnTimer = 0, bust = 0, bustGrace = 0, copsWrecked = 0, copsWarned = false, nearestCop = Infinity, stars = 1;
// ### Works out the wanted stars from the time on the run, the progress and the wrecked police cars.
function updateWanted(){
  const progress = gate && gate.active ? 1 : collected / Math.max(1, M.shards);
  const next = Core.wantedStars(stars, heli.runTime, M.time, progress, copsWrecked);
  if (next === stars) return;
  const more = Core.pursuit(next).cops > Core.pursuit(stars).cops;
  stars = next;
  if (stars >= 3) toast(`Wanted level up: ${stars} stars. ${more ? 'More police, and faster.' : 'The police get faster.'}`, 'red', 2400);
}
const snapI = v => clamp(Math.round(v / PITCH) * PITCH, -3 * PITCH, 3 * PITCH);
// ### True if a building stands between two points: the police line of sight.
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
// ### Brings a police car into the chase, behind or near the player but out of sight.
function spawnPolice(p){
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const cands = intersections.filter(q => { const d = Math.hypot(q.x - car.x, q.z - car.z); return d > 70 && d < 150; })
    .sort((a, b) => ((a.x - car.x) * fx + (a.z - car.z) * fz) - ((b.x - car.x) * fx + (b.z - car.z) * fz));
  if (!cands.length) return false;
  const q = cands[Math.floor(Math.random() * Math.min(4, cands.length))], x = q.x, z = q.z;
  Object.assign(p, { x, z, heading: Math.atan2(car.x - x, car.z - z), speed: 6, ri: undefined, road: null, steer: 0, hp: Core.pursuit(stars).hp, stun: 0, stuck: 0, rev: 0, wp: null, active: true, hitCool: 0 });
  fixPolice(p);
  p.g.visible = true;
  return true;
}
// ### Takes a police car out of the chase with a burst of sparks. The wreck stays where it stopped: light bar dead, paint dented
// ### and dull, sagging to one side and smoking from the engine. The same car comes back clean after the time set by the stars.
const WRECK_SMOKE = Object.freeze({ rate: 9, color: 0x232326, opacity: 0.66, rise: 3 });
function wreckPolice(p){
  p.active = false; p.respawn = Core.pursuit(stars).respawn; copsWrecked++;
  burst(p.x, p.g.position.y + 1.2, p.z, SPARKS, 40, 1);
  burst(p.x, p.g.position.y + 1.2, p.z, C(0x2a6bff), 16, 0.8);
  p.light.intensity = 0; p.wreck = 14; p.wreckAge = 0; p.speed = 0;
  p.red.color.setHex(0x2a0a0e); p.blue.color.setHex(0x080e26); p.sRed.material.opacity = 0; p.sBlue.material.opacity = 0;
  p.paint.color.setHex(0x0e0f12); p.paint.clearcoat = 0.15; p.paint.roughness = 0.75; p.paint.userData.dent.value = 0.9;
  // a broken wheel lets it sag to one side; lifted by as much, so the low wheel stays on the road
  const sag = (Math.random() < 0.5 ? -1 : 1) * 0.05;
  p.g.rotation.z = sag; p.g.position.y += 0.95 * Math.abs(Math.sin(sag));
  toast('Police car taken out!', 'gold', 2000);
}
// ### A police car back in the chase: clean paint, working lights, level.
function fixPolice(p){
  p.wreck = 0; p.g.rotation.z = 0;
  p.paint.color.setHex(0x14161c); p.paint.clearcoat = 1; p.paint.roughness = 0.3; p.paint.userData.dent.value = 0;
}
// ### The wrecks smoke for a while; one left far behind is cleared away.
function updateWrecks(dt){
  for (const p of police){
    if (p.active || !p.g.visible) continue;
    // cleared away when far behind, or after half a minute once the player is not looking on (traffic would queue for ever)
    p.wreckAge = (p.wreckAge || 0) + dt;
    const far = Math.hypot(p.x - car.x, p.z - car.z);
    if (far > 260 || (p.wreckAge > 30 && far > 70)){ p.g.visible = false; p.wreck = 0; continue; }
    if (p.wreck > 0){
      p.wreck -= dt;
      p.smokeAcc = (p.smokeAcc || 0) + dt * WRECK_SMOKE.rate * Math.min(1, p.wreck / 4);
      const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
      while (p.smokeAcc >= 1){ p.smokeAcc -= 1; puff(p.x + fx * 1.5, p.g.position.y + 1.0, p.z + fz * 1.5, 0, 0, WRECK_SMOKE); }
    }
  }
}
// ### The police AI each frame: choose a target, steer, control speed, collide, hit the player, fill the bust meter.
function updatePolice(dt){
  const live = state === 'play';
  if (live){
    heli.runTime += dt;
    updateWanted();
    updateWrecks(dt);
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
    if (live && dist > 230){ spawnPolice(p); continue; }
    let tx = car.x + pvx * 0.35, tz = car.z + pvz * 0.35;
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
    const desired = Math.atan2(tx - p.x, tz - p.z);
    const diff = wrapAngle(desired - p.heading);
    const maxP = Core.copTopSpeed(M.police, stars, dist, heli.spotted, Core.gradeAt(mode, p.x, p.z, p.heading));
    if (!live){ p.speed *= Math.exp(-dt * 2); }
    else if (p.rev > 0){ p.rev -= dt; p.speed = Math.max(p.speed - 30 * dt, -8); p.steer = -Math.sign(diff) || 1; }
    else {
      p.steer += (clamp(diff * 2.2, -1, 1) - p.steer) * Math.min(1, 10 * dt);
      let target = maxP * (1 - Math.min(0.65, Math.abs(diff) / Math.PI * 1.5));
      if (dist < 14) target = Math.min(target, Math.abs(car.speed) + 7);
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
      if (d < rr && d > 0.001){ const nx = (p.x - o.x) / d, nz = (p.z - o.z) / d; p.x += nx * (rr - d); p.z += nz * (rr - d); p.speed *= 0.9; if (o.npc){ if (o.npc.stun < 0.5 && Math.abs(p.speed) > 6) shove(o.npc, -nx, -nz, Math.abs(p.speed) * 0.5, o.x, o.z, 1); o.npc.stun = Math.max(o.npc.stun, 1.5); } }
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
        crash(impact * 0.8); sfx.hit(impact, 1);
        p.hp -= impact * V.ram * 0.09;
        p.stun = Math.max(p.stun, 0.4 + V.ram * 0.5);
        car.speed *= V.key === 'truck' ? 0.92 : 0.72; p.speed *= 0.4;
        if (p.hp <= 0) wreckPolice(p);
      }
      break;
    }
  }
  if (live){
    // ### No bust while Marta gets in and for a few seconds after, so you can get going again with her on board
    if (bustGrace > 0) bustGrace -= dt;
    const b = Core.bustStep(bust, nearestCop, car.speed, dt, bustGrace > 0 || (witness.boarding > 0 && !witness.inCar));
    bust = b.bust;
    if (b.busted) gameOver('busted');
  }
}
// ### Flashes the light bars and moves the single point light of each police car.
function updatePoliceVisuals(){
  const phase = Math.floor(clock * 8);
  police.forEach((p, i) => {
    if (!p.active) return;
    p.g.position.set(p.x, groundH(p.x, p.z), p.z); p.g.rotation.set(-Math.atan(Core.gradeAt(mode, p.x, p.z, p.heading)), p.heading, 0, 'YXZ');
    const r = (phase + i) % 2 === 0;
    p.red.color.setHex(r ? 0xff2a3a : 0x3a0610); p.blue.color.setHex(r ? 0x0a1640 : 0x2a6bff);
    p.sRed.material.opacity = r ? 1 : 0.05; p.sBlue.material.opacity = r ? 0.05 : 1;
    p.light.color.setHex(r ? 0xff2a3a : 0x2a6bff); p.light.intensity = 3;
    p.light.position.set(p.x, p.g.position.y + 2.4, p.z);
  });
}
function resetPolice(){
  police.forEach(p => { p.active = false; p.respawn = 0; p.wreck = 0; p.g.visible = false; p.light.intensity = 0; });
  spawnTimer = 4; bust = 0; bustGrace = 0; copsWrecked = 0; copsWarned = false; nearestCop = Infinity; stars = 1;
  heli.runTime = 0; heli.on = false; heli.spotted = false; heli.g.visible = false; heli.beam.visible = false; heli.lamp.intensity = 0;
}

// ---------- Police helicopter ----------
// ### Joins the chase after 60 seconds (or with the fifth star) and stays until the run ends. It flies ahead of the player, so its searchlight is in view from
// ### the chase camera. The light follows the player a little slower than the police can drive: at full speed on a clear road
// ### you stay ahead of it, but every sharp turn or crash lets it catch you. While you are in the light the police know
// ### where you are: they drive 6 % faster and see you from further away. Its searchlight is a real spot light
// ### that is there from the start with no strength, so the scene's shaders never have to change when it arrives.
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
  g.scale.setScalar(1.25);
  g.visible = false; scene.add(g);
  // The searchlight is a real spot light from the nose of the helicopter, with a faint shaft to show where it comes from. It
  // lights the road and the cars under it as they are, from above. (It used to be a glowing disc laid 30 cm over the road, which
  // covered the wheels and made a car look sunk into the ground.) It exists from the start with no strength, so the number of
  // lights never changes and no shader has to be rebuilt when the helicopter arrives.
  const beam = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 24, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 0.5), BEAM_MAT.clone());
  beam.material.opacity = 0.07; beam.visible = false; scene.add(beam);
  const lamp = new THREE.SpotLight(0xe6eeff, 0, 110, Math.atan(Core.SPOT_RADIUS * 1.25 / 31), 0.45, 1);
  scene.add(lamp, lamp.target);
  return { g, rotor, tail, beam, lamp, strobeR, strobeB, on: false, spotted: false, runTime: 0, closing: 0, x: 0, z: 0, sx: 0, sz: 0, h: 0, tilt: 0, roll: 0 };
})();
// ### Flies the helicopter ahead of the player and moves its searchlight after them. In the light the police know where you are.
function updateHeli(dt){
  const live = state === 'play', H = heli;
  if (!H.on){
    if (!live || !Core.helicopterDue(H.runTime, stars)) return;
    toast('Police helicopter overhead! Stay out of its searchlight.', 'red', 3600);
    // it arrives from behind the player and overtakes
    H.on = true; H.x = car.x - Math.sin(car.heading) * 170; H.z = car.z - Math.cos(car.heading) * 170; H.sx = H.x; H.sz = H.z; H.h = car.heading;
    H.g.visible = true; H.beam.visible = true;
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
  const gy = groundH(H.sx, H.sz);
  const lx = H.x + Math.sin(H.h) * 2.15, lz = H.z + Math.cos(H.h) * 2.15;
  // the light, warmer while it holds the player
  H.lamp.position.set(lx, y + 0.55, lz); H.lamp.target.position.set(H.sx, gy, H.sz);
  H.lamp.intensity = 3.2; H.lamp.color.setHex(H.spotted ? 0xfff0d8 : 0xe6eeff);
  H.beam.position.set(lx, y + 0.55, lz); H.beam.lookAt(H.sx, gy, H.sz);
  const L = Math.hypot(H.sx - lx, gy - y - 0.55, H.sz - lz);
  H.beam.scale.set(Core.SPOT_RADIUS, Core.SPOT_RADIUS, L);
}
// moving vehicles as circles (city traffic) for collisions
let frameNo = 0, obsCache = null, obsStamp = -1;
function vehicleObstacles(){
  if (obsStamp === frameNo && obsCache) return obsCache;
  obsStamp = frameNo;
  return (obsCache = buildObstacles());
}
// circles along each kind of vehicle: where they sit from the middle, and their radius
const OBST = { truck: [[-4.2, -1.5, 1.2, 3.6], 1.35], tram: [[-2.9, 0, 2.9], 1.3], bus: [[-4.6, -1.55, 1.55, 4.6], 1.3], coach: [[-4.6, -1.55, 1.55, 4.6], 1.3], moto: [[-0.45, 0.45], 0.55], car: [[-1.2, 1.2], 1.05] };
// ### Lists the moving vehicles near the player as circles, for collisions, and the police wrecks, which stand still.
function buildObstacles(){
  const out = buildTraffic();
  for (const p of police){
    if (p.active || !p.g.visible) continue;
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    for (const o of OBST.car[0]) out.push({ x: p.x + fx * o, z: p.z + fz * o, r: OBST.car[1], npc: null, vx: 0, vz: 0 });
  }
  return out;
}
function buildTraffic(){
  const out = [];
  for (const n of npcs){
    if (!n.on) continue;
    const h = n.h + (n.ph || 0), cx = n.x + (n.px || 0), cz = n.z + (n.pz || 0), fx = Math.sin(h), fz = Math.cos(h);
    if (OBST[n.fleet]){
      for (const o of OBST[n.fleet][0]) out.push({ x: cx + fx * o, z: cz + fz * o, r: OBST[n.fleet][1], npc: n, vx: fx * n.speed, vz: fz * n.speed });
      continue;
    }
    out.push({ x: cx + fx * 1.15, z: cz + fz * 1.15, r: 1.05, npc: n, vx: fx * n.speed, vz: fz * n.speed });
    out.push({ x: cx - fx * 1.15, z: cz - fz * 1.15, r: 1.05, npc: n, vx: fx * n.speed, vz: fz * n.speed });
  }
  return out;
}

// ### Shoving traffic. The rules (weights, how momentum is shared, how much a hit turns a vehicle) are in Core (shoveImpulse,
// ### keepSpeed, shoveSpin). Here the push is kept apart from the vehicle's own lane position (px, pz and the turn ph); it slides
// ### out over the tyres' friction, stops at walls, lamp posts and parked cars, and once the stunned driver has come round, the
// ### vehicle steers back into its lane.
const { MASS, PLAYER_MASS, SHOVE } = Core;
const massOf = o => MASS[o.fleet || o.type] || 1;
// pushes o along (dx, dz) after a hit with this closing speed at the point (hx, hz); mp is the hitter's weight. Returns the share
// of the momentum that went into o (0 for a tram, near 1 for a motorcycle hit by a lorry), so the hitter can keep the rest.
function shove(o, dx, dz, impact, hx, hz, mp){
  const m = massOf(o), { share, dv } = Core.shoveImpulse(impact, mp, m);
  if (!dv) return 0;
  o.pvx = (o.pvx || 0) + dx * dv; o.pvz = (o.pvz || 0) + dz * dv;
  o.pw = (o.pw || 0) + Core.shoveSpin(hx - (o.x + (o.px || 0)), hz - (o.z + (o.pz || 0)), dx, dz, dv, m);
  o.stun = Math.max(o.stun || 0, 2.5);
  return share;
}
function stepShove(o, dt){
  if (!o.pvx && !o.pvz && !o.px && !o.pz && !o.ph && !o.pw) return;
  o.px = (o.px || 0) + (o.pvx || 0) * dt; o.pz = (o.pz || 0) + (o.pvz || 0) * dt; o.ph = (o.ph || 0) + (o.pw || 0) * dt;
  const grip = Math.exp(-dt * SHOVE.grip); o.pvx = (o.pvx || 0) * grip; o.pvz = (o.pvz || 0) * grip; o.pw = (o.pw || 0) * Math.exp(-dt * SHOVE.turnGrip);
  for (const c of collidersNear(o.x + o.px, o.z + o.pz)){
    const hit = collidePoint(o.x + o.px, o.z + o.pz, 1.0, c);
    if (hit){ o.px += hit[0] * hit[2]; o.pz += hit[1] * hit[2]; o.pvx *= 0.2; o.pvz *= 0.2; }
  }
  const L = Math.hypot(o.px, o.pz); if (L > SHOVE.max){ o.px *= SHOVE.max / L; o.pz *= SHOVE.max / L; o.pvx = o.pvz = 0; }
  if ((o.stun || 0) <= 0 && Math.hypot(o.pvx, o.pvz) < SHOVE.rest){
    const back = Math.exp(-dt * SHOVE.back); o.px *= back; o.pz *= back; o.ph *= Math.exp(-dt * SHOVE.turnBack);
    if (Math.abs(o.px) + Math.abs(o.pz) < 0.02 && Math.abs(o.ph) < 0.002) resetShove(o);
  }
}
function resetShove(o){ o.px = o.pz = o.pvx = o.pvz = o.ph = o.pw = 0; }

// ### Pushing parked cars. A parked car hit by the player slides away like traffic (Core.shoveImpulse, with the handbrake's
// ### weight PARKED.brake), turns when hit off its middle, stops at houses, lamp posts and other parked cars (and shoves those
// ### on), and stays where it comes to rest until the next run. Its collider box and radar block move with it.
const { PARKED } = Core;
const parkedMoving = new Set();
// pushes the parked car p along (dx, dz) after a hit with this closing speed at (hx, hz); returns the share of the momentum
function pushParked(p, dx, dz, impact, hx, hz, mp){
  const m = (p.suv ? MASS.suv : MASS.sedan) * PARKED.brake, { share, dv } = Core.shoveImpulse(impact, mp, m);
  if (!dv) return 0;
  p.pvx += dx * dv; p.pvz += dz * dv;
  p.pw += Core.shoveSpin(hx - (p.x + p.px), hz - (p.z + p.pz), dx, dz, dv, m);
  p.moved = true; parkedMoving.add(p);
  return share;
}
// puts the collider box, the radar block and the drawn car where the parked car is now
function placeParked(p){
  const x = p.x + p.px, z = p.z + p.pz, [ex, ez] = Core.parkedBox(p.hx, p.hz, p.ph);
  Object.assign(p.col, { x0: x - ex, x1: x + ex, z0: z - ez, z1: z + ez });
  Object.assign(p.rr, { x0: x - ex, x1: x + ex, z0: z - ez, z1: z + ez });
  p.fleet.set(p.i, x, 0, z, p.h + p.ph, true);
}
function stepParked(dt){
  if (!parkedMoving.size) return;
  const fleets = new Set();
  for (const p of parkedMoving){
    p.px += p.pvx * dt; p.pz += p.pvz * dt; p.ph += p.pw * dt;
    const grip = Math.exp(-dt * PARKED.grip); p.pvx *= grip; p.pvz *= grip; p.pw *= Math.exp(-dt * PARKED.turnGrip);
    // its nose and tail against houses, posts and the other parked cars
    const fx = Math.sin(p.h + p.ph), fz = Math.cos(p.h + p.ph);
    for (const s of [-1.35, 0, 1.35]) for (const c of CITY.colliders){
      if (c === p.col) continue;
      const hit = collidePoint(p.x + p.px + fx * s, p.z + p.pz + fz * s, 0.95, c);
      if (!hit) continue;
      const into = -(p.pvx * hit[0] + p.pvz * hit[1]);
      p.px += hit[0] * hit[2]; p.pz += hit[1] * hit[2];
      if (into > 0){
        // another parked car takes half of the push, a house or a post stops it
        if (c.car && into > 0.6) pushParked(c.car, -hit[0], -hit[1], into, p.x + p.px + fx * s, p.z + p.pz + fz * s, (p.suv ? MASS.suv : MASS.sedan) * PARKED.brake);
        p.pvx += hit[0] * into; p.pvz += hit[1] * into; p.pvx *= 0.7; p.pvz *= 0.7; p.pw *= 0.6;
      }
    }
    const L = Math.hypot(p.px, p.pz); if (L > PARKED.max){ p.px *= PARKED.max / L; p.pz *= PARKED.max / L; p.pvx = p.pvz = 0; }
    if (Math.hypot(p.pvx, p.pvz) < PARKED.rest && Math.abs(p.pw) < 0.02){ p.pvx = p.pvz = p.pw = 0; parkedMoving.delete(p); }
    placeParked(p); fleets.add(p.fleet);
  }
  for (const f of fleets) f.commit();
}
// a new run: every parked car back in its place
function resetParked(){
  parkedMoving.clear();
  if (!CITY.parked) return;
  const fleets = new Set();
  for (const p of CITY.parked){ if (!p.moved) continue; resetShove(p); p.moved = false; placeParked(p); fleets.add(p.fleet); }
  for (const f of fleets) f.commit();
}

// ---------- Pickups (placed fresh every run) ----------
// ### placeRun places the pieces of evidence, the green repair kits and the finish gate: the evidence in parks, on the squares
// ### and on roads, the gate at the south-west corner of the Baixa, on the way to the bridge.
const ringGeo = new THREE.RingGeometry(1.8, 2.3, 32); ringGeo.rotateX(-Math.PI / 2);
const kitMat = new THREE.MeshStandardMaterial({ color: 0xd8ffe9, emissive: GREEN, emissiveIntensity: 1.2, flatShading: true, roughness: 0.3 });
const kitBar1 = new THREE.BoxGeometry(1.6, 0.5, 0.5), kitBar2 = new THREE.BoxGeometry(0.5, 1.6, 0.5);
let runGroup = null, items = [], kits = [], gate = null;

// ### The six pieces of evidence in Lisbon, each a small model that floats and turns where the star shards would be. They are
// ### about one and a half times life size, and slightly self-lit, so they can be seen from the car at night.
const printTexture = (() => {
  const c = document.createElement('canvas'); c.width = 128; c.height = 160;
  const g = c.getContext('2d'); g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, 128, 160);
  g.strokeStyle = '#2a2f3a'; g.lineWidth = 2.2;
  for (let k = 1; k < 14; k++){ g.beginPath(); g.ellipse(64, 70, 4 + k * 3.4, 6 + k * 4.4, 0.15, Math.PI * 0.05 * (k % 3), Math.PI * (1.9 + 0.05 * (k % 2))); g.stroke(); }
  g.fillStyle = '#b3262c'; g.fillRect(0, 138, 128, 22); g.fillStyle = '#fff'; g.font = '700 15px "Segoe UI", sans-serif'; g.fillText('EVIDENCE', 26, 154);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
})();
const photoTexture = (() => {
  const c = document.createElement('canvas'); c.width = 128; c.height = 100;
  const g = c.getContext('2d'); g.fillStyle = '#f7f5ef'; g.fillRect(0, 0, 128, 100);
  const sky = g.createLinearGradient(0, 8, 0, 78); sky.addColorStop(0, '#1d2a44'); sky.addColorStop(1, '#3b3a4a'); g.fillStyle = sky; g.fillRect(8, 8, 112, 70);
  g.fillStyle = '#c9a94a'; g.fillRect(70, 22, 30, 40); g.fillStyle = '#0d0f14'; g.fillRect(76, 30, 12, 28); g.beginPath(); g.arc(82, 30, 5, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
})();
function evidenceModel(key){
  const g = new THREE.Group(), lit = (color, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0.22 }, extra || {}));
  const add = (geo, mat, x, y, z, rx, ry, rz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); m.rotation.set(rx || 0, ry || 0, rz || 0); m.castShadow = true; g.add(m); return m; };
  if (key === 'photos'){
    // three prints fanned out
    [-0.32, 0, 0.32].forEach((r, i) => add(new THREE.BoxGeometry(0.62, 0.48, 0.015), new THREE.MeshStandardMaterial({ map: photoTexture, emissive: 0xffffff, emissiveMap: photoTexture, emissiveIntensity: 0.45, roughness: 0.5 }), (i - 1) * 0.14, (i - 1) * -0.03, i * 0.02, 0, 0, r));
  } else if (key === 'prints'){
    // a fingerprint card in a clear evidence bag, with a DNA swab
    add(new THREE.BoxGeometry(0.5, 0.64, 0.012), new THREE.MeshStandardMaterial({ map: printTexture, emissive: 0xffffff, emissiveMap: printTexture, emissiveIntensity: 0.45, roughness: 0.5 }));
    add(new THREE.BoxGeometry(0.62, 0.8, 0.05), new THREE.MeshStandardMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.22, roughness: 0.1, depthWrite: false }), 0, -0.04, 0);
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 6), lit(0xe8e8e8), 0.36, -0.1, 0.05, 0, 0, 0.5);
    add(new THREE.SphereGeometry(0.035, 8, 6).scale(1, 1.6, 1), lit(0xffffff, { emissiveIntensity: 0.5 }), 0.49, 0.13, 0.05);
  } else if (key === 'torch'){
    const body = new THREE.Group(); body.rotation.set(0, 0, Math.PI / 2 - 0.25); g.add(body);
    const b = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; body.add(m); };
    b(new THREE.CylinderGeometry(0.075, 0.075, 0.62, 14), lit(0x1c1d21, { roughness: 0.7, emissiveIntensity: 0.15 }), 0);
    b(new THREE.CylinderGeometry(0.13, 0.085, 0.2, 16), lit(0x9aa2ab, { metalness: 0.7, roughness: 0.3 }), 0.4);
    b(new THREE.CircleGeometry(0.12, 18).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }), 0.505);
    b(new THREE.BoxGeometry(0.05, 0.08, 0.03), lit(0xb3262c), 0.1);
  } else if (key === 'lockpick'){
    // a tension wrench and a hook pick on a small leather wallet
    add(new THREE.BoxGeometry(0.7, 0.04, 0.42), lit(0x5a3a26, { roughness: 0.8 }), 0, -0.2, 0, 0.35, 0, 0);
    const steel = lit(0xc9d1d9, { metalness: 0.8, roughness: 0.25, emissiveIntensity: 0.35 });
    add(new THREE.BoxGeometry(0.62, 0.025, 0.025), steel, 0, 0.02, 0);
    add(new THREE.BoxGeometry(0.025, 0.09, 0.025), steel, 0.31, 0.055, 0);
    add(new THREE.BoxGeometry(0.2, 0.06, 0.05), lit(0x202226), -0.24, 0.02, 0);
    add(new THREE.BoxGeometry(0.46, 0.02, 0.02), steel, 0.02, -0.09, 0.07);
    add(new THREE.BoxGeometry(0.02, 0.12, 0.02), steel, -0.2, -0.04, 0.07);
  } else if (key === 'clothes'){
    // a folded dark hoodie and trousers, as found in a bag
    const cloth = lit(0x46536b, { roughness: 0.95, emissiveIntensity: 0.45 });
    add(new THREE.BoxGeometry(0.78, 0.16, 0.56), lit(0x3a3f4a, { roughness: 0.95, emissiveIntensity: 0.45 }), 0, -0.14, 0);
    add(new THREE.BoxGeometry(0.72, 0.15, 0.52), cloth, 0.02, 0.02, 0.01, 0, 0.06, 0);
    add(new THREE.TorusGeometry(0.15, 0.04, 8, 18, Math.PI), cloth, 0.02, 0.1, -0.2, -Math.PI / 2, 0, 0);
    add(new THREE.BoxGeometry(0.06, 0.02, 0.3), lit(0x8a8f99), 0.12, 0.1, 0.05);
  } else {
    // the balaclava: a knitted head shape with one slit for the eyes
    add(new THREE.SphereGeometry(0.3, 20, 16).scale(0.92, 1.18, 1), lit(0x34363e, { roughness: 1, emissiveIntensity: 0.5 }));
    add(new THREE.BoxGeometry(0.34, 0.08, 0.1), new THREE.MeshBasicMaterial({ color: 0x050506 }), 0, 0.07, 0.25);
    add(new THREE.TorusGeometry(0.19, 0.022, 6, 24).scale(1, 0.32, 1), lit(0x8d909a, { emissiveIntensity: 0.5 }), 0, 0.07, 0.24);
    add(new THREE.CylinderGeometry(0.24, 0.28, 0.14, 18), lit(0x34363e, { roughness: 1, emissiveIntensity: 0.5 }), 0, -0.38, 0);
  }
  if (key === 'photos' || key === 'prints' || key === 'lockpick') g.rotation.x = -0.6;
  g.scale.setScalar(1.5);
  const turn = new THREE.Group(); turn.add(g);
  return turn;
}

function glowSprite(color, size, opacity){
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: opacity || 1 }));
  s.scale.setScalar(size);
  return s;
}

// ### Sets up one run: places the shards, repair kits and finish gate for the current map.
function placeRun(){
  resetParked();
  if (runGroup){
    scene.remove(runGroup);
    runGroup.traverse(o => {
      if (o.material && o.material !== kitMat) o.material.dispose();
      if (o.geometry && o.geometry !== ringGeo && o.geometry !== kitBar1 && o.geometry !== kitBar2 && !o.isSprite) o.geometry.dispose();
    });
  }
  runGroup = new THREE.Group(); scene.add(runGroup);
  items = []; kits = [];
  const rnd = Math.random;
  const chosen = [], kitSpots = [];
  let gp, gateR, gateY, gateRot = 0;
  const lane = s => { const side = rnd() < 0.5 ? -3.5 : 3.5; return s.axis === 'x' ? { x: s.x, z: s.z + side } : { x: s.x + side, z: s.z }; };
  const far = (p, list, d) => list.every(q => Math.hypot(q.x - p.x, q.z - p.z) >= d);
  chosen.push({ x: -3.5, z: 24 });
  shuffle(shardSpots.slice(), rnd).forEach(p => { if (chosen.length < 4 && far(p, chosen, 36)) chosen.push(p); });
  const roads = shuffle(roadSpots.slice(), rnd);
  for (const s of roads){ if (chosen.length >= M.shards) break; const p = lane(s); if (Math.hypot(p.x, p.z) > 30 && far(p, chosen, 36)) chosen.push(p); }
  for (const s of roads){ if (kitSpots.length >= M.kits) break; const p = lane(s); if (far(p, chosen, 25) && far(p, kitSpots, 60) && Math.hypot(p.x, p.z) > 40) kitSpots.push(p); }
  // the south-west corner of the Baixa, where Rua do Crucifixo meets the river avenue: the way out to the 25 de Abril bridge.
  // The gate faces west, up the approach road that climbs to the bridge.
  gp = { x: -144, z: 144 }; gateRot = -Math.PI / 2;
  gateR = 5.4; gateY = 5.8;

  chosen.forEach((s, i) => {
    const g = new THREE.Group(); g.position.set(s.x, groundH(s.x, s.z) + (s.park ? 0.12 : 0), s.z);
    const ev = Core.EVIDENCE[i % Core.EVIDENCE.length];
    const gem = evidenceModel(ev.key); gem.position.y = 1.9; gem.castShadow = true;
    const glow = glowSprite(SPARK, 7, 0.95); glow.position.y = 1.9;
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: SPARK, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.y = 0.06;
    g.add(gem, glow, ring); runGroup.add(g);
    items.push({ x: s.x, z: s.z, s: s.s, group: g, gem, glow, ring, ev, taken: false, phase: i * 1.7 });
  });
  kitSpots.forEach((s, i) => {
    const g = new THREE.Group(); g.position.set(s.x, groundH(s.x, s.z), s.z);
    const cross = new THREE.Group(); cross.position.y = 1.6;
    cross.add(new THREE.Mesh(kitBar1, kitMat), new THREE.Mesh(kitBar2, kitMat));
    const glow = glowSprite(GREEN, 5, 0.8); glow.position.y = 1.6;
    g.add(cross, glow); runGroup.add(g);
    kits.push({ x: s.x, z: s.z, group: g, cross, taken: false, phase: i * 2.1 });
  });

  const pg = new THREE.Group(); pg.position.set(gp.x, groundH(gp.x, gp.z), gp.z); pg.rotation.y = gateRot;
  const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(gateR, 0.5, 10, 48), new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: GOLD, emissiveIntensity: 1.3, flatShading: true, roughness: 0.3, metalness: 0.4 }));
  ringMesh.position.y = gateY; ringMesh.castShadow = true;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(gateR - 0.4, 40), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  disc.position.y = gateY;
  const beamGeo = new THREE.CylinderGeometry(1.6, 1.6, 220, 16, 1, true); beamGeo.translate(0, 110, 0);
  const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  const pglow = glowSprite(GOLD, gateR * 3.3); pglow.position.y = gateY;
  pg.add(ringMesh, disc, beam, pglow);
  runGroup.add(pg);
  pg.visible = false;
  gate = { x: gp.x, z: gp.z, group: pg, ring: ringMesh, disc, beam, active: false, grow: 0 };
}

// ---------- Particles & smoke ----------
// ### Core.smokeFor says how the damaged engine smokes: from thin grey to a thick black column rising above the vehicle, and
// ### flames near the end. Sprites come from fixed pools, so nothing is allocated. (The sparks of crashes and pickups are with the
// ### scraping sparks below.)
// ### Smoke puffs are soft, lumpy clouds, not round glows: a few textures painted from many overlapping blobs, so no two
// ### puffs look alike. Each puff starts small and dense at the engine, swells quickly and then more slowly, turns while it
// ### drifts, slows as it rises, is carried off by a light wind and thins out and turns paler as it spreads.
const SMOKE_TEX = [11, 23, 37].map(seed => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), r = mulberry32(seed);
  for (let k = 0; k < 22; k++){
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 30, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, rad = 14 + r() * 22;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,' + (0.18 + r() * 0.16) + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  // fade the edge, so the square of the sprite never shows
  g.globalCompositeOperation = 'destination-in';
  const edge = g.createRadialGradient(64, 64, 20, 64, 64, 64);
  edge.addColorStop(0, 'rgba(0,0,0,1)'); edge.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = edge; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
});
const SMOKE_PALE = C(0x77777d), SMOKE_WIND = [0.9, 0.5];
const smoke = [], flames = [];
for (let i = 0; i < 140; i++){
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: SMOKE_TEX[i % SMOKE_TEX.length], color: 0x4a4a50, transparent: true, depthWrite: false, opacity: 0 }));
  s.visible = false; scene.add(s);
  smoke.push({ s, life: 0, vx: 0, vy: 0, vz: 0, peak: 0.5, grow: 5, size: 0.5, decay: 0.3, spin: 0, phase: 0, c0: new THREE.Color(), c1: new THREE.Color() });
}
for (let i = 0; i < 14; i++){
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: SMOKE_TEX[i % SMOKE_TEX.length], color: 0xff7a1e, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending }));
  s.visible = false; scene.add(s);
  flames.push({ s, life: 0, vx: 0, vy: 0, vz: 0 });
}
const FLAME_HOT = C(0xffd27a), FLAME_COOL = C(0xff4a12);
let smokeAcc = 0, smokeIdx = 0, flameAcc = 0, flameIdx = 0;
// ### Removes all sparks, smoke and flames, so that a new run does not start next to the smoke of the last one.
function clearEffects(){
  smoke.concat(flames).forEach(p => { p.life = 0; p.s.visible = false; });
  smokeAcc = flameAcc = 0;
  clearSparks();
}
// ### Emits the smoke and flames that Core.smokeFor asks for at the current damage, and lets them rise and fade.
// ### Lets one puff of smoke rise from a point: P is what Core.smokeFor returns; vx, vz is how the source is moving.
function puff(ox, oy, oz, vx, vz, P){
  const p = smoke[smokeIdx++ % smoke.length];
  // thicker smoke billows into bigger clouds and hangs in the air longer
  p.life = 1; p.s.visible = true; p.peak = P.opacity * (0.7 + Math.random() * 0.25);
  p.size = 0.3 + Math.random() * 0.3; p.grow = 1.6 + P.rate * 0.07 + Math.random() * 1.2; p.decay = 0.46 - P.rate * 0.004 + Math.random() * 0.1;
  p.s.material.rotation = Math.random() * Math.PI * 2; p.spin = (Math.random() - 0.5) * 0.9; p.phase = Math.random() * 6.28;
  p.s.position.set(ox + (Math.random() - 0.5) * 0.5, oy, oz + (Math.random() - 0.5) * 0.5);
  p.vx = (Math.random() - 0.5) * 0.9 - vx * 0.2; p.vy = P.rise * (0.7 + Math.random() * 0.5); p.vz = (Math.random() - 0.5) * 0.9 - vz * 0.2;
  p.c0.set(P.color); p.c1.copy(p.c0).lerp(SMOKE_PALE, 0.55);
  p.s.material.color.copy(p.c0);
}
function updateSmoke(dt){
  const P = Core.smokeFor(damage), md = MODELS[V.key];
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading), ox = car.x + fx * md.smoke[0], oz = car.z + fz * md.smoke[0], oy = car.y + md.smoke[1];
  if (state === 'play' && P.rate > 0){
    smokeAcc += dt * P.rate;
    while (smokeAcc >= 1){ smokeAcc -= 1; puff(ox, oy, oz, fx * car.speed, fz * car.speed, P); }
    if (P.fire){
      flameAcc += dt * 26;
      while (flameAcc >= 1){
        flameAcc -= 1;
        const p = flames[flameIdx++ % flames.length];
        p.life = 1; p.s.visible = true;
        p.s.position.set(ox + (Math.random() - 0.5) * 0.5, oy - 0.1, oz + (Math.random() - 0.5) * 0.5);
        p.vx = (Math.random() - 0.5) * 0.6 - fx * car.speed * 0.3; p.vy = 1.8 + Math.random() * 1.6; p.vz = (Math.random() - 0.5) * 0.6 - fz * car.speed * 0.3;
      }
    }
  }
  for (const p of smoke){
    if (p.life <= 0) continue;
    p.life -= dt * p.decay;
    const age = 1 - Math.max(0, p.life);
    // the air drags the puff towards the wind; the hot smoke slows as it rises and cools, and it wobbles a little
    p.vx += (SMOKE_WIND[0] - p.vx) * Math.min(1, dt * 0.7); p.vz += (SMOKE_WIND[1] - p.vz) * Math.min(1, dt * 0.7);
    p.vy *= 1 - Math.min(1, dt * 0.35);
    const wob = Math.sin(clock * 1.7 + p.phase) * 0.35;
    p.s.position.x += (p.vx + wob) * dt; p.s.position.y += p.vy * dt; p.s.position.z += (p.vz - wob * 0.6) * dt;
    p.s.material.rotation += p.spin * dt * (1 - age * 0.6);
    p.s.scale.setScalar(p.size + p.grow * Math.sqrt(age));
    p.s.material.color.copy(p.c0).lerp(p.c1, age);
    // quick to appear, then it fades as it spreads
    p.s.material.opacity = Math.min(1, age * 7) * Math.pow(Math.max(0, p.life), 1.4) * p.peak;
    if (p.life <= 0) p.s.visible = false;
  }
  for (const p of flames){
    if (p.life <= 0) continue;
    p.life -= dt * 2.6;
    p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
    p.s.scale.setScalar(0.35 + p.life * 1.0);
    p.s.material.color.copy(FLAME_COOL).lerp(FLAME_HOT, Math.max(0, p.life));
    p.s.material.rotation += dt * 2;
    p.s.material.opacity = Math.max(0, p.life) * 0.85;
    if (p.life <= 0) p.s.visible = false;
  }
}

// ### Skid marks: dark strips behind the rear wheels while the tyres slide (Core.skidAmount). They use a fixed ring of quads, so
// ### a long drive never allocates more; the oldest fade out before they are overwritten. Each corner is placed with groundH, so the
// ### marks lie on the hills, 5 cm above the road and its painted lines, and they darken what is under them instead of covering it.
const SKID_QUADS = 900, SKID_FADE = 60, SKID_STEP = 0.7, SKID_LIFT = 0.05;
const skids = (() => {
  const g = new THREE.BufferGeometry(), pos = new Float32Array(SKID_QUADS * 18), col = new Float32Array(SKID_QUADS * 18).fill(1);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  g.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }));
  mesh.frustumCulled = false; mesh.renderOrder = 1; scene.add(mesh);
  return { mesh, g, pos, col, head: 0, used: 0, dark: new Float32Array(SKID_QUADS), last: [] };
})();
function resetSkids(){ skids.head = 0; skids.used = 0; skids.last = []; skids.g.setDrawRange(0, 0); }
function shadeSkid(q, v){ for (let i = q * 18; i < (q + 1) * 18; i++) skids.col[i] = v; }
function addSkidQuad(a, b, shade){
  const q = skids.head, c = [a.lx, a.ly, a.lz, a.rx, a.ry, a.rz, b.rx, b.ry, b.rz, a.lx, a.ly, a.lz, b.rx, b.ry, b.rz, b.lx, b.ly, b.lz];
  skids.pos.set(c, q * 18); skids.dark[q] = shade; shadeSkid(q, shade);
  skids.head = (q + 1) % SKID_QUADS; skids.used = Math.min(SKID_QUADS, skids.used + 1);
  // the oldest quads are next in line: they fade towards nothing, so marks never vanish with a hard edge
  if (skids.used === SKID_QUADS) for (let k = 0; k < SKID_FADE; k++){
    const old = (skids.head + k) % SKID_QUADS, f = k / SKID_FADE;
    shadeSkid(old, 1 - (1 - skids.dark[old]) * f);
  }
}
function updateSkids(){
  const md = MODELS[V.key], S = md.skid, amount = Core.skidAmount(car.speed, keys.down, keys.brake, car.steer);
  if (!amount){ skids.last = []; return; }
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading), rx = -fz, rz = fx;
  let wrote = false;
  S.x.forEach((off, i) => {
    const cx = car.x + fx * S.z + rx * off, cz = car.z + fz * S.z + rz * off, prev = skids.last[i];
    if (prev && Math.hypot(cx - prev.x, cz - prev.z) < SKID_STEP) return;
    const hw = S.w / 2, lx = cx - rx * hw, lz = cz - rz * hw, x2 = cx + rx * hw, z2 = cz + rz * hw;
    const now = { x: cx, z: cz, lx, ly: groundH(lx, lz) + SKID_LIFT, lz, rx: x2, ry: groundH(x2, z2) + SKID_LIFT, rz: z2 };
    if (prev){
      addSkidQuad(prev, now, Math.pow(1 - 0.8 * amount, 2.2)); wrote = true;
      // burning rubber: a thin, low puff of pale smoke behind the tyre
      if (amount > 0.6 && Math.random() < 0.5){
        const p = smoke[smokeIdx++ % smoke.length];
        p.life = 1; p.s.visible = true; p.peak = 0.2; p.grow = 2.6; p.s.material.color.set(0x9a9aa2);
        p.s.position.set(cx, now.ly + 0.25, cz); p.vx = -fx * car.speed * 0.12; p.vy = 0.55; p.vz = -fz * car.speed * 0.12;
      }
    }
    skids.last[i] = now;
  });
  if (wrote){
    skids.g.attributes.position.needsUpdate = true; skids.g.attributes.color.needsUpdate = true;
    skids.g.setDrawRange(0, skids.used * 6);
  }
}

// ### Scraping (Core.scrapeLevel): sliding along a wall or another vehicle throws sparks, lays scratches on the wall and grinds.
// ### The sparks are a fixed pool of glowing streaks, a line from where each spark is to where it was a moment ago with a glow at
// ### its head. They fly on with part of the car's speed, so they trail behind it, fall, bounce once off the ground and cool from
// ### white over orange to nothing. The scratches are a ring of instanced quads on the wall: pale scraped streaks with some of the
// ### car's paint in them, laid every SCRAPE.step metres; before the oldest are reused they thin out, so none vanish at once.
// ### Crashes, a wreck and pickups throw sparks from the same pool (burst): hot metal sparks for crashes, which cool like the
// ### scraping ones, and coloured glowing sparks for shards, evidence, kits and the gate, which float a little longer.
const SPARK_POOL = 480, SPARK_TRAIL = 0.035, SPARK_FALL = 16;
const sparks = (() => {
  const geo = (n, k) => { const g = new THREE.BufferGeometry(), pos = new Float32Array(n * k), col = new Float32Array(n * k);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage)); return { g, pos, col }; };
  const line = geo(SPARK_POOL, 6), head = geo(SPARK_POOL, 3);
  const lines = new THREE.LineSegments(line.g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  const glow = new THREE.Points(head.g, new THREE.PointsMaterial({ map: glowTexture, vertexColors: true, size: 0.32, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  lines.frustumCulled = glow.frustumCulled = false; lines.renderOrder = glow.renderOrder = 2; scene.add(lines, glow);
  const p = []; for (let i = 0; i < SPARK_POOL; i++) p.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, floor: 0, bounced: false, fall: SPARK_FALL, tint: null, trail: SPARK_TRAIL });
  return { line, head, p, idx: 0, acc: 0, live: false };
})();
// ### Throws n sparks from a point of contact: along the scrape (tx, tz) with part of the sliding speed, out of the surface (nx, nz)
// ### and up; (vx, vz) is how the other side moves, if it is a vehicle.
function emitSparks(sc, n){
  for (let k = 0; k < n; k++){
    const p = sparks.p[sparks.idx++ % SPARK_POOL], f = sc.along * (0.25 + Math.random() * 0.5), o = 0.8 + Math.random() * 3.2;
    p.life = p.max = 0.3 + Math.random() * 0.45; p.bounced = false; p.fall = SPARK_FALL; p.tint = null; p.trail = SPARK_TRAIL;
    p.x = sc.x + (Math.random() - 0.5) * 0.3; p.y = sc.y + (Math.random() - 0.5) * 0.2; p.z = sc.z + (Math.random() - 0.5) * 0.3; p.floor = sc.floor;
    p.vx = sc.tx * f + sc.nx * o + sc.vx * 0.6 + (Math.random() - 0.5) * 2.5;
    p.vz = sc.tz * f + sc.nz * o + sc.vz * 0.6 + (Math.random() - 0.5) * 2.5;
    p.vy = 0.8 + Math.random() * 4.2;
  }
  if (n) sparks.live = true;
}
// ### Throws a burst of n sparks from a point in all directions. The orange crash colour (SPARKS) gives hot metal sparks that
// ### streak out fast, fall, bounce off the ground and cool from white to orange; any other colour gives softer glowing sparks of
// ### that colour that start white-hot and fall more slowly. spread scales how far they fly.
function burst(x, y, z, color, n, spread){
  spread = spread || 1;
  const hot = color === SPARKS, floor = groundH(x, z) + 0.05;
  for (let k = 0; k < n; k++){
    const p = sparks.p[sparks.idx++ % SPARK_POOL], a = Math.random() * Math.PI * 2;
    const out = (hot ? 4 + Math.random() * 11 : 2.5 + Math.random() * 6) * spread, up = (hot ? 2 + Math.random() * 8 : 3 + Math.random() * 7) * spread;
    p.x = x + (Math.random() - 0.5) * 0.3; p.y = y + (Math.random() - 0.5) * 0.3; p.z = z + (Math.random() - 0.5) * 0.3; p.floor = Math.min(floor, p.y);
    p.vx = Math.cos(a) * out; p.vz = Math.sin(a) * out; p.vy = up;
    p.life = p.max = hot ? 0.35 + Math.random() * 0.55 : 0.6 + Math.random() * 0.6; p.bounced = false;
    p.fall = hot ? SPARK_FALL : 7; p.tint = hot ? null : color; p.trail = hot ? 0.045 : 0.07;
  }
  if (n) sparks.live = true;
}
function updateSparks(dt){
  if (!sparks.live) return;
  const L = sparks.line, H = sparks.head;
  let any = false;
  for (let i = 0; i < SPARK_POOL; i++){
    const p = sparks.p[i], a = i * 6, b = i * 3;
    if (p.life <= 0){ L.col.fill(0, a, a + 6); H.col.fill(0, b, b + 3); continue; }
    any = true;
    p.life -= dt; p.vy -= p.fall * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    // a spark hits the ground once and skips on, low and slower; then it slides and dies out
    if (p.y < p.floor){ p.y = p.floor; if (!p.bounced){ p.vy *= -0.35; p.vx *= 0.55; p.vz *= 0.55; p.bounced = true; } else { p.vy = 0; p.vx *= 0.9; p.vz *= 0.9; } }
    const t = clamp(p.life / p.max, 0, 1), br = Math.min(1, t * 2.5);
    let r, g, bl;
    if (p.tint){
      // a coloured spark: white-hot at first, then its own colour, fading out
      const w = Math.max(0, (t - 0.7) / 0.3) * 0.7;
      r = (p.tint.r + (1 - p.tint.r) * w) * br; g = (p.tint.g + (1 - p.tint.g) * w) * br; bl = (p.tint.b + (1 - p.tint.b) * w) * br;
    } else { r = br; g = (0.28 + 0.67 * t * t) * br; bl = (0.04 + 0.6 * t * t * t) * br; }
    L.pos[a] = p.x; L.pos[a + 1] = p.y; L.pos[a + 2] = p.z;
    L.pos[a + 3] = p.x - p.vx * p.trail; L.pos[a + 4] = p.y - p.vy * p.trail; L.pos[a + 5] = p.z - p.vz * p.trail;
    L.col[a] = r; L.col[a + 1] = g; L.col[a + 2] = bl; L.col[a + 3] = r * 0.25; L.col[a + 4] = g * 0.2; L.col[a + 5] = bl * 0.1;
    H.pos[b] = p.x; H.pos[b + 1] = p.y; H.pos[b + 2] = p.z; const hb = p.tint ? 1 : 0.7; H.col[b] = r * hb; H.col[b + 1] = g * hb; H.col[b + 2] = bl * hb;
  }
  for (const G of [L, H]){ G.g.attributes.position.needsUpdate = true; G.g.attributes.color.needsUpdate = true; }
  sparks.live = any;
}
function clearSparks(){
  sparks.p.forEach(p => { p.life = 0; });
  sparks.line.col.fill(0); sparks.head.col.fill(0); sparks.acc = 0; sparks.live = false;
  for (const G of [sparks.line, sparks.head]) G.g.attributes.color.needsUpdate = true;
}
const scratches = (() => {
  const N = Core.SCRAPE.marks, c = document.createElement('canvas'); c.width = 256; c.height = 32;
  const g = c.getContext('2d'), r = mulberry32(5);
  // many fine streaks of different strength, as left by an edge dragged along the wall, a few of them deep and bright
  for (let k = 0; k < 80; k++){
    const y = 4 + r() * 24, x = r() * 80 - 30, len = 90 + r() * 200;
    g.strokeStyle = 'rgba(255,255,255,' + (0.2 + r() * 0.6).toFixed(2) + ')'; g.lineWidth = 0.5 + r() * (r() < 0.15 ? 2.4 : 1.1);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y + (r() - 0.5) * 3); g.stroke();
  }
  // soften the top and bottom edge, so the quad never shows
  g.globalCompositeOperation = 'destination-in';
  const edge = g.createLinearGradient(0, 0, 0, 32);
  edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(0.25, 'rgba(0,0,0,1)'); edge.addColorStop(0.75, 'rgba(0,0,0,1)'); edge.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = edge; g.fillRect(0, 0, 256, 32);
  const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; tex.wrapS = THREE.RepeatWrapping;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85, roughness: 0.6, metalness: 0.15, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < N; i++) mesh.setColorAt(i, WHITE);
  mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 1; scene.add(mesh);
  // per mark: x, y, z, turn, length, height (kept to thin the oldest out)
  return { mesh, N, data: new Float32Array(N * 6), head: 0, used: 0, last: null, m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), v: new THREE.Vector3(), s: new THREE.Vector3(), col: new THREE.Color() };
})();
function placeScratch(i, thin){
  const S = scratches, d = S.data, k = i * 6;
  S.v.set(d[k], d[k + 1], d[k + 2]); S.e.set(0, d[k + 3], 0); S.q.setFromEuler(S.e); S.s.set(d[k + 4], Math.max(0.001, d[k + 5] * thin), 1);
  S.mesh.setMatrixAt(i, S.m.compose(S.v, S.q, S.s));
}
// mostly the pale of scraped stone and bare metal, with a little of the car's paint rubbed into it
const SCRATCH_PALE = C(0xd2cdc4);
function addScratch(ax, az, bx, bz, nx, nz, y, h, inset){
  const S = scratches, i = S.head, k = i * 6, FADE = Core.SCRAPE.fade;
  S.data.set([(ax + bx) / 2 + nx * (0.02 - inset), y, (az + bz) / 2 + nz * (0.02 - inset), Math.atan2(nx, nz), Math.hypot(bx - ax, bz - az) + 0.2, h], k);
  placeScratch(i, 1);
  S.mesh.setColorAt(i, S.col.copy(SCRATCH_PALE).lerp(MODELS[V.key].paint.color, 0.2 + Math.random() * 0.25));
  S.head = (i + 1) % S.N; S.used = Math.min(S.N, S.used + 1); S.mesh.count = S.used;
  if (S.used === S.N) for (let j = 0; j < FADE; j++) placeScratch((S.head + j) % S.N, j / FADE);
  S.mesh.instanceMatrix.needsUpdate = true; S.mesh.instanceColor.needsUpdate = true;
}
function resetScratches(){ const S = scratches; S.head = S.used = 0; S.last = null; S.mesh.count = 0; }
// the height of the scrape above the road for each vehicle: its bumper and the side of its body
const SCRAPE_AT = { car: [0.38, 0.5], bike: [0.32, 0.42], truck: [0.5, 0.75] };
const scrapeNow = { level: 0, along: 0, x: 0, y: 0, z: 0, floor: 0, nx: 0, nz: 0, tx: 0, tz: 0, vx: 0, vz: 0, c: null };
// ### Called after each frame's contacts: throws the sparks and lays the scratch. Only walls of houses, parked cars and the
// ### walls get scratches, as only those stand where the side of a car touches them.
function scrapeEffects(dt){
  const sc = scrapeNow;
  if (!sc.level){ scratches.last = null; sparks.acc = 0; return; }
  sparks.acc += Core.sparkCount(sc.level, dt);
  const n = Math.floor(sparks.acc); sparks.acc -= n; emitSparks(sc, n);
  // a parked car that has been pushed gets no more scratches, as they would stay behind where it stood
  const c = sc.c, wall = c && (c.t === 'b' || (c.t === 'p' && !(c.car && c.car.moved)) || (c.t === 'w' && c.x0 === -0.5));
  if (!wall){ scratches.last = null; return; }
  const at = SCRAPE_AT[V.key] || SCRAPE_AT.car, y = c.t === 'w' ? car.y + 0.2 : car.y + at[1], last = scratches.last;
  const now = { x: sc.x, z: sc.z, nx: sc.nx, nz: sc.nz, c };
  if (!last || last.c !== c || last.nx * sc.nx + last.nz * sc.nz < 0.95){ scratches.last = now; return; }
  const d = Math.hypot(sc.x - last.x, sc.z - last.z);
  if (d < Core.SCRAPE.step) return;
  // the box of a parked car is a little wider than its body
  if (d < 3) addScratch(last.x, last.z, sc.x, sc.z, sc.nx, sc.nz, y, 0.05 + 0.08 * sc.level, c.t === 'p' ? 0.08 : c.t === 'w' ? 0.05 : 0);
  scratches.last = now;
}

// ---------- Sound: engine with rpm and an automatic gearbox, plus siren ----------
// ### Everything is synthesised with the Web Audio API, no sound files. core.js models each engine (ENGINES, engineLoops) and
// ### renders loops at five rpms, each once under load and once on overrun, the way racing games use recorded engine loops.
// ### Here they are pitched to the current rpm and crossfaded by rpm and throttle. The throttle closes for each gear change, so
// ### the revs audibly fall into the next gear. Road rumble, gearbox whine, wind and tyres follow the speed; the truck adds a
// ### lagging turbo and air brakes; a second oscillator with a slow LFO is the police siren.
let audio = null, muted = false;
// ### The three volume sliders: the game, the music and the police (sirens and helicopter). The music can be heard for a moment
// ### while its slider moves, even in the menu or the pause. The police volume is kept under its own key.
const volume = Object.assign(Core.parseVolume(readStore('shard-heist-volume')), { police: Core.parseLevel(readStore('shard-heist-police-volume')) });
let musicPreview = 0;
function setVolume(kind, value){
  volume[kind] = clamp(value, 0, 1);
  if (kind === 'police') writeStore('shard-heist-police-volume', String(volume.police));
  else writeStore('shard-heist-volume', JSON.stringify({ game: volume.game, music: volume.music }));
  card.querySelectorAll(`[data-vol="${kind}"]`).forEach(r => { r.value = Math.round(volume[kind] * 100); const o = r.parentNode.querySelector('output'); if (o) o.textContent = r.value + '%'; });
  if (!audio) return;
  const g = kind === 'game' ? audio.gameVol : kind === 'police' ? audio.policeVol : audio.musicVol;
  g.gain.setTargetAtTime(Core.volumeGain(volume[kind]), audio.ctx.currentTime, 0.03);
}
const VOL_LABELS = { game: ['Game', 'Game volume: engine, tyres and effects'], music: ['Music', 'Music volume: the radio'], police: ['Police', 'Police volume: sirens and the helicopter'] };
const volumeRow = () => `<div class="vol">${['game', 'music', 'police'].map(k => `<label>${VOL_LABELS[k][0]} <input type="range" min="0" max="100" step="5" data-vol="${k}" value="${Math.round(volume[k] * 100)}" aria-label="${VOL_LABELS[k][1]}"><output>${Math.round(volume[k] * 100)}%</output></label>`).join('')}</div>`;
const ENGINES = Core.ENGINES;
const eng = { rpm: 750, gear: 1, shift: 0, load: 0, boost: 0, miss: 0, prevPedal: 0, prevBrake: false, popTime: 0 };
// ### Creates the audio graph on the first click or key. Browsers do not allow sound before the player has done something.
function initAudio(){
  if (audio){ if (audio.ctx.state === 'suspended') audio.ctx.resume(); return; }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain(); master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
    // the player's volumes: everything of the game goes through gameVol, the radio through musicVol; the sirens and the
    // helicopter go through policeVol first, so they can be turned down (or up) on their own
    const gameVol = ctx.createGain(), musicVol = ctx.createGain(), policeVol = ctx.createGain();
    gameVol.gain.value = Core.volumeGain(volume.game); musicVol.gain.value = Core.volumeGain(volume.music); policeVol.gain.value = Core.volumeGain(volume.police);
    policeVol.connect(comp);
    comp.connect(gameVol).connect(master); musicVol.connect(master); master.connect(ctx.destination);
    const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };
    // ### The engine bus. Pitched loops alone are too even, which makes an engine hum like a drone. So after the loops:
    // ### grit, a level that wobbles with slow random noise, as no two firings are equally strong; a little more low end and
    // ### less of the thin, buzzing band around 2.5 kHz; and a soft saturation, as a real exhaust distorts at full throttle.
    // ### Beside the loops runs the exhaust roar, broadband noise around the firing frequency that grows with throttle and rpm.
    const bus = gain(0), grit = gain(1);
    const gritF = ctx.createBiquadFilter(); gritF.type = 'lowpass'; gritF.frequency.value = 26;
    const gritDepth = gain(0); noise().connect(gritF).connect(gritDepth).connect(grit.gain);
    const lowShelf = ctx.createBiquadFilter(); lowShelf.type = 'lowshelf'; lowShelf.frequency.value = 120; lowShelf.gain.value = 3;
    const buzzCut = ctx.createBiquadFilter(); buzzCut.type = 'peaking'; buzzCut.frequency.value = 2500; buzzCut.Q.value = 0.8; buzzCut.gain.value = -6;
    // makeup brings quiet sounds back to their old level (drive x the slope of the curve at zero), so only loud ones are squeezed
    const drive = gain(2.2), shaper = ctx.createWaveShaper(), makeup = gain(Math.tanh(1.6) / (2.2 * 1.6));
    shaper.curve = (() => { const c = new Float32Array(1024); for (let i = 0; i < c.length; i++){ const x = i / (c.length - 1) * 2 - 1; c[i] = Math.tanh(1.6 * x) / Math.tanh(1.6); } return c; })();
    shaper.oversample = '2x';
    bus.connect(grit).connect(lowShelf).connect(buzzCut).connect(drive).connect(shaper).connect(makeup).connect(comp);
    const roarF = ctx.createBiquadFilter(); roarF.type = 'bandpass'; roarF.Q.value = 0.7; roarF.frequency.value = 160;
    const roar = gain(0); noise().connect(roarF).connect(roar).connect(bus);
    const roadF = ctx.createBiquadFilter(); roadF.type = 'lowpass'; roadF.frequency.value = 240;
    const road = gain(0); noise().connect(roadF).connect(road).connect(comp);
    const windF = ctx.createBiquadFilter(); windF.type = 'highpass'; windF.frequency.value = 700;
    const wind = gain(0); noise().connect(windF).connect(wind).connect(comp);
    const tireF = ctx.createBiquadFilter(); tireF.type = 'bandpass'; tireF.frequency.value = 2300; tireF.Q.value = 9;
    const tire = gain(0); noise().connect(tireF).connect(tire).connect(comp);
    // ### The grind of a scrape: noise through a broad band and a narrow metallic ring above it, whose level crackles with slow
    // ### random noise, as the contact catches and lets go. updateEngine sets its level and pitch from the scrape.
    const scrapeF = ctx.createBiquadFilter(); scrapeF.type = 'bandpass'; scrapeF.frequency.value = 2200; scrapeF.Q.value = 1.2;
    const scrapeRing = ctx.createBiquadFilter(); scrapeRing.type = 'bandpass'; scrapeRing.frequency.value = 4700; scrapeRing.Q.value = 7;
    const scrapeAm = gain(0.45), scrapeAmF = ctx.createBiquadFilter(); scrapeAmF.type = 'lowpass'; scrapeAmF.frequency.value = 40;
    const scrapeSrc = ctx.createBufferSource(); scrapeSrc.buffer = noiseBuf; scrapeSrc.loop = true; scrapeSrc.start(0, 0.77);
    scrapeSrc.connect(scrapeAmF).connect(gain(1.8)).connect(scrapeAm.gain);
    const scrape = gain(0), scrapeIn = noise(); scrapeIn.connect(scrapeF).connect(scrapeAm); scrapeIn.connect(scrapeRing).connect(gain(0.9)).connect(scrapeAm);
    scrapeAm.connect(scrape).connect(comp);
    const popF = ctx.createBiquadFilter(); popF.type = 'bandpass'; popF.frequency.value = 1100; popF.Q.value = 1.6;
    popF.connect(comp);
    const airF = ctx.createBiquadFilter(); airF.type = 'highpass'; airF.frequency.value = 3000;
    airF.connect(comp);
    const rotorData = Core.rotorLoop(Core.ENGINE_SR, 7), rotorBuf = ctx.createBuffer(1, rotorData.length, Core.ENGINE_SR); rotorBuf.copyToChannel(rotorData, 0);
    const rotorSrc = ctx.createBufferSource(); rotorSrc.buffer = rotorBuf; rotorSrc.loop = true; rotorSrc.start();
    const rotorF = ctx.createBiquadFilter(); rotorF.type = 'lowpass'; rotorF.frequency.value = 900;
    const rotor = gain(0); rotorSrc.connect(rotorF).connect(rotor).connect(policeVol);
    const radioBus = gain(0), radioComp = ctx.createDynamicsCompressor(); radioComp.threshold.value = -14; radioComp.ratio.value = 6; radioBus.connect(radioComp).connect(musicVol);
    const whine = ctx.createOscillator(); whine.type = 'sine';
    const whineG = gain(0); whine.connect(whineG).connect(comp);
    const turbo = ctx.createOscillator(); turbo.type = 'sine'; turbo.frequency.value = 1800;
    const turboG = gain(0); turbo.connect(turboG).connect(comp);
    const siren = ctx.createOscillator(); siren.type = 'triangle'; siren.frequency.value = 950;
    const sirenLfo = ctx.createOscillator(); sirenLfo.frequency.value = 0.32;
    const sirenDepth = gain(330); sirenLfo.connect(sirenDepth).connect(siren.frequency);
    const sirenGain = gain(0); siren.connect(sirenGain).connect(policeVol);
    [turbo, whine, siren, sirenLfo].forEach(o => o.start());
    audio = { ctx, master, gameVol, musicVol, policeVol, comp, bus, gritDepth, roar, roarF, layers: [], voice: null, bufs: {}, noiseBuf, radioBus, road, rotor, scrape, scrapeF, rotorF, rotorSrc, wind, tire, popF, airF, turbo, turboG, whine, whineG, sirenGain, sirenLfo };
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
// ### The radio: every note of Core.radioBar is played on a small synthesised instrument. Drums are filtered noise and pitched
// ### sines; guitars and leads go through a distortion bus; the melodica has a dub echo. Notes are scheduled a little ahead on the
// ### audio clock, one bar at a time, so they stay in time even when the frame rate drops. The stations have no audio files.
const radio = { key: 'off', out: null, drive: null, echo: null, bar: 0, next: 0 };
const mtof = n => 440 * Math.pow(2, (n - 69) / 12);
// ### Creates one station's outputs: dry, a distortion bus for guitars and leads, and an echo.
function radioBuses(){
  const ctx = audio.ctx, out = ctx.createGain(); out.connect(audio.radioBus);
  const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++){ const x = i / 512 - 1; curve[i] = Math.tanh(x * 7) * 0.8; }
  const drive = ctx.createWaveShaper(); drive.curve = curve; drive.oversample = '2x';
  // ### Plays a short sequence of notes: pickups, crashes and results.
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 3600;
  drive.connect(tone).connect(out);
  const echo = ctx.createDelay(1.5); echo.delayTime.value = 0.75 * 60 / Core.RADIO[radio.key].bpm;
  const back = ctx.createGain(); back.gain.value = 0.42; echo.connect(back).connect(echo); echo.connect(out);
  radio.out = out; radio.drive = drive; radio.echo = echo;
}
// ### Plays one oscillator note with a short envelope and an optional filter, then frees itself.
function radioOsc(type, f, at, dur, level, dest, opt){
  const o = opt || {}, ctx = audio.ctx, osc = ctx.createOscillator(), g = ctx.createGain(), stop = at + dur + (o.release || 0.03);
  osc.type = type; osc.frequency.setValueAtTime(f, at); if (o.detune) osc.detune.value = o.detune;
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, at + (o.glide || dur));
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(level, at + (o.attack || 0.006));
  if (o.hold) g.gain.setValueAtTime(level, at + dur);
  g.gain.exponentialRampToValueAtTime(0.0001, stop);
  let last = osc.connect(g);
  if (o.lp){ const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = o.q || 0.7; fl.frequency.setValueAtTime(o.lp, at); if (o.lpTo) fl.frequency.exponentialRampToValueAtTime(o.lpTo, at + dur); last = last.connect(fl); }
  last.connect(dest); osc.start(at); osc.stop(stop + 0.02);
}
// ### Plays one filtered burst of noise: the base of every drum and cymbal.
function radioNoise(type, f, Q, at, dur, level, dest){
  const ctx = audio.ctx, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = audio.noiseBuf; fl.type = type; fl.frequency.value = f; fl.Q.value = Q;
  g.gain.setValueAtTime(level, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(fl).connect(g).connect(dest); s.start(at, Math.random() * 1.5, dur + 0.02);
}
// ### Plays one note of Core.radioBar on the instrument it names.
function radioNote(e, at, beat){
  const out = radio.out, drive = radio.drive, f = mtof(e.n), dur = e.d * beat, v = e.v;
  switch (e.i){
    case 'kick': radioOsc('sine', 130, at, 0.24, v * 0.95, out, { to: 46, glide: 0.09 }); break;
    case 'hkick': radioOsc('sine', mtof(e.n + 36), at, 0.34, v * 0.5, drive, { to: mtof(e.n + 12), glide: 0.1 }); radioNoise('highpass', 2500, 0.7, at, 0.03, 0.35, out); break;
    case 'rbass': radioOsc('sawtooth', f, at, dur, v * 0.3, drive, { attack: dur * 0.85, lp: 900 }); break;
    case 'snare': radioNoise('bandpass', 1900, 0.7, at, 0.17, v * 0.7, out); radioOsc('triangle', 190, at, 0.1, v * 0.3, out); break;
    case 'rim': radioNoise('bandpass', 2500, 3, at, 0.06, v * 0.7, out); break;
    case 'clap': radioNoise('bandpass', 1400, 1, at, 0.16, v * 0.7, out); break;
    case 'hat': radioNoise('highpass', 7500, 0.7, at, 0.045, v * 0.32, out); break;
    case 'ohat': radioNoise('highpass', 6500, 0.7, at, 0.16, v * 0.3, out); break;
    case 'crash': radioNoise('highpass', 4200, 0.7, at, dur, v * 0.45, out); break;
    case 'sub': radioOsc('sine', f, at, dur, v * 0.6, out); break;
    case 'bass': radioOsc('sine', f, at, dur, v * 0.6, out); radioOsc('triangle', f, at, dur, v * 0.28, out, { lp: 500 }); break;
    case 'acid': radioOsc('sawtooth', f, at, dur, 0.24, out, { lp: 240 + 2800 * v, lpTo: 200, q: 11 }); break;
    case 'skank': radioOsc('square', f, at, dur, v * 0.18, out, { lp: 2100 }); break;
    case 'organ': radioOsc('square', f, at, dur, v * 0.2, out, { lp: 900 }); break;
    case 'stab': radioOsc('sawtooth', f, at, dur, v * 0.3, radio.echo, { lp: 1500, lpTo: 400 }); radioOsc('sawtooth', f, at, dur, v * 0.3, out, { lp: 1500, lpTo: 400 }); break;
    case 'brass': radioOsc('sawtooth', f, at, dur, v * 0.3, out, { lp: 2300, attack: 0.015 }); break;
    case 'pluck': radioOsc('triangle', f, at, dur, v * 0.5, out); radioOsc('sawtooth', f, at, dur * 0.5, v * 0.14, out, { lp: 3000 }); break;
    case 'accordion': radioOsc('square', f, at, dur, v * 0.2, out, { lp: 2600, detune: -7, attack: 0.02, hold: true }); radioOsc('square', f, at, dur, v * 0.2, out, { lp: 2600, detune: 7, attack: 0.02, hold: true }); break;
    case 'lead': radioOsc('sawtooth', f, at, dur, v * 0.17, out, { lp: 3400, detune: 6, hold: true }); radioOsc('triangle', f, at, dur, v * 0.32, out, { hold: true }); break;
    case 'melodica': radioOsc('triangle', f, at, dur, v * 0.34, out, { attack: 0.03 }); radioOsc('triangle', f, at, dur, v * 0.22, radio.echo, { attack: 0.03 }); break;
    case 'screech': [-16, 0, 16].forEach(d => radioOsc('sawtooth', f, at, dur, v * 0.14, drive, { detune: d, hold: true })); break;
    case 'strings': [-6, 6].forEach(d => radioOsc('sawtooth', f, at, dur, v * 0.1, out, { lp: 1700, detune: d, attack: Math.min(0.5, dur * 0.25), hold: true, release: 0.25 })); break;
    case 'piano': radioOsc('triangle', f, at, Math.min(dur, 2.4), v * 0.42, out, { attack: 0.004 }); radioOsc('sine', f * 2, at, Math.min(dur, 1.2), v * 0.12, out, { attack: 0.004 }); break;
    case 'guitar': radioOsc('sawtooth', f, at, dur, v * 0.24, drive, { hold: true }); radioOsc('square', f * 1.003, at, dur, v * 0.14, drive, { hold: true }); break;
    case 'chug': radioOsc('sawtooth', f, at, dur, v * 0.3, drive, { lp: 650 }); break;
    case 'gbass': radioOsc('sawtooth', f, at, dur, v * 0.3, out, { lp: 480 }); break;
    case 'solo': radioOsc('sawtooth', f, at, dur, v * 0.2, drive, { hold: true }); break;
  }
}
// ### Schedules the next bar ahead on the audio clock, and silences the radio outside of driving.
function updateRadio(){
  if (!audio) return;
  const t = audio.ctx.currentTime, playing = radio.key !== 'off' && volume.music > 0 && (state === 'play' || performance.now() < musicPreview) && !muted;
  audio.radioBus.gain.setTargetAtTime(playing ? 0.9 * (Core.RADIO[radio.key].level || 1) : 0, t, 0.08);
  if (!playing) return;
  if (!radio.out) radioBuses();
  if (radio.next < t) radio.next = t + 0.06;
  const beat = 60 / Core.RADIO[radio.key].bpm;
  while (radio.next < t + 0.6){
    Core.radioBar(radio.key, radio.bar).forEach(e => radioNote(e, radio.next + e.t * beat, beat));
    radio.bar++; radio.next += 4 * beat;
  }
}
// Switch station: the old station's notes, already scheduled, fade out on their own bus
function setStation(key, announce){
  radio.key = Core.parseRadio(key);
  writeStore('shard-heist-radio', radio.key);
  if (radio.out){ const old = radio.out, ctx = audio.ctx; old.gain.setTargetAtTime(0, ctx.currentTime, 0.05); setTimeout(() => old.disconnect(), 400); }
  radio.out = null; radio.bar = 0; radio.next = 0;
  const on = radio.key !== 'off', name = on ? Core.RADIO[radio.key].name : 'Off';
  $('radioTag').hidden = !on; $('radioTag').textContent = on ? name : '';
  $('btnRadio').classList.toggle('on', on);
  $('btnRadio').setAttribute('aria-label', 'Radio: ' + name + '. Press to change station');
  card.querySelectorAll('[data-radio]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.radio === radio.key)));
  if (announce) toast('Radio: ' + name, 'gold', 1600);
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
    o.connect(g).connect(audio.gameVol);
    o.start(st); o.stop(st + dur + 0.05);
  });
}
let hitQuiet = 0;
const sfx = {
  collect: () => tone([880, 1175, 1568], 0.18, 'triangle', 0.14),
  repair: () => tone([392, 523, 659], 0.16, 'square', 0.06),
  gate: () => tone([523, 659, 784, 1047, 1319], 0.26, 'sine', 0.12),
  crash: k => tone([110 + k * 2, 70], 0.16, 'square', Math.min(0.14, 0.04 + k * 0.004)),
  // ### Hitting another vehicle sounds like what it is: the lighter it is, the higher and shorter the crunch of metal (a motorcycle
  // ### clatters), the heavier, the deeper and longer the boom under it (a bus or a lorry thuds). Louder the harder the hit. Several
  // ### contacts within a quarter of a second count as one crash, so a scrape does not rattle.
  hit: (k, m) => {
    if (!audio || muted || clock < hitQuiet) return;
    hitQuiet = clock + 0.25;
    const ctx = audio.ctx, t = ctx.currentTime, w = clamp(Number.isFinite(m) ? m : 1, 0.2, 5), loud = clamp(0.08 + k * 0.012, 0.08, 0.5);
    // the crunch: noise through a band that sits lower the heavier the vehicle
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3400 / (1 + w * 1.1); bp.Q.value = 1.4; bp.connect(audio.gameVol);
    noiseBurst(t, bp, loud, 0.12 + 0.05 * w);
    // a light vehicle rings: two short metallic partials
    if (w < 0.6){ tone([2200, 3300], 0.06, 'square', loud * 0.12); }
    // the body of the hit: a falling low tone, deeper and longer for a heavy vehicle
    const o = ctx.createOscillator(), gg = ctx.createGain(), f = 140 / (1 + w * 0.6), len = Math.min(0.5, 0.14 + 0.08 * w);
    o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.5, t + len);
    gg.gain.setValueAtTime(0.0001, t); gg.gain.exponentialRampToValueAtTime(loud * (0.5 + w * 0.15), t + 0.01); gg.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(gg).connect(audio.gameVol); o.start(t); o.stop(t + len + 0.05);
  },
  win: () => tone([659, 784, 988, 1319], 0.3, 'triangle', 0.13),
  // ### Nitro: a rising whoosh of noise over a deep surge that fades with the burn; a charge filling up chimes softly.
  nitro: () => {
    if (!audio || muted) return;
    const ctx = audio.ctx, t = ctx.currentTime, len = Core.NITRO.time;
    const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = audio.noiseBuf; s.loop = true; bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(3200, t + 0.45); bp.frequency.exponentialRampToValueAtTime(1400, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.08); g.gain.exponentialRampToValueAtTime(0.12, t + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.3);
    s.connect(bp).connect(g).connect(audio.gameVol); s.start(t, Math.random() * 1.5); s.stop(t + len + 0.4);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(110, t + len);
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.07, t + 0.1); og.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    o.connect(lp).connect(og).connect(audio.gameVol); o.start(t); o.stop(t + len + 0.3);
  },
  nitroReady: () => tone([1047, 1568], 0.12, 'sine', 0.07),
  fail: () => tone([392, 330, 262], 0.3, 'sine', 0.12),
  zap: () => tone([180, 90], 0.14, 'sawtooth', 0.07),
  // the old plank door of the tunnel: the latch clacks, then the hinges creak long and slow, twice, as they do in room 1.
  // Room 1 plays recordings; room 2 has no sound files, so the creak is drawn: a falling sawtooth through a narrow filter.
  creak: () => {
    if (!audio || muted) return;
    const ctx = audio.ctx, t0 = ctx.currentTime;
    noiseBurst(t0, audio.gameVol, 0.1, 0.08);
    const groan = (f0, f1, at, dur, vol) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), bp = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
      bp.type = 'bandpass'; bp.frequency.value = 820; bp.Q.value = 2.5;
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(bp).connect(g).connect(audio.gameVol); o.start(at); o.stop(at + dur + 0.05);
    };
    groan(118, 80, t0 + 0.2, 1.1, 0.09); groan(160, 104, t0 + 0.75, 0.8, 0.06);
  },
  // a car door: the latch clicks open, or shuts with a dull thud
  door: open => {
    if (!audio || muted) return;
    if (open) tone([1400, 900], 0.035, 'square', 0.03);
    else { noiseBurst(audio.ctx.currentTime, audio.gameVol, 0.22, 0.09); tone([120, 70], 0.1, 'triangle', 0.1); }
  },
  // a wheel over a tram rail: a short metallic clack with a dull thump under it, louder the faster the wheel hits it
  rail: k => {
    if (!audio || muted) return;
    const ctx = audio.ctx, bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1300 + Math.random() * 400; bp.Q.value = 3; bp.connect(audio.gameVol);
    noiseBurst(ctx.currentTime, bp, 0.12 + k * 0.3, 0.05);
    setTimeout(() => bp.disconnect(), 300);
    tone([85, 55], 0.07, 'triangle', 0.04 + k * 0.08);
  },
};
const engineNorm = () => { const E = ENGINES[V.key]; return clamp((eng.rpm - E.idle) / (E.max - E.idle), 0, 1); };
function engineRpm(){ return eng.rpm; }
// ### Runs the gearbox and rpm each frame, crossfades the engine loops, and sets road, wind, tyre, turbo and rotor levels.
function updateEngine(dt){
  const sp = Math.abs(car.speed), live = state === 'play' || garage.live || (finale.on && finale.ramp), E = ENGINES[V.key];
  // on the bridge of the finale nobody holds a key: updateFinale works the throttle; under the music the engine fades out (finale.level)
  const cine = finale.on && finale.placed;
  const pedal = live ? (keys.up || (keys.down && car.speed <= 0.5) ? 1 : 0) : cine ? finale.throttle : 0;
  const braking = live && Core.isBraking(car.speed, keys.down, keys.up, keys.brake);
  if (live || cine){ const g = Core.gearFor(E, eng.gear, car.speed, pedal); if (g > eng.gear) eng.shift = E.shift; eng.gear = g; }
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
  const hunt = w[0] * offW * (0.012 * Math.sin(clock * 2.1) + 0.007 * Math.sin(clock * 5.3 + 1));
  // the revs are never perfectly steady: a small random drift, wider at low rpm and under load
  eng.flutter = clamp((eng.flutter || 0) * Math.exp(-dt * 6) + (Math.random() - 0.5) * dt * (0.25 + 0.35 * eng.load), -0.012, 0.012);
  a.layers.forEach((l, i) => { const r = i >> 1; l.src.playbackRate.setTargetAtTime(clamp(rpm / l.ref * (1 + eng.flutter) + hunt, 0.4, 2.5), t, 0.02); l.g.gain.setTargetAtTime(w[r] * (i & 1 ? offW * (r ? 1 : E.idling.gain) : onW), t, 0.03); });
  // grit and exhaust roar (see initAudio): rougher and louder the harder the engine works
  const firing = rpm / 60 * E.cyl / 2;
  // the 26 Hz noise is weak (about 2.4 % of full scale), so this gives a wobble of about 4 % at idle and 12 % flat out
  a.gritDepth.gain.setTargetAtTime(1.6 + 3.4 * eng.load * (0.4 + 0.6 * norm), t, 0.05);
  a.roarF.frequency.setTargetAtTime(80 + firing * 1.8, t, 0.03);
  a.roar.gain.setTargetAtTime(0.55 * (0.2 + 0.8 * eng.load) * (0.3 + 0.7 * norm), t, 0.05);
  const on = (live || cine) && !muted;
  // the engine is quieter than the music, and drops further under it while the radio plays
  const under = radio.key !== 'off' && volume.music > 0.05 ? 0.55 : 1;
  let vol = (0.2 + 0.05 * eng.load) * E.vol * under;
  // a badly damaged engine misfires
  if (live && damage >= 50 && Math.random() < dt * (damage - 40) / 10) eng.miss = 0.05;
  if (eng.miss > 0){ eng.miss -= dt; vol *= 0.4; }
  // on foot in the garage the engines are off: the chosen one is first heard when the player sits in it and starts it
  a.bus.gain.setTargetAtTime(state === 'menu' || state === 'pause' || muted || (garage.on && !garage.live) || (state === 'over' && endReason === 'wrecked') ? 0 : on ? vol * (finale.on ? finale.level * finale.level : 1) : vol * 0.3, t, 0.03);
  if (on && E.pops){
    if (eng.prevPedal && !pedal && norm > 0.45) eng.popTime = 0.7;
    if (eng.popTime > 0){ eng.popTime -= dt; if (Math.random() < dt * 14) noiseBurst(t + Math.random() * 0.02, a.popF, 0.1 + Math.random() * 0.14, 0.03 + Math.random() * 0.03); }
  }
  if (E.turbo){
    // the turbo spools up slowly under load and vents when the driver lifts
    const want = eng.load * norm;
    eng.boost += (want - eng.boost) * Math.min(1, dt * (want > eng.boost ? 1.3 : 4));
    a.turbo.frequency.setTargetAtTime(1400 + 4200 * eng.boost, t, 0.1);
    a.turboG.gain.setTargetAtTime(on ? E.turbo * 0.6 * eng.boost : 0, t, 0.1);
    if (on && eng.prevPedal && !pedal && eng.boost > 0.25) noiseBurst(t, a.airF, 0.1, 0.45);
  } else a.turboG.gain.setTargetAtTime(0, t, 0.1);
  if (on && E.air && eng.prevBrake && !braking && sp > 2) noiseBurst(t, a.airF, 0.16, 0.55);
  eng.prevPedal = pedal; eng.prevBrake = braking;
  a.whine.frequency.setTargetAtTime(Math.max(60, sp * E.whine[0] * (car.speed < 0 ? 1.8 : 1)), t, 0.05);
  // the gearbox whine is a faint tone under the engine; louder, it is the drone-like hum that real cars do not have
  a.whineG.gain.setTargetAtTime(on ? E.whine[1] * 0.3 * Math.min(1, sp / 12) * (car.speed < -0.3 ? 3 : 0.4 + 0.6 * eng.load) : 0, t, 0.08);
  a.road.gain.setTargetAtTime(on ? Math.pow(sp / 55, 1.4) * 0.1 * E.road * under : 0, t, 0.15);
  const rotorDist = heli.on ? Math.hypot(heli.x - car.x, heli.z - car.z) : 300, rotorNear = clamp(1 - rotorDist / 240, 0.2, 1);
  a.rotor.gain.setTargetAtTime(on && heli.on ? 0.42 * rotorNear : 0, t, 0.3);
  a.rotorF.frequency.setTargetAtTime(500 + 3500 * rotorNear * rotorNear, t, 0.3);
  a.rotorSrc.playbackRate.setTargetAtTime(1 + clamp(heli.closing / 340, -0.08, 0.08), t, 0.3);
  a.wind.gain.setTargetAtTime(on ? Math.pow(sp / 55, 2) * 0.06 * under : 0, t, 0.2);
  const squeal = Core.skidAmount(car.speed, keys.down, keys.brake, car.steer) * 0.075;
  a.tire.gain.setTargetAtTime(on ? squeal : 0, t, 0.06);
  const grind = on && live ? scrapeNow.level : 0;
  a.scrape.gain.setTargetAtTime(grind ? 0.05 + 0.17 * grind : 0, t, grind ? 0.02 : 0.07);
  a.scrapeF.frequency.setTargetAtTime(1500 + 2300 * grind, t, 0.05);
  const sirenVol = !muted && (state === 'play' || state === 'over') && nearestCop < Infinity ? 0.075 * clamp(1 - nearestCop / 220, 0, 1) : 0;
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
const boundaryRect = () => [-LIMIT - 1.6, LIMIT + 1.6, -LIMIT - 1.6, LIMIT + 1.6];
// ### Builds the glowing force-field walls at the edge of the current map.
function buildBoundary(){
  if (BOUND.mesh){ scene.remove(BOUND.mesh); BOUND.mesh.geometry.dispose(); }
  const [x0, x1, z0, z1] = boundaryRect(), y0 = -24, H = 56;
  const side = (len, rot, x, z) => { const g = new THREE.PlaneGeometry(len, H, Math.max(1, Math.round(len / 20)), 1); g.rotateY(rot); g.translate(x, y0 + H / 2, z); return g; };
  const parts = [side(x1 - x0, 0, (x0 + x1) / 2, z0), side(x1 - x0, 0, (x0 + x1) / 2, z1), side(z1 - z0, Math.PI / 2, x0, (z0 + z1) / 2), side(z1 - z0, Math.PI / 2, x1, (z0 + z1) / 2)];
  BOUND.mesh = new THREE.Mesh(mergeGeos(parts), boundMat);
  BOUND.mesh.frustumCulled = false; BOUND.mesh.renderOrder = 2;
  scene.add(BOUND.mesh);
}
function boundaryDistance(){
  return Core.edgeDistance(boundaryRect(), car.x, car.z, 1.6);
}
// ### Animates the force field, and pushes the player back with a spark when they touch it.
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
    const onX = Math.abs(car.x - ex) < Math.abs(car.z - ez);
    burst(onX ? ex : px, car.y + 1, onX ? pz : ez, C(0xff4d5a), 14, 0.6);
    car.shake = Math.max(car.shake, 0.3);
    sfx.zap();
  }
  // the outer streets of the city are part of the map, so there the warning only comes when heading for the edge
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading), out = Math.abs(car.x) > Math.abs(car.z) ? Math.sign(car.x) * fx : Math.sign(car.z) * fz;
  const warn = out * Math.sign(car.speed || 1) > 0.35;
  const prox = warn ? clamp(1 - d / 20, 0, 1) : 0, show = warn && d < 12;
  ui.edge.style.opacity = prox.toFixed(2);
  if (show !== BOUND.shown){ ui.edgeBanner.classList.toggle('show', show); BOUND.shown = show; }
  if (show){
    const [x0, x1, z0, z1] = boundaryRect();
    const tx = (x0 + x1) / 2, tz = (z0 + z1) / 2;
    const rel = wrapAngle(Math.atan2(tx - car.x, tz - car.z) - car.heading);
    ui.edgeArrow.style.transform = `rotate(${(-rel * 180 / Math.PI).toFixed(1)}deg)`;
  }
}

// ---------- Input ----------
// ### Keyboard (WASD/arrows, space, C, E, P, M, Enter) and on-screen touch pads both write into the same keys object.
const keys = { up: false, down: false, left: false, right: false, brake: false, look: false, nitro: false };
const keyMap = Core.KEY_MAP, held = new Set(), crashGuard = Core.newCrashGuard();
addEventListener('keydown', e => {
  if (!$('fatal').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  // typing a driver name: the letters go into the field, not to the car, and Enter saves the name
  if (e.target && e.target.classList && e.target.classList.contains('drv-input')){
    if (e.code === 'Enter' || e.code === 'NumpadEnter'){
      e.preventDefault();
      if (e.repeat) return;
      const f = e.target.dataset.accField;
      if (f) accountAction(f === 'play' ? 'play' : f === 'name' ? 'name' : 'in', e.target); else addDriverFrom(e.target);
    }
    return;
  }
  // on a volume slider the arrow keys move the slider, not the car
  if (e.target && e.target.type === 'range' && /^(Arrow|Home|End|Page)/.test(e.code)) return;
  if (e.repeat && e.code === 'Enter'){ e.preventDefault(); return; }
  if (e.repeat && !Object.hasOwn(keyMap, e.code)) return;
  const onButton = !overlay.hidden && document.activeElement && document.activeElement.tagName === 'BUTTON' && card.contains(document.activeElement);
  if ((e.code === 'Enter' || e.code === 'Space') && onButton){ e.preventDefault(); if (!e.repeat) document.activeElement.click(); return; }
  if (Object.hasOwn(keyMap, e.code)){ held.add(e.code); keys[keyMap[e.code]] = true; e.preventDefault(); }
  if (e.code === Core.LOOK.key){ keys.look = true; e.preventDefault(); }
  if (e.code === Core.NITRO.key){ keys.nitro = true; e.preventDefault(); }
  if (e.code === 'KeyP' || e.code === 'Escape'){ if (state === 'play') pause(); else if (state === 'pause') resume(); else if (garage.live && garage.phase === 'drive') garagePick(true); }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') garage.run = true;
  if (e.code === 'KeyM'){ if (state === 'play') showMap(); else if (state === 'pause' && mapOpen) resume(); }
  if (e.code === 'KeyN') toggleSound();
  if (e.code === 'KeyR'){ initAudio(); setStation(Core.radioNext(radio.key, e.shiftKey ? -1 : 1), true); }
  if (e.code === 'Enter' && !overlay.hidden){ const b = card.querySelector('.btn'); if (b){ e.preventDefault(); b.click(); } }
});
addEventListener('keyup', e => {
  if (Object.hasOwn(keyMap, e.code)){ held.delete(e.code); keys[keyMap[e.code]] = Core.actionHeld(held, keyMap[e.code]); }
  if (e.code === Core.LOOK.key) keys.look = false;
  if (e.code === Core.NITRO.key) keys.nitro = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') garage.run = false;
});
addEventListener('blur', () => { garage.run = false; held.clear(); Object.keys(keys).forEach(k => keys[k] = false); if (state === 'play') pause(); });
// The engine must never keep running when the tab is hidden: suspend all audio, resume when visible again
// The error screen pauses the run and silences the engine
addEventListener('shardheist:fatal', () => { if (state === 'play') pause(); if (audio) audio.ctx.suspend(); $('fatalReload').focus(); });
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
  const on = e => { e.preventDefault(); keys[k] = true; keys.brake = keys.up && keys.down; btn.classList.add('down'); try { btn.setPointerCapture(e.pointerId); } catch (_) {} initAudio(); };
  const off = () => { keys[k] = false; keys.brake = keys.up && keys.down; btn.classList.remove('down'); };
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('pointerup', off);
  btn.addEventListener('pointercancel', off);
  btn.addEventListener('lostpointercapture', off);
  btn.addEventListener('contextmenu', e => e.preventDefault());
});

// ---------- Tilt steering ----------
// ### A phone is recognised by its touch screen and motion sensor, and then steers by tilting: hold it sideways and lower one side,
// ### like a steering wheel. Gas and brake stay on the screen, and the steering buttons go away while tilt is working. Upright, or
// ### without a sensor, the buttons stay. The readings are only used here, in the browser. iOS asks the player first, and only after a tap.
const TILT = { can: COARSE && typeof DeviceOrientationEvent !== 'undefined', mode: 'pads', beta: NaN, listening: false, asked: false, on: false, value: 0, hintSide: false, hintUp: false };
if (TILT.can) TILT.mode = Core.parseSteer(readStore('shard-heist-steer'));
// ### Listens to the sensor once.
function tiltListen(){
  if (TILT.listening) return;
  TILT.listening = true;
  addEventListener('deviceorientation', e => { if (Number.isFinite(e.beta)) TILT.beta = e.beta; });
}
// ### Turns the sensor on if the player wants tilt. Has to run inside a tap, because of iOS.
function tiltAsk(){
  if (!TILT.can || TILT.mode !== 'tilt') return;
  const ask = DeviceOrientationEvent.requestPermission;
  if (typeof ask !== 'function') return tiltListen();
  if (TILT.asked) return;
  TILT.asked = true;
  const refused = () => { TILT.mode = 'pads'; toast('No access to the motion sensor. Steer with the buttons instead.', 'red', 3600); };
  ask.call(DeviceOrientationEvent).then(answer => { if (answer === 'granted') tiltListen(); else refused(); }).catch(refused);
}
// ### The rotation of the screen in degrees: 0 upright, 90 or 270 sideways.
function screenAngle(){
  const o = screen.orientation, a = o && Number.isFinite(o.angle) ? o.angle : window.orientation || 0;
  return (a % 360 + 360) % 360;
}
// ### Reads the tilt each frame, shows or hides the steering buttons, and explains it once in a run.
function updateTilt(){
  const seen = Number.isFinite(TILT.beta), angle = screenAngle(), sideways = angle === 90 || angle === 270;
  const on = TILT.mode === 'tilt' && seen && sideways;
  if (on !== TILT.on){ TILT.on = on; $('touch').classList.toggle('tilt', on); }
  TILT.value = on ? Core.tiltSteer(TILT.beta, angle) : 0;
  if (state !== 'play' || TILT.mode !== 'tilt' || !seen || heli.runTime < 5) return;
  if (on && !TILT.hintSide){ TILT.hintSide = true; toast('Tilt the phone like a steering wheel. Gas and brake are on the right.', '', 3600); }
  if (!sideways && !TILT.hintUp){ TILT.hintUp = true; toast('Turn the phone sideways to steer by tilting. Auto-rotate must be on.', '', 3600); }
}
// ### The choice between tilt and buttons, for the menu and the pause card. Only a phone shows it.
const steerRow = () => TILT.can ? `<span class="gfx">Steering <button data-steer="tilt" aria-pressed="${TILT.mode === 'tilt'}">Tilt</button><button data-steer="pads" aria-pressed="${TILT.mode === 'pads'}">Buttons</button></span>` : '';

// ---------- HUD ----------
// ### Updates the on-screen panels every frame: timer, speedometer (SVG arc with ticks), gear, rpm, pedal bars, damage,
// ### pursuit/bust meter, signal strength and route progress. Values are only written to the DOM when they change.
// ### drawRadar paints the heading-up mini map on a canvas with one affine transform from world to radar coordinates.
const overlay = $('overlay'), card = $('card'), hud = $('hud');
const ui = {
  lookTag: $('lookTag'), nos: $('nos'), nosPips: [...document.querySelectorAll('#nosPips i')], nfill: $('nfill'), tNitro: $('tNitro'),
  time: $('time'), speed: $('speed'), rpm: $('rpm'), chips: $('chips'), bars: $('bars'), sig: $('sigText'), toast: $('toast'),
  eye: $('missionEye'), mission: $('missionName'),
  gVal: $('gVal'), gGlow: $('gGlow'), gTip: $('gTip'), gears: [...document.querySelectorAll('.gearbox [data-g]')], gearD: $('gearD'),
  pBrake: $('pBrake'), pGas: $('pGas'), pBrakeV: $('pBrakeV'), pGasV: $('pGasV'), tBrake: $('tBrake'), tGas: $('tGas'),
  dash: $('dash'), dmg: $('dmg'), dmgPct: $('dmgPct'), dmgState: $('dmgState'), dfill: $('dfill'),
  guide: $('guide'), guideArrow: $('guideArrow'), guideName: $('guideName'), guideDist: $('guideDist'),
  kitGuide: $('kitGuide'), kitArrow: $('kitArrow'), kitDist: $('kitDist'),
  pursuit: $('pursuit'), edge: $('edgeWarn'), edgeBanner: $('ewBanner'), edgeArrow: $('ewArrow'), purState: $('purState'), cops: [...$('cops').children], stars: $('stars'), bustPct: $('bustPct'), bfill: $('bfill')
};
const DIAMOND = '<svg class="chip" viewBox="0 0 16 16"><path d="M8 1.5 14.5 8 8 14.5 1.5 8Z"/></svg>';
// ### One small line icon per piece of evidence, for the panel at the top left; it lights up when the piece is in the car.
const EV_ICON = {
  photos: 'M2 4h9v8H2zM5 2h9v8M3.5 10l2.5-3 2 2 1.5-1.5 1.5 2.5',
  prints: 'M8 2.5c-3 0-5 2.2-5 5M8 2.5c3 0 5 2.2 5 5v1M5.5 13c-.5-1.5-.5-3 0-4.5C6.2 6.6 9.8 6.6 10.5 8.5c.5 1.5.4 3-.2 4.5M8 8.5v5M3 10.5c.2 1 .5 1.8 1 2.5',
  torch: 'M2 6.5h7v3H2zM9 5l4-2v10l-4-2zM14.5 6v4',
  lockpick: 'M1.5 9.5h9l2-2.5M1.5 9.5v-2h3v2M5 12.5h8M13 12.5v-2',
  clothes: 'M5.5 2 2 4.5l1.5 2.5L5 6v8h6V6l1.5 1 1.5-2.5L10.5 2c-.5 1.2-1.4 1.8-2.5 1.8S6 3.2 5.5 2z',
  balaclava: 'M8 1.5c3 0 5 2.6 5 6v4.5c0 1.5-2.2 2.5-5 2.5s-5-1-5-2.5V7.5c0-3.4 2-6 5-6zM4.5 7h7v2.3h-7z'
};
const STAR = '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.2 1.3-6.6L2.5 9.3l6.6-.8z"/></svg>';

const G = { cx: 80, cy: 80, r: 66, a0: 135, sweep: 270, max: 160 };
function polar(r, deg){ const a = deg * Math.PI / 180; return [G.cx + r * Math.cos(a), G.cy + r * Math.sin(a)]; }
// ### Draws the speedometer scale for the current map.
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
let toastHold = 0, toastNext = null;
// ### Shows a short message at the top of the screen.
// ### A story radio line is important: other messages wait until it has been shown, and only the newest of them is kept.
function toast(text, tone, ms, important){
  const now = performance.now();
  if (!important && now < toastHold){ toastNext = [text, tone, ms]; return; }
  if (important){ toastHold = now + (ms || 2600) * 0.85; toastNext = null; }
  ui.toast.textContent = text;
  ui.toast.className = tone || '';
  void ui.toast.offsetWidth;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast.classList.remove('show');
    if (toastNext){ const n = toastNext; toastNext = null; toast(n[0], n[1], n[2]); }
  }, ms || 2600);
}
function renderChips(){
  ui.chips.innerHTML = items.map(it => it.ev
    ? `<svg class="chip ev${it.taken ? ' on' : ''}" viewBox="0 0 16 16" role="img" aria-label="${it.ev.name}${it.taken ? ', found' : ''}"><title>${it.ev.name}</title><path d="${EV_ICON[it.ev.key]}"/></svg>`
    : DIAMOND.replace('class="chip"', 'class="chip' + (it.taken ? ' on' : '') + '"')).join('') +
    // the witness, the last thing to bring along in Lisbon: shown once she is waiting, lit once she is in the car
    ((witness.active || witness.inCar) ? `<svg class="chip wit${witness.inCar ? ' on' : ''}" viewBox="0 0 16 16" role="img" aria-label="Witness${witness.inCar ? ', in the car' : ''}"><title>Witness: ${WITNESS.name}</title><path d="M6 4.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0M3.5 14c0-3 2-5 4.5-5s4.5 2 4.5 5"/></svg>` : '') +
    `<span class="count">${collected}/${items.length}</span>`;
}
const pedal = { thr: 0, brk: 0 };
const last = { guide: '', guideDeg: 999, kit: '', kitDeg: 999, kitLow: null, street: '', time: '', speed: -1, rpm: -1, sig: '', gear: '', hb: null, thr: -1, brk: -1, dmg: -1, km: '', pur: '', bust: -1 };
// ### Updates the HUD. A value is only written when it has changed, because touching the page every frame is slow.
function updateHud(dt){
  // in story mode this line names the act instead
  if (!story){
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

  // nitro: one pip per charge ready; the bar fills towards the next charge, and drains while one burns
  const burning = Core.nitroOn(nitro), nf = burning ? nitro.left / Core.NITRO.time : nitro.fill / Core.NITRO.every;
  const nosKey = nitro.charges + '|' + burning + '|' + nf.toFixed(2);
  if (nosKey !== last.nos){
    last.nos = nosKey;
    ui.nosPips.forEach((p, i) => p.classList.toggle('on', i < nitro.charges));
    ui.nfill.style.width = (nf * 100).toFixed(1) + '%';
    ui.nos.classList.toggle('burn', burning);
    ui.tNitro.classList.toggle('empty', !nitro.charges && !burning);
    ui.tNitro.setAttribute('aria-label', 'Nitro: ' + nitro.charges + ' ready');
  }
  const d = Math.round(damage);
  if (d !== last.dmg){
    last.dmg = d;
    ui.dmgPct.textContent = d;
    const lvl = Core.damageLevel(d);
    ui.dmg.dataset.level = lvl;
    ui.dmgState.textContent = lvl === 'crit' ? 'Critical' : lvl === 'warn' ? 'Dented' : 'Good';
    ui.dfill.style.width = d + '%';
  }

  // Pursuit
  if (stars !== last.stars){
    last.stars = stars;
    [...ui.stars.children].forEach((s, i) => s.classList.toggle('on', i < stars));
    ui.stars.classList.toggle('max', stars >= Core.MAX_STARS);
    ui.stars.setAttribute('aria-label', 'Wanted level ' + stars + ' of ' + Core.MAX_STARS);
  }
  const active = police.filter(p => p.active).length, want = state === 'play' ? Core.pursuit(stars).cops : active;
  const stateTxt = heli.spotted ? 'In the spotlight' : !active ? (copsWarned ? 'Lost them' : 'No police yet') : nearestCop < 25 ? 'On your tail' : nearestCop < 140 ? 'In pursuit' : 'Losing them';
  const purKey = active + '|' + want + '|' + stateTxt + '|' + (nearestCop < 25);
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
  if (gate && gate.active){ bars = 4; txt = 'Gate open'; gold = true; }
  else if (witness.active){
    const R = M.radar, dist = Math.hypot(witness.x - car.x, witness.z - car.z);
    bars = dist < R ? 4 : dist < R * 1.5 ? 3 : dist < R * 2.2 ? 2 : 1; gold = true;
    txt = bars === 4 ? 'Witness in range' : bars === 3 ? 'Medium signal' : 'Weak signal';
  } else {
    let dist = Infinity;
    items.forEach(it => { if (!it.taken) dist = Math.min(dist, Math.hypot(it.x - car.x, it.z - car.z)); });
    const R = M.radar;
    bars = dist < R ? 4 : dist < R * 1.5 ? 3 : dist < R * 2.2 ? 2 : 1;
    txt = bars === 4 ? 'Evidence in range' : bars === 3 ? 'Medium signal' : 'Weak signal';
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
// a tap or click on the radar opens the big map
rc.style.pointerEvents = 'auto'; rc.style.cursor = 'pointer';
rc.addEventListener('click', () => { if (state === 'play') showMap(); });
// ### Draws the radar: streets, shards, kits, police, the helicopter light, the gate and story markers.
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
  rx.fillStyle = 'rgba(255,255,255,.6)';
  for (const n of npcs){ if (n.on && Math.abs(n.x - car.x) < reach && Math.abs(n.z - car.z) < reach){ rx.beginPath(); rx.arc(n.x, n.z, 1.6, 0, Math.PI * 2); rx.fill(); } }
  rx.strokeStyle = 'rgba(255,93,108,0.6)'; rx.lineWidth = 2 / kk; rx.setLineDash([6 / kk, 6 / kk]);
  rx.strokeRect(-LIMIT, -LIMIT, LIMIT * 2, LIMIT * 2); rx.setLineDash([]);
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
  if (witness.active){
    // the witness: a gold figure, or a gold arrow at the rim while she is out of range
    const [sx, sy, dist] = toScreen(witness.x, witness.z);
    rx.fillStyle = '#ffc857';
    if (dist > range * 0.92){
      const ang = Math.atan2(sy - R, sx - R), rr = R - 18;
      rx.save(); rx.translate(R + Math.cos(ang) * rr, R + Math.sin(ang) * rr); rx.rotate(ang);
      rx.beginPath(); rx.moveTo(12, 0); rx.lineTo(-8, -10); rx.lineTo(-3, 0); rx.lineTo(-8, 10); rx.closePath(); rx.fill();
      rx.restore();
    } else {
      rx.fillStyle = `rgba(255,200,87,${0.2 + pulse * 0.25})`; rx.beginPath(); rx.arc(sx, sy, 13 + pulse * 5, 0, Math.PI * 2); rx.fill();
      rx.fillStyle = '#ffc857'; rx.beginPath(); rx.arc(sx, sy - 5, 3.5, 0, Math.PI * 2); rx.fill();
      rx.beginPath(); rx.moveTo(sx - 6, sy + 8); rx.quadraticCurveTo(sx, sy - 6, sx + 6, sy + 8); rx.closePath(); rx.fill();
    }
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
// the nitro tank (Core.newNitro): charges ready, pickups towards the next one, seconds left of the one burning
const nitro = Core.newNitro();
let edgeHint = false, warnedDamage = false;
const best = {};
for (const k of Object.keys(MODES)){ const b = Core.parseBest(readStore(MODES[k].store)); if (b) best[k] = b; }

// ---------- Drivers & leaderboard ----------
// ### Two ways to be on a leaderboard. Offline, the player creates a driver (just a name) that stays in this browser
// ### (localStorage), and the board compares the drivers of this device. Online, the player signs in with an account
// ### (online.js, Supabase): the driver name belongs to the account and every finished run goes on one board that everybody
// ### sees. Each run is always kept on this device too, so nothing is lost when the internet is gone. The rules are in Core.
let board = Core.parseBoard(readStore('shard-heist-board')), pendingRun = null, lastRank = null;
let driver = board.drivers.find(d => Core.sameName(d, Core.cleanName(readStore('shard-heist-driver') || ''))) || '';
// names are cleaned by Core already; escaping them again keeps any HTML out of the page
const esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
function saveBoard(){ writeStore('shard-heist-board', JSON.stringify(board)); writeStore('shard-heist-driver', driver); }
// ### Creates or picks a driver; false when the name is empty after cleaning.
function setDriver(raw){
  const r = Core.addDriver(board, raw);
  if (!r.name) return false;
  board = r.board; driver = r.name; saveBoard();
  return true;
}

// ---------- The whole heist: room 1 and room 2 as one time ----------
// ### A player who comes from room 1 (after Ending A it opens this page with ?heist=1#arrive) brings their escape time along
// ### (Core.parseHeist reads what room 1 left in the browser's storage). There is no menu and no card for them: the page opens
// ### in the glare of the headlights they walked into (#arrive, shown by the address alone) and it clears on the garage. When that Lisbon run is finished, the escape and the drive are added up to the heist time, which goes on the
// ### heist leaderboard: on this device and, when signed in, online. A failed drive can be tried again and the heist stays
// ### open; going back to the menu ends it. heist.run: the heist being played; last: the one just finished, for the end
// ### screen; pending: waiting for a driver name; list: this device's board; online: everybody's, once loaded.
const heist = { cold: false, run: null, last: null, pending: null, rank: null, list: Core.parseHeistBoard(readStore(Core.HEIST.store)), online: null, net: null };
// ### Reads the handover from room 1; null when the page was not opened from there or the handover is not valid.
function heistArrival(){
  return /[?&]heist=1(&|$)/.test(location.search) ? Core.parseHeist(readStore(Core.HEIST.key), Date.now()) : null;
}
// ### Straight from the tunnel into the garage: no menu and no card. The page was opened by room 1, not by a click here, so the
// ### sound and (on a phone) the motion sensor may not be started yet: they start with the first key or tap in the garage.
// ### It comes in two parts. heistPrepare sets the run up and goes down into the garage: everything that takes time. heistArrive
// ### is the moment the player comes through the tunnel door with their escape time. On its own page room 2 does both at
// ### once (heistBegin). On the heist page it is loaded ahead under room 1 (HEIST_WAIT): it prepares when it has loaded and
// ### then stands still, without drawing, until that page says the player has left room 1; then it only has to arrive.
const HEIST_WAIT = window.parent !== window && /[?&]heist=wait(&|$)/.test(location.search);
function heistPrepare(){
  story = null; heist.cold = true;
  startRun('city', sel.veh, true);
  enterGarage();
  heist.cold = false;
}
function heistArrive(h, again){
  heist.run = { escape: h.escape };
  // a tap or a key in room 1 on the same page counts here too: then the sound can start now, and the door is heard
  if (navigator.userActivation && navigator.userActivation.hasBeenActive) initAudio();
  // prepared a while ago: the walk out of the tunnel begins now, with the door shut in front of you
  if (again) garagePick(false);
  toast(`Out of the tunnel. Escape time ${fmtTimeExact(h.escape)}, the drive is added.`, '', 7000);
  const wake = () => { removeEventListener('pointerdown', wake, true); removeEventListener('keydown', wake, true); initAudio(); tiltAsk(); };
  addEventListener('pointerdown', wake, true); addEventListener('keydown', wake, true);
}
function heistBegin(h){ heistPrepare(); heistArrive(h, false); }
// ### Loads everybody's heists. Fails quietly: this device's list stays.
async function loadHeists(){
  if (!net) return;
  const r = await net.heistBoard();
  if (r.ok) heist.online = r.rows;
  redrawBoards();
}
// ### Saves the heist that just ended under the active driver (once): on this device, and online when signed in.
function recordHeistPending(){
  const h = heist.pending;
  if (!h || !driver) return Promise.resolve();
  heist.pending = null;
  heist.rank = Core.recordHeist(heist.list, driver, h.escape, h.drive, h.veh);
  heist.list = heist.rank.list;
  writeStore(Core.HEIST.store, JSON.stringify(heist.list));
  if (!signedIn()) return Promise.resolve();
  heist.net = { pending: true };
  return net.submitHeist(h).then(async r => {
    if (!r.ok){ heist.net = { error: r.error }; redrawBoards(); return; }
    await loadHeists();
    const l = heist.online;
    heist.net = l ? { place: l.findIndex(x => Core.sameName(x.name, online.name)) + 1, n: l.length } : null;
    redrawBoards();
  });
}
// ### The heist on the end screen: escape + drive = heist time, the driver's place, and the heist leaderboard (everybody's
// ### when signed in and loaded, otherwise this device's). Each row shows the two parts under the name.
function heistSection(){
  const h = heist.last;
  if (!h) return '';
  const on = signedIn() && heist.online, list = on ? heist.online : heist.list, me = on ? online.name : driver, N = heist.net;
  let head = '';
  if (signedIn() && N) head = N.pending ? 'Saving the heist online…' : N.error ? esc(N.error) : N.place ? `Online: ${esc(online.name)} is in place <b>${N.place}</b> of ${N.n}.` : '';
  else if (heist.rank && heist.rank.rank) head = (heist.rank.best ? (heist.rank.prev ? `New best heist for ${esc(driver)} (was ${fmtTimeExact(heist.rank.prev)}).` : `${esc(driver)} is on the heist board.`) : `${esc(driver)}'s best heist stays ${fmtTimeExact(heist.rank.prev)}.`) + ` Place <b>${heist.rank.rank}</b> of ${heist.list.length}.`;
  const rows = Core.heistRows(list, me), lead = rows.length && rows[0].place === 1 ? rows[0].time : null;
  const body = rows.length ? `<ol class="lb-list">${rows.map(r => `<li class="${r.me ? 'me' : ''}${r.gap ? ' gap' : ''}${r.place <= 3 ? ' p' + r.place : ''}"><span class="lb-place">${r.place}</span>`
      + `<span class="lb-who"><span class="lb-name">${esc(r.name)}</span><span class="lb-meta">Escape ${fmtTimeExact(r.escape)} · Drive ${fmtTimeExact(r.drive)} · ${VEH[r.veh].name}</span></span>`
      + `<span class="lb-time"><b>${fmtTimeExact(r.time)}</b>${lead !== null && r.place > 1 ? `<small>+${(r.time - lead).toFixed(1)} s</small>` : ''}</span></li>`).join('')}</ol>`
    : `<p class="lb-empty">${driver ? 'No heists yet.' : 'Enter a driver name below to put this heist on the board.'}</p>`;
  return `<div class="eyebrow">The whole heist · Cell Block D to the bridge</div>
    <div class="heist-sum"><div><span class="eyebrow">Escape · room 1</span><b>${fmtTimeExact(h.escape)}</b></div><i>+</i><div><span class="eyebrow">Drive · room 2</span><b>${fmtTimeExact(h.drive)}</b></div><i>=</i><div class="total"><span class="eyebrow">Heist time</span><b>${fmtTimeExact(h.total)}</b></div></div>
    <p class="heist-best${h.isBest ? ' new' : ''}">${h.isBest ? 'New best heist on this device' : 'Best heist on this device · ' + fmtTimeExact(h.best)}${on && heist.online[0] ? ` · Online record · ${fmtTimeExact(heist.online[0].time)} by ${esc(heist.online[0].name)}` : ''}</p>
    ${head ? `<p class="lb-head${N && N.error ? ' bad' : ''}">${head}</p>` : ''}
    <p class="lb-where${on ? ' on' : ''}">${on ? 'Heist leaderboard · online · everybody\'s heists' : 'Heist leaderboard · this device only'}</p>${body}`;
}

// ---------- Online account ----------
// ### net is the Supabase client (null when online.js is missing). online holds what the page shows: the account's driver
// ### name, the boards loaded per map, a message for the player, and the place of the last run on the online boards.
const Online = window.ShardOnline || null;
const net = Online && typeof fetch === 'function' ? Online.createClient({ fetch: (u, o) => fetch(u, o), store: { get: readStore, set: writeStore } }) : null;
const online = { name: '', ready: false, mail: false, busy: false, msg: '', bad: false, boards: {}, down: false, rank: null };
const signedIn = () => !!(net && net.user && online.name);
// ### Loads both online boards of a map and redraws the boards on screen. Fails quietly: the local board stays.
async function loadBoards(m){
  if (!net) return;
  const r = await net.boards(m);
  if (r.ok){ online.boards[m] = { all: r.all, month: r.month }; online.down = false; }
  else online.down = true;
  redrawBoards();
}
// The boards of one map in the shape Core.boardRows reads: online when signed in and loaded, otherwise this device's
function boardFor(m){
  const ob = signedIn() && online.boards[m];
  if (!ob) return { src: board, me: driver, online: false };
  const empty = { city: [] };
  return { src: { runs: Object.assign({}, empty, { [m]: ob.all }), month: { key: Core.monthKey(Date.now()), runs: Object.assign({}, empty, { [m]: ob.month }) } }, me: online.name, online: true };
}
// ### After sign-in (or when the page opens signed in): fetch the account's driver name and use it as the driver here too.
async function afterSignIn(){
  online.busy = true; redrawAccount();
  // a slow start or a weak connection gets two more tries before the player is told the board is not reachable
  let r = await net.driverName();
  for (let i = 0; i < 2 && !r.ok && r.status === 0 && net.user; i++){ await new Promise(ok => setTimeout(ok, 2000)); r = await net.driverName(); }
  online.busy = false;
  if (!r.ok){ online.msg = r.error; online.bad = true; if (!net.user) online.name = ''; }
  else { online.name = r.name; online.msg = ''; online.bad = false; if (r.name) setDriver(r.name); }
  online.ready = true;
  redrawAccount();
  if (online.name){ loadBoards(sel.mode); const lb = card.querySelector('[data-board]'); if (lb) loadBoards(lb.dataset.board); }
}
// ### The account buttons. play: the quick start with a name only (an anonymous account for this browser); mail: shows the
// ### email form; in / up: sign in or create an account with email and password; name: the driver name of a new email account;
// ### out: sign out. When the online board can't be reached, play keeps the name as a driver on this device instead.
async function accountAction(kind, el){
  if (!net || online.busy) return;
  if (kind === 'mail'){ online.mail = !online.mail; online.msg = ''; redrawAccount(); return; }
  const box = (el && el.closest && el.closest('[data-account], .lb-ask')) || card.querySelector('[data-account]');
  const val = n => { const x = box && box.querySelector(`[data-acc-field="${n}"]`); return x ? x.value : ''; };
  // read every field before the box is redrawn (the redraw empties the password field on purpose)
  const email = val('email'), password = val('password'), typedName = val(kind === 'play' ? 'play' : 'name');
  const name = Core.cleanName(typedName);
  if ((kind === 'play' || kind === 'name') && !name){
    online.msg = 'Enter a driver name: letters, digits, spaces and . _ \' -'; online.bad = true; redrawAccount({ email }); return;
  }
  let r;
  online.busy = true; online.msg = kind === 'out' ? '' : 'One moment…'; online.bad = false;
  redrawAccount({ email, name: typedName });
  if (kind === 'play') r = await net.playAs(name);
  else if (kind === 'in') r = await net.signIn(email, password);
  else if (kind === 'up') r = await net.signUp(email, password);
  else if (kind === 'name') r = await net.setDriverName(name);
  else if (kind === 'out'){ r = await net.signOut(); online.name = ''; online.boards = {}; online.rank = null; }
  online.busy = false;
  if (kind === 'play' && r && !r.ok && r.status === 0){
    // offline: drive on as a driver of this device
    setDriver(name); online.msg = 'The online board is not reachable right now. You drive as ' + driver + ' on this device.'; online.bad = true;
    redrawAccount(); refreshDriverViews(); return;
  }
  if (!r || !r.ok){ online.msg = r ? r.error : ''; online.bad = true; redrawAccount({ email, name: typedName }); return; }
  if (kind === 'play' || kind === 'name'){ online.name = name; online.ready = true; setDriver(name); }
  online.msg = kind === 'up' ? 'Account created. Now choose your driver name.' : kind === 'play' || kind === 'name' ? 'You are on the online leaderboard.' : kind === 'out' ? 'Signed out. Times are kept on this device.' : '';
  online.bad = false;
  if (kind === 'in' || kind === 'up') return afterSignIn();
  redrawAccount();
  if (kind === 'play' || kind === 'name') loadBoards(sel.mode);
  refreshDriverViews();
}
// ### Saves the run that just ended under the active driver (once): always on this device, and online when signed in.
function recordPending(){
  if (!driver) return;
  if (!pendingRun){ recordHeistPending(); return; }
  const run = pendingRun;
  lastRank = Core.recordRun(board, run.mode, driver, run.time, run.veh, run.stars, Date.now());
  board = lastRank.board; pendingRun = null; saveBoard();
  if (signedIn()){
    online.rank = { pending: true };
    net.submitRun(run).then(async r => {
      if (!r.ok){ online.rank = { error: r.error }; redrawBoards(); return; }
      await loadBoards(run.mode);
      const ob = online.boards[run.mode], at = l => l ? l.findIndex(x => Core.sameName(x.name, online.name)) + 1 : 0;
      online.rank = ob ? { all: at(ob.all), n: ob.all.length, month: at(ob.month) } : null;
      redrawBoards();
    }).then(recordHeistPending);
  } else recordHeistPending();
}
// The name field with its button; the same one is used in the menu and on the end screen
const nameField = (ph, label) => `<span class="drv-new"><input type="text" class="drv-input" maxlength="${Core.NAME_MAX}" placeholder="${ph}" aria-label="${ph}" autocomplete="off" spellcheck="false"><button type="button" class="drv-add" data-driver-add>${label}</button></span>`;
// ### One board as a list. The first three places wear a gold, silver and bronze medal; under each name are the vehicle (a
// ### small drawing and its name) and the stars of that run; beside the time, how far behind the leader it is. The driver's own
// ### row is marked.
const LB_VEH = {
  car: '<path d="M2 11.5V9l1.6-3.2c.3-.5.8-.8 1.3-.8h6.2c.5 0 1 .3 1.3.8L14 9v2.5M2 9h12M4.5 13.2a1.2 1.2 0 1 0 0-.1M11.5 13.2a1.2 1.2 0 1 0 0-.1"/>',
  bike: '<path d="M4 12.5a2.3 2.3 0 1 0 0-.1M12 12.5a2.3 2.3 0 1 0 0-.1M4 12.4 7 8h3.5l1.5 4.4M7 8 6 5.5H4.2M10.5 8l1-2.5h1.8"/>',
  truck: '<path d="M1.5 11.5V4.5h8v7M9.5 7h3l2 2.6v1.9M1.5 11.5h13M4.5 13.2a1.2 1.2 0 1 0 0-.1M11.5 13.2a1.2 1.2 0 1 0 0-.1"/>'
};
const lbStars = n => `<span class="lb-stars" aria-label="${n} of 3 stars">${[1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}">★</i>`).join('')}</span>`;
const boardList = (rows, empty) => {
  if (!rows.length) return `<p class="lb-empty">${empty}</p>`;
  const lead = rows[0].place === 1 ? rows[0].time : null;
  return `<ol class="lb-list">${rows.map(r => {
    const medal = r.place <= 3 ? ` p${r.place}` : '', behind = lead !== null && r.place > 1 ? `<small>+${(r.time - lead).toFixed(1)} s</small>` : '';
    return `<li class="${r.me ? 'me' : ''}${r.gap ? ' gap' : ''}${medal}"><span class="lb-place">${r.place}</span>`
      + `<span class="lb-who"><span class="lb-name">${esc(r.name)}</span><span class="lb-meta"><svg viewBox="0 0 16 16" aria-hidden="true">${LB_VEH[r.veh] || LB_VEH.car}</svg>${VEH[r.veh].name}${lbStars(r.stars || 1)}</span></span>`
      + `<span class="lb-time"><b>${fmtTimeExact(r.time)}</b>${behind}</span></li>`;
  }).join('')}</ol>`;
};
// ### The two boards of one map side by side: all time, and the current calendar month with its leader named above it.
function boardPanels(m){
  const B = boardFor(m), key = Core.monthKey(Date.now()), month = Core.monthName(key), lead = Core.boardList(B.src, m, key)[0];
  const where = B.online ? '<p class="lb-where on">Online · everybody\'s times</p>' : `<p class="lb-where">This device only${signedIn() && online.down ? ' · online board not reachable right now' : ''}</p>`;
  return `${where}<p class="lb-leader"><svg class="lb-crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18l-1.5-10-4.5 4-3-7-3 7-4.5-4z"/></svg><span>Leader of the month</span><b>${lead ? esc(lead.name) : 'nobody yet'}</b>${lead ? `<i>${fmtTimeExact(lead.time)} · ${VEH[lead.veh].name}</i>` : ''}</p>
    <div class="lb-cols">
      <div class="lb-col"><h3>All time</h3>${boardList(Core.boardRows(B.src, m, B.me), 'No times on this map yet.')}</div>
      <div class="lb-col"><h3>${month}</h3>${boardList(Core.boardRows(B.src, m, B.me, key), 'No times this month yet.')}</div>
    </div>`;
}
// ### The account box in the menu. Signed out: one field for the driver name and "Play online" (no email, no password); below
// ### it a link opens the email form for players who want the same driver on every device. Signed in: the name and Sign out.
const quickField = (label, value) => `<span class="drv-new"><input type="text" class="drv-input" data-acc-field="play" maxlength="${Core.NAME_MAX}" placeholder="Driver name" aria-label="Driver name" autocomplete="nickname" spellcheck="false" value="${esc(value || '')}"><button type="button" class="drv-add" data-acc="play"${online.busy ? ' disabled' : ''}>${label}</button></span>`;
function accountBox(keep){
  if (!net) return '';
  const msg = online.msg ? `<p class="acc-msg${online.bad ? ' bad' : ''}" role="status">${esc(online.msg)}</p>` : '';
  const dis = online.busy ? ' disabled' : '';
  if (net.user && online.name){
    const where = net.user.anon ? 'on this browser. Signing out ends this driver here.' : 'on every device where you sign in.';
    return `<div class="acc on"><p>Online as <b>${esc(online.name)}</b> · your runs go on the online leaderboard, ${where}</p><button type="button" class="drv" data-acc="out"${dis}>Sign out</button>${msg}</div>`;
  }
  if (net.user && online.ready) return `<div class="acc"><p>Signed in. Choose the driver name everybody will see (it can't be changed later).</p>
      <span class="drv-new"><input type="text" class="drv-input" data-acc-field="name" maxlength="${Core.NAME_MAX}" placeholder="Driver name" aria-label="Driver name" autocomplete="nickname" spellcheck="false" value="${esc(driver)}"><button type="button" class="drv-add" data-acc="name"${dis}>Save name</button></span>
      <button type="button" class="drv" data-acc="out"${dis}>Sign out</button>${msg}</div>`;
  if (net.user) return `<div class="acc"><p>Signing in…</p>${msg}</div>`;
  const email = keep && keep.email ? esc(keep.email) : '';
  const mail = online.mail ? `<div class="acc-mail"><p>With email and password you get the same driver on every device.</p>
      <div class="acc-fields"><input type="email" class="drv-input" data-acc-field="email" maxlength="254" placeholder="Email" aria-label="Email" autocomplete="username" spellcheck="false" value="${email}"><input type="password" class="drv-input" data-acc-field="password" maxlength="72" placeholder="Password (8+ characters)" aria-label="Password" autocomplete="current-password"></div>
      <div class="acc-btns"><button type="button" class="drv-add" data-acc="in"${dis}>Sign in</button><button type="button" class="drv" data-acc="up"${dis}>Create account</button></div></div>` : '';
  return `<div class="acc"><p>Type a driver name and you are on the online leaderboard. No email, no password.</p>
      ${quickField('Play online', keep && keep.name !== undefined ? keep.name : driver)}${msg}
      <button type="button" class="acc-link" data-acc="mail" aria-expanded="${!!online.mail}">${online.mail ? 'Hide the email sign-in' : 'Use an email account instead (same driver on every device)'}</button>${mail}</div>`;
}
// ### The menu section: the account box and the two leaderboards (all time and this month) of the chosen map. Without the
// ### online part (online.js missing), the drivers of this device are shown instead, as before.
function driverSection(){
  const local = net ? '' : `<div class="drivers">${board.drivers.slice().reverse().map(d => `<button class="drv" data-driver="${esc(d)}" aria-pressed="${Core.sameName(d, driver)}">${esc(d)}</button>`).join('')}</div>
      ${nameField(board.drivers.length ? 'New driver name' : 'Your name', 'Add driver')}
      <p class="drv-hint">${driver ? `Driving as <b>${esc(driver)}</b> on this device. Each finished run goes on the leaderboard of its map.` : 'Add a name to put your times on the leaderboard. It stays on this device.'}</p>`;
  return `<div class="m-label"><span>02</span>Driver · your name on the leaderboard</div>
      <div data-account>${accountBox()}</div>
      ${local}
      <div class="lb" data-lb-menu><div class="eyebrow">Leaderboard · ${MODES[sel.mode].title}</div>${boardPanels(sel.mode)}</div>`;
}
// ### The end screen's leaderboards for one map: what this run did, the all-time and monthly boards with the leader of the month,
// ### and the name field when nobody is signed in.
function boardSection(m){
  let head = '';
  const R = online.rank;
  if (signedIn() && R){
    const who = esc(online.name);
    head = R.pending ? `<p class="lb-head">Saving ${who}'s time online…</p>`
      : R.error ? `<p class="lb-head bad">${esc(R.error)}</p>`
      : R.all ? `<p class="lb-head">Online, all time: ${who} is in place <b>${R.all}</b> of ${R.n}${R.month ? ` · This month: place <b>${R.month}</b>${R.month === 1 ? ': you lead the month' : ''}` : ''}.</p>` : '';
  } else if (lastRank && lastRank.rank){
    const who = esc(driver), n = board.runs[m].length;
    head = lastRank.personalBest
      ? (lastRank.prev ? `New personal best for ${who} (was ${fmtTimeExact(lastRank.prev)}).` : `${who} is on the board.`)
      : `${who}'s best stays ${fmtTimeExact(lastRank.prev)}.`;
    head = `<p class="lb-head">${head} All time: place <b>${lastRank.rank}</b> of ${n}${lastRank.monthRank ? ` · This month: place <b>${lastRank.monthRank}</b>${lastRank.monthRank === 1 && lastRank.monthBest ? ': you lead the month' : ''}` : ''}.</p>`;
  }
  const ask = !driver && pendingRun ? `<div class="lb-ask"><span>Enter a driver name to put this time on the ${net ? 'online ' : ''}leaderboard</span>${net ? quickField('Save time', '') : nameField('Your name', 'Save time')}</div>${net && online.msg && online.bad ? `<p class="lb-head bad">${esc(online.msg)}</p>` : ''}` : '';
  return `<div class="eyebrow">Leaderboard · ${MODES[m].title}</div>${head}${ask}${boardPanels(m)}`;
}
// ### Reads the name field next to the button (or the field itself) and creates the driver.
function addDriverFrom(el){
  const wrap = el.closest('.drv-new'), input = wrap && wrap.querySelector('.drv-input');
  if (!input) return;
  if (!setDriver(input.value)){ input.value = ''; input.classList.remove('bad'); void input.offsetWidth; input.classList.add('bad'); input.focus(); return; }
  refreshDriverViews();
}
// ### After a driver change: the menu redraws its section; the end screen saves the waiting run and redraws the board.
function refreshDriverViews(){
  const sec = card.querySelector('[data-drivers]');
  if (sec) sec.innerHTML = driverSection();
  const lb = card.querySelector('[data-board]');
  if (lb){ recordPending(); lb.innerHTML = boardSection(lb.dataset.board); }
  const hs = card.querySelector('[data-heist]');
  if (hs) hs.innerHTML = heistSection();
}
// Redraws only the account box (keeping a typed email), or only the boards, so a field being typed in is never wiped
function redrawAccount(keep){
  const box = card.querySelector('[data-account]');
  if (!box) return;
  const sec = card.querySelector('[data-drivers]');
  const b2 = card.querySelector('[data-account]');
  if (b2) b2.innerHTML = accountBox(keep);
  redrawBoards();
}
function redrawBoards(){
  const mb = card.querySelector('[data-lb-menu]');
  if (mb) mb.innerHTML = `<div class="eyebrow">Leaderboard · ${MODES[sel.mode].title}</div>${boardPanels(sel.mode)}`;
  const lb = card.querySelector('[data-board]');
  if (lb) lb.innerHTML = boardSection(lb.dataset.board);
  const hs = card.querySelector('[data-heist]');
  if (hs) hs.innerHTML = heistSection();
}

// ### Sets the map up for a run: Lisbon is the only one.
function setMode(m){
  mode = m; M = MODES[m];
  CITY.group.visible = true;
  ui.eye.textContent = M.eyebrow;
  ui.mission.textContent = M.mission;
  last.km = ''; last.street = '';
  initGauge();
  buildBoundary();
}

// ### Puts the player back at the start of the map.
function resetCar(){
  clearEffects();
  Object.assign(crashGuard, Core.newCrashGuard());
  car.railPrev = null; car.rattle = 0;
  const x = -3.5, z = -6, heading = 0;
  Object.assign(car, { x, z, y: groundH(x, z), heading, camHeading: heading, speed: 0, steer: 0, yaw: 0, pitch: 0, roll: 0, bodyPitch: 0, shake: 0, prevSpeed: 0, lean: 0, lift: 0 });
  resetScratches(); scrapeNow.level = 0;
  // stand on the road as it really lies here, at once: level on a sloping street, the wheels of one side would sink into it
  settleCar(1);
  resetSkids();
  eng.gear = 1; eng.rpm = ENGINES[V.key].idle; eng.shift = 0; eng.boost = 0; eng.miss = 0;
  camera.position.set(x - Math.sin(heading) * V.cam[0], car.y + V.cam[1], z - Math.cos(heading) * V.cam[0]);
  camera.lookAt(x + Math.sin(heading) * 4, car.y + 1.6, z + Math.cos(heading) * 4);
}

// ### Starts a free ride or a story act: resets the score, car and police.
// ### viaGarage: the caller sends the player through the garage first (enterGarage), so the map of the evidence waits until the street.
function startRun(m, v, viaGarage){
  garageLeave();
  endFinale(); hideWitness();
  if (!heist.cold){ initAudio(); tiltAsk(); }
  setVehicle(v || V.key);
  setMode(m || mode);
  placeRun();
  resetCar();
  resetNpcs();
  warmUp();
  resetPolice();
  collected = 0; timeLeft = M.time; damage = 0; Object.assign(nitro, Core.newNitro());
  edgeHint = false; warnedDamage = false;
  Object.values(MODELS).forEach(md => md.paint.color.copy(md.base));
  renderChips();
  hud.classList.remove('off');
  hideOverlay();
  state = 'play';
  if (!viaGarage) showOverview();
}
// ### Lisbon starts with a map of the Baixa: where the six pieces of evidence lie, the repair kits, your start and the gate.
// ### The run is paused while it is open; "Start driving" begins the clock. The sealed letter of the story is not on it.
let overviewOpen = false, mapOpen = false;
// ### The big map during a run in Lisbon (key M, or a tap on the radar): the run pauses and the map of the Baixa fills the
// ### card, with what is still to collect, the witness, the gate, and the yellow way to it once it is open. M or Enter closes it.
function showMap(){
  state = 'pause'; overviewOpen = false; mapOpen = true;
  held.clear(); Object.keys(keys).forEach(k => keys[k] = false);
  const left = items.filter(it => !it.taken).length;
  showCard(`
    <div class="eyebrow">Map · Lisbon · Baixa</div>
    <h2>${gate.active ? 'To the gate' : witness.active ? 'Pick up the witness' : left + ' of ' + items.length + ' pieces left'}</h2>
    <canvas class="ov-map" id="ovMap" width="900" height="900" role="img" aria-label="Map of the Baixa: where you are, what is left to collect and the gate"></canvas>
    <div class="actions">
      <button class="btn" data-action="resume">Back to driving <small class="desk-only">M</small></button>
      <button class="btn ghost" data-action="menu">Main menu</button>
    </div>`, 'map');
  drawOverview($('ovMap'));
}
function showOverview(){
  state = 'pause'; overviewOpen = true;
  showCard(`
    <div class="eyebrow">${story ? 'Act 1 · The Evidence' : 'Lisbon · Baixa'} · ${V.name}</div>
    <h2>Where the evidence is</h2>
    <p>Your friend hid six pieces of evidence in the Baixa. Collect all six, pick up the witness who saw the real thief, then escape through the golden gate at the south-west corner of the Baixa, on the way to the 25 de Abril bridge. While you drive, an arrow on the screen points to the nearest piece, then to her.</p>
    <canvas class="ov-map" id="ovMap" width="640" height="640" role="img" aria-label="Map of the Baixa: ${items.map(it => it.ev.name).join(', ')}, the repair kits, your start and the gate"></canvas>
    <div class="actions">
      <button class="btn" data-action="resume">Start driving <small class="desk-only">Enter</small></button>
      <button class="btn ghost" data-action="menu">Main menu</button>
    </div>`);
  drawOverview($('ovMap'));
}
// ### Draws the map: north is up (z grows to the south), the same blocks as the radar, then the markers with their names.
function drawOverview(cv){
  const g = cv.getContext('2d'), S = cv.width, span = LIMIT + 24, k = S / (2 * span);
  const X = x => (x + span) * k, Y = z => (z + span) * k;
  // everything was drawn for a 640 px canvas; a larger one is scaled up around each marker
  const u = S / 640;
  g.fillStyle = '#0e1022'; g.fillRect(0, 0, S, S);
  for (const r of CITY.radar){ g.fillStyle = r.c; g.fillRect(X(r.x0), Y(r.z0), (r.x1 - r.x0) * k, (r.z1 - r.z0) * k); }
  g.strokeStyle = 'rgba(255,93,108,.6)'; g.lineWidth = 2; g.setLineDash([7, 7]); g.strokeRect(X(-LIMIT), Y(-LIMIT), 2 * LIMIT * k, 2 * LIMIT * k); g.setLineDash([]);
  g.font = `700 ${Math.round(25 * u)}px "Big Shoulders Display", "Segoe UI", sans-serif`; g.textBaseline = 'middle';
  const label = (text, x, y, color) => {
    const w = g.measureText(text).width + 14 * u, lx = Math.min(S - w - 4, Math.max(4, x - w / 2)), ly = Math.min(S - 16 * u, y + 36 * u);
    g.fillStyle = 'rgba(8,10,22,.86)'; g.fillRect(lx, ly - 15 * u, w, 30 * u); g.fillStyle = color; g.fillText(text, lx + 7 * u, ly + u);
  };
  // the yellow way to the gate, once it is open
  if (gate.active){
    const pts = Core.routeTo(car.x, car.z, car.heading, gate.x, gate.z);
    g.strokeStyle = '#ffd21f'; g.lineWidth = 7 * u; g.lineJoin = 'round'; g.lineCap = 'round'; g.setLineDash([14 * u, 10 * u]);
    g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke(); g.setLineDash([]);
  }
  // the gate at the south-west corner and where you are
  g.strokeStyle = '#ffc857'; g.lineWidth = 4 * u; g.beginPath(); g.arc(X(gate.x), Y(gate.z), 16 * u, 0, Math.PI * 2); g.stroke();
  if (gate.active){ g.fillStyle = 'rgba(255,200,87,.35)'; g.fill(); }
  label('Gate · to the bridge', X(gate.x), Y(gate.z), '#ffc857');
  if (witness.active){
    g.fillStyle = '#ffc857'; g.beginPath(); g.arc(X(witness.x), Y(witness.z), 11 * u, 0, Math.PI * 2); g.fill();
    label('Witness · ' + WITNESS.name, X(witness.x), Y(witness.z), '#ffc857');
  }
  g.save(); g.translate(X(car.x), Y(car.z)); g.rotate(-car.heading + Math.PI); g.scale(u, u); g.fillStyle = '#ffffff';
  g.beginPath(); g.moveTo(0, -18); g.lineTo(13, 15); g.lineTo(0, 8); g.lineTo(-13, 15); g.closePath(); g.fill(); g.restore();
  label('You', X(car.x), Y(car.z) - 72 * u, '#ffffff');
  for (const kt of kits){ if (kt.taken) continue; g.fillStyle = '#4ef0a0'; g.fillRect(X(kt.x) - 10 * u, Y(kt.z) - 3.5 * u, 20 * u, 7 * u); g.fillRect(X(kt.x) - 3.5 * u, Y(kt.z) - 10 * u, 7 * u, 20 * u); }
  items.forEach((it, i) => {
    if (it.taken) return;
    const x = X(it.x), y = Y(it.z);
    g.save(); g.translate(x, y); g.scale(u, u); g.translate(-x, -y);
    evMedal(g, x, y, it.ev.key, i + 1);
    g.restore();
    label(`${i + 1} · ${it.ev.name}`, x, y + 6 * u, '#55ecff');
  });
}
// ### One piece of evidence on the map: a dark medallion with a cyan rim and glow, a small drawing of the piece inside, and its
// ### number in a badge on the rim. The drawings are made with the canvas (EV_ARTS), about 36 px across.
function evMedal(g, x, y, key, n){
  const r = 27;
  g.save();
  g.shadowColor = 'rgba(85,236,255,.75)'; g.shadowBlur = 18;
  const bg = g.createRadialGradient(x - 8, y - 10, 4, x, y, r);
  bg.addColorStop(0, '#26304f'); bg.addColorStop(1, '#0b0e1d');
  g.fillStyle = bg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0; g.strokeStyle = '#55ecff'; g.lineWidth = 3; g.stroke();
  g.strokeStyle = 'rgba(85,236,255,.35)'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, r - 5, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(x, y, r - 3, 0, Math.PI * 2); g.clip();
  EV_ARTS[key](g, x, y);
  g.restore();
  g.save();
  g.fillStyle = '#55ecff'; g.beginPath(); g.arc(x + r * 0.72, y - r * 0.72, 10, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0b0e1d'; g.font = '800 14px "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), x + r * 0.72, y - r * 0.72 + 1);
  g.restore();
}
// the little drawings, each centred on (x, y)
const EV_ARTS = {
  // two polaroids, the front one with a dark figure at a lit window
  photos(g, x, y){
    const pol = (ax, ay, rot, front) => {
      g.save(); g.translate(ax, ay); g.rotate(rot);
      g.fillStyle = '#f2efe6'; g.fillRect(-12, -14, 24, 28);
      g.fillStyle = front ? '#1b2440' : '#3a4566'; g.fillRect(-9.5, -11.5, 19, 17);
      if (front){
        g.fillStyle = '#ffd27a'; g.fillRect(-6, -9, 12, 10);
        g.fillStyle = '#0b0e1d'; g.beginPath(); g.arc(0, -4.5, 2.6, 0, Math.PI * 2); g.fill(); g.fillRect(-3.4, -2, 6.8, 5);
      }
      g.restore();
    };
    pol(x - 4, y + 1, -0.28, false); pol(x + 3, y - 1, 0.12, true);
  },
  // the whorl of a fingertip: nested, slightly broken ellipses
  prints(g, x, y){
    g.strokeStyle = '#7ff3ff'; g.lineCap = 'round'; g.lineWidth = 1.7;
    for (let k = 0; k < 6; k++){
      const rx = 3 + k * 2.6, ry = 4.5 + k * 3.1, gap = 0.5 + (k % 2) * 0.6;
      g.beginPath(); g.ellipse(x, y + 1, rx, ry, 0.15, -Math.PI / 2 + gap, Math.PI * 1.5 - 0.15); g.stroke();
    }
  },
  // a metal torch, diagonal, throwing a warm cone of light
  torch(g, x, y){
    g.save(); g.translate(x, y); g.rotate(-0.6);
    const beam = g.createLinearGradient(6, 0, 30, 0);
    beam.addColorStop(0, 'rgba(255,214,120,.85)'); beam.addColorStop(1, 'rgba(255,214,120,0)');
    g.fillStyle = beam; g.beginPath(); g.moveTo(6, -4); g.lineTo(30, -13); g.lineTo(30, 13); g.lineTo(6, 4); g.closePath(); g.fill();
    const body = g.createLinearGradient(0, -5, 0, 5);
    body.addColorStop(0, '#cfd6e2'); body.addColorStop(0.5, '#7d8698'); body.addColorStop(1, '#3f4656');
    g.fillStyle = body; g.fillRect(-18, -3.5, 18, 7); g.fillRect(-1, -5.5, 8, 11);
    g.fillStyle = '#fff4c9'; g.fillRect(6, -4.5, 1.6, 9);
    g.fillStyle = '#2a3040'; g.fillRect(-12, -3.6, 2, 7.2); g.fillRect(-7, -3.6, 2, 7.2);
    g.restore();
  },
  // two picks and a tension wrench on a ring
  lockpick(g, x, y){
    g.lineCap = 'round';
    g.strokeStyle = '#9aa3b5'; g.lineWidth = 2; g.beginPath(); g.arc(x - 9, y + 9, 6, 0, Math.PI * 2); g.stroke();
    const pick = (ang, len, hook) => {
      g.save(); g.translate(x - 5, y + 5); g.rotate(ang);
      g.strokeStyle = '#e3e8f1'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(0, 0); g.lineTo(len, 0); g.stroke();
      g.lineWidth = 1.8; g.beginPath(); g.moveTo(len, 0);
      if (hook) g.quadraticCurveTo(len + 4, 0, len + 4, -4); else { g.lineTo(len + 2, -2); g.lineTo(len + 4, 0); g.lineTo(len + 6, -2); }
      g.stroke(); g.restore();
    };
    pick(-0.75, 20, true); pick(-0.45, 22, false);
    g.strokeStyle = '#55ecff'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(x - 4, y + 8); g.lineTo(x + 13, y + 3); g.lineTo(x + 13, y - 2); g.stroke();
  },
  // a black hoodie with a zip, seen from the front
  clothes(g, x, y){
    g.fillStyle = '#1d212c'; g.strokeStyle = '#55ecff'; g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(x - 7, y - 13); g.quadraticCurveTo(x, y - 18, x + 7, y - 13);
    g.lineTo(x + 15, y - 8); g.lineTo(x + 18, y + 6); g.lineTo(x + 12, y + 7); g.lineTo(x + 11, y + 15); g.lineTo(x - 11, y + 15); g.lineTo(x - 12, y + 7); g.lineTo(x - 18, y + 6); g.lineTo(x - 15, y - 8);
    g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = '#8f99ad'; g.beginPath(); g.moveTo(x, y - 11); g.lineTo(x, y + 15); g.stroke();
    g.beginPath(); g.moveTo(x - 7, y - 13); g.quadraticCurveTo(x, y - 6, x + 7, y - 13); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x - 9, y + 5, 7, 5); g.fillRect(x + 2, y + 5, 7, 5);
  },
  // a black knitted mask with the eye slit
  balaclava(g, x, y){
    const head = g.createRadialGradient(x - 4, y - 6, 2, x, y, 18);
    head.addColorStop(0, '#3a3f4d'); head.addColorStop(1, '#111319');
    g.fillStyle = head; g.beginPath(); g.ellipse(x, y + 1, 12.5, 15.5, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1;
    for (let k = -10; k <= 10; k += 3.3){ g.beginPath(); g.moveTo(x + k, y - 13); g.lineTo(x + k * 1.05, y + 15); g.stroke(); }
    g.fillStyle = '#d9a98a'; g.beginPath(); g.ellipse(x, y - 2, 9, 3.6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0b0e1d'; g.beginPath(); g.arc(x - 4, y - 2, 1.5, 0, Math.PI * 2); g.arc(x + 4, y - 2, 1.5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#55ecff'; g.lineWidth = 1.2; g.beginPath(); g.ellipse(x, y + 1, 12.5, 15.5, 0, 0, Math.PI * 2); g.stroke();
  }
};
// ### The guide arrow: points at the nearest piece of evidence still out there, then at the witness, and at the gate once she is in the car.
function updateGuide(){
  let t = null, name = '';
  if (state === 'play'){
    let best = Infinity;
    for (const it of items) if (!it.taken){ const d = Math.hypot(it.x - car.x, it.z - car.z); if (d < best){ best = d; t = it; name = it.ev ? it.ev.name : 'Evidence'; } }
    if (!t && witness.active){ t = witness; name = 'Witness · ' + WITNESS.name; }
    if (!t && gate && gate.active){ t = gate; name = 'Gate · to the bridge'; }
  }
  if (!t){ if (!ui.guide.hidden) ui.guide.hidden = true; last.guide = ''; return; }
  if (ui.guide.hidden) ui.guide.hidden = false;
  const d = Math.hypot(t.x - car.x, t.z - car.z), deg = Core.guideTurn(car.x, car.z, car.heading, t.x, t.z) * 180 / Math.PI;
  const key = name + '|' + Math.round(d / 10);
  if (key !== last.guide){
    last.guide = key;
    ui.guideName.textContent = name;
    ui.guideDist.textContent = d < 15 ? 'right here' : Math.round(d / 10) * 10 + ' m';
    ui.guide.classList.toggle('gold', t === gate || t === witness);
  }
  if (Math.abs(deg - last.guideDeg) > 0.5){ last.guideDeg = deg; ui.guideArrow.style.transform = `rotate(${deg.toFixed(1)}deg)`; }
}
// ### The green arrow to the nearest repair kit (Core.kitToGuide), from 20 % damage on and on every map. It sits above the
// ### evidence arrow, or in its place when there is none.
function updateKitGuide(){
  const k = state === 'play' ? Core.kitToGuide(kits, car.x, car.z, damage) : null;
  if (!k){ if (!ui.kitGuide.hidden) ui.kitGuide.hidden = true; last.kit = ''; return; }
  if (ui.kitGuide.hidden) ui.kitGuide.hidden = false;
  const low = ui.guide.hidden;
  if (low !== last.kitLow){ last.kitLow = low; ui.kitGuide.classList.toggle('low', low); }
  const d = Math.hypot(k.x - car.x, k.z - car.z), deg = Core.guideTurn(car.x, car.z, car.heading, k.x, k.z) * 180 / Math.PI;
  const key = String(Math.round(d / 10));
  if (key !== last.kit){ last.kit = key; ui.kitDist.textContent = d < 15 ? 'right here' : Math.round(d / 10) * 10 + ' m'; }
  if (Math.abs(deg - last.kitDeg) > 0.5){ last.kitDeg = deg; ui.kitArrow.style.transform = `rotate(${deg.toFixed(1)}deg)`; }
}
// what is collected on this map
const what = () => 'pieces of evidence';
// ### Pauses the run and shows the pause card.
function pause(){
  state = 'pause'; overviewOpen = false; mapOpen = false;
  showCard(`
    <div class="eyebrow">${M.title} · ${V.name}</div>
    <h2>Paused</h2>
    <p>${collected} of ${items.length} ${what()}, ${fmtTime(timeLeft)} left, damage at ${Math.round(damage)}%, bust meter at ${Math.round(bust * 100)}%.</p>
    <div class="actions">
      <button class="btn" data-action="resume">Resume</button>
      <button class="btn ghost" data-action="${story ? 'retry-act' : 'again'}">Restart</button>
      <button class="btn ghost" data-action="menu">Main menu</button>
    </div>
    ${steerRow()}
    ${volumeRow()}`);
}
// ### Goes back to driving after a pause.
function resume(){
  hideOverlay(); state = 'play'; initAudio(); mapOpen = false;
  if (overviewOpen){ overviewOpen = false; toast('Follow the arrow to the evidence. Every police car is looking for inmate 4471.', '', 3600); }
}

// ### Picks up a piece of evidence. After the sixth piece the witness appears.
function collect(it){
  it.taken = true; collected++;
  const nos = Core.nitroPickup(nitro), ready = nos ? (COARSE ? ' · Nitro ready: tap the flame' : ' · Nitro ready: press E') : '';
  if (nos){ sfx.nitroReady(); ui.nos.classList.remove('ready'); void ui.nos.offsetWidth; ui.nos.classList.add('ready'); }
  burst(it.x, it.group.position.y + 1.9, it.z, SPARK, 28);
  runGroup.remove(it.group);
  sfx.collect();
  if (collected >= items.length) spawnWitness();
  renderChips();
  if (collected >= items.length){
    sfx.gate();
    toast(`${it.ev.name}: ${it.ev.found} One thing is still missing: a witness. ${WITNESS.name}, ${WITNESS.job}, saw the real thief. She is waiting for you, look for the golden light and stop next to her.${ready}`, 'gold', 7000);
  } else toast(`Evidence ${collected} / ${items.length} · ${it.ev.name}: ${it.ev.found}${ready}`, '', 4200);
}
// ### Picks up a repair kit: Core.repairDamage removes the damage.
function repair(kt){
  kt.taken = true;
  burst(kt.x, kt.group.position.y + 1.6, kt.z, GREEN, 18);
  runGroup.remove(kt.group);
  const before = damage;
  damage = Core.repairDamage(damage);
  if (damage < 50) warnedDamage = false;
  sfx.repair();
  toast(`Repair kit: damage ${Math.round(before)}% → ${Math.round(damage)}%`, 'green', 2400);
}
// ### Opens the finish gate at the south-west corner of the Baixa (Lisbon), on the way to the bridge, once everything is in the car.
function openGate(){
  gate.active = true; gate.group.visible = true; gate.grow = 0;
  sfx.gate();
}

// ---------- The route on the road ----------
// ### Once the gate is open, yellow arrows on the road show the way to it, as in an open-world driving game: one every 5 m in
// ### the driving lane, along the streets and round the corners (Core.routeTo, Core.routeMarks). They are worked out again as
// ### the car moves, so a wrong turn simply gives a new way, and a pulse runs along them towards the gate. All arrows are one
// ### instanced mesh that lies flat on the road and follows the hills.
const ROUTE = { max: 100, step: 5, lane: 3.5, lead: 8 };
const route = (() => {
  const sh = new THREE.Shape();
  // a chevron pointing along +z, 2.6 m wide
  [[0, 1.7], [1.6, 0.1], [1.6, -0.9], [0, 0.7], [-1.6, -0.9], [-1.6, 0.1]].forEach(([x, y], i) => i ? sh.lineTo(x, y) : sh.moveTo(x, y));
  const geo = new THREE.ShapeGeometry(sh).rotateX(Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), ROUTE.max);
  mesh.frustumCulled = false; mesh.visible = false; mesh.count = 0; mesh.renderOrder = 2; scene.add(mesh);
  return { mesh, marks: [], pts: [], at: null, dummy: new THREE.Object3D() };
})();
function updateRoute(){
  const on = gate && gate.active && !finale.on && (state === 'play' || state === 'pause');
  route.mesh.visible = on;
  if (!on){ route.at = null; route.pts = []; return; }
  if (!route.at || Math.hypot(car.x - route.at.x, car.z - route.at.z) > 3){
    route.at = { x: car.x, z: car.z };
    route.pts = Core.routeTo(car.x, car.z, car.heading, gate.x, gate.z);
    route.marks = Core.routeMarks(route.pts, ROUTE.step, ROUTE.lane, ROUTE.lead, ROUTE.max);
  }
  const D = route.dummy;
  route.marks.forEach((m, i) => {
    const fx = Math.sin(m.h), fz = Math.cos(m.h), y = groundH(m.x, m.z);
    D.position.set(m.x, y + 0.09, m.z);
    // nose up or down with the road, and a pulse that runs from the car towards the gate
    D.rotation.set(-Math.atan2(groundH(m.x + fx, m.z + fz) - groundH(m.x - fx, m.z - fz), 2), m.h, 0, 'YXZ');
    D.scale.setScalar(REDUCED ? 1 : 0.82 + 0.26 * Math.max(0, Math.sin(clock * 5 - i * 0.5)));
    D.updateMatrix(); route.mesh.setMatrixAt(i, D.matrix);
  });
  route.mesh.count = route.marks.length; route.mesh.instanceMatrix.needsUpdate = true;
}

// ---------- The witness and the finale over the bridge ----------
// ### The last piece of evidence in Lisbon is a person. Once the six pieces are in the car, Marta Silva, a night-shift nurse who
// ### saw the real thief climb out of the museum window, waits on a pavement somewhere in the Baixa, waving, with a golden light
// ### over her head and a gold mark on the radar. Stop next to her (closer than 7 m, slower than about 11 km/h) and she walks
// ### to the car and gets in; drive off before she reaches it and she goes back to wait. With her on board the gate opens.
const { WITNESS } = Core;
// ### Marta is built like a person, about 1.70 m tall: legs of 0.88 m that turn at the hip and the knee, a long belted coat over dark
// ### trousers and boots, a red scarf, a face with eyes, nose and lips, hair tied in a bun, a handbag on her left shoulder, and arms
// ### that turn at the shoulder, the elbow and the wrist. Every part is a smooth tube or a lofted shell (limbLoft, loft), not a box.
const HIP = 0.88;
const witness = (() => {
  const g = new THREE.Group(), mat = (c, r) => new THREE.MeshStandardMaterial({ color: c, roughness: r || 0.78 });
  const coat = mat(0xb48a58), coatDark = mat(0x8e6a42), trousers = mat(0x23262e), boot = mat(0x18130f, 0.45), skin = mat(0xe0ae90, 0.6);
  const hair = mat(0x3a2418, 0.55), scarf = mat(0xa8323a), bagMat = mat(0x5a2f22, 0.5), eye = mat(0x1b1410, 0.3), lip = mat(0xa5524e, 0.5);
  const add = (geo, m, parent) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; (parent || g).add(o); return o; };
  // legs: thigh from the hip, shin and boot from the knee
  const hips = [], knees = [];
  for (const sd of [-1, 1]){
    const hip = new THREE.Group(); hip.position.set(sd * 0.095, HIP, 0); g.add(hip);
    add(limbLoft([0, 0.02, 0], [0, -0.43, 0], [0.078, 0.075, 0.066, 0.056, 0.05], 12), trousers, hip);
    const knee = new THREE.Group(); knee.position.y = -0.43; hip.add(knee);
    add(limbLoft([0, 0.01, 0], [0, -0.36, 0], [0.052, 0.054, 0.046, 0.038, 0.036], 12), trousers, knee);
    add(mergeGeos([limbLoft([0, -0.2, 0], [0, -0.4, 0], [0.047, 0.047, 0.044], 12), ball([0, -0.42, 0.045], 0.05, 0.85, 0.55, 2.0)]), boot, knee);
    hips.push(hip); knees.push(knee);
  }
  // the upper body turns at the hips: the coat skirt, the torso, the neck and the head
  const upper = new THREE.Group(); upper.position.y = HIP; g.add(upper);
  add(loft([[0, 0.14, 0, 0.15, 0.1], [0, 0.0, 0, 0.175, 0.12], [0, -0.18, 0, 0.19, 0.135], [0, -0.36, 0.01, 0.205, 0.145]], 16), coat, upper);
  add(loft([[0, 0.06, 0, 0.165, 0.11], [0, 0.18, 0.005, 0.155, 0.105], [0, 0.32, 0.01, 0.17, 0.115], [0, 0.44, 0, 0.19, 0.11], [0, 0.52, -0.005, 0.175, 0.095], [0, 0.57, -0.01, 0.07, 0.06]], 16), coat, upper);
  // belt, lapels and the buttons down the front
  add(mergeGeos([loft([[0, 0.135, 0, 0.158, 0.106], [0, 0.175, 0, 0.158, 0.106]], 16), boxG(0.09, 0.04, 0.02, 0, 0.155, 0.105)]), coatDark, upper);
  add(mergeGeos([0.36, 0.27, 0.06, -0.06].map(y => ball([0.03, y, 0.118 + (y > 0.2 ? 0.003 : 0.015)], 0.011))), coatDark, upper);
  add(mergeGeos([limb([-0.02, 0.5, 0.1], [0.06, 0.32, 0.12], 0.012, 0.03, 6), limb([0.02, 0.5, 0.1], [-0.05, 0.36, 0.115], 0.012, 0.024, 6)]), coatDark, upper);
  // neck, scarf, head
  const head = new THREE.Group(); head.position.y = 0.6; upper.add(head);
  add(limbLoft([0, -0.04, 0], [0, 0.08, 0], [0.048, 0.045, 0.045]), skin, head);
  add(new THREE.TorusGeometry(0.06, 0.032, 8, 16).rotateX(Math.PI / 2).translate(0, 0.0, 0.005), scarf, head);
  add(limb([0.03, -0.01, 0.07], [0.05, -0.17, 0.1], 0.025, 0.018, 6), scarf, head);
  add(ball([0, 0.17, 0.01], 0.1, 0.86, 1.08, 0.95), skin, head);
  add(mergeGeos([ball([0.034, 0.185, 0.088], 0.012, 1, 0.8, 0.6), ball([-0.034, 0.185, 0.088], 0.012, 1, 0.8, 0.6)]), eye, head);
  add(mergeGeos([ball([0, 0.16, 0.1], 0.016, 0.8, 1.2, 1), ball([-0.084, 0.165, 0.005], 0.018, 0.5, 1, 0.8), ball([0.084, 0.165, 0.005], 0.018, 0.5, 1, 0.8)]), skin, head);
  add(ball([0, 0.118, 0.087], 0.022, 1.2, 0.45, 0.6), lip, head);
  add(mergeGeos([ball([0, 0.2, -0.01], 0.106, 0.92, 0.98, 1.0).translate(0, 0, -0.008), ball([0, 0.27, 0.04], 0.07, 1.3, 0.5, 1.0), ball([0, 0.2, -0.12], 0.05, 1, 1, 0.9)]), hair, head);
  // arms: shoulder, elbow, wrist. [0] is her right arm (-x), which waves and opens the door; [1] her left, with the bag
  const sh = [], el = [], hands = [];
  for (const sd of [-1, 1]){
    const s0 = new THREE.Group(); s0.position.set(sd * 0.2, 0.5, -0.01); upper.add(s0);
    add(mergeGeos([ball([0, 0, 0], 0.062, 1, 0.9, 1), limbLoft([0, 0, 0], [0, -0.29, 0], [0.058, 0.054, 0.05, 0.046], 12)]), coat, s0);
    const e = new THREE.Group(); e.position.y = -0.29; s0.add(e);
    add(mergeGeos([ball([0, 0, 0], 0.047), limbLoft([0, 0, 0], [0, -0.24, 0], [0.047, 0.044, 0.04, 0.042], 12)]), coat, e);
    add(limbLoft([0, -0.22, 0], [0, -0.25, 0], [0.046, 0.046], 12), coatDark, e);
    const h = new THREE.Group(); h.position.y = -0.25; e.add(h);
    add(mergeGeos([ball([0, -0.06, 0.005], 0.045, 0.62, 1.1, 0.38), limb([sd * 0.025, -0.02, 0.02], [sd * 0.035, -0.07, 0.035], 0.012, 0.01, 5)]), skin, h);
    sh.push(s0); el.push(e); hands.push(h);
  }
  // the handbag hangs from the left shoulder on a strap
  add(mergeGeos([boxG(0.07, 0.2, 0.2, 0.25, 0.02, 0.0), limb([0.21, 0.52, 0.0], [0.27, 0.1, 0.0], 0.008, 0.008, 5)]), bagMat, upper);
  const marker = glowSprite(GOLD, 2.4, 0.9); marker.position.y = 2.5; g.add(marker);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ring.position.y = 0.06; g.add(ring);
  g.visible = false; scene.add(g);
  return { g, upper, head, hips, knees, sh, el, hands, marker, ring, active: false, inCar: false, boarding: 0, phase: '', t: 0, lock: null, x: 0, z: 0, h: 0, face: 0, wave: 0, home: null };
})();
// ### Puts the witness on a pavement 70 to 200 m from the player, facing the street.
function spawnWitness(){
  const spots = shuffle(roadSpots.slice(), Math.random);
  let pick = null;
  for (const s of spots){
    const side = Math.random() < 0.5 ? -1 : 1, x = s.axis === 'x' ? s.x : s.x + side * 8.3, z = s.axis === 'x' ? s.z + side * 8.3 : s.z;
    const d = Math.hypot(x - car.x, z - car.z);
    if (!Core.witnessSpotOk(x, z, car.x, car.z, LIMIT)) continue;
    pick = { x, z, h: s.axis === 'x' ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2) };
    break;
  }
  if (!pick) pick = { x: 8.3, z: 100, h: -Math.PI / 2 };
  Object.assign(witness, { active: true, inCar: false, boarding: 0, x: pick.x, z: pick.z, h: pick.h, face: pick.h, wave: 0, home: pick });
  witness.g.visible = true; witness.marker.visible = true; witness.ring.visible = true;
  renderChips();
}
// ### Where she gets in, in the vehicle's own coordinates (x to the left, z forward, metres): where she stands beside the door, the
// ### sill she steps over (and how high it is), and her seat (hip height, how far she leans back, legs astride on the motorcycle).
const BOARD = {
  car: { stand: [-1.62, -0.45], sill: [-1.02, -0.2, 0], seat: [-0.43, 0.42, -0.22], lean: 0.62, legs: 'sit' },
  truck: { stand: [-2.0, 2.15], sill: [-1.45, 2.25, 1.22], seat: [-0.62, 1.86, 2.05], lean: 0.18, legs: 'sit' },
  bike: { stand: [-0.85, -0.5], sill: [-0.32, -0.5, 0.2], seat: [0, 0.9, -0.52], lean: -0.15, legs: 'astride' }
};
// how long each step of getting in takes, in seconds: quick, so the player is soon on the way again
const BOARD_T = { open: 0.25, enter: 0.6, close: 0.25 };
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
// The passenger door of the vehicle (none on the motorcycle): 0 shut, 1 wide open
function setDoor(k){
  const d = MODELS[V.key].door;
  if (!d) return;
  d.pivot.visible = d.cut || k > 0.001; d.hole.visible = k > 0.04;
  if (d.inner) d.inner.visible = k <= 0.001;
  d.pivot.rotation.y = d.max * k;
}
// Puts her back in the world: off the seat, out of the vehicle, the door shut
function unseatWitness(){
  const W = witness;
  if (W.g.parent !== scene) scene.add(W.g);
  W.g.rotation.set(0, 0, 0); witnessPose({});
  W.marker.visible = true; W.ring.visible = true; W.lock = null; W.phase = '';
  Object.values(MODELS).forEach(m => { if (m.door){ m.door.pivot.visible = !!m.door.cut; m.door.hole.visible = false; if (m.door.inner) m.door.inner.visible = true; m.door.pivot.rotation.y = 0; } });
}
function hideWitness(){ unseatWitness(); Object.assign(witness, { active: false, inCar: false, boarding: 0 }); witness.g.visible = false; }
// ### Her whole pose in one call. stride: the walking phase (0 = standing); sit: 0 standing to 1 seated (astride on a motorcycle);
// ### wave: how far the right arm is raised to wave (0..1); reach: the right hand to the door handle (0..1); lean: the upper body
// ### leaning back; look: how far the head turns (radians). The arms swing against the legs while she walks.
function witnessPose(o){
  const W = witness, stride = o.stride || 0, sit = o.sit || 0, wave = o.wave || 0, reach = o.reach || 0, walk = stride ? 1 : 0;
  W.hips.forEach((h, i) => {
    const sd = i ? 1 : -1, ph = stride + i * Math.PI, swing = walk * Math.sin(ph) * 0.5;
    h.rotation.x = -swing * (1 - sit) - sit * (o.astride ? 1.15 : Math.PI / 2);
    h.rotation.z = o.astride ? sd * 0.3 * sit : sd * 0.02;
    // the knee bends as the leg swings through, and is nearly straight when the foot is down
    W.knees[i].rotation.x = walk * Math.max(0, Math.sin(ph - 1.2)) * 0.75 * (1 - sit) + sit * (o.astride ? 1.5 : Math.PI / 2);
  });
  W.sh.forEach((s0, i) => {
    const sd = i ? 1 : -1, ph = stride + i * Math.PI;
    // hanging, a little away from the body; swinging against the leg of the same side; in the lap when seated
    let x = walk * Math.sin(ph) * 0.38 * (1 - sit) - sit * 0.45, z = sd * 0.07, ex = -0.12 - walk * (0.25 + 0.15 * Math.sin(ph)) - sit * 1.0, ez = 0, hz = 0;
    if (i === 0){
      // reach for the door handle
      x += (-1.15 - x) * reach; ex += (-0.35 - ex) * reach;
      // wave: the upper arm out and up, the forearm upright and swinging from the elbow, the hand loose at the wrist
      const ph2 = (o.wavePhase || 0);
      x += (-0.35 - x) * wave; z += (-2.35 - z) * wave;
      ex += (0 - ex) * wave; ez = wave * (0.55 + 0.42 * Math.sin(ph2));
      hz = wave * 0.3 * Math.sin(ph2 - 0.7);
    }
    s0.rotation.set(x, 0, z); W.el[i].rotation.set(ex, 0, ez); W.hands[i].rotation.set(0, 0, hz);
  });
  W.upper.rotation.set(-(o.lean || 0) + walk * 0.05, walk * Math.sin(stride) * 0.06, (o.sway || 0));
  W.head.rotation.set(walk * 0.04, o.look || 0, -(o.sway || 0) * 0.6);
}
// ### Waves; when the car stops next to her she walks to the passenger door, opens it, gets in, sits down and pulls the door
// ### shut (on the motorcycle she climbs onto the pillion seat). The car waits while she gets in. She then rides along, visible
// ### through the window, until the run ends.
function updateWitness(dt, live){
  const W = witness;
  if (!W.active) return;
  const B = BOARD[V.key], ch = Math.cos(car.heading), sh = Math.sin(car.heading);
  const toWorld = (lx, lz) => [car.x + lx * ch + lz * sh, car.z - lx * sh + lz * ch];
  const d = Math.hypot(W.x - car.x, W.z - car.z);
  if (live && !W.boarding && Core.witnessGetsIn(d, car.speed)){ W.boarding = 0.001; W.phase = 'walk'; W.t = 0; toast(`${WITNESS.name} runs to your car.`, '', 1500); }
  // ### Waiting on the pavement under the golden light. She turns to face the player's car, shifts her weight, and waves: in bursts
  // ### of about three seconds while the car is far away, and all the time, with the whole arm, once it is closer than 45 m.
  if (!W.phase){
    W.g.position.set(W.x, groundH(W.x, W.z), W.z);
    const toCar = Math.atan2(car.x - W.x, car.z - W.z), near = d < 45;
    W.face += wrapAngle((d < 160 ? toCar : W.h) - W.face) * Math.min(1, dt * 2.2);
    W.g.rotation.y = W.face;
    const cyc = clock % 4.2, waveOn = cyc < 0.35 ? cyc / 0.35 : cyc < 3.0 ? 1 : cyc < 3.4 ? 1 - (cyc - 3.0) / 0.4 : 0;
    W.wave += ((near ? 1 : waveOn) - W.wave) * Math.min(1, dt * 7);
    witnessPose({ wave: W.wave, wavePhase: clock * (near ? 11 : 8.5), sway: Math.sin(clock * 1.1) * 0.035, look: clamp(wrapAngle(toCar - W.face), -0.6, 0.6) });
    W.marker.position.y = 2.5 + Math.sin(clock * 2.4) * 0.15;
    W.ring.material.opacity = 0.3 + 0.25 * Math.sin(clock * 3);
    return;
  }
  // ### 1. She walks to the door. Drive off before she gets there and she goes back to wait.
  if (W.phase === 'walk'){
    if (Core.witnessGivesUp(d) || !live){ unseatWitness(); Object.assign(W, { boarding: 0, x: W.home.x, z: W.home.z, h: W.home.h }); }
    else {
      W.boarding += dt;
      const [tx, tz] = toWorld(B.stand[0], B.stand[1]), dx = tx - W.x, dz = tz - W.z, l = Math.hypot(dx, dz);
      if (l > 0.06){ const step = Math.min(l, dt * 5.2); W.x += dx / l * step; W.z += dz / l * step; W.h = Math.atan2(dx, dz); }
      const moving = l > 0.06, stride = moving ? W.boarding * 14 + 0.001 : 0;
      W.g.position.set(W.x, groundH(W.x, W.z) + (moving ? Math.abs(Math.cos(stride)) * 0.025 : 0), W.z);
      W.face += wrapAngle(W.h - W.face) * Math.min(1, dt * 8); W.g.rotation.y = W.face;
      // she keeps waving for a moment as she sets off, then walks with both arms
      W.wave = Math.max(0, W.wave - dt * 4);
      witnessPose({ stride, wave: W.wave, wavePhase: clock * 11 });
      W.marker.visible = false; W.ring.visible = false;
      // there, and the car is standing: she takes over in the car's own coordinates, and the car waits for her
      if (l <= 0.06 && Math.abs(car.speed) < 2.5){
        W.lock = { x: car.x, z: car.z, heading: car.heading };
        MODELS[V.key].g.add(W.g);
        W.phase = MODELS[V.key].door ? 'open' : 'enter'; W.t = 0;
        if (MODELS[V.key].door) sfx.door(true);
      }
    }
    return;
  }
  if (W.lock){ car.x = W.lock.x; car.z = W.lock.z; car.heading = W.lock.heading; car.speed = 0; }
  W.t += dt;
  const [sx, sz] = B.stand, [ix, iz, iy] = B.sill, [px, py, pz] = B.seat;
  // ### 2. She opens the door: faces the car and pulls the handle; the door swings out
  if (W.phase === 'open'){
    const k = Math.min(1, W.t / BOARD_T.open);
    setDoor(ease(k));
    W.g.position.set(sx, 0, sz); W.g.rotation.y = Math.PI / 2;
    witnessPose({ reach: Math.sin(Math.min(1, k * 1.4) * Math.PI / 2) * (1 - Math.max(0, k - 0.75) * 2), look: -0.25 });
    if (k >= 1){ W.phase = 'enter'; W.t = 0; }
  // ### 3. She steps in over the sill (up the steps into the truck cab), turns to face forward and sits down
  } else if (W.phase === 'enter'){
    const k = Math.min(1, W.t / BOARD_T.enter), a = ease(Math.min(1, k / 0.4)), b = ease(Math.max(0, (k - 0.4) / 0.6));
    const x = sx + (ix - sx) * a + (px - ix) * b, z = sz + (iz - sz) * a + (pz - iz) * b;
    const y = iy * a + (py - HIP - iy) * b;
    W.g.position.set(x, y, z);
    W.g.rotation.y = Math.PI / 2 * (1 - b);
    // she ducks her head under the roof as she gets in
    witnessPose({ stride: k < 0.4 ? k * 18 + 0.001 : 0, sit: b, astride: B.legs === 'astride', lean: B.lean * b - Math.sin(Math.min(1, k * 1.6) * Math.PI) * (B.legs === 'sit' ? 0.35 : 0.1) });
    if (k >= 1){ W.phase = MODELS[V.key].door ? 'close' : 'done'; W.t = 0; }
  // ### 4. She pulls the door shut behind her
  } else if (W.phase === 'close'){
    const k = Math.min(1, W.t / BOARD_T.close);
    setDoor(1 - k * k);
    if (k >= 1){ sfx.door(false); car.shake = Math.max(car.shake, 0.08); W.phase = 'done'; }
  }
  if (W.phase === 'done'){
    W.phase = 'seated'; W.lock = null;
    W.active = false; W.inCar = true;
    // a head start: the police can't box you in for a few seconds, and the cars around you lose a moment
    bustGrace = Core.WITNESS_RULE.grace;
    police.forEach(p => { if (p.active) p.stun = Math.max(p.stun, Core.WITNESS_RULE.stun); });
    sfx.collect();
    const [bx, bz] = toWorld(px, pz); burst(bx, car.y + py + 0.8, bz, GOLD, 18);
    renderChips();
    openGate();
    witnessCard();
  }
}
// ### With Marta in the car the game stops for a moment: a card in the middle of the screen tells what she saw and where to go
// ### now. It has to be closed (button, Enter, or a tap) before the drive goes on; the police wait as well.
function witnessCard(){
  state = 'pause'; overviewOpen = false; mapOpen = false;
  held.clear(); Object.keys(keys).forEach(k => keys[k] = false);
  showCard(`
    <div class="eyebrow">The witness · ${WITNESS.name}</div>
    <h2>“I saw him climb out of that window.”</h2>
    <p>${WITNESS.name}, ${WITNESS.job}, is in the car. She saw a man climb out of the museum window that night, and she will say so in court. That is the last piece of evidence: with the photos, the fingerprints, the torch, the lockpick, the clothes and the balaclava, it proves you did not take the necklace.</p>
    <p><b>Now get out of the city.</b> Follow the yellow arrows on the road to the golden gate at the south-west corner of the Baixa. Behind it is the 25 de Abril bridge. For the next ${Core.WITNESS_RULE.grace} seconds the police can't box you in: get moving.${COARSE ? ' Tap the radar to see the map.' : ' Press <kbd>M</kbd> for the map.'}</p>
    <div class="actions">
      <button class="btn" data-action="resume">Drive on <small class="desk-only">Enter</small></button>
    </div>`, 'story');
}

// ### The finale: through the gate the game takes the wheel. The vehicle drives itself up the approach road to the 25 de Abril
// ### bridge (updateRamp) and, without a cut, on over the deck: you cross the bridge with Marta beside you, driving south over the Tejo as the first
// ### light comes up behind the towers: no police, no helicopter, heroic music. Then the result card. A black plane in front of the
// ### camera does the fades. In the story, this ends act 1 (the bridge leads out of the city); in a free ride
// ### it is the end of the run.
// ### music: the anthem starts this many metres before the deck, so it is already playing as you come up onto the bridge; from
// ### then on the engine fades out bit by bit over duck seconds until it is silent (quiet: 0), and the music is all you hear.
const FINALE = Object.freeze({ fade: 0.8, start: -270, speed: 24, lane: 4.1, end: 10.2, dawnFrom: 0.8, dawnTo: 8.4, shot: 3.8, cruise: 0.45, accel: 1.6, music: 80, quiet: 0, duck: 6 });
const finale = { on: false, done: false, t: 0, placed: false, deckY: 42.12, throttle: 0, level: 1, kick: false, ramp: false, rt: 0, s: 0, lane: 1, side: null, idle: 0, hOff: 0, cut: false, shot: 0 };
const fader = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
fader.position.z = -0.6; fader.renderOrder = 9999; fader.frustumCulled = false; camera.add(fader); scene.add(camera);
function startFinale(){
  state = 'finale';
  Object.assign(finale, { on: true, done: false, t: 0, placed: false, throttle: 0, level: 1, kick: false, ramp: !!CITY.approach, rt: 0, s: 0, lane: 1, side: null, idle: 0, hOff: 0, cut: false, shot: 0, music: false });
  hud.classList.add('off');
  // the police give up at the gate, and from here on the vehicle drives itself: every key is let go
  resetPolice();
  held.clear(); Object.keys(keys).forEach(k => keys[k] = false);
  if (finale.ramp){ finale.s = rampLocal(CITY.approach, car.x, car.z, 0).s; toast('You made it. Up the ramp and onto the bridge!', 'gold', 2600); }
}
// ### The drive up to the bridge. Through the gate the vehicle drives itself, and the keys, the pads and the tilt do nothing
// ### any more: west along the river and round the banked loop that climbs to the deck, 42 m up. The gas and the steering are
// ### worked for it, aiming RAMP.look metres ahead in its lane (the side of the road it came through the gate on), at
// ### RAMP.autoSpeed. Through the gate at an angle or too fast it may still touch a parapet: they keep it on the road (a scrape
// ### throws sparks, a hard knock slows it down), and from 90 m on the barrier in the middle keeps it on its side. The clock
// ### stopped at the gate. On the deck the drive over the bridge takes over without a cut, at the same speed and in the same lane.
const RAMP = Object.freeze({ edge: 1.1, median: 1.3, knock: 6, settle: 1.2, look: 9, autoSpeed: 22, autoLane: 4.2 });
// ### The long straight along the river is not shown in full. RAMP_CUT.at seconds behind the gate the picture cuts, as in a film,
// ### to a helicopter shot high outside the loop: the vehicle is now RAMP_CUT.before metres before the loop, in your lane and at
// ### your speed (at least RAMP_CUT.speed), and the camera, RAMP_CUT.up metres up and RAMP_CUT.out metres outside the road,
// ### follows it into the curve for RAMP_CUT.shot seconds, then cuts back behind it. Only a
// ### vehicle still at least RAMP_CUT.min metres short of the cut point is moved, so a fast driver is never sent back.
const RAMP_CUT = Object.freeze({ at: 2.5, before: 25, min: 30, speed: 18, shot: 4, out: 34, up: 17 });
function rampCut(A){
  const f = finale, s = A.loop - RAMP_CUT.before, side = (f.lane > 0 ? 1 : -1) * RAMP.autoLane, p = A.at(s, side);
  Object.assign(car, { x: p.x, z: p.z, y: p.y, heading: p.h, camHeading: p.h, speed: Math.max(car.speed, RAMP_CUT.speed), steer: 0, yaw: 0, pitch: 0, roll: 0, shake: 0 });
  f.s = s; f.cut = true; f.shot = 0;
  clearEffects(); resetSkids();
}
// the helicopter: high outside the loop, drifting along it, always on the vehicle
function heliCam(){
  const A = CITY.approach, k = finale.shot / RAMP_CUT.shot, c = A.at(A.loop + 10 + k * 35, -RAMP_CUT.out);
  camera.position.set(c.x, c.y + RAMP_CUT.up, c.z);
  camera.lookAt(car.x, car.y + 1, car.z);
  if (camera.fov !== 50){ camera.fov = 50; camera.updateProjectionMatrix(); }
}
// where a point lies on the approach road: s, metres along it (searched near s0), and side, metres right of its middle
function rampLocal(A, x, z, s0){
  const d2 = s => { const p = A.at(s); return (p.x - x) ** 2 + (p.z - z) ** 2; };
  let best = clamp(s0, 0, A.len), bd = d2(best);
  for (let s = Math.max(0, s0 - 8); s <= Math.min(A.len, s0 + 8); s += 0.5){ const d = d2(s); if (d < bd){ bd = d; best = s; } }
  for (const step of [0.25, 0.1, 0.05]) for (const s of [best - step, best + step]){ if (s < 0 || s > A.len) continue; const d = d2(s); if (d < bd){ bd = d; best = s; } }
  const p = A.at(best);
  return { s: best, side: -(x - p.x) * Math.cos(p.h) + (z - p.z) * Math.sin(p.h), h: p.h, slope: p.slope, bank: p.bank };
}
function updateRamp(dt){
  const A = CITY.approach, f = finale;
  f.rt += dt;
  if (!f.cut && f.rt >= RAMP_CUT.at){ if (A.loop && f.s < A.loop - RAMP_CUT.before - RAMP_CUT.min) rampCut(A); else { f.cut = true; f.shot = RAMP_CUT.shot; } }
  let q = rampLocal(A, car.x, car.z, f.s);
  // through the gate at any angle: the first moment turns the vehicle onto the road
  if (f.rt < RAMP.settle) car.heading += wrapAngle(q.h - car.heading) * Math.min(1, dt * 5) * (1 - f.rt / RAMP.settle);
  let rel = wrapAngle(car.heading - q.h);
  // the vehicle drives itself, whatever is pressed: on the right-hand side of the road, as in Portugal (past the barrier, on
  // the side it is on)
  const tgt = A.at(f.s + RAMP.look, (f.s > 90 ? f.lane : 1) * RAMP.autoLane), err = wrapAngle(Math.atan2(tgt.x - car.x, tgt.z - car.z) - car.heading);
  const pedals = { up: car.speed < RAMP.autoSpeed, down: false, brake: false }, steerIn = clamp(err * 3, -1, 1);
  const grade = q.slope * Math.cos(rel);
  car.speed = Core.stepSpeed(car.speed, pedals, dt, Core.slopeTop(Core.topSpeed(M, V, damage), grade, V), V, grade);
  car.steer = Core.stepSteer(car.steer, steerIn, dt);
  car.yaw = Core.stepYaw(car.yaw || 0, Core.turnRate(car.steer, car.speed, V, pedals.brake), dt, V);
  car.heading += car.yaw * dt * (car.speed >= 0 ? 1 : -1);
  let fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  car.x += fx * car.speed * dt; car.z += fz * car.speed * dt;
  q = rampLocal(A, car.x, car.z, f.s); f.s = q.s; rel = wrapAngle(car.heading - q.h);
  // never back through the gate
  if (q.s < 1 && car.speed * Math.cos(rel) < 0) car.speed = 0;
  // the parapets, and from 90 m on the barrier in the middle: you stay on the side you were on
  const w = A.hw(q.s) - RAMP.edge;
  let lo = -w, hi = w;
  if (q.s > 90){ if (f.lane > 0) lo = RAMP.median; else hi = -RAMP.median; } else f.lane = q.side >= 0 ? 1 : -1;
  let side = q.side;
  scrapeNow.level = 0;
  if (side < lo || side > hi){
    const sg = side > hi ? 1 : -1, nx = sg * Math.cos(q.h), nz = -sg * Math.sin(q.h);
    side = clamp(side, lo, hi);
    const p = A.at(q.s, side), vx = fx * car.speed, vz = fz * car.speed, into = -(vx * nx + vz * nz);
    car.x = p.x; car.z = p.z;
    if (into > 0){
      // the vehicle is turned along the wall, and a hard knock costs speed
      const dirH = car.speed * Math.cos(rel) >= 0 ? q.h : q.h + Math.PI;
      car.heading += wrapAngle(dirH - car.heading) * Math.min(1, 0.15 + into * 0.04);
      if (into > RAMP.knock){ sfx.crash(into); car.shake = Math.min(1, into / 18); car.speed *= 0.6; } else car.speed *= 0.985;
    }
    const lv = Core.scrapeLevel(vx, vz, nx, nz);
    if (lv > 0){
      const along = -vx * nz + vz * nx, dir = Math.sign(along) || 1;
      Object.assign(scrapeNow, { level: lv, along: Math.abs(along), nx, nz, tx: -nz * dir, tz: nx * dir, vx: 0, vz: 0, c: null,
        x: car.x - nx * V.r, z: car.z - nz * V.r, y: car.y + 0.5, floor: car.y + 0.03 });
    }
  }
  scrapeEffects(dt);
  // on the road: its height, its climb and its bank as the vehicle meets them
  const p = A.at(q.s, side);
  rel = wrapAngle(car.heading - q.h);
  car.y = p.y;
  car.pitch += (Math.atan(q.slope * Math.cos(rel)) - car.pitch) * Math.min(1, 10 * dt);
  car.roll += (Math.atan(q.bank * Math.cos(rel)) - car.roll) * Math.min(1, 10 * dt);
  car.wheelRot += car.speed * dt;
  if (f.cut && f.shot < RAMP_CUT.shot){
    f.shot += dt; heliCam();
    // and back behind the vehicle with a cut, not a swoop
    if (f.shot >= RAMP_CUT.shot){ look.snap = true; car.camHeading = car.heading; }
  } else chaseCam(dt);
  // the last stretch up to the deck: the music begins
  if (q.s >= A.len - FINALE.music) startAnthem();
  // up on the deck: the drive over the bridge takes over where you are
  if (q.s >= A.len - 0.5){
    f.ramp = false;
    CITY.bridge.updateMatrixWorld(true);
    const local = CITY.bridge.worldToLocal(new THREE.Vector3(car.x, finale.deckY, car.z));
    held.clear(); Object.keys(keys).forEach(k => keys[k] = false);
    const h0 = car.heading;
    onTheBridge(local.x, local.z, Math.max(car.speed, 8));
    // the heading you came up with turns into the bridge's over a moment, not at once
    f.hOff = wrapAngle(h0 - car.heading); car.heading += f.hOff;
    f.t = FINALE.fade * 2;
  }
}
// ### Puts the vehicle on the bridge deck, along metres from its middle and side metres right of its centre line, driving south
// ### at speed, and starts the music and Marta's words.
function onTheBridge(along, side, speed){
  const F = FINALE, f = finale;
  f.placed = true; f.side = side;
  CITY.bridge.updateMatrixWorld(true);
  const p = onBridge(along, side), ahead = onBridge(along + 10, side);
  Object.assign(car, { x: p.x, z: p.z, y: p.y, heading: Math.atan2(ahead.x - p.x, ahead.z - p.z), speed, steer: 0, yaw: 0, pitch: 0, roll: 0, bodyPitch: 0, lift: 0, shake: 0 });
  // the engine is heard working here (updateEngine): first it cruises one gear above the one that pulls at this speed
  const E = ENGINES[V.key], pull = Math.min(E.gears.length, E.gears.findIndex(g => g * 0.97 > speed) + 1 || E.gears.length);
  eng.gear = Math.min(E.gears.length, pull + 1); eng.shift = 0; eng.rpm = Core.engineTarget(E, eng.gear, speed, 1); f.throttle = F.cruise;
  resetPolice(); clearEffects(); if (!witness.inCar) hideWitness();  // Marta rides over the bridge in the passenger seat
  startAnthem();
  toast(`${WITNESS.name}: “I saw him climb out of that window. I will tell them everything.”`, 'gold', 5200);
  setTimeout(() => { if (finale.on && !finale.done) toast('HALE: Across the bridge and you are out of the city. Well done, detective.', 'hale', 4600); }, 4200);
}
// ### Ends the finale and its morning light: before a new run or the menu.
function endFinale(){
  finale.on = false; finale.done = false; fader.material.opacity = 0; setDawn(0);
  if (anthem.out){ try { anthem.out.disconnect(); } catch (e) {} anthem.out = null; }
}
// a point on the bridge deck: along is metres along the bridge from its middle, side is metres to the right of its centre line
function onBridge(along, side, up){ return CITY.bridge.localToWorld(new THREE.Vector3(along, finale.deckY + (up || 0), side)); }
function updateFinale(dt){
  const F = FINALE, f = finale;
  // with the music playing the engine steps back (its level goes to the engine sound in updateEngine)
  if (f.music && !f.done) f.level = Math.max(F.quiet, f.level - dt * (1 - F.quiet) / F.duck);
  if (f.ramp) return updateRamp(dt);
  f.t += dt;
  const t = f.t;
  if (!f.placed){
    // through the gate, into the dark
    car.x += Math.sin(car.heading) * car.speed * dt; car.z += Math.cos(car.heading) * car.speed * dt;
    fader.material.opacity = Math.min(1, t / F.fade);
    chaseCam(dt);
    if (t < F.fade) return;
    onTheBridge(F.start, F.lane, F.speed);
  }
  // across the bridge at a steady speed; after the last fade it rolls to a stop under the card
  // With the second shot the driver puts the foot down: a gear down, the engine pulls through to the next change and on. At the
  // end the foot comes off, the exhaust crackles, and the engine falls back to its idle while the vehicle rolls out.
  if (f.done){ car.speed *= Math.exp(-dt * 0.9); f.throttle = 0; f.level = Math.max(0, f.level - dt * 0.15); }
  else if (t >= F.shot){
    if (!f.kick){ f.kick = true; eng.gear = Math.max(1, eng.gear - 1); f.throttle = 1; }
    car.speed += F.accel * dt;
  } else car.speed += (F.speed - car.speed) * Math.min(1, dt * 0.8);  // from the approach road: into the cruising speed
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  // from the approach road: over into the lane
  if (f.side !== null && !f.done){ const ds = (F.lane - f.side) * Math.min(1, dt * 1.2); f.side += ds; car.x += -fz * ds; car.z += fx * ds; }
  if (f.hOff){ const dh = f.hOff * Math.min(1, dt * 2.5); f.hOff = Math.abs(f.hOff - dh) < 1e-4 ? 0 : f.hOff - dh; car.heading -= dh; }
  car.x += fx * car.speed * dt; car.z += fz * car.speed * dt; car.y = finale.deckY; car.wheelRot += car.speed * dt;
  const sm = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  setDawn(sm(F.dawnFrom, F.dawnTo, t));
  // two shots: low beside the car, over the water, cut before the first tower would come between; then high behind it, with the
  // towers and the morning sky ahead
  const rx = -fz, rz = fx;
  if (t < F.shot){
    // outside the railing, clear of the tower legs, a little above the road so the deck girder does not fill the picture
    const k = (t - F.fade) / (F.shot - F.fade);
    camera.position.set(car.x + rx * 10.5 + fx * (6 - k * 9), car.y + 2.6 + k * 0.8, car.z + rz * 10.5 + fz * (6 - k * 9));
    camera.lookAt(car.x + fx * 1.5, car.y + 0.9, car.z + fz * 1.5);
  } else {
    const k = Math.min(1, (t - F.shot) / (F.end - F.shot));
    // in the lane, so it passes between the legs of each tower instead of through them
    camera.position.set(car.x - fx * (16 + k * 6) - rx, car.y + 5 + k * 5, car.z - fz * (16 + k * 6) - rz);
    camera.lookAt(car.x + fx * 30, car.y + 4 + k * 6, car.z + fz * 30);
  }
  if (camera.fov !== 55){ camera.fov = 55; camera.updateProjectionMatrix(); }
  // fade in on the bridge, out at the end, and in again under the result card
  if (!f.done){
    fader.material.opacity = t < F.fade * 2 ? 1 - (t - F.fade) / F.fade : t > F.end - F.fade ? Math.min(1, (t - (F.end - F.fade)) / F.fade) : 0;
    if (t >= F.end){ f.done = true; f.doneAt = t; finish(); }
  } else fader.material.opacity = Math.max(0, 1 - (t - f.doneAt) / F.fade);
}

// ### Heroic music for the finale, synthesised like the radio: a brass choir and strings on a rising progression in D major
// ### (D, A, B minor, G, then D, G, A and a long D), a trumpet melody on top, timpani at each change, a roll and a cymbal into the
// ### last chord, all in a little hall reverb. About 14 seconds. It plays on the music volume, once per finale (startAnthem).
const anthem = { out: null };
function startAnthem(){ if (finale.music) return; finale.music = true; playAnthem(); }
function playAnthem(){
  if (!audio || muted) return;
  const ctx = audio.ctx, out = ctx.createGain(), comp = ctx.createDynamicsCompressor(), wet = ctx.createGain(), hall = ctx.createConvolver();
  out.gain.value = 0.55; comp.threshold.value = -18; comp.ratio.value = 3; wet.gain.value = 0.35;
  const ir = ctx.createBuffer(2, ctx.sampleRate * 2.4, ctx.sampleRate);
  for (let c = 0; c < 2; c++){ const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3); }
  hall.buffer = ir;
  out.connect(comp).connect(audio.musicVol); out.connect(hall).connect(wet).connect(audio.musicVol);
  anthem.out = out;
  const beat = 60 / 88, t0 = ctx.currentTime + 0.1;
  const brass = (n, at, dur, v) => [-8, 0, 8].forEach(d => radioOsc('sawtooth', mtof(n), at, dur, v, out, { lp: 1900, detune: d, attack: 0.07, hold: true, release: 0.35 }));
  const strings = (n, at, dur, v) => [-5, 5].forEach(d => radioOsc('sawtooth', mtof(n), at, dur, v, out, { lp: 2400, detune: d, attack: 0.25, hold: true, release: 0.6 }));
  const timp = (n, at, v) => { radioOsc('sine', mtof(n), at, 0.9, v, out, { to: mtof(n) * 0.94, glide: 0.5, attack: 0.004 }); radioNoise('lowpass', 380, 0.8, at, 0.25, v * 0.6, out); };
  const trumpet = (n, at, dur) => { radioOsc('sawtooth', mtof(n), at, dur, 0.09, out, { lp: 2800, attack: 0.03, hold: true, release: 0.2 }); radioOsc('square', mtof(n) * 1.002, at, dur, 0.04, out, { lp: 2200, attack: 0.03, hold: true, release: 0.2 }); };
  // [bass, chord tones] for two beats each, then the last chord held
  const prog = [[38, [57, 62, 66]], [33, [57, 61, 64]], [35, [59, 62, 66]], [31, [59, 62, 67]], [42, [57, 62, 66]], [31, [59, 62, 67]], [33, [57, 61, 64]]];
  const melody = [[74, 1], [78, 1], [76, 1.5], [69, 0.5], [78, 1], [83, 1], [81, 1.5], [79, 0.5], [78, 1], [74, 1], [76, 1], [79, 1], [81, 1], [85, 1]];
  // two beats of a timpani roll that swells into the first chord
  for (let i = 0; i < 12; i++) timp(38, t0 + i * beat / 6, 0.05 + i * 0.02);
  const s0 = t0 + 2 * beat;
  prog.forEach(([b, ch], i) => {
    const at = s0 + i * 2 * beat;
    radioOsc('sawtooth', mtof(b + 12), at, 2 * beat, 0.12, out, { lp: 600, attack: 0.05, hold: true, release: 0.3 });
    ch.forEach(n => { brass(n, at, 2 * beat * 0.95, 0.035); strings(n + 12, at, 2 * beat, 0.03); });
    timp(b < 36 ? b + 12 : b, at, 0.32);
  });
  let mt = s0; melody.forEach(([n, d]) => { trumpet(n, mt, d * beat * 0.92); mt += d * beat; });
  const end = s0 + prog.length * 2 * beat;
  for (let i = 0; i < 8; i++) timp(33, end - beat + i * beat / 8, 0.12 + i * 0.03);
  [26, 38, 50, 57, 62, 66, 69].forEach(n => brass(n + 12, end, 4 * beat, n < 40 ? 0.05 : 0.03));
  [62, 66, 69, 74].forEach(n => strings(n + 12, end, 4.5 * beat, 0.03));
  trumpet(86, end, 4 * beat);
  timp(38, end, 0.5); radioNoise('highpass', 4800, 0.7, end, 3, 0.35, out);
}

// ### Applies a crash: damage from Core.crashDamage, sparks, sound and camera shake.
function crash(impact, add = Core.crashDamage(impact, V)){
  if (add <= 0 && clock < bumpQuiet) return;
  bumpQuiet = clock + 0.4;
  car.shake = Math.min(1, impact / 18);
  sfx.crash(impact);
  if (add <= 0 || state !== 'play') return;
  damage = Core.addDamage(damage, add);
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  burst(car.x + fx * 2, car.y + 0.8, car.z + fz * 2, SPARKS, Math.min(26, 6 + Math.round(impact)), 0.6);
  ui.dash.classList.remove('hit'); void ui.dash.offsetWidth; ui.dash.classList.add('hit');
  if (Core.isWrecked(damage)){ gameOver('wrecked'); return; }
  if (damage >= 50 && !warnedDamage){ warnedDamage = true; toast(kits.some(k => !k.taken) ? 'Engine damaged: top speed reduced. Follow the green arrow to a repair kit.' : 'Engine damaged: top speed reduced.', 'red', 3200); }
}

// ### Ends a run at the gate and shows the score and stars.
function finish(){
  // Lisbon ends with the drive over the bridge; updateFinale calls finish again when it is over
  if (!finale.done) return startFinale();
  if (story) return storyFinish();
  state = 'done';
  const used = Core.driveTime(mode, M, timeLeft, collected);
  const stars = Core.runStars(mode, M, timeLeft, used, damage, V), lostStar = stars < Core.runStars(mode, M, timeLeft, used, 0, V);
  burst(gate.x, gate.group.position.y + 6, gate.z, GOLD, 40);
  sfx.win();
  let isBest = false;
  if (Core.isNewBest(best[mode], used)){ best[mode] = used; isBest = true; writeStore(M.store, String(used)); }
  pendingRun = { mode, time: used, veh: V.key, stars }; lastRank = null;
  // a heist ends here: the escape from room 1 and this drive are one time, and the handover is used up
  const total = heist.run ? Core.heistTotal(heist.run.escape, used) : null;
  // the fastest heist on this device before this one, whoever drove it
  const heistBest = heist.list.length ? heist.list[0].time : null;
  heist.last = total === null ? null : { escape: heist.run.escape, drive: used, veh: V.key, total, best: heistBest, isBest: Core.isNewBest(heistBest, total) };
  heist.pending = heist.last; heist.rank = null; heist.net = null; heist.run = null;
  if (heist.last){ writeStore(Core.HEIST.key, ''); loadHeists(); }
  recordPending();
  // ### The result card: the title with the stars beside it, the drive time as the one large number with the best time under it,
  // ### three smaller figures next to it, then the two leaderboards. Everything is set large, to be read at a glance.
  const dmg = Math.round(damage);
  showCard(`
    <div class="res-top">
      <div><div class="eyebrow">${M.title} · ${V.name}</div><h1>Clean <em>getaway</em></h1></div>
      <div class="stars" role="img" aria-label="${stars} of 3 stars">${[0, 1, 2].map(i => `<span class="${i < stars ? 'on' : ''}">${STAR}</span>`).join('')}</div>
    </div>
    <p>With the six pieces of evidence in the glovebox and ${WITNESS.name} beside you, you cross the 25 de Abril bridge as the sky over the Tejo turns pale. Lisbon is behind you.</p>
    <div class="res-hero">
      <div class="res-time"><span class="eyebrow">Drive time</span><b>${fmtTimeExact(used)}</b><i class="${isBest ? 'best' : ''}">${isBest ? 'New best time on this device' : 'Best on this device · ' + fmtTimeExact(best[mode])}</i></div>
      <div class="res-stats">
        <div class="stat"><span class="eyebrow">Time left</span><b>${fmtTime(timeLeft)}</b></div>
        <div class="stat ${dmg > 50 ? 'bad' : dmg > 20 ? 'warn' : 'good'}"><span class="eyebrow">Damage</span><b>${dmg}%</b></div>
        <div class="stat"><span class="eyebrow">Cops wrecked</span><b>${copsWrecked}</b></div>
      </div>
    </div>
    ${lostStar ? '<p class="note">One star lost for heavy damage (over 50 %).</p>' : ''}
    ${heist.last ? `<section class="lb heist" data-heist>${heistSection()}</section>` : ''}
    <section class="lb" data-board="${mode}">${boardSection(mode)}</section>
    <div class="actions">
      <button class="btn" data-action="again">Drive again <small class="desk-only">Enter</small></button>
      <button class="btn ghost" data-action="menu">Change vehicle</button>
    </div>`, 'result');
}

// ### Ends a run that failed: busted, wrecked or out of time.
function gameOver(reason){
  if (state !== 'play') return;
  endReason = reason;
  if (story) return storyGameOver(reason);
  state = 'over';
  sfx.fail();
  if (reason === 'wrecked'){ const fx = Math.sin(car.heading), fz = Math.cos(car.heading); burst(car.x + fx, car.y + 1.2, car.z + fz, SPARKS, 36, 0.9); }
  const title = reason === 'busted' ? 'Busted!' : reason === 'wrecked' ? 'Vehicle wrecked' : "Time's up";
  const text = reason === 'busted'
    ? `The police boxed you in with ${collected} of ${items.length} ${what()}. Keep moving: the bust meter only fills while you are slow and a cop is right next to you.`
    : reason === 'wrecked'
      ? `Damage hit 100% with ${collected} of ${items.length} ${what()} collected. Grab the green repair kits and avoid head-on hits.`
      : `You found ${collected} of ${items.length} ${what()}. The signal bars under the radar tell you whether you are getting closer.`;
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
// ### The menu shows the real vehicles: each model is rendered once at start-up to a small transparent picture, seen from the front
// ### three-quarters, so the previews can never go out of date. If that fails, the drawn icons in ICONS are shown instead.
const PREVIEWS = {};
function renderPreviews(){
  const W = 640, H = 340, rt = new THREE.WebGLRenderTarget(W, H), s = new THREE.Scene(), cam = new THREE.PerspectiveCamera(24, W / H, 0.1, 200);
  rt.texture.encoding = THREE.sRGBEncoding;
  s.environment = scene.environment;
  const key = new THREE.DirectionalLight(0xfff4e6, 2.4); key.position.set(4, 8, 6);
  const rim = new THREE.DirectionalLight(0x8fdcff, 1.5); rim.position.set(-6, 3, -5);
  const fill = new THREE.HemisphereLight(0xcfe0ff, 0x252a3a, 1.1);
  s.add(key, rim, fill);
  const shadows = renderer.shadowMap.enabled, clear = renderer.getClearAlpha(), pixels = new Uint8Array(W * H * 4);
  renderer.shadowMap.enabled = false; renderer.setClearAlpha(0);
  try {
    for (const k of Object.keys(MODELS)){
      const md = MODELS[k], parent = md.g.parent;
      s.add(md.g); md.g.visible = true;
      const box = new THREE.Box3().setFromObject(md.g), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
      const d = r / Math.sin(cam.fov * Math.PI / 360) * 0.66;
      cam.position.set(c.x + d * 0.72, c.y + d * 0.2, c.z + d * 0.66); cam.lookAt(c);
      renderer.setRenderTarget(rt); renderer.clear(); renderer.render(s, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, W, H, pixels);
      const big = document.createElement('canvas'); big.width = W; big.height = H;
      const b = big.getContext('2d'), img = b.createImageData(W, H);
      for (let y = 0; y < H; y++) img.data.set(pixels.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      b.putImageData(img, 0, 0);
      const out = document.createElement('canvas'); out.width = W / 2; out.height = H / 2;
      out.getContext('2d').drawImage(big, 0, 0, W / 2, H / 2);
      PREVIEWS[k] = out.toDataURL('image/png');
      parent.add(md.g); md.g.visible = false;
    }
  } catch (e) { /* the drawn icons stay */ }
  renderer.setRenderTarget(null); renderer.shadowMap.enabled = shadows; renderer.setClearAlpha(clear);
  rt.dispose();
}
const STAT_NAMES = ['Top speed', 'Acceleration', 'Handling', 'Durability', 'Ramming'];
const STAT_WORDS = ['', 'Low', 'Fair', 'Good', 'High', 'Max'];
const { vehStats, zeroTo80 } = Core;
// ### Shows the chosen vehicle in the menu; its stat bars are computed from the tuning table.
function renderVehDetail(){
  const v = VEH[sel.veh], el = card.querySelector('#vehDetail');
  if (!el) return;
  const st = vehStats(v);
  const value = i => i === 0 ? Math.round(MODES[sel.mode].max * v.speed * 3.6) + ' km/h' : i === 1 ? '0–80 ' + zeroTo80(v, MODES[sel.mode]).toFixed(1) + ' s' : STAT_WORDS[st[i]];
  el.innerHTML = `<div class="vd-head"><b>${v.name}</b><span class="vd-cls">${v.cls}</span></div><p>${v.blurb}</p>
    <div class="vd-stats">${STAT_NAMES.map((n, i) => `<div class="vd-row"><span>${n}</span><span class="vd-bar">${[0, 1, 2, 3, 4].map(j => `<i class="${j < st[i] ? 'on' : ''}"></i>`).join('')}</span><b>${value(i)}</b></div>`).join('')}</div>`;
  $('showName').textContent = v.cls;
}
// ### Builds the main menu: story mode, maps, vehicle, radio, graphics.
function showMenu(){
  // back from the bridge: the night returns and the car stands in the city again
  if (finale.on){ endFinale(); hideWitness(); resetCar(); }
  state = 'menu';
  hud.classList.add('off');
  const bestNote = k => best[k] ? fmtTimeExact(best[k]) : 'no run yet';
  showCard(`
    <div class="m-top">
      <div class="m-brand"><span class="m-dot"></span>Room 2 · The chase · Inmate 4471 has escaped · 02:30</div>
      <h1 class="m-logo">Framed<em class="sub">One night in Lisbon</em></h1>
      <p class="m-lede">You are out of Cell Block D, and every police car in town knows it. Find the evidence that proves you innocent, ram the police, outrun them or lose them in traffic, then escape through the gate.</p>
    </div>
    <button class="story-card" data-action="story"><span class="sc-eyebrow">Story mode · after the tunnel · one night in Lisbon · 3 endings</span><b>The Necklace Job</b><span>You escaped. Now prove who framed you: find the evidence in the Baixa, and a sealed letter that is on no map, with Officer Hale on the radio.</span><em>Play the story →</em></button>
    <section class="m-sec">
      <div class="m-label"><span>01</span>Free ride · Choose your getaway vehicle</div>
      <div class="vtabs">${['car', 'bike', 'truck'].map(k => `<button class="vtab" data-pick="veh" data-val="${k}" aria-pressed="${sel.veh === k}">${PREVIEWS[k] ? `<img src="${PREVIEWS[k]}" alt="">` : ICONS[k]}<span>${VEH[k].name}<small>${VEH[k].cls}</small></span></button>`).join('')}</div>
      <div class="vdetail" id="vehDetail"></div>
    </section>
    <section class="m-sec" data-drivers>${driverSection()}</section>
    <button class="btn m-start" data-action="go"><span>Start the getaway</span><kbd class="desk-only">Enter</kbd></button>
    <div class="m-foot">
      <span class="desk-only"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive · <kbd>Space</kbd> handbrake · <kbd>C</kbd> look back · <kbd>E</kbd> nitro · <kbd>P</kbd> pause · <kbd>M</kbd> map · <kbd>N</kbd> sound · <kbd>R</kbd> radio</span>
      <span class="touch-only">Steer on the left, brake and gas on the right. Hold the round button to look back; tap the flame for nitro.</span>
      <span>Best · Lisbon ${bestNote('city')}</span>
      <span class="gfx">Radio ${Core.RADIO_ORDER.map(k => `<button data-radio="${k}" aria-pressed="${radio.key === k}">${k === 'off' ? 'Off' : Core.RADIO[k].name}</button>`).join('')}</span>
      <span class="gfx">Graphics <button data-gfx="ultra" aria-pressed="${gfx === 'ultra'}">Ultra</button><button data-gfx="balanced" aria-pressed="${gfx === 'balanced'}">Balanced</button></span>
      ${steerRow()}
      ${volumeRow()}
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

// ### Shows a card (result, pause, story) over the game.
function showCard(html, kind){
  const isMenu = kind === 'menu';
  card.innerHTML = html;
  overlay.classList.toggle('menu', isMenu); card.classList.toggle('menu', isMenu); overlay.classList.toggle('garage', kind === 'garage'); card.classList.toggle('garage', kind === 'garage'); card.classList.toggle('map', kind === 'map'); card.classList.toggle('result', kind === 'result');
  menuFraming(isMenu);
  overlay.hidden = false;
  const b = card.querySelector('.btn'); if (b && !COARSE) b.focus({ preventScroll: true });
}
// ### Hides the card and returns to the game.
function hideOverlay(){ overlay.hidden = true; menuFraming(false); }
function backToMenu(){
  heist.run = null;
  garageLeave();
  setMode('city'); placeRun(); resetCar(); resetPolice(); damage = 0;
  Object.values(MODELS).forEach(md => md.paint.color.copy(md.base));
  setVehicle(sel.veh);
  showMenu();
}

// moving a volume slider: the music plays for a moment so it can be heard, the game sounds give a short tone when let go
card.addEventListener('input', e => {
  const r = e.target.closest('[data-vol]');
  if (!r) return;
  initAudio();
  if (r.dataset.vol === 'music') musicPreview = performance.now() + 1500;
  setVolume(r.dataset.vol, Number(r.value) / 100);
});
// letting go of the police slider plays a short whoop of a siren at the new volume
card.addEventListener('change', e => {
  const r = e.target.closest('[data-vol]');
  if (r && r.dataset.vol === 'game') sfx.collect();
  if (r && r.dataset.vol === 'police' && audio && !muted){
    const { ctx } = audio, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(650, t); o.frequency.exponentialRampToValueAtTime(1280, t + 0.45);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.05); g.gain.setTargetAtTime(0, t + 0.42, 0.06);
    o.connect(g).connect(audio.policeVol); o.start(t); o.stop(t + 0.8);
  }
});
card.addEventListener('click', e => {
  const ac = e.target.closest('[data-acc]');
  if (ac){ accountAction(ac.dataset.acc, ac); return; }
  const da = e.target.closest('[data-driver-add]');
  if (da){ addDriverFrom(da); return; }
  const db = e.target.closest('[data-driver]');
  if (db){ if (setDriver(db.dataset.driver)) refreshDriverViews(); return; }
  const rb = e.target.closest('[data-radio]');
  if (rb){
    setStation(rb.dataset.radio, false);
    return;
  }
  const sb = e.target.closest('[data-steer]');
  if (sb){
    TILT.mode = Core.parseSteer(sb.dataset.steer);
    card.querySelectorAll('[data-steer]').forEach(b => b.setAttribute('aria-pressed', String(b === sb)));
    writeStore('shard-heist-steer', TILT.mode);
    tiltAsk();
    return;
  }
  const gb = e.target.closest('[data-gfx]');
  if (gb){
    gfx = gb.dataset.gfx;
    quality = Core.newQuality();
    card.querySelectorAll('[data-gfx]').forEach(b => b.setAttribute('aria-pressed', String(b === gb)));
    writeStore('shard-heist-gfx', gfx);
    applyGfx();
    return;
  }
  const pick = e.target.closest('[data-pick]');
  if (pick){
    if (!Core.applyPick(sel, pick.dataset.pick, pick.dataset.val)) return;
    card.querySelectorAll(`[data-pick="${pick.dataset.pick}"]`).forEach(b => b.setAttribute('aria-pressed', String(b === pick)));
    if (pick.dataset.pick === 'veh'){ setVehicle(sel.veh); if (garage.on) garageChosen(true); }
    renderVehDetail();
    writeStore('shard-heist-pick', JSON.stringify(sel));
    return;
  }
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const a = b.dataset.action;
  if (!Core.actionAllowed(a, { state, story })) return;
  initAudio();
  if (a === 'go'){ story = null; startRun(sel.mode, sel.veh, true); enterGarage(); }
  else if (a === 'board') garageBoard();
  else if (a === 'street') garageToStreet(false);
  else if (a === 'again') startRun(mode, V.key);
  else if (a === 'resume') resume();
  else if (a === 'menu'){ story = null; backToMenu(); }
  else if (a === 'story') showStoryIntro();
  else if (a === 'act') startStoryAct(story.act, true);
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
$('btnRadio').addEventListener('click', e => { e.currentTarget.blur(); initAudio(); setStation(Core.radioNext(radio.key, 1), true); });

// ---------- Physics ----------
// ### Arcade car physics: throttle, brake, hills (Core.slopeTop, gravity in Core.stepSpeed), coasting drag, speed-dependent steering and a top speed reduced by damage and
// ### off-road driving. Collisions test a few circles along the vehicle against boxes and circles and push the car out;
// ### the impact speed along the contact normal decides the damage. The chase camera follows smoothly and is kept out of
// ### buildings (camClip) and above hills.
const collidePoint = Core.collidePoint;
// ### The tram rails in Lisbon: every frame each wheel is checked against the two rails (Core.trackOffset). A wheel that crossed
// ### a rail since the last frame gives a jolt (camera, body, a clack, and a short buzz on phones that can vibrate); rolling on
// ### the stone track bed gives a light, steady rumble. The front axle hits first and the rear one a moment later, like a real car.
const RAIL_WHEELS = { car: [[0.87, 1.45], [-0.87, 1.45], [0.88, -1.35], [-0.88, -1.35]], bike: [[0, 0.76], [0, -0.74]], truck: [[1.1, 2.0], [-1.1, 2.0], [0.91, -1.7], [-0.91, -1.7]] };
let railBuzz = 0;
function updateRails(dt){
  if (finale.on){ car.railPrev = null; return; }
  const ch = Math.cos(car.heading), sh = Math.sin(car.heading), now = RAIL_WHEELS[V.key].map(([lx, lz]) => Core.trackOffset(car.x + lx * ch + lz * sh, car.z - lx * sh + lz * ch));
  let crossings = 0, onBed = false;
  now.forEach((o, i) => { if (car.railPrev) crossings += Core.railCrossings(car.railPrev[i], o); if (Math.abs(o) <= Core.RAIL.bed) onBed = true; });
  car.railPrev = now;
  const { jolt, rumble } = Core.railShake(crossings, car.speed, onBed);
  if (rumble){ car.shake = Math.max(car.shake, rumble); car.rattle = Math.max(car.rattle || 0, rumble * 1.5); }
  if (!jolt) return;
  car.shake = Math.max(car.shake, jolt); car.rattle = Math.max(car.rattle || 0, jolt * 2.2);
  sfx.rail(jolt);
  const t = performance.now();
  // (a browser refuses to vibrate before the first tap on the page, and says so in its console: wait for one)
  if (COARSE && t > railBuzz && navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)){ railBuzz = t + 90; try { navigator.vibrate(Math.round(12 + jolt * 50)); } catch (e) {} }
}
// ### Player physics each frame: speed with slopes, steering, movement, collisions, and how the vehicle sits on the ground.
function updateCar(dt){
  const grade = Core.gradeAt(mode, car.x, car.z, car.heading);
  // ### Nitro (Core.nitroFire, nitroTop, nitroPush): a press of E or the flame button fires a charge, which raises the top speed
  // ### and pushes the vehicle on for 2.5 s. Only the press counts, so holding the key does not fire the next one.
  if (keys.nitro && !nitroHeld && Core.nitroFire(nitro, state, car.speed)) sfx.nitro();
  nitroHeld = keys.nitro;
  const maxNow = Core.nitroTop(Core.slopeTop(Core.topSpeed(M, V, damage), grade, V), nitro);
  car.speed = Core.nitroPush(Core.stepSpeed(car.speed, keys, dt, maxNow, V, grade), nitro, dt, maxNow);
  if (Core.nitroOn(nitro)) car.shake = Math.max(car.shake, 0.05);
  Core.nitroStep(nitro, dt);

  // ### Steering: the rules (how fast the wheel turns, how tightly the tyres let the vehicle turn, how the turn rate builds up)
  // ### are Core.stepSteer, Core.turnRate and Core.stepYaw, tested in tests/room-2/rules.test.js.
  const steerIn = (keys.left ? 1 : 0) - (keys.right ? 1 : 0) || TILT.value;
  car.steer = Core.stepSteer(car.steer, steerIn, dt);
  const sp = Math.abs(car.speed);
  car.yaw = Core.stepYaw(car.yaw || 0, Core.turnRate(car.steer, car.speed, V, keys.brake), dt, V);
  car.heading += car.yaw * dt * (car.speed >= 0 ? 1 : -1);

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
  // the hardest scrape of this frame: the speed along the surface against what is touched (Core.scrapeLevel)
  const sc = scrapeNow, at = SCRAPE_AT[V.key] || SCRAPE_AT.car;
  sc.level = 0;
  const scrapeAt = (hit, s, vxo, vzo, c) => {
    const rvx = fx * car.speed - (vxo || 0), rvz = fz * car.speed - (vzo || 0), lv = Core.scrapeLevel(rvx, rvz, hit[0], hit[1]);
    if (lv <= sc.level) return;
    const along = -rvx * hit[1] + rvz * hit[0], dir = Math.sign(along) || 1;
    Object.assign(sc, { level: lv, along: Math.abs(along), nx: hit[0], nz: hit[1], tx: -hit[1] * dir, tz: hit[0] * dir, vx: vxo || 0, vz: vzo || 0, c: c || null,
      x: car.x + fx * s - hit[0] * V.r, z: car.z + fz * s - hit[1] * V.r, y: car.y + at[0], floor: car.y + 0.03 });
  };
  const nearC = collidersNear(car.x, car.z);
  for (const s of V.samples){
    for (const c of nearC){
      const hit = collidePoint(car.x + fx * s, car.z + fz * s, V.r, c);
      if (!hit) continue;
      if (c.car){
        // a parked car gives way: it is pushed, and you keep more speed than against a wall
        const p = c.car, impact = hitWith(hit, p.pvx, p.pvz);
        scrapeAt(hit, s, p.pvx, p.pvz, c);
        const share = impact > 0.5 ? pushParked(p, -hit[0], -hit[1], impact, car.x + fx * s, car.z + fz * s, PLAYER_MASS[V.key] || 1) : 0;
        if (impact > 2){ worst = Math.max(worst, impact); car.speed *= Core.keepSpeed(share); sfx.hit(impact, MASS.sedan * PARKED.brake); } else car.speed *= 0.985;
        continue;
      }
      const impact = hitWith(hit);
      scrapeAt(hit, s, 0, 0, c);
      if (impact > 2){ worst = Math.max(worst, impact); car.speed *= 0.3; } else car.speed *= 0.985;
    }
  }
  for (const o of vehicleObstacles()){
    for (const s of V.samples){
      const hit = collidePoint(car.x + fx * s, car.z + fz * s, V.r, { t: 'c', x: o.x, z: o.z, r: o.r });
      if (!hit) continue;
      const impact = hitWith(hit, o.vx, o.vz);
      scrapeAt(hit, s, o.vx, o.vz);
      // the hit vehicle is pushed away from you; you keep more speed the lighter it is
      const share = o.npc && impact > 1 ? shove(o.npc, -hit[0], -hit[1], impact, o.x, o.z, PLAYER_MASS[V.key] || 1) : 0;
      if (o.npc) o.npc.stun = Math.max(o.npc.stun, 2.5);
      if (impact > 2){ worst = Math.max(worst, impact); car.speed *= o.npc ? Core.keepSpeed(share) : 0.4; if (o.npc) sfx.hit(impact, massOf(o.npc)); }
      break;
    }
  }
  scrapeEffects(dt);
  if (worst > 0) crash(worst, Core.chargeCrash(crashGuard, worst, V, clock));
  if (state !== 'play') return;
  settleCar(dt);
}

// ### Keeps the vehicle inside the map and on the ground, and sets its pitch, roll and wheels.
function settleCar(dt){
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);

  if (Math.abs(car.x) > LIMIT || Math.abs(car.z) > LIMIT){
    const into = (Math.abs(car.x) > LIMIT ? Math.sign(car.x) * fx : 0) + (Math.abs(car.z) > LIMIT ? Math.sign(car.z) * fz : 0);
    car.x = clamp(car.x, -LIMIT, LIMIT); car.z = clamp(car.z, -LIMIT, LIMIT);
    if (into * car.speed > 0) car.speed *= Math.exp(-6 * dt);
  }

  const rxv = -fz, rzv = fx, half = V.key === 'truck' ? 3 : 1.5;
  const hF = groundH(car.x + fx * half, car.z + fz * half), hB = groundH(car.x - fx * half, car.z - fz * half);
  const hR = groundH(car.x + rxv * 1.1, car.z + rzv * 1.1), hL = groundH(car.x - rxv * 1.1, car.z - rzv * 1.1);
  car.pitch += (Math.atan2(hF - hB, half * 2) - car.pitch) * Math.min(1, 10 * dt);
  car.roll += (Math.atan2(hL - hR, 2.2) - car.roll) * Math.min(1, 10 * dt);
  const ty = Math.max((hF + hB + hL + hR) / 4, groundH(car.x, car.z));
  // the land is followed exactly, otherwise the vehicle would sink into every climb; only a kerb's step is smoothed
  const land = garage.on ? garageGround(car.x, car.z) : hill(car.x, car.z);
  car.lift += (ty - land - car.lift) * Math.min(1, 18 * dt);
  car.y = land + car.lift;
  const accel = (car.speed - car.prevSpeed) / Math.max(dt, 1e-4);
  car.prevSpeed = car.speed;
  car.bodyPitch += (clamp(accel * 0.0025, -0.06, 0.05) - car.bodyPitch) * Math.min(1, 6 * dt);
  car.wheelRot += car.speed * dt;
}

// ### When a run ends the vehicle rolls out instead of stopping dead, and stops at the first thing in its way.
function coast(dt){
  car.speed *= Math.exp(-dt * 3);
  if (Math.abs(car.speed) < 0.05){ car.speed = 0; return; }
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading), x = car.x + fx * car.speed * dt, z = car.z + fz * car.speed * dt;
  const blocked = V.samples.some(s => {
    const px = x + fx * s, pz = z + fz * s;
    if (collidersNear(x, z).some(c => collidePoint(px, pz, V.r, c))) return true;
    return vehicleObstacles().some(o => Math.hypot(o.x - px, o.z - pz) < o.r + V.r);
  });
  if (blocked){ car.speed = 0; return; }
  car.x = x; car.z = z;
  settleCar(dt);
}

// ### Moves the 3D vehicle to its physics position; sets brake lights, damage parts, dents, lean and spinning wheels.
function applyCarMesh(dt){
  carGroup.position.set(car.x, car.y, car.z);
  carGroup.rotation.y = car.heading;
  const sp = Math.abs(car.speed), md = MODELS[V.key];
  const driving = state === 'play' || garage.live || (finale.on && finale.ramp);
  const braking = driving && Core.isBraking(car.speed, keys.down, keys.up, keys.brake);
  if (braking !== brakeLights.on){
    brakeLights.on = braking;
    brakeLights.mat.color.setHex(braking ? 0xff2a38 : 0x7a0c14);
    brakeLights.glows.forEach(s => { s.visible = braking; });
  }
  const reversing = driving && Core.isReversing(car.speed);
  if (reversing !== reverseLights.on){
    reverseLights.on = reversing;
    reverseLights.mat.color.setHex(reversing ? 0xf4f8ff : 0x4a4e55);
    reverseLights.glows.forEach(s => { s.visible = reversing; });
  }
  const stage = Core.damageStage(damage);
  if (stage !== md.stage){
    md.stage = stage;
    md.damageParts.forEach(d => { d.m.visible = d.show ? stage >= d.stage : stage < d.stage; });
  }
  dentU.value = sstep(12, 100, damage) * md.dent;
  // a hanging part scrapes the road and throws sparks
  if (state === 'play' && stage === 3 && sp > 12 && Math.random() < dt * 5) burst(car.x - Math.sin(car.heading) * 2, car.y + 0.15, car.z - Math.cos(car.heading) * 2, SPARKS, 2, 0.3);
  carTilt.rotation.x = -(car.pitch + car.bodyPitch);
  if (V.key === 'bike'){
    car.lean += (-car.steer * Math.min(1, sp / 18) * 0.5 - car.lean) * Math.min(1, 8 * dt);
    carTilt.rotation.z = car.lean;
    // the rider tucks in at speed and leans further into the turn than the bike
    md.rider.rotation.x = 0.07 * Math.min(1, sp / 28);
    md.rider.rotation.z = car.lean * 0.22; md.rider.position.x = car.lean * 0.1;
  // a car leans out of the corner by how hard it is actually cornering (sideways pull = speed x turn rate), not by the key alone
  } else carTilt.rotation.z = car.roll + clamp(sp * (car.yaw || 0) / 16, -1, 1) * (V.key === 'truck' ? 0.035 : 0.05) * (car.speed >= 0 ? 1 : -1) + (md.stage === 3 ? 0.022 : 0);
  // The body leans in turns, dips when braking and sags when wrecked, but it turns about the middle of the vehicle at road
  // level, so a wheel on the low side would sink into the road. Lift it by as much as that lowest wheel would sink.
  const lean = V.key === 'bike' ? 0 : carTilt.rotation.z - car.roll, track = Math.max(...md.skid.x.map(Math.abs)) + md.skid.w / 2;
  carTilt.position.y = track * Math.abs(Math.sin(lean)) + Math.abs(md.skid.z) * Math.abs(Math.sin(car.bodyPitch));
  // the rails shake the body: it hops up a few centimetres and rocks a little (never with reduced motion)
  if ((car.rattle || 0) > 0.004 && !REDUCED){ carTilt.position.y += Math.random() * car.rattle * 0.07; carTilt.rotation.z += (Math.random() - 0.5) * car.rattle * 0.035; carTilt.rotation.x += (Math.random() - 0.5) * car.rattle * 0.02; }
  car.rattle = (car.rattle || 0) * Math.exp(-dt * 9);
  md.wheels.forEach(w => w.rotation.x = car.wheelRot / md.r);
  md.pivots.forEach(p => p.rotation.y = car.steer * 0.45);
  md.paint.color.copy(md.base).lerp(PAINT_DEAD, damage / 100 * 0.65);
  // battered paint loses its shine: the clear coat goes dull and the surface rough
  if (md.rough0 === undefined) md.rough0 = md.paint.roughness;
  md.paint.clearcoat = 1 - 0.85 * damage / 100; md.paint.roughness = md.rough0 + 0.45 * damage / 100;
}

// Keeps the chase camera out of buildings
function camClip(tx, tz){
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

// ### The chase camera: follows behind, stays out of buildings and above the ground, and widens with speed.
// ### The nitro flame: four glows behind the exhaust, a white-blue core and three fading blue ones, that flicker and stretch out
// ### behind the vehicle while a charge burns, and the view widens a little.
let nitroHeld = false, nitroFov = 0;
const NITRO_AT = { car: [-2.25, 0.33], bike: [-1.0, 0.5], truck: [-2.3, 0.55] };
const nitroFlame = [[0xe4f2ff, 1.1, 0], [0x6fb4ff, 1.6, 0.6], [0x4f7dff, 2.0, 1.4], [0x6a4dff, 2.3, 2.4]].map(([c, size, back]) => {
  const g = glowSprite(C(c), size, 0); g.visible = false; g.userData = { size, back }; carTilt.add(g); return g;
});
function updateNitroFx(){
  const on = Core.nitroOn(nitro) && (state === 'play' || state === 'pause'), at = NITRO_AT[V.key] || NITRO_AT.car;
  const fade = on ? Math.min(1, nitro.left / 0.4) : 0;
  nitroFlame.forEach((g, i) => {
    g.visible = on;
    if (!on) return;
    const flick = 0.75 + Math.random() * 0.5, d = g.userData;
    g.position.set(0, at[1], at[0] - d.back * (0.8 + Math.random() * 0.4));
    g.scale.setScalar(d.size * flick * (0.5 + 0.5 * fade));
    g.material.opacity = (i === 0 ? 1 : 0.85 - i * 0.18) * fade;
  });
}
// ### Looking back (Core.lookingBack, Core.lookBackView): while C or the look-back button is held, the camera jumps ahead of the
// ### vehicle and looks back down the road. It cuts there and back at once, as a swing through the car would be hard to follow.
const look = { on: false, snap: false };
function setLook(on){
  if (on === look.on) return;
  look.on = on; look.snap = true; ui.lookTag.hidden = !on;
}
function chaseCam(dt){
  // the camera swings round after the car on a smoothed heading, so a quick tap of the steering does not jerk the whole view
  if (car.camHeading === undefined || Math.abs(wrapAngle(car.heading - car.camHeading)) > 1.2) car.camHeading = car.heading;
  car.camHeading += wrapAngle(car.heading - car.camHeading) * Math.min(1, dt * 6);
  setLook(Core.lookingBack(keys.look, state));
  const v = look.on && Core.lookBackView(car.x, car.y, car.z, car.camHeading, V.cam);
  if (v){
    const f = camClip(v.px, v.pz), kb = look.snap ? 1 : 1 - Math.exp(-dt * 10);
    camera.position.x += (car.x + (v.px - car.x) * f - camera.position.x) * kb;
    camera.position.z += (car.z + (v.pz - car.z) * f - camera.position.z) * kb;
    camera.position.y += (v.py + (1 - f) * 1.5 - camera.position.y) * kb;
    const gb = groundH(camera.position.x, camera.position.z) + 1.5; if (camera.position.y < gb) camera.position.y = gb;
    camera.lookAt(v.tx, v.ty, v.tz);
    look.snap = false;
    if (camera.fov !== 62){ camera.fov = 62; camera.updateProjectionMatrix(); }
    return;
  }
  const fx = Math.sin(car.camHeading), fz = Math.cos(car.camHeading), sp = Math.abs(car.speed);
  const dist = V.cam[0] + sp * 0.07;
  let tx = car.x - fx * dist, tz = car.z - fz * dist;
  const f = camClip(tx, tz);
  tx = car.x + (tx - car.x) * f; tz = car.z + (tz - car.z) * f;
  const h = V.cam[1] + sp * 0.025 + (1 - f) * 2.5;
  const k = look.snap ? 1 : 1 - Math.exp(-dt * 4.5);
  look.snap = false;
  camera.position.x += (tx - camera.position.x) * k;
  camera.position.z += (tz - camera.position.z) * k;
  camera.position.y += (car.y + h - camera.position.y) * k;
  const gh = groundH(camera.position.x, camera.position.z) + 1.5; if (camera.position.y < gh) camera.position.y = gh;
  camera.lookAt(car.x + fx * 4, car.y + 1.6, car.z + fz * 4);
  if (car.shake > 0.01 && !REDUCED){
    camera.position.x += (Math.random() - 0.5) * car.shake * 0.6;
    camera.position.y += (Math.random() - 0.5) * car.shake * 0.6;
  }
  car.shake *= Math.exp(-dt * 6);
  nitroFov += ((Core.nitroOn(nitro) ? 6 : 0) - nitroFov) * Math.min(1, dt * (Core.nitroOn(nitro) ? 6 : 2));
  const fov = 62 + sp / (M.max * V.speed) * 14 + nitroFov;
  if (Math.abs(camera.fov - fov) > 0.05){ camera.fov = fov; camera.updateProjectionMatrix(); }
}
// ### The showroom camera that circles the chosen vehicle in the menu.
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
// ### Turns the showroom lights and the turntable on only while the menu is open.
function updateShowroom(){
  // down in the garage the same two lights do the work of its lamps, and the ring marks the vehicle that is chosen
  const gar = garage.on, on = state === 'menu' || gar;
  turntable.visible = state === 'menu' || (gar && garage.phase === 'pick');
  // on the way out they fade as the roller door rolls up, so the street takes over the light without a jump
  // on the ramp the tubes light the way, so the key light that follows the vehicle steps back and does not wash out the floor
  const upRamp = gar && car.z > Core.GARAGE.z1 + 1 ? 0.35 : 1;
  // in the garage the key light is softer and wider (no bright disc on the back wall), and the rim light is white, not cyan
  showKey.intensity = gar ? 2.6 * upRamp * (1 - 0.8 * garage.open) : on ? 3.2 : 0;
  showKey.angle = gar ? 0.8 : 0.55; showKey.penumbra = gar ? 1 : 0.6;
  showRim.color.setHex(gar ? 0xfff1dc : 0x55ecff);
  showRim.intensity = gar ? 0.45 * (1 - 0.8 * garage.open) : on ? 2.4 : 0;
  if (!on) return;
  const s = V.key === 'truck' ? 1.65 : V.key === 'bike' ? 0.62 : 1;
  // the ring lies on the street like the vehicle does; kept level on a slope it would cut through the tyres on the low side
  turntable.position.set(car.x, car.y, car.z); turntable.scale.setScalar(s);
  turntable.rotation.set(-car.pitch, car.heading, car.roll, 'YXZ');
  turntable.children[1].material.opacity = 0.5 + 0.25 * Math.sin(clock * 2);
  showKey.position.set(car.x + 4 * s, car.y + 9 * s, car.z + 5 * s); showKey.target.position.set(car.x, car.y, car.z);
  showRim.position.set(car.x - Math.sin(orbitAngle) * 4 * s, car.y + 2.2 * s, car.z - Math.cos(orbitAngle) * 4 * s);
  if (gar){
    const G = Core.GARAGE, pick = garage.phase !== 'drive' && garage.phase !== 'exit';
    const ox = garage.shift ? garage.shift.x : 0;
    showKey.position.set(pick ? 0 : ox + (car.x - ox) * 0.4, car.y + 13, pick ? 2 : car.z + 5); showKey.target.position.set(pick ? 0 : car.x, car.y, pick ? G.bays.bike[1] : car.z);
    showRim.position.set(car.x + Math.sin(car.heading) * 3.5, car.y + 2.4, car.z + Math.cos(car.heading) * 3.5);
  }
}

// ---------- The player on foot ----------
// ### The player on foot, seen through their own eyes: the same body as in room 1 (the escape room), so the two rooms feel
// ### like one person. The walk (the way it builds up and fades, the dip of the head at every footfall, the sway from
// ### foot to foot), the look (dragging turns the head), the glide to a spot, the two hands in the sleeves of the striped
// ### prison uniform with their swing, springs, idle gestures and reach, and the echo of the footsteps are the code of
// ### room-1-escape/js/room.js, copied word for word (the pace is the caller's: o.pace, faster in the garage, with a run); only what ties them to the washroom (its walls, its puddles, the ladder)
// ### is left out. The hand models and the linen scans are loaded from room 1's folder, so there is one copy of each. If they
// ### cannot be loaded, the drawn hands stand in, as in room 1. The steps are synthesised (see "Footsteps").
// ### ShardWalker.create(o) returns one walker. o: THREE, renderer, camera, canvas, reduced, base (the path to room 1),
// ### collide(p) (keeps the standing point out of walls), floorAt(x, z), sound() (the audio context and where to play, or null).
const ShardWalker = (() => {
function create(o){
const THREE = o.THREE, renderer = o.renderer, camera = o.camera, canvas = o.canvas, REDUCED = !!o.reduced, BASE = o.base;
const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(4471);
let clock = 0, active = false;

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

// ---------- Camera: walking and looking around ----------
// ### You walk freely in the first person: the arrow keys (or W A S D) walk, dragging the mouse or a finger turns your head.
// ### goTo glides you to a spot instead, with the same footsteps.
const EYE = 1.62, WALK_SPEED = 1.7, BODY = .26, LOOK_SPEED = .0042;
// lookYaw and lookPitch are where the mouse points the head; yaw and pitch follow them within a few milliseconds, so uneven
// mouse events never make the picture jerk
const cam = { pos: new THREE.Vector3(0, EYE, 0), yaw: 0, pitch: 0, lookYaw: 0, lookPitch: 0, from: null, t: 1, dur: 1,
  vel: new THREE.Vector3(), stride: 0, bob: 0, sway: 0, stepAmp: 1 };
// ### The camera angles that look at a point.
const anglesTo = (pos, look) => { const d = new THREE.Vector3(...look).sub(new THREE.Vector3(...pos)); return { yaw: Math.atan2(d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) }; };
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
let camTarget = { pos: cam.pos.clone(), yaw: 0, pitch: 0 };
// ### Stands you at a spot, looking at a point, at once.
function place(pos, look){
  const a = anglesTo(pos, look);
  cam.pos.set(pos[0], pos[1], pos[2]); cam.vel.set(0, 0, 0); cam.t = 1; cam.bob = cam.sway = 0;
  Object.assign(cam, { yaw: a.yaw, pitch: a.pitch, lookYaw: a.yaw, lookPitch: a.pitch });
}
// ### Moves the camera smoothly to another place (room 1's goView, with the place given by the caller).
function goTo(pos, look, dur){
  cam.yaw = wrapAngle(cam.yaw);
  cam.from = { pos: cam.pos.clone(), yaw: cam.yaw, pitch: cam.pitch };
  camTarget = { pos: new THREE.Vector3(...pos), ...anglesTo(pos, look) };
  // turn the short way round
  while (camTarget.yaw - cam.from.yaw > Math.PI) camTarget.yaw -= Math.PI * 2;
  while (camTarget.yaw - cam.from.yaw < -Math.PI) camTarget.yaw += Math.PI * 2;
  cam.t = 0; cam.dur = REDUCED ? .01 : (dur || 1.1); cam.vel.set(0, 0, 0);
}
// ### One step of walking: speed builds up and fades out smoothly, you slide along walls, and the floor answers with real
// ### footsteps (see "Footsteps"). The head moves as in a real walk (not with reduced motion): it dips a little at every footfall and rises
// ### over the standing leg, and the body shifts its weight from one foot to the other, so the view sways gently from side
// ### to side once every two steps and tilts with it. f and s are the keys held: forwards and to the right.
function walk(dt, f, s, canWalk){
  if (!canWalk){ cam.vel.set(0, 0, 0); cam.bob *= .9; return; }
  const len = Math.hypot(f, s);
  const fx = Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), sp = len ? (o.pace ? o.pace() : WALK_SPEED) / len : 0;
  const k = 1 - Math.exp(-dt * (len ? 10 : 14));
  cam.vel.x += ((fx * f - fz * s) * sp - cam.vel.x) * k;
  cam.vel.z += ((fz * f + fx * s) * sp - cam.vel.z) * k;
  const speed = Math.hypot(cam.vel.x, cam.vel.z);
  if (speed > .002){
    cam.pos.x += cam.vel.x * dt; cam.pos.z += cam.vel.z * dt;
    o.collide(cam.pos, BODY);
    const before = Math.floor(cam.stride / .8);
    cam.stride += speed * dt;
    if (Math.floor(cam.stride / .8) !== before){
      // no two steps are quite the same: each one dips the head a little more or less
      cam.stepAmp = .82 + Math.random() * .36;
      if (speed > .5) step(speed);
    }
  } else cam.vel.set(0, 0, 0);
  // a gentle bob that fades in and out with the speed
  cam.pos.y += (o.floorAt(cam.pos.x, cam.pos.z) + EYE - cam.pos.y) * (1 - Math.exp(-dt * 6));
  const gait = REDUCED ? 0 : Math.min(1, speed / WALK_SPEED), steps = cam.stride / .8, kb = 1 - Math.exp(-dt * 12);
  // lowest at each footfall (when the footstep sounds), highest halfway through the step
  cam.bob += ((Math.abs(Math.sin(Math.PI * steps)) - .64) * .026 * gait * cam.stepAmp - cam.bob) * kb;
  cam.sway += (Math.sin(Math.PI * steps) * .011 * gait - cam.sway) * kb;
}
// ### Moves the camera each frame: a glide when one runs, otherwise walking and looking. Then the hands.
function update(dt, f, s, canWalk){
  clock += dt;
  if (cam.t < 1){
    cam.t = Math.min(1, cam.t + dt / cam.dur);
    const e = cam.t < .5 ? 2 * cam.t * cam.t : 1 - Math.pow(-2 * cam.t + 2, 2) / 2, px = cam.pos.x, pz = cam.pos.z;
    cam.pos.lerpVectors(cam.from.pos, camTarget.pos, e);
    // walking there with the buttons: the same footsteps, one every stride
    const moved = Math.hypot(cam.pos.x - px, cam.pos.z - pz);
    if (dt > 0 && moved / dt > .3){
      const before = Math.floor(cam.stride / .8); cam.stride += moved;
      if (Math.floor(cam.stride / .8) !== before) step(Math.min(WALK_SPEED, moved / dt));
    }
    cam.lookYaw = cam.yaw = cam.from.yaw + (camTarget.yaw - cam.from.yaw) * e;
    cam.lookPitch = cam.pitch = cam.from.pitch + (camTarget.pitch - cam.from.pitch) * e;
    cam.bob *= .9; cam.sway *= .9;
  } else {
    const k = 1 - Math.exp(-dt * 30);
    cam.yaw += (cam.lookYaw - cam.yaw) * k; cam.pitch += (cam.lookPitch - cam.pitch) * k;
    walk(dt, f, s, canWalk);
  }
  // the weight shift moves the eye sideways (to the right of where you look) and tilts the head a little with it
  camera.position.set(cam.pos.x + Math.cos(cam.yaw) * cam.sway, cam.pos.y + cam.bob, cam.pos.z + Math.sin(cam.yaw) * cam.sway);
  camera.rotation.set(clamp(cam.pitch, -1.4, 1.4), -cam.yaw, -cam.sway * .45, 'YXZ');
  updateHands(dt);
}
let drag = null;
canvas.addEventListener('pointerdown', e => { if (!active) return; drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId }; try { canvas.setPointerCapture(e.pointerId); } catch (err) {} });
canvas.addEventListener('pointermove', e => {
  if (!drag || !active) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
  // the first few pixels decide between a click and a drag; once it is a drag, every pixel turns the head
  if (drag.moved > 6){
    if (!drag.looking){ drag.looking = true; if (o.onLook) o.onLook(); }
    if (cam.t >= 1){ cam.lookYaw += dx * LOOK_SPEED; cam.lookPitch = clamp(cam.lookPitch - dy * LOOK_SPEED, -1.3, 1.25); }
  }
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointercancel', () => { drag = null; });

// ---------- Your own hands ----------
// ### You see your own hands at the bottom of the picture, in the sleeves of the striped prison uniform. They live in a small
// ### scene of their own that is drawn over the world after a depth clear, so they never sink into a wall you stand close to.
// ### The hands are real hand models with a skeleton (room-1-escape/models, MIT licence), so every finger bends at its own
// ### joints. Until they have loaded, or if they cannot load, simple drawn hands stand in. With reduced motion they hold still.
const handScene = new THREE.Scene(), handCam = new THREE.PerspectiveCamera();
handScene.add(new THREE.HemisphereLight(0xb9c6bf, 0x1c1410, .42));
{
  const key = new THREE.DirectionalLight(0xe8ecdf, .62); key.position.set(.2, 1, -.4); handScene.add(key);
  const fill = new THREE.DirectionalLight(0xd9c7b8, .18); fill.position.set(-.3, -.4, .6); handScene.add(fill);   // light bouncing off the floor
}
const brnd = mulberry32(4471);   // the cloth's own random numbers
// ### The skin of the real hands, drawn at 0.2 mm a pixel: the warm base with faint blotches and redder patches, freckles,
// ### veins showing blue-green through the skin, the fine criss-cross lines of the skin and its pores, and some dust from
// ### the ladder. The bump map gives the lines and the pores their depth. The first two loops draw from the room's own
// ### random numbers exactly as before (so everything after them in the room keeps its look); the rest uses its own.
function skinTextures(){
  const srnd = mulberry32(2207), S = 512, LINES = [];
  for (let i = 0; i < 900; i++){ const a = (srnd() < .5 ? .7 : -.7) + (srnd() - .5) * .35, x = srnd() * S, y = srnd() * S, l = 8 + srnd() * 30; LINES.push([x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, srnd()]); }
  const PORES = []; for (let i = 0; i < 9000; i++) PORES.push([srnd() * S, srnd() * S, srnd()]);
  const wrap = (g, f) => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]){ g.save(); g.translate(dx, dy); f(); g.restore(); } };   // so the tiles meet without a seam
  const map = canvasTex(S, S, (g, w, h) => {
    g.fillStyle = '#a8765c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++){ const r = (2 + rnd() * 9) * 4; g.fillStyle = rnd() < .5 ? `rgba(176,104,84,${rnd() * .12})` : `rgba(214,170,140,${rnd() * .12})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2); g.fill(); }
    for (let i = 0; i < 1600; i++){ g.fillStyle = `rgba(90,52,40,${rnd() * .07})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }   // pores
    const blob = (x, y, r, c) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, c); gr.addColorStop(1, c.replace(/[\d.]+\)$/, '0)')); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); };
    wrap(g, () => {
      for (let i = 0; i < 26; i++) blob(srnd() * w, srnd() * h, 40 + srnd() * 90, srnd() < .5 ? 'rgba(186,96,80,.09)' : 'rgba(198,160,110,.08)');   // redder and yellower patches
      g.lineCap = 'round';
      for (let i = 0; i < 9; i++){   // veins, faint and soft
        let x = srnd() * w, y = srnd() * h, a = srnd() * Math.PI * 2;
        g.strokeStyle = 'rgba(70,92,118,.05)';
        for (const lw of [9, 5]){ g.lineWidth = lw; g.beginPath(); g.moveTo(x, y); let px = x, py = y, pa = a; for (let k = 0; k < 6; k++){ pa += (srnd() - .5) * .9; px += Math.cos(pa) * 22; py += Math.sin(pa) * 22; g.lineTo(px, py); } g.stroke(); }
      }
      for (let i = 0; i < 70; i++) blob(srnd() * w, srnd() * h, 1.5 + srnd() * 3, `rgba(120,66,44,${.2 + srnd() * .25})`);   // freckles
      for (const [x1, y1, x2, y2, v] of LINES){ g.strokeStyle = `rgba(112,66,52,${.05 + v * .06})`; g.lineWidth = 1; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
      for (let i = 0; i < 18; i++) blob(srnd() * w, srnd() * h, 14 + srnd() * 46, `rgba(84,72,60,${.08 + srnd() * .1})`);   // dust and grime from the ladder
    });
    for (const [x, y, v] of PORES){ g.fillStyle = `rgba(92,50,38,${.04 + v * .08})`; g.fillRect(x, y, 1.4, 1.4); }
  }, [3, 3]);
  const bump = canvasTex(S, S, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    wrap(g, () => { g.lineCap = 'round'; for (const [x1, y1, x2, y2, v] of LINES){ g.strokeStyle = `rgba(0,0,0,${.25 + v * .3})`; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); } });
    for (const [x, y, v] of PORES){ g.fillStyle = `rgba(0,0,0,${.2 + v * .3})`; g.fillRect(x, y, 1.6, 1.6); }
    for (let i = 0; i < 4000; i++){ g.fillStyle = srnd() < .5 ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)'; g.fillRect(srnd() * w, srnd() * h, 3, 3); }   // the soft unevenness between
  }, [3, 3]);
  bump.encoding = THREE.LinearEncoding;
  return { map, bump };
}
const SKIN = skinTextures();
// ### Gives a geometry a white colour per corner, for materials that shade their folds with vertex colours.
function plainColours(geo){ geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3)); return geo; }
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
// ### The uniform is woven of coarse linen: a CC0 scan from Poly Haven (Rough Linen) gives every thread. Its shades are laid
// ### over the painted stripes once the picture has loaded, and its normal and roughness maps give the weave its relief and
// ### its matt and shiny threads. Until then, or if the scans cannot be loaded, the painted ribs of the twill show instead.
function linenCloth(cloth, mat, strength = 1){
  const im = new Image();
  im.onload = () => {
    const c = cloth.map.image, g = c.getContext('2d');
    g.save(); g.globalCompositeOperation = 'overlay'; g.globalAlpha = .85 * strength; g.drawImage(im, 0, 0, c.width, c.height); g.restore();
    cloth.map.needsUpdate = true;
  };
  im.src = BASE + 'textures/uniform-linen-detail.jpg';
  const loader = new THREE.TextureLoader(), scan = (file, then) => loader.load(BASE + 'textures/' + file, t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANISO; then(t); mat.needsUpdate = true; }, undefined, () => {});
  mat.bumpMap = cloth.bump; mat.bumpScale = .002;
  scan('uniform-linen-normal.jpg', t => { mat.bumpMap = null; mat.normalMap = t; mat.normalScale = new THREE.Vector2(.7 * strength, .7 * strength); });
  scan('uniform-linen-rough.jpg', t => { mat.roughnessMap = t; mat.roughness = 1; });
  return mat;
}
// ### The radius of a profile [[y, r], ...] at height y (straight lines between the points).
function profileAt(pr, y){
  for (let i = 1; i < pr.length; i++) if (y <= pr[i][0]){ const [y0, r0] = pr[i - 1], [y1, r1] = pr[i]; return r0 + (r1 - r0) * (y - y0) / (y1 - y0); }
  return pr[pr.length - 1][1];
}
// ### A tube of cloth from y = 0 to y = 1 (stretched to its length later) whose radius follows the profile. Folds are
// ### pushed into it: soft lengthwise drape all along, and rings of wrinkles where the cloth bunches ([height, reach,
// ### depth] in bunch), each ring wavering round the tube so no two folds are alike. Each corner gets a colour: darker
// ### deep in a fold, where little light reaches, and browner where dirt(y, angle) says the cloth is dusty.
function clothTube(profile, bunch, seg = 24, rows = 36, dirt, seal = [1, 1]){
  const pts = []; for (let j = 0; j <= rows; j++){ const y = j / rows; pts.push(new THREE.Vector2(profileAt(profile, y), y)); }
  const geo = new THREE.LatheGeometry(pts, seg), p = geo.attributes.position, uv = geo.attributes.uv, s1 = brnd() * 6.3, s2 = brnd() * 6.3;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++){
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(x, z);
    let f = .025 * Math.sin(a * 3 + s1 + y * 2) + .012 * Math.sin(a * 7 + s2 - y * 3), fold = 0;
    for (const [c, w, amp] of bunch){
      const d = (y - c) / w;
      if (Math.abs(d) < 1) fold += amp * (1 - d * d) * Math.sin((y - c) / w * 9 + Math.sin(a * 2 + s1) * 1.8 + Math.sin(a * 5 + s2) * .6);
    }
    // where the tube meets a joint the folds die away, so its edge closes neatly round the joint
    const fade = Math.min(1, seal[0] ? y / .08 : 1, seal[1] ? (1 - y) / .08 : 1);
    f = (f + fold) * fade; fold *= fade;
    p.setX(i, x * (1 + f)); p.setZ(i, z * (1 + f));
    uv.setY(i, uv.getY(i) + f * .3 + .012 * Math.sin(a * 2 + s2 + y * 4));   // the stripes are pulled out of line by the folds
    const shade = clamp(1 + f * 3 + Math.min(0, fold) * 6, .42, 1.08), dust = dirt ? clamp(dirt(y, a + s2), 0, 1) : 0;
    col[i * 3] = shade * (1 - dust * .3); col[i * 3 + 1] = shade * (1 - dust * .36); col[i * 3 + 2] = shade * (1 - dust * .46);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  // the first and last column of the lathe are the same seam: give them the same normal so it does not show
  const n = geo.attributes.normal, cols = rows + 1;
  for (let j = 0; j < cols; j++){
    const a = j, b = seg * cols + j, v = new THREE.Vector3(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, v.x, v.y, v.z); n.setXYZ(b, v.x, v.y, v.z);
  }
  return geo;
}
const HAND_MAT = {
  skin: new THREE.MeshStandardMaterial({ color: 0xa06e55, roughness: .66 }),
  nail: new THREE.MeshStandardMaterial({ color: 0xd9b3a0, roughness: .35 }),
  // the real hands: the skin above, matt but with a soft sheen
  real: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .58, envMapIntensity: .35, skinning: true, map: SKIN.map, bumpMap: SKIN.bump, bumpScale: .00025 }),
  sleeve: (() => { const c = prisonCloth(256, 256, [1, 3.2], .25); return linenCloth(c, new THREE.MeshStandardMaterial({ color: 0xc8c8c8, side: THREE.DoubleSide, map: c.map, vertexColors: true }), .8); })()
};
// ### The cuff and the sleeve, running from the wrist (the origin) back out of the picture along +z. The sleeve is a tube
// ### of cloth with soft folds, pushed up into rings of wrinkles behind the cuff and at the elbow.
function addSleeve(arm){
  arm.add(new THREE.Mesh(plainColours(new THREE.CylinderGeometry(.038, .04, .035, 18, 1, true).rotateX(Math.PI / 2).translate(0, 0, .05)), HAND_MAT.sleeve));
  const tube = clothTube([[0, .05], [.12, .049], [.6, .045], [1, .043]], [[.12, .1, .07], [.92, .1, .05]], 22, 30, (y, a) => (1 - y / .3) * .35 * (.7 + .3 * Math.sin(a * 4 + y * 9)), [0, 1]);
  arm.add(new THREE.Mesh(tube.rotateX(Math.PI / 2).scale(1, 1, .42).translate(0, -.004, .065), HAND_MAT.sleeve));
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
    const col = mat.vertexColors ? new Float32Array(n * 3) : null;
    let o = 0;
    for (const g of parts){ pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2); if (col) col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    arm.add(new THREE.Mesh(geo, mat));
  }
}
// ### Reads a binary glTF file (.glb) with one skinned mesh, as the hand models are: the mesh, its joints and the matrices
// ### that bind the skin to them. A few lines instead of three.js's GLTFLoader, so no other library has to be loaded.
function glbParts(buf){
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('not a glb file');
  const jsonLen = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen))), bin = 20 + jsonLen + 8;
  const acc = i => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType], st = bin + (bv.byteOffset || 0) + (a.byteOffset || 0);
    return new T(buf.slice(st, st + a.count * n * T.BYTES_PER_ELEMENT));
  };
  return { json, acc };
}
function readGlb(buf){
  const { json, acc } = glbParts(buf);
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
  Promise.all(['right', 'left'].map(n => fetch(BASE + 'models/hand-' + n + '.glb').then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })))
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
  amp: 1, ampT: 1, step: 0, curl: [0, 0, 0, 0, 0], gesture: null, gestureT: 0, nextGesture: 3 + Math.random() * 6, seed: Math.random() * 100, init: false,
  to: null, toK: 0, toCurl: 0, toE: new THREE.Vector3(), drop: 0, dropK: 0 });
const HANDS = { r: Object.assign(buildHand(1), handState()), l: Object.assign(buildHand(-1), handState()), reach: 0, down: 1, show: false, grip: 0, gripK: 0, wide: 0, own: false };
loadRealHands();
// ### What the hands hold once the player sits in a vehicle: a steering wheel (rim, hub and three spokes), or the bars of the
// ### motorcycle. It belongs to the view from the seat, like the hands, and rises into the picture with them (see grip).
const WHEEL = new THREE.Group(), BARS = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: .55, metalness: .2 });
  WHEEL.add(new THREE.Mesh(new THREE.TorusGeometry(.19, .016, 10, 32), dark), new THREE.Mesh(new THREE.CylinderGeometry(.045, .05, .03, 16).rotateX(Math.PI / 2), dark));
  for (const a of [0, Math.PI, -Math.PI / 2]) WHEEL.add(new THREE.Mesh(new THREE.BoxGeometry(.19, .026, .012).translate(.095, 0, 0).rotateZ(a), dark));
  WHEEL.rotation.x = -.42;
  BARS.add(new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, .74, 10).rotateZ(Math.PI / 2), dark));
  for (const sd of [-1, 1]) BARS.add(new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, .13, 10).rotateZ(Math.PI / 2).translate(sd * .3, 0, 0), dark));
  WHEEL.visible = BARS.visible = false;
  handScene.add(WHEEL, BARS);
}
// ### Where each hand is (x, y, z from the eye) and how it is turned (pitch, yaw, roll). At rest the arms hang relaxed:
// ### the hands low at the edge of the picture, thumbs up and palms turned towards each other, the forearms rising from
// ### below. To use something the right hand turns palm down and reaches forward into the middle of the picture.
const HAND_REST = { r: [.2, -.215, -.37, -.06, .1, -.9], l: [-.2, -.221, -.38, -.06, -.08, .92] };
const HAND_REACH = [.12, -.165, -.5, .3, .35, -.35];
// a hand sent to something (handTo): turned palm up with the fingers forward, so they hook under a handle and pull it; the
// fingertips are TO_FINGERS from the wrist, and the arm comes from the shoulder (TO_SHOULDER, from the eye)
const HAND_TO = { r: [0, 0, 0, .25, .35, -2.45], l: [0, 0, 0, .1, -.6, 1.6] };
const TO_FINGERS = new THREE.Vector3(0, -.024, -.088), TO_EULER = new THREE.Euler(), TO_AT = new THREE.Vector3(), TO_SHOULDER = new THREE.Vector3();
// both hands on a steering wheel in front of the chest, palms down and closed round the rim; wide: on the bars of a motorcycle
const HAND_WHEEL = { r: [.17, -.2, -.43, .34, .22, -.5], l: [-.17, -.2, -.43, .34, -.22, .5] }, WHEEL_WIDE = .1;
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
// ### The right hand reaches out when you use something.
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
  const show = HANDS.show;
  HANDS.down += ((show ? 0 : 1) - HANDS.down) * (1 - Math.exp(-dt * 5));
  const still = REDUCED ? 0 : 1, t = clock;
  HANDS.reach = Math.max(0, HANDS.reach - dt / .55);
  HANDS.gripK += (HANDS.grip - HANDS.gripK) * (1 - Math.exp(-dt * 7));
  const held = HANDS.wide ? BARS : WHEEL;
  WHEEL.visible = BARS.visible = false; held.visible = HANDS.gripK > .02 && HANDS.down < .98 && !HANDS.own;
  camera.updateMatrixWorld();
  held.position.set(0, -.2 - (1 - HANDS.gripK) * .3 - HANDS.down * .35, HANDS.wide ? -.41 : -.45);
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
    // at the wheel: both hands go to the rim and stay there
    if (HANDS.gripK > .001){
      const Wp = HAND_WHEEL[key], gk = HANDS.gripK;
      tp[0] = lerp(tp[0], Wp[0] + side * HANDS.wide * WHEEL_WIDE, gk); tp[1] = lerp(tp[1], Wp[1], gk); tp[2] = lerp(tp[2], Wp[2], gk);
      for (let i = 0; i < 3; i++) tr[i] = lerp(tr[i], Wp[3 + i], gk);
    }
    // a hand that is not needed sinks out of the picture (dropHand)
    h.dropK += (h.drop - h.dropK) * (1 - Math.exp(-dt * 5)); tp[1] -= h.dropK * .3; tp[2] += h.dropK * .08;
    // a hand sent to a point in the world (handTo): the fingers reach it from below and follow it as it moves; the arm only
    // stretches so far from the shoulder
    h.toK += ((h.to ? 1 : 0) - h.toK) * (1 - Math.exp(-dt * 6));
    if (h.toK > .001){
      if (h.to) camera.worldToLocal(h.toE.copy(h.to));
      const E = h.toE, R = HAND_TO[key], k = h.toK, f = TO_FINGERS.clone().applyEuler(TO_EULER.set(R[3], R[4], R[5], 'YXZ'));
      const at = TO_AT.set(E.x - f.x, E.y - f.y, E.z - f.z), sh = TO_SHOULDER.set(side * .2, -.25, .05), d = at.distanceTo(sh);
      if (d > .72) at.sub(sh).multiplyScalar(.72 / d).add(sh);
      tp[0] = lerp(tp[0], at.x, k); tp[1] = lerp(tp[1], at.y, k); tp[2] = lerp(tp[2], at.z, k);
      for (let i = 0; i < 3; i++) tr[i] = lerp(tr[i], R[3 + i], k);
    }
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
      const target = lerp(lerp((CURL_REST[f] - swing * .12 + wobble(sd + 10 + f, t * 1.1) * .07 * still + gc[f]) * (1 - out * .8), f < 4 ? .9 : .55, HANDS.gripK), h.toCurl * (f < 4 ? 1 : .6), h.toK);
      h.curl[f] += (target - h.curl[f]) * (1 - Math.exp(-dt * (g ? 10 : 6)));
    }
    poseFingers(h, side, spread);
  }
}
// ### Bends every finger joint of a real hand by its curl (index to little finger, then the thumb) and spreads them.
function poseFingers(h, side, spread){
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  h.fingers.forEach((bones, f) => bones.forEach((j, n) => {
    const c = h.curl[f] * [1, 1.25, .8][n], s = n ? 0 : side * (f - 1.5) * (.05 + spread * .5);
    j.o.quaternion.copy(j.rest).multiply(q.setFromEuler(e.set(-c, s, 0)));
  }));
  h.thumb.forEach((j, n) => { const c = h.curl[4] * [.5, 1, .9][n]; j.o.quaternion.copy(j.rest).multiply(q.setFromEuler(e.set(-c, n ? 0 : -side * c * .4, 0))); });
}
// ### Draws the hands over the world with the same lens as the eye, after clearing the depth so nothing hides them.
function drawHands(environment){
  if (!HANDS.r.arm.visible) return;
  handScene.environment = environment || null;
  handCam.fov = camera.fov; handCam.aspect = camera.aspect; handCam.near = .02; handCam.far = 10; handCam.updateProjectionMatrix();
  const auto = renderer.autoClear;
  renderer.autoClear = false; renderer.clearDepth();
  renderer.render(handScene, handCam); renderer.autoClear = auto;
}

// ---------- Footsteps ----------
// ### Room 2 plays no sound files (all of its sound is made in the browser), so the recorded steps of the escape room are not
// ### used here. Each footfall is the short, dull thud that stands in for them there while they load, and the bare concrete
// ### answers with the same echo: a reverb made from noise that dies away in about 0.8 s and stays bright, after a few early
// ### reflections off the walls.
const STEP_VOL = { echo: .38 };
let ac = null, master = null, noiseBuf = null, stepBus = null;
// ### Sets the footsteps up the first time there is sound: their own bus, the echo, and the recordings.
function initSteps(){
  const snd = o.sound && o.sound();
  if (!snd || ac) return;
  ac = snd.ctx; master = snd.out;
  noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  stepBus = ac.createGain(); stepBus.connect(master);
  const echo = ac.createConvolver(), echoGain = ac.createGain(); echo.buffer = washroomEcho(); echoGain.gain.value = STEP_VOL.echo;
  stepBus.connect(echo); echo.connect(echoGain); echoGain.connect(master);
}
// ### One footfall where you stand, on the concrete floor; a slow step is softer than a brisk one.
function step(speed){
  initSteps();
  if (!ac || (o.muted && o.muted())) return;
  const brisk = .55 + .45 * Math.min(1, speed / WALK_SPEED);
  noise(.09, .06 * brisk * 1.6, 'lowpass', 240 + Math.random() * 60);
}
// ### The washroom's echo for the footsteps: stereo noise that dies away 60 dB in 0.8 s and only slowly gets darker,
// ### after early reflections off the concrete and tiles (7 to 31 ms).
function washroomEcho(){
  const len = Math.floor(ac.sampleRate * 1.1), buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++){
    const d = buf.getChannelData(c); let lp = 0;
    for (let i = 0; i < len; i++){
      const t = i / ac.sampleRate, k = .08 + .5 * Math.min(1, t / .8);   // the tail slowly loses its highs
      lp += (1 - k) * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.exp(-6.9 * t / .8) * Math.min(1, t / .012);
    }
    for (const [ms, a] of [[7, .5], [11, .35], [17, .3], [23, .22], [31, .18]]) d[Math.floor((ms + c * 1.5) / 1000 * ac.sampleRate)] += a * (c ? -1 : 1);
  }
  return buf;
}
// ### Plays one short burst of filtered noise.
function noise(dur, vol, type, freq, delay){
  if (!ac) return;
  const t = ac.currentTime + (delay || 0), s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf; f.type = type || 'lowpass'; f.frequency.value = freq || 800;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(stepBus); s.start(t, Math.random()); s.stop(t + dur + .02);
}

// ### Shows or hides the body: while it is off, dragging does not turn the head and the hands sink out of the picture.
function setActive(on){ active = !!on; HANDS.show = active; if (!active){ drag = null; HANDS.down = 1; HANDS.r.arm.visible = HANDS.l.arm.visible = false; } else initSteps(); }
// ### hold moves the hands alone, for when the caller moves the camera itself (getting into a vehicle); grip puts both hands
// ### on a steering wheel (k = 1; wide: on the bars of a motorcycle) or lets go again (k = 0).
function hold(dt){ clock += dt; cam.vel.set(0, 0, 0); updateHands(dt); }
// own: the vehicle has its own wheel in the picture, so none is drawn with the hands. handTo sends one hand ('r' or 'l') to a
// point in the world (a door handle) and closes its fingers by curl, or back to where it was (p = null).
function grip(k, wide, own){ HANDS.grip = REDUCED ? 0 : k; HANDS.wide = wide ? 1 : 0; HANDS.own = !!own; if (!k && !active) HANDS.gripK = 0; }
function handTo(key, p, curl){ const h = HANDS[key]; h.to = p && !REDUCED ? p : null; if (p) h.toCurl = curl || 0; }
// dropHand lets one hand sink out of the picture while the other works (on = true), or brings it back
function dropHand(key, on){ HANDS[key].drop = on ? 1 : 0; }
return { cam, EYE, BODY, WALK_SPEED, place, goTo, update, hold, grip, handTo, dropHand, drawHands, reach: reachHand, setActive, gliding: () => cam.t < 1, hands: HANDS, lowerHands: () => { HANDS.show = false; } };
}
return { create };
})();

// ---------- The garage ----------
// ### A run in Lisbon begins under the city, in the lock-up garage at the end of the tunnel from Cell Block D. The three getaway
// ### vehicles stand in their bays. The player is on foot, with the same body as in the escape room (walker.js): walks among the
// ### vehicles with the arrow keys or W A S D, looks round by dragging, and sees their own hands in the striped sleeves. The
// ### vehicle they walk up to (or tap on the card, which walks them there) is the chosen one. "Get in" walks to its driver's
// ### door, the hand opens it, they get in and take the wheel. Then they drive up the ramp. At the top a roller door rolls up
// ### and the vehicle drives straight out onto the street in the Baixa (no cut: see garageSwap), where the map of the
// ### evidence opens and the run begins. No clock runs down here and no police come.
// ### The sizes, the floor, the walls and the order of the vehicles are rules in Core (GARAGE, garageFloor, garageWalls, ...).
// ### The garage lies 30 m under the city, so the moon does not reach it: down here the light comes from the strip lights under
// ### the ceiling (garageLight: a soft light from straight above, white and even, so the vehicles stand in their own shadows),
// ### the concrete glows a little, and the two showroom lights follow the vehicle.
// ### The door of the tunnel in the garage, in room 1's measures (its TUN and TDOOR): the doorway w x h, the plank leaf, the
// ### tunnel's half width r, the height at which its vault springs, and how much of its length is built behind the wall. A
// ### run begins back metres inside the tunnel, behind the shut door: it swings open (to open radians, over opens seconds, as
// ### it did in room 1; here it comes to rest flat along the stone side of the doorway, its hinges hinge metres inside it)
// ### and you walk out through it to the start in the garage in walk seconds.
const TUNNEL_DOOR = Object.freeze({ w: 0.84, h: 1.76, leafH: 1.73, r: 0.65, spring: 1.5, len: 8, open: 1.55, hinge: 0.06, opens: 1.5, back: 2.3, walk: 2.8 });
const GAR = { group: new THREE.Group(), top: new THREE.Group(), colliders: Core.garageWalls(), slots: {}, end: Core.GARAGE.z1 + Core.GARAGE.ramp + Core.GARAGE.top, walk: 3, kerb: 0.6, sill: 0, clear: 3, shutter: null };
(function buildGarage(){
  const G = Core.GARAGE, Y = G.y, end = G.z1 + G.ramp + G.top, grp = GAR.group, rnd = mulberry32(4471);
  const tex = (w, h, draw, rx, ry) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = ANISO;
    if (rx){ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); }
    return t;
  };
  // ### Concrete: a flat grey with fine specks and the joints between the slabs. Only the floor gets a few small, faint stains
  // ### (stains): on the walls and the ceiling, stretched over a whole wall, they looked like dark blotches.
  const concrete = (base, joints, stains) => (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++){ const d = rnd() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${d},${d},${d},${(rnd() * 0.06).toFixed(3)})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }
    for (let i = 0; i < (stains || 0); i++){ const x = 30 + rnd() * (w - 60), y = 30 + rnd() * (h - 60), r = 8 + rnd() * 18, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(0,0,0,.09)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    if (joints){ g.strokeStyle = 'rgba(0,0,0,.32)'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2); }
  };
  // ### Texture coordinates from the position, so a texture keeps its size in metres on every face (tile metres a tile)
  // ### instead of being stretched over a whole wall. With h, a wall's texture runs from y0 at the bottom to y0 + h at the top
  // ### once, so the painted band sits at the foot of every wall.
  const worldUV = (geo, tile, y0, h) => {
    const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv;
    for (let i = 0; i < P.count; i++){
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), ax = Math.abs(N.getX(i)), ay = Math.abs(N.getY(i)), az = Math.abs(N.getZ(i));
      if (ay >= ax && ay >= az) U.setXY(i, x / tile, z / tile);
      else U.setXY(i, (ax > az ? z : x) / tile, h ? (y - y0) / h : y / tile);
    }
    U.needsUpdate = true; return geo;
  };
  const mat = (map, rough, glow, env) => { const m = new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: 0, emissive: C(glow), emissiveMap: map }); m.userData.env = env || 0.25; return m; };
  const floorMat = mat(tex(256, 256, concrete('#63666a', true, 4), 9, 9), 0.5, 0x262626, 0.6);
  // ### The floor of the ramp: darker, rougher concrete than the hall, with fine anti-slip grooves across it, the two worn dark
  // ### tracks the tyres have polished into it, black rubber where cars have braked, and a few oil drips. One tile spans the full
  // ### width of the ramp, so the tracks lie where the wheels run; along it, a tile is about 4 m.
  const rampTex = (g, w, h) => {
    concrete('#53565a', false)(g, w, h);
    for (let y = 0; y < h; y += 8){ g.fillStyle = 'rgba(0,0,0,.13)'; g.fillRect(0, y, w, 1.6); g.fillStyle = 'rgba(255,255,255,.03)'; g.fillRect(0, y + 1.6, w, 1); }
    for (const cx of [0.4, 0.6]){
      const x = cx * w, gr = g.createLinearGradient(x - 22, 0, x + 22, 0);
      gr.addColorStop(0, 'rgba(8,8,10,0)'); gr.addColorStop(0.5, 'rgba(8,8,10,.34)'); gr.addColorStop(1, 'rgba(8,8,10,0)');
      g.fillStyle = gr; g.fillRect(x - 22, 0, 44, h);
      for (let i = 0; i < 6; i++){ g.fillStyle = `rgba(0,0,0,${(0.12 + rnd() * 0.18).toFixed(2)})`; g.fillRect(x - 6 + rnd() * 6, rnd() * h, 4 + rnd() * 4, 20 + rnd() * 50); }
    }
    for (let i = 0; i < 5; i++){ const x = w * (0.42 + rnd() * 0.16), y = rnd() * h, r = 5 + rnd() * 12, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(10,8,6,.5)'); gr.addColorStop(1, 'rgba(10,8,6,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  };
  const rampMat = mat(tex(256, 256, rampTex, 1, 8), 0.86, 0x1c1c1e, 0.35);
  const topMat = mat(tex(256, 256, rampTex, 1, 4), 0.86, 0x1c1c1e, 0.35);
  // ### The walls: fair-faced concrete in panels with their tie holes, painted blue up to about 1.3 m with a white line over it.
  // ### One tile is 4 m wide and as high as the hall (worldUV).
  const wallMat = mat(tex(256, 256, (g, w, h) => {
    concrete('#a9abac', false)(g, w, h);
    g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(0, 0, 1.5, h * 0.72); g.fillRect(w / 2, 0, 1.2, h * 0.72); g.fillRect(0, h * 0.36, w, 1.2);
    g.fillStyle = 'rgba(0,0,0,.28)'; for (const x of [0.25, 0.75]) for (const y of [0.16, 0.52]){ g.beginPath(); g.arc(x * w, y * h, 2.2, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#2a587a'; g.fillRect(0, h * 0.75, w, h * 0.25); g.fillStyle = '#e9e9e2'; g.fillRect(0, h * 0.73, w, h * 0.025);
  }, 1, 1), 0.85, 0x3c3c3c);
  const plainMat = mat(tex(256, 256, concrete('#9a9c9e', false), 1, 1), 0.9, 0x343434);
  const roofMat = mat(tex(256, 256, concrete('#76787a', true), 7, 6), 0.9, 0x2e2e2e);
  const paint = hex => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.7, emissive: C(hex).multiplyScalar(0.3) });
  // yellow and black stripes, on the pillars and the kerbs of the ramp
  const hazard = new THREE.MeshStandardMaterial({ map: tex(64, 64, (g, w, h) => { g.fillStyle = '#e8b21c'; g.fillRect(0, 0, w, h); g.fillStyle = '#15161a'; for (let i = -64; i < 128; i += 32){ g.beginPath(); g.moveTo(i, h); g.lineTo(i + 16, h); g.lineTo(i + 16 + h, 0); g.lineTo(i + h, 0); g.fill(); } }), roughness: 0.7, emissive: C(0x3a3020) });
  const add = (geo, m, cast) => { const o = new THREE.Mesh(geo, m); o.receiveShadow = true; o.castShadow = !!cast; grp.add(o); return o; };
  const box = (x0, x1, y0, y1, z0, z1) => boxG(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

  // the hall: floor, ceiling and the walls (the same boxes the vehicle collides with), the opening to the ramp with its lintel
  add(box(-G.x, G.x, Y - 0.4, Y, G.z0, G.z1), floorMat);
  add(box(-G.x - 1, G.x + 1, Y + G.h, Y + G.h + 0.4, G.z0 - 1, G.z1 + 1), roofMat);
  const W = GAR.colliders, hall = W.slice(0, 5), sides = W.slice(5, 7), head = G.z1 + G.ramp;
  // (the wall beside the ramp, hall[3], is built in three pieces round the doorway of the tunnel, TUNNEL_DOOR)
  const TD = TUNNEL_DOOR, tdx = G.entry, tdw = TD.w / 2;
  add(mergeGeos([...hall.filter((c, i) => i !== 3).map(c => worldUV(box(c.x0, c.x1, Y, Y + G.h, c.z0, c.z1), 4, Y, G.h)),
    worldUV(box(hall[3].x0, tdx - tdw, Y, Y + G.h, G.z1, G.z1 + 1), 4, Y, G.h), worldUV(box(tdx + tdw, hall[3].x1, Y, Y + G.h, G.z1, G.z1 + 1), 4, Y, G.h),
    worldUV(box(tdx - tdw, tdx + tdw, Y + TD.h, Y + G.h, G.z1, G.z1 + 1), 4, Y, G.h)]), wallMat);
  add(worldUV(box(-G.door, G.door, Y + G.tunnel, Y + G.h, G.z1, G.z1 + 1), 3), plainMat);
  // the sides of the ramp are drawn from 1 m in: the first metre is the end of the hall wall, and two faces in the same place
  // would flicker against each other
  add(mergeGeos(sides.map(c => worldUV(box(c.x0, c.x1, Y, Y + G.rise + G.tunnel + 0.4, c.z0 + 1, head), 3))), plainMat);
  // the ramp with its ceiling
  const a = Math.atan2(G.rise, G.ramp), len = Math.hypot(G.ramp, G.rise), slab = up => {
    const g = new THREE.BoxGeometry(G.door * 2, 0.4, len + 0.4); g.translate(0, up, 0); g.rotateX(-a); g.translate(0, Y + G.rise / 2, G.z1 + G.ramp / 2); return g;
  };
  add(slab(-0.2), rampMat);
  add(slab(G.tunnel * Math.cos(a) + 0.2), roofMat);
  // ### On the ramp: a kerb along each wall with yellow and black paint, a yellow line inside it, and fluorescent tubes down the
  // ### middle of the ceiling, each with its pool of light on the floor. onRamp puts a piece made flat (x across, up from the
  // ### floor, d metres along the slope from its foot) onto the slope.
  const onRamp = (geo, x, up, d) => geo.translate(x, up, d - len / 2).rotateX(-a).translate(0, Y + G.rise / 2, G.z1 + G.ramp / 2);
  add(mergeGeos([-1, 1].map(sd => onRamp(new THREE.BoxGeometry(0.32, 0.16, len), sd * (G.door - 0.16), 0.08, len / 2))), hazard);
  add(mergeGeos([-1, 1].map(sd => onRamp(new THREE.BoxGeometry(0.13, 0.02, len - 0.6), sd * (G.door - 0.62), 0.011, len / 2))), paint(0xe8b21c));
  // the blue band and the white line of the hall walls go on up the ramp
  // (from where the hall wall ends, 1 m up the ramp, so they do not stick out round its corner)
  add(mergeGeos([-1, 1].map(sd => onRamp(new THREE.BoxGeometry(0.02, 1.2, len - 0.8), sd * (G.door - 0.01), 0.76, (len + 1.2) / 2))), paint(0x2a587a));
  add(mergeGeos([-1, 1].map(sd => onRamp(new THREE.BoxGeometry(0.025, 0.13, len - 0.8), sd * (G.door - 0.012), 1.42, (len + 1.2) / 2))), paint(0xe9e9e2));
  const rampTubes = [], rampPools = [];
  for (let d = 3; d < len - 1; d += 6){
    rampTubes.push(onRamp(new THREE.BoxGeometry(0.16, 0.07, 1.8), 0, G.tunnel * Math.cos(a) - 0.06, d), onRamp(new THREE.BoxGeometry(0.3, 0.05, 1.9), 0, G.tunnel * Math.cos(a) - 0.02, d));
    rampPools.push(onRamp(new THREE.PlaneGeometry(G.door * 2 - 0.8, 6.4).rotateX(-Math.PI / 2), 0, 0.025, d));
  }
  // pillars with a yellow and black band at bumper height
  add(mergeGeos(G.pillars.map(([x, z]) => worldUV(box(x - G.pillar, x + G.pillar, Y, Y + G.h, z - G.pillar, z + G.pillar), 2))), plainMat, true);
  add(mergeGeos(G.pillars.map(([x, z]) => box(x - G.pillar - 0.03, x + G.pillar + 0.03, Y + 0.15, Y + 1.25, z - G.pillar - 0.03, z + G.pillar + 0.03))), hazard);
  // paint on the floor: the lines of the three bays, and two arrows to the ramp
  const WIDE = { car: [3.6, 7.2], bike: [2.4, 4.4], truck: [4.6, 9.4] }, lines = [];
  for (const k of G.order){
    const [x, z, h] = G.bays[k], [wd, ln] = WIDE[k];
    for (const sd of [-1, 1]) lines.push(new THREE.BoxGeometry(0.14, 0.02, ln).rotateY(h).translate(x + Math.cos(h) * wd / 2 * sd, Y + 0.011, z - Math.sin(h) * wd / 2 * sd));
    const slot = new THREE.Group(); slot.position.set(x, Y, z); slot.rotation.y = h; grp.add(slot); GAR.slots[k] = slot;
  }
  add(mergeGeos(lines), paint(0xe6e6de));
  const arrow = new THREE.Shape(); [[-0.28, -1.5], [0.28, -1.5], [0.28, 0.3], [0.85, 0.3], [0, 1.6], [-0.85, 0.3], [-0.28, 0.3]].forEach(([x, y], i) => i ? arrow.lineTo(x, y) : arrow.moveTo(x, y));
  add(mergeGeos([1, 8].map(z => new THREE.ShapeGeometry(arrow).rotateX(-Math.PI / 2).rotateY(Math.PI).translate(0, Y + 0.012, z))), paint(0xe8b21c));
  // strip lights under the ceiling, each with its pool of light on the floor; amber lamps along the ramp
  // ### The strip lights: twin tubes in a grey metal fitting hung a little under the ceiling, in three rows from the back wall to
  // ### the ramp, each with its pool of light on the floor.
  const tubes = [], pools = [], amber = [], fittings = [];
  for (const x of [-11, 0, 11]) for (const z of [-12.5, -6, 0.5, 7]){
    fittings.push(boxG(0.36, 0.09, 2.9, x, Y + G.h - 0.16, z), boxG(0.03, 0.12, 0.03, x, Y + G.h - 0.06, z - 1.2), boxG(0.03, 0.12, 0.03, x, Y + G.h - 0.06, z + 1.2));
    for (const sd of [-1, 1]) tubes.push(boxG(0.07, 0.07, 2.7, x + sd * 0.08, Y + G.h - 0.24, z));
    pools.push(new THREE.PlaneGeometry(9, 11).rotateX(-Math.PI / 2).translate(x, Y + 0.02, z));
  }
  add(mergeGeos(fittings), new THREE.MeshStandardMaterial({ color: 0x9a9fa6, roughness: 0.45, metalness: 0.6, emissive: C(0x1c1e22) }));
  for (let z = G.z1 + 4; z < head; z += 7) for (const sd of [-1, 1]){
    amber.push(boxG(0.08, 0.12, 0.34, sd * (G.door - 0.05), Core.garageFloor(0, z) + 2.4, z));
    const gl = glowSprite(C(0xffb866), 0.8, 0.45); gl.position.set(sd * (G.door - 0.14), Core.garageFloor(0, z) + 2.4, z); grp.add(gl);
  }
  grp.add(new THREE.Mesh(mergeGeos(tubes.concat(rampTubes)), new THREE.MeshBasicMaterial({ color: 0xf1f6ff })));
  const rampPool = new THREE.Mesh(mergeGeos(rampPools), new THREE.MeshBasicMaterial({ map: glowTexture, color: 0xb4c2de, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
  rampPool.renderOrder = 2; grp.add(rampPool);
  grp.add(new THREE.Mesh(mergeGeos(amber), new THREE.MeshBasicMaterial({ color: 0xffc27a })));
  const pool = new THREE.Mesh(mergeGeos(pools), new THREE.MeshBasicMaterial({ map: glowTexture, color: 0xc4cedf, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
  pool.renderOrder = 2; grp.add(pool);
  // the exit sign over the ramp ("Saída" is Portuguese for exit) and pipes under the ceiling
  const sign = tex(512, 64, (g, w, h) => { g.fillStyle = '#0d7a44'; g.fillRect(0, 0, w, h); g.fillStyle = '#f4fff8'; g.font = '800 44px "Segoe UI", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SAÍDA  ↑  EXIT', w / 2, h / 2 + 2); });
  grp.add(new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.45).rotateY(Math.PI).translate(0, Y + (G.tunnel + G.h) / 2, G.z1 - 0.02), new THREE.MeshBasicMaterial({ map: sign })));
  add(mergeGeos([-14.6, -14.1].map(z => new THREE.CylinderGeometry(0.09, 0.09, G.x * 2, 10).rotateZ(Math.PI / 2).translate(0, Y + G.h - 0.4, z))), new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.5, metalness: 0.6, emissive: C(0x1a1410) }));
  // ### The way in: the end of the tunnel from Cell Block D, built as in room 1 (room-1-escape/js/room.js, "TUN" and "TDOOR")
  // ### and from the same scanned surfaces, read from room 1's folder: the doorway runs through the thick wall beside the ramp,
  // ### opposite the three bays, with stone sides, a brick lintel and old pavers, framed in old timber; behind it the tunnel
  // ### runs back under its brick barrel vault between stone walls, lit by two old bulbs, to the wooden ladder at its far end.
  // ### The plank door (rough planks on two iron straps, a ring to pull it by) hangs on the tunnel side of the wall and opens
  // ### towards the garage; a run begins behind it, and it swings open as you walk out (garageTunnelDoor).
  {
    const ex = tdx, zw = G.z1, zT = zw + 1, L = TD.len, r = TD.r, sp = Y + TD.spring, dh = TD.h, dw = tdw, base = '../room-1-escape/textures/';
    const loader = new THREE.TextureLoader(), aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const scan = (file, srgb) => { const t = loader.load(base + file, undefined, undefined, () => {}); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; if (srgb) t.encoding = THREE.sRGBEncoding; return t; };
    const tmat = (color, normal, tint, o) => { const m = new THREE.MeshStandardMaterial(Object.assign({ map: scan(color, true), normalMap: scan(normal), roughness: 0.95, side: THREE.DoubleSide }, o)); m.color.setRGB(tint[0], tint[1], tint[2]); return m; };
    const TM = {
      brick: tmat('tunnel-brick-color.jpg', 'tunnel-brick-normal.jpg', [0.5, 0.45, 0.44], { roughnessMap: scan('tunnel-brick-rough.jpg'), roughness: 1 }),
      stone: tmat('tunnel-stone-color.jpg', 'tunnel-stone-normal.jpg', [0.68, 0.64, 0.6]),
      floor: tmat('tunnel-floor-color.jpg', 'tunnel-floor-normal.jpg', [0.6, 0.57, 0.54]),
      wood: tmat('ladder-wood-color.jpg', 'ladder-wood-normal.jpg', [0.86, 0.78, 0.68]),
      iron: new THREE.MeshStandardMaterial({ color: 0x3b2c22, roughness: 0.75, metalness: 0.55 })
    };
    // one picture of a scan covers the same number of metres on every surface
    const uvM = (geo, su, sv) => { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return geo; };
    const tplane = (w, h, m, tile, x, y, z, rx, ry) => { const o = new THREE.Mesh(uvM(new THREE.PlaneGeometry(w, h), w / tile, h / tile), m); o.position.set(x, y, z); o.rotation.set(rx || 0, ry || 0, 0); grp.add(o); return o; };
    const tbox = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); grp.add(o); return o; };
    // the doorway through the wall, 1 m deep: stone sides, a brick lintel, pavers; and its timber frame on the garage side
    // (a finger's width inside the faces of the concrete wall they cover)
    for (const s of [-1, 1]) tplane(1.02, dh, TM.stone, 2.5, ex + s * (dw - 0.012), Y + dh / 2, zw + 0.5, 0, -s * Math.PI / 2);
    tplane(TD.w, 1.02, TM.brick, 2.5, ex, Y + dh - 0.012, zw + 0.5, Math.PI / 2);
    tplane(TD.w, 1, TM.floor, 2, ex, Y + 0.004, zw + 0.5, -Math.PI / 2);
    // (the timber reaches a little into the opening, over the edge of the concrete wall behind it. The posts end under the
    // head beam, which lies across them and stands a little proud: no two faces of the frame share a place)
    for (const s of [-1, 1]) tbox(0.1, dh - 0.03, 0.07, TM.wood, ex + s * (dw + 0.02), Y + (dh - 0.03) / 2, zw - 0.03);
    tbox(TD.w + 0.24, 0.11, 0.09, TM.wood, ex, Y + dh + 0.025, zw - 0.04);
    // the tunnel behind it: the wall the doorway is in (stone, under a brick half-moon), stone walls up to the spring of the
    // vault, the brick barrel vault, the pavers, and the stone wall at the far end
    // (they stand a finger's width in front of the back of the concrete wall, and reach as far over its edges round the doorway)
    const zF = zT + 0.012, di = dw - 0.012;
    for (const s of [-1, 1]) tplane(r - di, TD.spring, TM.stone, 2.5, ex + s * (r + di) / 2, Y + TD.spring / 2, zF);
    const arch = new THREE.Shape(); arch.moveTo(-r, 0); arch.lineTo(-di, 0); arch.lineTo(-di, dh - 0.012 - TD.spring); arch.lineTo(di, dh - 0.012 - TD.spring); arch.lineTo(di, 0); arch.lineTo(r, 0); arch.absarc(0, 0, r, 0, Math.PI, false);
    const moon = new THREE.Mesh(uvM(new THREE.ShapeGeometry(arch, 18), 1 / 2.5, 1 / 2.5), TM.brick); moon.position.set(ex, sp, zF); grp.add(moon);
    for (const s of [-1, 1]) tplane(L, TD.spring, TM.stone, 2.5, ex + s * r, Y + TD.spring / 2, zT + L / 2, 0, Math.PI / 2);
    tplane(r * 2, L, TM.floor, 2, ex, Y + 0.002, zT + L / 2, -Math.PI / 2);
    const vault = new THREE.Mesh(uvM(new THREE.CylinderGeometry(r, r, L, 20, 1, true, Math.PI / 2, Math.PI), Math.PI * r / 2.5, L / 2.5).rotateX(Math.PI / 2), TM.brick);
    vault.position.set(ex, sp, zT + L / 2); grp.add(vault);
    tplane(r * 2, TD.spring + r, TM.stone, 2.5, ex, Y + (TD.spring + r) / 2, zT + L, 0, Math.PI);
    // the wooden ladder at the far end, where you came down from the washroom, and rubble along the walls
    for (const s of [-1, 1]) tbox(0.05, TD.spring + r, 0.04, TM.wood, ex + s * 0.2, Y + (TD.spring + r) / 2, zT + L - 0.1);
    for (let y = 0.3; y < TD.spring + r - 0.1; y += 0.3) tbox(0.4, 0.035, 0.035, TM.wood, ex, Y + y, zT + L - 0.1);
    const rnd = Core.mulberry32(1912);
    for (let i = 0; i < 16; i++){
      const s = 0.04 + rnd() * 0.08, side = rnd() < 0.5 ? -1 : 1, st = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rnd() < 0.5 ? TM.stone : TM.brick);
      st.position.set(ex + side * (r - 0.08 - rnd() * 0.12), Y + s * 0.6, zT + 0.4 + rnd() * (L - 0.8)); st.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); grp.add(st);
    }
    // two old bulbs on their flex under the crown: the glass, and the warm light they throw on the vault
    const bulbs = [], halos = [];
    for (const k of [0.28, 0.72]){
      const bz = zT + L * k;
      bulbs.push(new THREE.SphereGeometry(0.045, 10, 8).translate(ex, sp + r - 0.2, bz), boxG(0.008, 0.16, 0.008, ex, sp + r - 0.08, bz));
      halos.push(new THREE.PlaneGeometry(1.5, 1.5).rotateY(Math.PI).translate(ex, sp + r - 0.25, bz));
    }
    grp.add(new THREE.Mesh(mergeGeos(bulbs), new THREE.MeshBasicMaterial({ color: 0xffd9a0 })));
    const halo = new THREE.Mesh(mergeGeos(halos), new THREE.MeshBasicMaterial({ map: glowTexture, color: 0xffb060, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.renderOrder = 2; grp.add(halo);
    // the door: hinged on the tunnel side of the wall, it swings out into the doorway, towards the garage
    // (its hinges are TD.hinge inside the stone side of the doorway, so the open leaf lies flat along the stone, clear of it)
    const hx = dw - TD.hinge;
    const pivot = new THREE.Group(); pivot.position.set(ex + hx, Y + 0.012 + TD.leafH / 2, zT - 0.04); grp.add(pivot); GAR.tunnelDoor = pivot;
    const leaf = new THREE.Mesh(uvM(new THREE.BoxGeometry(TD.w - 0.04, TD.leafH, 0.05), 1.6, 3.4), TM.wood); leaf.position.x = -hx; pivot.add(leaf);
    for (const y of [-0.52, 0.58]){
      const strap = new THREE.Mesh(new THREE.BoxGeometry(TD.w - 0.06, 0.055, 0.012), TM.iron); strap.position.set(-hx, y, 0.031); pivot.add(strap);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 8), TM.iron); pin.position.set(0.004, y, 0.02); pivot.add(pin);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.007, 6, 18), TM.iron); ring.position.set(-hx - TD.w / 2 + 0.13, 0.02, 0.04); pivot.add(ring);
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.02, 10).rotateX(Math.PI / 2), TM.iron); boss.position.set(-hx - TD.w / 2 + 0.13, 0.065, 0.035); pivot.add(boss);
  }
  // ### A few things every car park has: a galvanised air duct under the ceiling between the rows of lights, with its hangers;
  // ### the numbers of the three bays painted on the back wall; a fire extinguisher in its red box and a grey fuse box by the
  // ### steel door; and the level, "-2", on each pillar.
  const steel = new THREE.MeshStandardMaterial({ color: 0xb4b8be, roughness: 0.5, metalness: 0.25, emissive: C(0x2a2c30) });
  add(mergeGeos([boxG(0.9, 0.55, G.z1 - G.z0 - 0.4, -5.5, Y + G.h - 0.5, (G.z0 + G.z1) / 2),
    ...[-12, -5, 2, 9].map(z => boxG(0.04, 0.24, 0.04, -5.5, Y + G.h - 0.12, z))]), steel);
  const label = (text, w, h, fg, bg, font) => tex(w, h, (g, cw, ch) => { if (bg){ g.fillStyle = bg; g.fillRect(0, 0, cw, ch); } g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, cw / 2, ch / 2 + 4); });
  G.order.forEach((k, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshStandardMaterial({ map: label('0' + (i + 1), 128, 128, '#f2f2ea', null, '800 92px "Segoe UI", Arial, sans-serif'), transparent: true, roughness: 0.8, emissive: C(0x404040) }));
    m.position.set(G.bays[k][0], Y + 2.5, G.z0 + 0.02); grp.add(m);
  });
  add(box(G.entry - 3.1, G.entry - 2.5, Y + 0.9, Y + 1.7, G.z1 - 0.22, G.z1), paint(0xb3201c));
  add(box(G.entry - 4.2, G.entry - 3.5, Y + 1.1, Y + 2.0, G.z1 - 0.16, G.z1), new THREE.MeshStandardMaterial({ color: 0x8e9196, roughness: 0.5, metalness: 0.5, emissive: C(0x16171a) }));
  const levelMat = new THREE.MeshStandardMaterial({ map: label('-2', 128, 128, '#15161a', '#e8b21c', '800 80px "Segoe UI", Arial, sans-serif'), roughness: 0.7, emissive: C(0x3a3020) });
  for (const [x, z] of G.pillars) for (const [dx, dz, ry] of [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]]){
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), levelMat);
    m.position.set(x + dx * (G.pillar + 0.01), Y + 2.3, z + dz * (G.pillar + 0.01)); m.rotation.y = ry; grp.add(m);
  }
  // ### The level stretch at the top of the ramp and the roller door at its end are one piece of their own (GAR.top), built
  // ### around the middle of the door's sill: z runs from -top at the head of the ramp to 0 at the door. Down in the garage it
  // ### closes the ramp. In the city the very same piece stands in the house at GARAGE.street, its last half metre out of the
  // ### wall as the frame of the door; its floor lies a little above the highest ground under it (GAR.sill), and a driveway
  // ### leads from the sill across the pavement and down the kerb to the street. See garageSwap for why it is one piece.
  {
    const top = GAR.top, T = G.top, [sx, sz] = G.street, H = (x, z) => Core.hillMesh('city', x, z), zs = sz + GAR.walk, zr = zs + GAR.kerb;
    const put = (geo, m, cast) => { const o = new THREE.Mesh(geo, m); o.receiveShadow = true; o.castShadow = !!cast; top.add(o); return o; };
    let high = -Infinity, low = Infinity;
    for (let x = sx - G.door - 1; x <= sx + G.door + 1; x += 0.8) for (let z = sz - T - 0.5; z <= zs; z += 0.5){ const h = H(x, z); high = Math.max(high, h); low = Math.min(low, h); }
    GAR.sill = high + 0.3;
    // the house has a floor over its ground floor, which follows the hill; the camera stays under its lowest corner
    GAR.clear = Math.min(G.tunnel - 0.45, low + 0.18 + GROUND + 0.3 - GAR.sill - 0.3);
    put(box(-G.door, G.door, -0.5, 0, -T, 0), topMat);
    put(mergeGeos([-1, 1].map(sd => box(Math.min(sd * (G.door - 0.32), sd * G.door), Math.max(sd * (G.door - 0.32), sd * G.door), 0, 0.16, -T, -0.2))), hazard);
    put(mergeGeos([-1, 1].map(sd => box(sd * (G.door - 0.62) - 0.065, sd * (G.door - 0.62) + 0.065, 0.001, 0.021, -T, -0.6))), paint(0xe8b21c));
    // a white stop line before the door, and the tubes and their pools as on the ramp
    put(box(-G.door + 0.4, G.door - 0.4, 0.001, 0.021, -1.6, -1.25), paint(0xe6e6de));
    const topTubes = [], topPools = [];
    for (let z = -T + 2; z < -1.5; z += 6){ topTubes.push(boxG(0.16, 0.07, 1.8, 0, G.tunnel - 0.06, z), boxG(0.3, 0.05, 1.9, 0, G.tunnel - 0.02, z)); topPools.push(new THREE.PlaneGeometry(G.door * 2 - 0.8, 6.4).rotateX(-Math.PI / 2).translate(0, 0.025, z)); }
    top.add(new THREE.Mesh(mergeGeos(topTubes), new THREE.MeshBasicMaterial({ color: 0xf1f6ff })));
    const topPool = new THREE.Mesh(mergeGeos(topPools), new THREE.MeshBasicMaterial({ map: glowTexture, color: 0xb4c2de, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
    topPool.renderOrder = 2; top.add(topPool);
    put(mergeGeos([-1, 1].map(sd => worldUV(box(sd > 0 ? G.door : -G.door - 1, sd > 0 ? G.door + 1 : -G.door, -0.5, G.tunnel + 0.4, -T, 0), 3))), plainMat);
    // the blue band and the white line of the ramp go on to the roller door
    put(mergeGeos([-1, 1].map(sd => box(sd * G.door - 0.02, sd * G.door + 0.02, 0.16, 1.36, -T, -0.6))), paint(0x2a587a));
    put(mergeGeos([-1, 1].map(sd => box(sd * G.door - 0.025, sd * G.door + 0.025, 1.36, 1.49, -T, -0.6))), paint(0xe9e9e2));
    put(box(-G.door - 1, G.door + 1, G.tunnel, G.tunnel + 0.4, -T, 0), roofMat, true);
    put(box(-G.door, G.door, G.tunnel - 0.3, G.tunnel, -0.6, -0.1), paint(0x3a3d44));
    const lamps = [];
    for (let z = -T + 3; z < -2; z += 7) for (const sd of [-1, 1]){
      lamps.push(boxG(0.08, 0.12, 0.34, sd * (G.door - 0.05), 2.4, z));
      const gl = glowSprite(C(0xffb866), 0.8, 0.45); gl.position.set(sd * (G.door - 0.14), 2.4, z); top.add(gl);
    }
    top.add(new THREE.Mesh(mergeGeos(lamps), new THREE.MeshBasicMaterial({ color: 0xffc27a })));
    // the roller door: ribbed steel, hung from its top edge, so rolling it up is a matter of making it shorter
    const ribs = tex(64, 256, (g, w, h) => { g.fillStyle = '#8b9199'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 16){ g.fillStyle = 'rgba(0,0,0,.38)'; g.fillRect(0, y, w, 3); g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(0, y + 3, w, 2); } });
    const shutter = new THREE.Mesh(new THREE.PlaneGeometry(G.door * 2, G.tunnel).translate(0, -G.tunnel / 2, 0), new THREE.MeshStandardMaterial({ map: ribs, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide, emissive: C(0x202328) }));
    shutter.position.set(0, G.tunnel, -0.25); top.add(shutter); GAR.shutter = shutter;
    // the driveway: from the sill down to the edge of the pavement, and down the kerb to the street, bent like the ground under it
    const N = 8, pos = [], idx = [], row = (z, y) => { for (let i = 0; i <= N; i++){ const x = -G.door + i * G.door * 2 / N; pos.push(x, y(sx + x) - GAR.sill, z - sz); } };
    row(sz, () => GAR.sill); row(zs, x => H(x, zs) + 0.24); row(zr, x => H(x, zr) + 0.02);
    for (let r = 0; r < 2; r++) for (let i = 0; i < N; i++){ const a = r * (N + 1) + i, b = a + N + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    // its two cheeks, down to the pavement
    for (const i of [0, N]) for (let r = 0; r < 2; r++){
      const a = r * (N + 1) + i, b = a + N + 1, n = pos.length / 3;
      pos.push(pos[a * 3], pos[a * 3 + 1] - 0.9, pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1] - 0.9, pos[b * 3 + 2]);
      idx.push(a, n, b, b, n, n + 1);
    }
    const drive = new THREE.BufferGeometry(); drive.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); drive.setIndex(idx); drive.computeVertexNormals();
    const dm = new THREE.MeshStandardMaterial({ color: 0x84868a, roughness: 0.8, side: THREE.DoubleSide, emissive: C(0x1c1c1e) }); dm.userData.env = 0.25;
    put(drive, dm);
  }
  grp.visible = false;
  scene.add(grp);
  scene.add(GAR.top);
  garageTop(true);
})();

// ### The player on foot: the body of the escape room (walker.js), with the garage's walls and floor and this game's sound.
GAR.mouth = { t: 'b', x0: -Core.GARAGE.door, x1: Core.GARAGE.door, z0: Core.GARAGE.z1, z1: Core.GARAGE.z1 + 1 };
const walker = ShardWalker.create({ THREE, renderer, camera, canvas, reduced: REDUCED, base: '../room-1-escape/', collide: garageCollide, floorAt: Core.garageFloor, pace: () => garage.run ? Core.GARAGE.run : Core.GARAGE.walk,
  sound: () => audio ? { ctx: audio.ctx, out: audio.gameVol } : null, muted: () => muted });
// ### Puts the three vehicles where they belong in the garage: the chosen one is the player's vehicle and stands in its bay, the
// ### other two are parked in theirs. Nobody sits on the motorcycle until the player has got on.
function garagePlace(){
  const G = Core.GARAGE;
  for (const k of G.order){ const md = MODELS[k]; (k === V.key ? carTilt : GAR.slots[k]).add(md.g); md.g.visible = true; }
  MODELS.bike.rider.visible = garage.live && V.key === 'bike';
  garageLamps(garage.live);
  const [x, z, h] = G.bays[V.key];
  Object.assign(car, { x, z, y: G.y, heading: h, camHeading: h, speed: 0, steer: 0, yaw: 0, pitch: 0, roll: 0, bodyPitch: 0, shake: 0, prevSpeed: 0, lean: 0, lift: 0 });
  eng.gear = 1; eng.rpm = ENGINES[V.key].idle; eng.shift = 0;
}
// ### The headlights of the chosen vehicle: dark while it is parked, on once the player sits in it.
function garageLamps(on){
  headlights.forEach((l, i) => { const show = on && (V.key !== 'bike' || i === 0); l.intensity = on ? (V.key === 'bike' ? 2 : 3) : 0; beams[i].visible = show; headGlows[i].visible = show; });
}
// ### The parked vehicles as circles, for collisions: the two that are not driven, or all three for the player on foot.
function garageParked(all){
  const out = [];
  for (const k of Core.GARAGE.order){
    if (k === V.key && !all) continue;
    const [x, z, h] = Core.GARAGE.bays[k];
    for (const sm of VEH[k].samples) out.push({ t: 'c', x: x + Math.sin(h) * sm, z: z + Math.cos(h) * sm, r: VEH[k].r });
  }
  return out;
}


// ### Goes down into the garage: the city above is hidden, the player stands on foot in front of the vehicles (the lens of
// ### the escape room: 66 degrees, and sharp from 5 cm on, as walls and hands come close), and the card comes up.
function enterGarage(){
  garage.on = true; state = 'garage';
  CITY.group.visible = false; GAR.group.visible = true;
  garage.shift = null; garageTop(false);
  hud.classList.add('off');
  camera.near = 0.05; camera.updateProjectionMatrix();
  garagePick(false);
}

// ### On foot in the garage: at the start in the tunnel door, with the three vehicles across the hall, or beside the vehicle's door after Esc at the wheel. The card
// ### shows the three vehicles (a tap walks you to one), "Get in" and the way round.
function garagePick(fromWheel){
  const G = Core.GARAGE;
  Object.assign(garage, { phase: 'pick', t: 0, live: false, sit: -1, path: [], ride: null });
  camera.near = 0.05; camera.updateProjectionMatrix();
  fader.material.opacity = 0;
  garageShutter(0); garageSwing(0); walker.grip(0); walker.handTo('r', null); walker.handTo('l', null); walker.dropHand('l', false);
  Object.values(MODELS).forEach(md => { if (md.drive && md.drive.flap) md.drive.flap.rotation.y = 0; });
  Object.values(MODELS).forEach(md => { if (md.dash){ md.dash.light(0); md.dash.show(0, 0); } });
  held.clear(); Object.keys(keys).forEach(k => keys[k] = false);
  garagePlace();
  const d = garageDoor(V.key);
  if (!fromWheel){ garage.door = 0; garageTunnelDoor(0); if (!REDUCED) sfx.creak(); }
  // a run begins in the tunnel, behind the door: it swings open and you walk out through it to the start, facing the vehicles
  // (with reduced motion you stand at the start at once)
  const eye = G.y + walker.EYE, start = [G.start[0], eye, G.start[1]], face = [car.x * 0.6, G.y + 1.1, car.z];
  if (fromWheel) walker.place(d.pos, d.look);
  else if (REDUCED) walker.place(start, face);
  else walker.place([G.entry, eye, G.z1 + TUNNEL_DOOR.back], [G.entry, G.y + 1.3, G.z1 - 8]);
  walker.setActive(true);
  if (!fromWheel && !REDUCED) walker.goTo(start, face, TUNNEL_DOOR.walk);
  if (camera.fov !== 66){ camera.fov = 66; camera.updateProjectionMatrix(); }
  showCard(`
    <div class="eyebrow">${story ? 'Act 1 · ' : ''}Lock-up garage · under the Baixa · 02:30</div>
    <h2>Choose your getaway vehicle</h2>
    <div class="vtabs">${G.order.map(k => `<button class="vtab" data-pick="veh" data-val="${k}" aria-pressed="${V.key === k}">${PREVIEWS[k] ? `<img src="${PREVIEWS[k]}" alt="">` : ICONS[k]}<span>${VEH[k].name}<small>${VEH[k].cls}</small></span></button>`).join('')}</div>
    <p class="gar-note" id="garNote"></p>
    <div class="actions">
      <button class="btn" data-action="board">Get in <small class="desk-only">Enter</small></button>
      <button class="btn ghost" data-action="street">Skip the garage</button>
      <button class="btn ghost" data-action="menu">Main menu</button>
    </div>
    <p class="note"><span class="desk-only">Arrow keys or W A S D to walk · hold Shift to run · drag to look around · walk up to a vehicle or click it</span><span class="touch-only">Drag to look around · tap a vehicle to walk to it</span></p>`, 'garage');
  garageChosen(false);
}

// ### Where the player stands to get into a vehicle, at eye height beside the driver's door (the driver sits on the left: the
// ### passenger's side of BOARD, mirrored), and what they look at from there: the handle of the door (the seat on the
// ### motorcycle). back is where they step back to while the door swings open, and mid the point in the open door they pass
// ### through on the way to the seat (over the sill, head down under the roof). The coupe has its own places (GARAGE_STAND),
// ### close enough to its low door to reach the handle.
const GARAGE_STAND = { car: { stand: [1.24, -0.06], back: [1.85, -0.55], sill: [0.98, 0.0, 1.0] } };
function garageDoor(k){
  const G = Core.GARAGE, [x, z, h] = G.bays[k], B = BOARD[k], S = GARAGE_STAND[k], md = MODELS[k], ch = Math.cos(h), sh = Math.sin(h), at = (lx, lz) => [x + lx * ch + lz * sh, z - lx * sh + lz * ch];
  const eye = G.y + walker.EYE, st = S ? at(...S.stand) : at(-B.stand[0] + 0.6, B.stand[1]), bk = S ? at(...S.back) : at(-B.stand[0] + 0.95, B.stand[1] - 0.4);
  const sill = S ? at(S.sill[0], S.sill[1]) : at(-B.sill[0] + 0.25, B.sill[1]), sy = S ? S.sill[2] : B.seat[1] + 0.9;
  let look;
  if (md.drive){ const p = md.drive.pivot.position, q = md.drive.flap ? md.drive.flap.position.clone().add(md.drive.handle.position) : md.drive.handle.position, hp = at(p.x + q.x, p.z + q.z); look = [hp[0], G.y + p.y + q.y, hp[1]]; }
  else { const seat = at(-B.seat[0], B.seat[2]); look = [seat[0], G.y + B.seat[1] + 0.3, seat[1]]; }
  return { pos: [st[0], eye, st[1]], look, back: [bk[0], eye, bk[1]], mid: new THREE.Vector3(sill[0], G.y + sy, sill[1]) };
}
// ### Walks the player to the driver's door of the chosen vehicle, as the "Walk to" buttons do in the escape room. From one
// ### bay to another the way leads out in front of the vehicles first, never through one.
function garageWalkTo(){
  const d = garageDoor(V.key), c = walker.cam.pos, legs = [], S = Core.GARAGE;
  // still in the doorway of the tunnel: first out into the garage, not through the wall
  if (c.z > S.z1 - 1) legs.push({ pos: [S.start[0], d.pos[1], S.start[1]], look: d.look });
  if (c.z < -3.5 && Math.abs(c.x - d.pos[0]) > 3) legs.push({ pos: [(c.x + d.pos[0]) / 2, d.pos[1], -2], look: d.look });
  legs.push(d);
  garage.path = legs;
  garageLeg();
}
// ### Starts the next leg of that walk; its time follows from its length, at a run.
function garageLeg(){
  const leg = garage.path.shift(), c = walker.cam.pos;
  walker.goTo(leg.pos, leg.look, clamp(Math.hypot(leg.pos[0] - c.x, leg.pos[2] - c.z) / Core.GARAGE.run, 0.3, 3));
}
// ### After a choice: the vehicles change places if needed, the card says what the chosen one is like, and (after a tap on
// ### the card) the player walks over to it.
function garageChosen(walkThere){
  garagePlace();
  const el = card.querySelector('#garNote');
  if (el) el.textContent = V.blurb;
  card.querySelectorAll('[data-pick="veh"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.val === V.key)));
  if (walkThere && garage.phase === 'pick') garageWalkTo();
}
// ### Keeps the player on foot out of the walls, the pillars and the three vehicles, and off the ramp.
function garageCollide(pos, body){
  const list = GAR.colliders.concat(GAR.mouth, garageParked(true));
  for (let n = 0; n < 2; n++) for (const c of list){ const hit = Core.collidePoint(pos.x, pos.z, body, c); if (hit){ pos.x += hit[0] * hit[2]; pos.z += hit[1] * hit[2]; } }
}

// ### "Get in": the card goes away and the player walks to the driver's door (updateGarage does the rest).
function garageBoard(){
  hideOverlay();
  Object.assign(garage, { phase: 'board', t: 0, sit: -1 });
  garageWalkTo();
}

// how long each part of getting in takes, in seconds: the hand to the handle, the pull that unlatches the door, the door
// swinging wide, the way onto the seat, pulling the door shut, a look round the cabin while the engine starts, rolling off
// out of the bay, and the view drawing back out of the cabin to its place behind the vehicle; and how long the roller door at
// the top takes to roll up. ROLL is how fast the vehicle rolls off (m/s).
const GARAGE_T = { reach: 0.8, pull: 0.5, open: 0.6, sit: 1.05, shut: 0.6, wheel: 1.6, roll: 1.4, back: 1.5, door: 0.7 }, ROLL = 3.2;
const HAND_P = new THREE.Vector3(), PULL_P = new THREE.Vector3(), EYE_P = new THREE.Vector3(), EYE_Q = new THREE.Quaternion();
// ### The driver's door of the chosen vehicle (the motorcycle has none): 0 shut, 1 wide open. Every other one is shut.
function garageSwing(k){
  for (const md of Object.values(MODELS)){
    if (!md.drive) continue;
    const on = md === MODELS[V.key] ? k : 0;
    md.drive.pivot.visible = md.drive.cut || on > 0.001; md.drive.hole.visible = on > 0.04; md.drive.pivot.rotation.y = md.drive.max * on;
    if (md.drive.inner) md.drive.inner.visible = on <= 0.001;
  }
}
// ### Where the piece at the top of the ramp stands (GAR.top): at the end of the ramp down in the garage, or in the house on
// ### the street, where its roller door is the way out of the garage that every run in Lisbon can see.
function garageTop(inCity){
  const G = Core.GARAGE;
  if (inCity) GAR.top.position.set(G.street[0], GAR.sill, G.street[1]); else GAR.top.position.set(0, G.y + G.rise, GAR.end);
}
// ### How far the roller door is rolled up: 0 shut, 1 open.
function garageShutter(k){ garage.open = k; GAR.shutter.scale.y = 1 - 0.97 * k; }
// ### The light of the garage (GARAGE_LIGHT) instead of the moon, from 1 down in the garage to 0 once the roller door is up. It
// ### only writes the lights (and the direction of the sun, SUN_OFF) when that changes, and leaves them to the finale's dawn
// ### (setDawn) otherwise. Returns how far it is.
function garageLight(){
  const L = GARAGE_LIGHT, k = garage.on && !finale.on ? 1 - garage.open : 0;
  if (k === L.k) return k;
  L.k = k;
  hemi.color.copy(NIGHT.hemiSky).lerp(L.hemiSky, k); hemi.groundColor.copy(NIGHT.hemiGround).lerp(L.hemiGround, k);
  hemi.intensity = NIGHT.hemiI + (L.hemiI - NIGHT.hemiI) * k;
  sun.color.copy(NIGHT.sunC).lerp(L.sunC, k); sun.intensity = NIGHT.sunI + (L.sunI - NIGHT.sunI) * k;
  SUN_NIGHT.forEach((v, i) => { SUN_OFF[i] = v + (L.off[i] - v) * k; });
  return k;
}
// ### The ground under the vehicle while the garage is on. Down in the garage it is the floor and the ramp (Core.garageFloor).
// ### Once the vehicle is in the city (garage.shift) it is the level floor behind the roller door, then the driveway across
// ### the pavement and down the kerb, then the street itself.
function garageGround(x, z){
  if (!garage.shift) return Core.garageFloor(x, z);
  const zd = Core.GARAGE.street[1], zs = zd + GAR.walk, zr = zs + GAR.kerb, H = (a, b) => Core.hillMesh('city', a, b);
  if (z <= zd) return GAR.sill;
  if (z <= zs) return GAR.sill + (H(x, zs) + 0.24 - GAR.sill) * (z - zd) / GAR.walk;
  if (z <= zr) return H(x, zr) + 0.24 * (zr - z) / GAR.kerb;
  return H(x, z);
}
// ### The seamless way out. The garage lies 30 m under the map, in a place of its own, and the city is not drawn while the
// ### player is down there. On the level stretch at the top the view shows nothing but that stretch and its shut roller door,
// ### and the very same piece stands in a house on the street. So here the vehicle, the camera and the piece are moved up
// ### into the city by one and the same step (garage.shift): the picture does not change, the city is drawn again, and then
// ### the door rolls up on the real street. No cut and no fade.
function garageSwap(){
  const G = Core.GARAGE, S = new THREE.Vector3(G.street[0], GAR.sill - (G.y + G.rise), G.street[1] - GAR.end);
  garage.shift = S; garage.t = 0;
  car.x += S.x; car.y += S.y; car.z += S.z; camera.position.add(S);
  GAR.group.visible = false; CITY.group.visible = true;
  garageTop(true);
  // nothing may stand in the way out: traffic within 30 m of the door starts somewhere else (the door is still shut)
  for (const n of npcs) if (n.on && Math.hypot(n.x - G.street[0], n.z - G.street[1] - 10) < 30){ n.on = false; spawnNpc(n, 60); }
  updateNpcs(0);
  sfx.door(true);
}
// ### Leaves the garage for the street and opens the map of the evidence at once. Driven out through the roller door, the
// ### vehicle stays where it is, rolling on the street in front of the garage; with "Skip the garage" it stands at the usual
// ### start. From "Start driving" on it is a run like any other.
function garageToStreet(rolling){
  const out = rolling && !!garage.shift;
  garageLeave();
  if (out){ car.prevSpeed = car.speed; car.steer = 0; } else resetCar();
  hud.classList.remove('off');
  state = 'play';
  showOverview();
}
// ### Puts everything back as it is outside the garage: the city visible, the three models with the player's vehicle again,
// ### the roller door shut in its house on the street.
function garageLeave(){
  if (!garage.on) return;
  Object.assign(garage, { on: false, live: false, phase: '', shift: null, run: false });
  GAR.group.visible = false; CITY.group.visible = true;
  garageTop(true); garageShutter(0); garageSwing(0);
  Object.values(MODELS).forEach(md => carTilt.add(md.g));
  MODELS.bike.rider.visible = true;
  setVehicle(V.key);
  fader.material.opacity = 0;
  walker.grip(0); walker.setActive(false);
  camera.near = 0.5; camera.updateProjectionMatrix();
}
// ### Driving in the garage: the same speed and steering rules as on the street (Core.stepSpeed, stepSteer, turnRate, stepYaw), at
// ### walking-to-town speed. Walls, pillars and the parked vehicles push the vehicle back; a bump costs speed but no damage.
// ### With roll (m/s) the vehicle rolls off by itself at that speed, straight on, as it leaves its bay after getting in.
function garageDrive(dt, roll){
  const G = Core.GARAGE;
  if (roll) car.speed += (roll - car.speed) * Math.min(1, dt * 1.4);
  else car.speed = Core.stepSpeed(car.speed, keys, dt, Math.min(G.speed, Core.topSpeed(M, V, 0)), V, Core.garageGrade(car.z, car.heading));
  car.steer = roll ? 0 : Core.stepSteer(car.steer, (keys.left ? 1 : 0) - (keys.right ? 1 : 0) || TILT.value, dt);
  car.yaw = Core.stepYaw(car.yaw || 0, Core.turnRate(car.steer, car.speed, V, keys.brake), dt, V);
  car.heading += car.yaw * dt * (car.speed >= 0 ? 1 : -1);
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  car.x += fx * car.speed * dt; car.z += fz * car.speed * dt;
  const walls = GAR.colliders.concat(garageParked());
  for (const sm of V.samples) for (const c of walls){
    const hit = collidePoint(car.x + fx * sm, car.z + fz * sm, V.r, c);
    if (!hit) continue;
    car.x += hit[0] * hit[2]; car.z += hit[1] * hit[2];
    const impact = -(fx * hit[0] + fz * hit[1]) * car.speed;
    if (impact > 2){ car.speed *= 0.3; car.shake = Math.max(car.shake, 0.25); sfx.crash(impact); } else car.speed *= 0.985;
  }
  settleCar(dt);
}
// ### Over the top of the ramp the vehicle drives itself: along the level stretch, out through the roller door and round to
// ### the left into the lane of the street (the way of Core.garageWay, followed with Core.wayAim). Returns true at its end.
function garageAuto(dt){
  const S = garage.shift, ox = S ? S.x : 0, oz = (S ? S.z : 0) + GAR.end, x = car.x - ox, z = car.z - oz;
  const [i, ax, az, done] = Core.wayAim(garage.way, garage.wi, x, z, V.key === 'truck' ? 5.5 : 4);
  garage.wi = i;
  const rate = clamp(wrapAngle(Math.atan2(ax - x, az - z) - car.heading) * 3, -1.1, 1.1);
  car.speed += ((z < 0 ? Core.GARAGE.out : Core.GARAGE.away) - car.speed) * Math.min(1, dt * 2);
  car.heading += rate * dt; car.yaw = rate; car.steer = rate / 1.1;
  car.x += Math.sin(car.heading) * car.speed * dt; car.z += Math.cos(car.heading) * car.speed * dt;
  settleCar(dt);
  return done;
}
// ### The camera behind the vehicle in the garage: closer and lower than on the street, and kept inside the walls and under the
// ### ceiling for as long as it is inside (also in the piece that stands in the city, which is why it is worked out in the
// ### garage's own measures and moved by garage.shift).
function garageCam(dt, snap){
  const G = Core.GARAGE, truck = V.key === 'truck', S = garage.shift, ox = S ? S.x : 0, oy = S ? S.y : 0, oz = S ? S.z : 0;
  car.camHeading += wrapAngle(car.heading - car.camHeading) * Math.min(1, dt * 5);
  // on the way out it closes up on the vehicle, so that it is on the level stretch soon after it
  garage.near += ((garage.phase === 'exit' ? 0.68 : 1) - garage.near) * (snap ? 1 : Math.min(1, dt * 3));
  const fx = Math.sin(car.camHeading), fz = Math.cos(car.camHeading), d = (truck ? 8.5 : V.key === 'bike' ? 5 : 6.5) * garage.near, edge = G.door - 0.7;
  const cx = car.x - ox, cy = car.y - oy, cz = car.z - oz;
  let tx = cx - fx * d, tz = Math.max(cz - fz * d, G.z0 + 0.7), ty = cy + (truck ? 4.1 : V.key === 'bike' ? 2.0 : 2.5);
  if (tz < GAR.end + 0.4){
    if (tz > G.z1 - 0.7 && Math.abs(tx) > edge){ if (cz < G.z1) tz = G.z1 - 0.7; else tx = clamp(tx, -edge, edge); }
    tx = clamp(tx, -G.x + 0.7, G.x - 0.7);
    ty = Math.min(ty, Core.garageFloor(tx, tz) + (tz > G.z1 ? G.tunnel : G.h) - 0.45);
    // on the level stretch it also stays under the first floor of the house that the stretch stands in up in the city
    if (tz > GAR.end - G.top - 2) ty = Math.min(ty, Core.garageFloor(tx, tz) + GAR.clear);
  }
  const k = snap ? 1 : 1 - Math.exp(-dt * 5);
  camera.position.x += (tx + ox - camera.position.x) * k; camera.position.y += (ty + oy - camera.position.y) * k; camera.position.z += (tz + oz - camera.position.z) * k;
  camera.lookAt(car.x + fx * 3, car.y + (truck ? 2.2 : 1.1), car.z + fz * 3);
  if (car.shake > 0.01 && !REDUCED) camera.position.y += (Math.random() - 0.5) * car.shake * 0.3;
  car.shake *= Math.exp(-dt * 6);
  if (camera.fov !== 62){ camera.fov = 62; camera.updateProjectionMatrix(); }
}
// ### When each step of getting in ends, in seconds after the player reaches the door (see updateGarage). Without a door (the
// ### motorcycle) the steps with the door take no time.
function garageMarks(door){
  const T = GARAGE_T, N = {}; let t = 0;
  for (const k of ['reach', 'pull', 'open', 'sit', 'shut', 'wheel', 'roll', 'back']) N[k] = t += (door || !['reach', 'pull', 'open', 'shut'].includes(k) ? T[k] : 0);
  return N;
}
// ### The view while getting in, after the vehicle has been moved for this frame (so the cabin does not lag behind the eye):
// ### from the door over the sill onto the seat, then the driver's own eyes (MODELS[...].eye) while the engine starts and the
// ### vehicle rolls off, and then back out through the rear window to the camera behind the vehicle. The dials follow the
// ### engine and the speed.
function garageRide(dt){
  const g = garage, N = g.ride;
  if (!N) return;
  const md = MODELS[V.key], s = g.sit;
  md.eye.updateWorldMatrix(true, false); md.eye.getWorldPosition(EYE_P); md.eye.getWorldQuaternion(EYE_Q);
  if (s < N.sit){
    const k = ease(clamp((s - N.open) / GARAGE_T.sit, 0, 1)), u = 1 - k, m = g.mid;
    camera.position.set(u * u * g.from.x + 2 * u * k * m.x + k * k * EYE_P.x, u * u * g.from.y + 2 * u * k * m.y + k * k * EYE_P.y, u * u * g.from.z + 2 * u * k * m.z + k * k * EYE_P.z);
    camera.quaternion.copy(g.turn).slerp(EYE_Q, ease(clamp((s - N.open) / (GARAGE_T.sit * 0.85), 0, 1)));
  } else if (s < N.roll){ camera.position.copy(EYE_P); camera.quaternion.copy(EYE_Q); }
  else {
    // quick at first and up over the roof, so it is soon out of the cabin, then it settles in behind
    const k = 1 - (1 - clamp((s - N.roll) / GARAGE_T.back, 0, 1)) ** 2.6;
    garageCam(dt, true);
    g.look.copy(camera.position); g.spin.copy(camera.quaternion);
    camera.position.lerpVectors(EYE_P, g.look, k); camera.position.y += Math.sin(Math.PI * k) * 0.9; camera.quaternion.copy(EYE_Q).slerp(g.spin, k);
    // the near plane moves out with it, so the walls and windows it passes through are not drawn right in front of the lens
    camera.fov = 66 + (62 - 66) * k; camera.near = Math.min(0.5, 0.05 + 3 * k); camera.updateProjectionMatrix();
  }
  // at the start the needles sweep to the end of their dials and back, as they do when the engine wakes
  const sweep = s > N.shut && s < N.shut + 1 ? Math.sin(Math.PI * (s - N.shut)) : 0;
  if (md.dash) md.dash.show(Math.max(Math.abs(car.speed) * 2.237, 160 * sweep), Math.max(g.live ? eng.rpm / 1000 : 0, 8 * sweep));
  walker.hold(dt);
}
// ### The tunnel door, t seconds after a run began behind it: it swings out towards the garage and slows as it opens, as it
// ### did when you opened it in room 1, and then stands open. With reduced motion it stands open from the start.
function garageTunnelDoor(t){
  const D = TUNNEL_DOOR, k = REDUCED ? 1 : clamp(t / D.opens, 0, 1);
  GAR.tunnelDoor.rotation.y = -D.open * (1 - Math.pow(1 - k, 3));
}
// ### One frame in the garage, by phase. pick: the player walks about (Shift runs); the vehicle they come close to is the
// ### chosen one. board: getting in, seen through the player's eyes and with their hands: the walk to the driver's door, the
// ### right hand takes the handle and pulls, the door swings open and the player steps back, in through it and onto the
// ### seat, both hands to the wheel (to the bars on the motorcycle), the left hand pulls the door shut, the engine starts in
// ### the cabin, the vehicle rolls off and the view draws back out of it to behind the vehicle. drive: the player drives up
// ### the ramp. exit: over the top the vehicle drives itself (garageAuto); as soon as the view has only the level stretch in
// ### it the city takes over (garageSwap), the roller door rolls up, and on the street the map opens.
function updateGarage(dt){
  const G = Core.GARAGE, g = garage, T = GARAGE_T;
  g.t += dt;
  if (g.door < TUNNEL_DOOR.opens){ g.door += dt; garageTunnelDoor(g.door); }
  if (g.phase === 'pick'){
    walker.update(dt, (keys.up ? 1 : 0) - (keys.down ? 1 : 0), (keys.right ? 1 : 0) - (keys.left ? 1 : 0), true);
    if (walker.gliding()) return;
    if (g.path.length){ garageLeg(); return; }
    // the vehicle the player walks up to becomes the chosen one
    const c = walker.cam.pos;
    let near = null, best = 3.4;
    for (const k of G.order){ const d = garageDoor(k).pos, l = Math.hypot(d[0] - c.x, d[2] - c.z); if (l < best){ best = l; near = k; } }
    if (near && near !== V.key && Core.applyPick(sel, 'veh', near)){ setVehicle(near); writeStore('shard-heist-pick', JSON.stringify(sel)); garageChosen(false); }
    return;
  }
  if (g.phase === 'board'){
    const d = garageDoor(V.key), md = MODELS[V.key], door = md.drive, T = GARAGE_T;
    // the walk to the door
    if (g.sit < 0){
      walker.update(dt, 0, 0, false);
      if (walker.gliding()) return;
      if (g.path.length){ garageLeg(); return; }
      g.sit = 0;
      return;
    }
    const was = g.sit, s = g.sit += dt, crossed = at => was < at && s >= at, N = garageMarks(!!door);
    // 1. the right hand goes to the handle, open, and the fingers hook round it (the left hand sinks out of the way),
    // 2. it pulls the handle out of its pocket, the latch clicks and the door comes open with the hand, 3. it lets go, the
    // handle springs back, the door swings wide and the player steps back out of its way, looking into the cabin
    if (s < N.open){
      const p = clamp((s - N.reach) / T.pull, 0, 1), k = s < N.reach ? 0 : s < N.pull ? 0.3 * ease(clamp((p - 0.4) / 0.6, 0, 1)) : 0.3 + 0.7 * (1 - (1 - (s - N.pull) / T.open) ** 2);
      garageSwing(k);
      if (door.flap) door.flap.rotation.y = -door.side * 0.45 * (s < N.pull ? ease(clamp(p / 0.4, 0, 1)) : Math.max(0, 1 - (s - N.pull) / 0.15));
      door.handle.updateWorldMatrix(true, false); door.handle.getWorldPosition(HAND_P);
      walker.handTo('r', s < N.pull ? HAND_P : null, s > N.reach - 0.2 ? 0.95 : 0.15);
      walker.dropHand('l', s < N.pull);
      if (crossed(N.reach + T.pull * 0.4)) sfx.door(true);
      if (crossed(N.pull)){ md.eye.updateWorldMatrix(true, false); md.eye.getWorldPosition(EYE_P); walker.goTo(d.back, [EYE_P.x, EYE_P.y - 0.2, EYE_P.z], T.open); }
      walker.update(dt, 0, 0, false);
      return;
    }
    // 4. in through the door and onto the seat (garageRide moves the view), the hands come up to the wheel (to the bars on
    // the motorcycle), 5. the left hand pulls the door shut by its grip
    if (!g.ride){ g.from.copy(camera.position); g.turn.copy(camera.quaternion); g.mid.copy(d.mid); g.ride = N; walker.handTo('r', null); walker.hands.show = false; }
    if (s > N.open + T.sit * 0.55 && s < N.roll){ walker.hands.show = true; walker.grip(1, V.key === 'bike', !!md.dash); }
    if (door && s >= N.sit && s < N.shut + 0.2){
      if (s < N.shut) garageSwing(1 - ease((s - N.sit) / T.shut));
      door.pull.updateWorldMatrix(true, false); door.pull.getWorldPosition(PULL_P);
      walker.handTo('l', s < N.shut - 0.1 ? PULL_P : null, 0.9);
    }
    // 6. the door shuts, the engine starts, the lights and the dials come on and the needles swing round once
    if (crossed(N.shut)){ if (door) sfx.door(false); g.live = true; garageLamps(true); }
    if (md.dash && s >= N.shut) md.dash.light(clamp((s - N.shut) / 0.5, 0, 1));
    // 7. it rolls off out of the bay, 8. the view draws back out of the cabin to its place behind the vehicle
    if (s >= N.wheel) garageDrive(dt, ROLL);
    // the hands belong to the view from the seat and go with it
    if (crossed(N.roll)){ walker.grip(0); walker.setActive(false); MODELS.bike.rider.visible = V.key === 'bike'; }
    if (s >= N.back){
      g.ride = null; camera.near = 0.05; camera.updateProjectionMatrix();
      Object.assign(g, { phase: 'drive', t: 0 });
      toast(COARSE ? 'Hold Gas and drive up the ramp to the street.' : 'Drive up the ramp to the street: W or ↑ is the gas.', '', 4200);
    }
    return;
  }
  if (g.phase === 'drive'){
    garageDrive(dt);
    garageCam(dt, false);
    if (Core.garageOut(car.z)) Object.assign(g, { phase: 'exit', t: 0, wi: 0, way: Core.garageWay() });
    return;
  }
  const done = garageAuto(dt);
  garageCam(dt, false);
  // the step up into the city: once the camera is on the level stretch and under the first floor of the house up there
  if (!g.shift){ if (camera.position.z >= GAR.end - G.top + 0.6 && camera.position.y <= G.y + G.rise + GAR.clear + 0.05) garageSwap(); }
  else garageShutter(ease(clamp(g.t / T.door, 0, 1)));
  if (done) garageToStreet(true);
}

// ### Spins the shards and kits, picks them up when close, and checks the finish gate.
function updatePickups(dt, live){
  for (const it of items){
    if (it.taken) continue;
    it.gem.rotation.y += dt * 1.6;
    const y = 1.9 + Math.sin(clock * 2.2 + it.phase) * 0.35;
    it.gem.position.y = y; it.glow.position.y = y;
    it.ring.material.opacity = 0.3 + 0.25 * Math.sin(clock * 3 + it.phase);
    if (live){ const dx = it.x - car.x, dz = it.z - car.z; if (dx * dx + dz * dz < 3.8 * 3.8) collect(it); }
  }
  updateWitness(dt, live);
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
      if (Math.hypot(gate.x - car.x, gate.z - car.z) < 5.5) finish();
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
// ### Sets up the post-processing chain for Ultra graphics: bloom, then anti-aliasing.
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
    // without a depth texture three.js gives a multisampled target only 16 bits of depth, too few for details on far facades
    if (rt.isWebGLMultisampleRenderTarget) for (const t of [c.renderTarget1, c.renderTarget2]) t.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType);
    c.addPass(new THREE.RenderPass(scene, camera));
    c.addPass(new THREE.UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.7, 0.45, 0.82));
    c.addPass(new THREE.ShaderPass(THREE.GammaCorrectionShader));
    if (!renderer.capabilities.isWebGL2 && THREE.FXAAShader){ fxaaPass = new THREE.ShaderPass(THREE.FXAAShader); c.addPass(fxaaPass); }
    return c;
  } catch (e) { return null; }
}
let quality = Core.newQuality();
// ### Applies the Ultra or Balanced graphics setting, at the resolution that keeps the picture smooth.
function applyGfx(){
  const q = GFX[gfx], size = COARSE ? q.shadow / 2 : q.shadow;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.ratio) * Core.QUALITY_SCALES[quality.level]);
  if (sun.shadow.mapSize.x !== size){
    sun.shadow.mapSize.set(size, size);
    if (sun.shadow.map){ sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  if (q.post && !composer) composer = buildComposer();
  resize();
}

// ---------- Story mode: The Necklace Job ----------
// ### The story that follows room 1 (the escape room), told in one night in Lisbon. The detective, framed for stealing the
// ### Starfall necklace and jailed as inmate 4471, has escaped through the tunnel. Officer Hale, who opened the way, helps
// ### over the radio while the police hunt the escaped inmate through the Baixa. It is the Lisbon run (the evidence, the
// ### witness, the gate, the bridge) with the radio and one thing more: an optional sealed letter hidden in a park (not
// ### shown on the radar) decides the ending. With it the truth comes out (Ending A), without it the detective goes back to
// ### cell 4471 (Ending B). Busted, wrecked or out of time is Ending C.
let story = null;
const STORY = {
  acts: [
    { mode: 'city', title: 'The Evidence', goal: 'Recover the six pieces of evidence hidden in Lisbon’s Baixa, and get out over the bridge.' }
  ],
  // [seconds into the act, text, tone]: Hale's lines are orange (tone 'hale'), police dispatch is red
  radio: [
    [[5, 'HALE: You made it out. Your friend hid six pieces of evidence in the Baixa: photos, fingerprints, a torch, a lockpick, clothes and a balaclava. They show who really broke in. Find them before the police find you.', 'hale'],
     [9, 'DISPATCH: All units, inmate 4471 has escaped from Cell Block D. %V. Approach with caution.', 'red'],
     [32, 'HALE: Ashford’s people used the parks as dead drops. Look there. Not everything shows up on your radar.', 'hale'],
     [58, 'DISPATCH: Escaped inmate still in the Baixa. Roadblocks on the waterfront.', 'red'],
     [95, 'DISPATCH: Lady Ashford has been told about the escape. Bring 4471 in.', 'red']]
  ]
};
const VEH_DESC = { car: 'Bright-blue coupe', bike: 'Black superbike', truck: 'Green tractor unit' };

// ### Shows the story prologue before the first act.
function showStoryIntro(){
  story = Core.newStory();
  showCard(`
    <div class="eyebrow">Story mode · After the tunnel · 02:30</div>
    <h1>The Necklace <em>Job</em></h1>
    <p>The tunnel under Cell Block D ends in a lock-up garage. Officer Hale’s note was true: a vehicle is waiting, the keys in the ignition, a radio on the seat.</p>
    <p>Three weeks ago you were framed for stealing the Starfall necklace. Your oldest friend on the force found out who really broke into the museum and hid the proof across Lisbon’s Baixa: photos, fingerprints and DNA, and the thief’s torch, lockpick, clothes and balaclava. Hale believes you but cannot prove it. You can, if you recover the evidence before the police recover you.</p>
    <div class="acts">${STORY.acts.map(a => `<div><span>Tonight</span><b>${a.title}</b><small>${a.goal}</small></div>`).join('')}</div>
    <p class="note">Hale helps over the radio. Look carefully: not everything you need shows up on the radar.</p>
    <div class="actions">
      <button class="btn" data-action="act">Start the story <small class="desk-only">Enter</small></button>
      <button class="btn ghost" data-action="menu">Back</button>
    </div>`);
}

// ### Starts the story's run in Lisbon.
// ### fresh: begun from the prologue, not a retry. Then it starts down in the garage.
function startStoryAct(i, fresh){
  if (!Core.beginAct(story, i)) return;
  story.env = null;
  const A = STORY.acts[i], viaGarage = !!fresh;
  startRun(A.mode, sel.veh, viaGarage);
  ui.eye.textContent = `Story · ${A.title}`;
  if (!story.letter) placeEnvelope();
  if (viaGarage) enterGarage();
  warmUp();
  toast(`${A.title}: ${A.goal}`, 'gold', 4200);
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

// ### Runs the story during the run: the radio messages and the sealed letter.
function updateStory(dt){
  // Radio and narrator lines on a timeline
  story.clock += dt;
  const lines = STORY.radio[story.act];
  const radio = Core.dueRadio(lines, story.radioIdx, story.clock);
  story.radioIdx = radio.idx;
  for (const [, text, tone] of radio.due) toast(text.replace('%V', VEH_DESC[V.key]), tone, 4200, true);
  const env = story.env;
  if (env && !env.taken){
    env.env.rotation.y += dt * 1.4;
    env.env.position.y = env.glow.position.y = 1.2 + Math.sin(clock * 2.4) * 0.15;
    if (Math.hypot(env.x - car.x, env.z - car.z) < 3.4){
      env.taken = true; story.letter = true;
      runGroup.remove(env.g);
      burst(env.x, groundH(env.x, env.z) + 1.4, env.z, GOLD, 20);
      sfx.collect();
      toast('You found a sealed letter from the mansion. It might prove who framed you.', 'gold', 4200);
    }
  }
}

// ### Ends the story's run after the bridge and shows the ending.
function storyFinish(){
  state = 'done';
  const used = Core.driveTime(mode, M, timeLeft, collected);
  story.times[story.act] = used; story.cops += copsWrecked;
  burst(gate.x, gate.group.position.y + 6, gate.z, GOLD, 40);
  sfx.win();
  const stats = `<div class="stats">
      <div class="stat"><span class="eyebrow">Drive time</span><b>${fmtTimeExact(used)}</b></div>
      <div class="stat"><span class="eyebrow">Damage</span><b>${Math.round(damage)}%</b></div>
      <div class="stat"><span class="eyebrow">Cops wrecked</span><b>${copsWrecked}</b></div>
    </div>`;
  showEnding(stats);
}

// ### Shows the story's ending after the bridge: A with the sealed letter, B without it. (Ending C is storyGameOver.)
function showEnding(stats){
  const good = Core.storyEnding(story) === 'A';
  const letter = `<p class="note">The sealed letter: <b>${good ? 'found' : 'still in a park in the Baixa'}</b></p>`;
  showCard(good ? `
    <div class="eyebrow">The Necklace Job · Ending A of 3 · The truth</div>
    <h1>Case <em>closed</em></h1>
    <p>On the far side of the bridge Officer Hale is waiting at the roadside with two investigators from the public prosecutor. You hand over the six pieces of evidence, and Marta Silva tells them what she saw at the museum window. Then you unfold the letter. It is in Lady Ashford’s hand: <i>“Take it. Hide the box in the detective’s car. Pin it on the detective.”</i></p>
    <p>It leaves no doubt. The fingerprints and the hairs in the balaclava are her butler’s, and he confesses that he only followed orders. By noon Lady Ashford is led out of her house in handcuffs, and the Starfall necklace turns up in her safe. Hale hands you back your badge: “Took you long enough.”</p>
    ${stats}${letter}
    <div class="actions"><button class="btn" data-action="story">Play the story again <small class="desk-only">Enter</small></button><button class="btn ghost" data-action="menu">Main menu</button></div>` : `
    <div class="eyebrow">The Necklace Job · Ending B of 3 · Framed</div>
    <h1>Back in <em>4471</em></h1>
    <p>On the far side of the bridge Officer Hale is waiting at the roadside with two investigators from the public prosecutor. You hand over the six pieces of evidence, and Marta Silva tells them what she saw at the museum window. It shows that someone else broke in. It does not show who sent him.</p>
    <p>“Evidence brought in by an escaped convict, and one witness in the dark,” says the prosecutor. “That is not enough to hold anyone.” The case will be heard again, but until then you are back in cell 4471, and Hale cannot help you twice. Somewhere in the Baixa, a sealed letter is still waiting in a park.</p>
    ${stats}${letter}
    <div class="actions"><button class="btn" data-action="story">Try for the true ending <small class="desk-only">Enter</small></button><button class="btn ghost" data-action="menu">Main menu</button></div>`);
}

// ### Offers a retry when the story's run fails.
function storyGameOver(reason){
  state = 'over';
  sfx.fail();
  if (reason === 'wrecked'){ const fx = Math.sin(car.heading), fz = Math.cos(car.heading); burst(car.x + fx, car.y + 1.2, car.z + fz, SPARKS, 36, 0.9); }
  const A = STORY.acts[story.act];
  const text = reason === 'busted'
    ? 'The police box you in. From the back of the squad car you hear the radio: “Inmate 4471 in custody. Lady Ashford has been informed.” Next stop: Cell Block D.'
    : reason === 'wrecked'
      ? 'Your vehicle gives up. By the time the smoke clears, blue lights surround you. Your evidence goes into a police bag, and you go back to cell 4471.'
      : 'You ran out of time. The fence has the necklace, and Cell Block D has its inmate back.';
  showCard(`
    <div class="eyebrow">The Necklace Job · ${A.title} · Ending C of 3</div>
    <h2>${reason === 'busted' ? 'Busted' : reason === 'wrecked' ? 'Wrecked' : 'Too late'}</h2>
    <p>${text}</p>
    <div class="actions"><button class="btn" data-action="retry-act">Try again <small class="desk-only">Enter</small></button><button class="btn ghost" data-action="menu">Main menu</button></div>`);
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
  if (state === 'menu' && !overlay.hidden && overlay.classList.contains('menu')) menuFraming(true);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
applyGfx();

let lastT = performance.now();
function frame(now){
  requestAnimationFrame(frame);
  const dt = Core.frameDt(now - lastT);
  if (state === 'play' && !document.hidden){
    const level = quality.level;
    Core.stepQuality(quality, now - lastT);
    if (quality.level !== level) applyGfx();
  }
  lastT = now;
  const paused = state === 'pause';
  if (look.on && state !== 'play') setLook(false);
  frameNo++;
  if (TILT.can) updateTilt();
  if (!paused) clock += dt;

  if (state === 'play'){
    updateCar(dt);
    if (state === 'play') updateSkids();
    if (state === 'play') updateRails(dt);
    if (state === 'play') updatePolice(dt);
    if (state === 'play'){
      timeLeft -= dt;
      updatePickups(dt, true);
      if (story && state === 'play') updateStory(dt);
      if (state === 'play' && timeLeft <= 0){ timeLeft = 0; gameOver('time'); }
    }
    chaseCam(dt);
  } else if (garage.on && !paused){
    updateGarage(dt);
  } else if (finale.on && !paused){
    updateFinale(dt);
  } else if (!paused){
    // in the showroom the vehicle still follows the slope of the street it stands on (each one has its own wheelbase)
    if (state !== 'menu') coast(dt); else settleCar(dt);
    updatePickups(dt, false);
    if (state !== 'menu') updatePolice(dt);
    if (state === 'menu') orbitCam(dt); else chaseCam(dt);
  }
  if (!paused){
    if (!garage.on){ updateSignals(); updateNpcs(dt); stepParked(dt); }
    if (state !== 'menu' && !garage.on) updateHeli(dt);
    updateSmoke(dt); updateSparks(dt);
    updateNitroFx();
  }
  updatePoliceVisuals();
  updateShowroom();
  updateBoundary(dt);
  applyCarMesh(dt);
  if (garage.on && !paused) garageRide(dt);

  sky.position.copy(camera.position);
  // the shadow box travels with the player, in height too, or high ground would fall out of it and lose its shadows
  garageLight();
  const [sx, sy, sz] = Core.snapShadow(car.x, car.y, car.z, SUN_OFF, (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x);
  sun.position.set(sx + SUN_OFF[0], sy + SUN_OFF[1], sz + SUN_OFF[2]);
  sun.target.position.set(sx, sy, sz);

  updateEngine(dt);
  updateRadio();
  updateHud(dt);
  if (state !== 'menu' && !garage.on) drawRadar();
  updateGuide();
  updateKitGuide();
  updateRoute();
  GAR.top.visible = garage.on || CITY.group.visible;
  if (composer && GFX[gfx].post) composer.render(); else renderer.render(scene, camera);
  if (garage.on) walker.drawHands(scene.environment);
}

setStation(readStore('shard-heist-radio'), false);
buildCity();
laySlopes(CITY.group, 'city');
tuneEnv(scene);
renderPreviews();
setVehicle(sel.veh);
setMode('city');
placeRun();
resetCar();
resetNpcs();
renderChips();
showMenu();
warmUp();
// the glare of the headlights (shown when the address ends in #arrive) clears once the garage has been drawn
const clearGlare = () => { const glare = $('arrive'); if (glare) requestAnimationFrame(() => requestAnimationFrame(() => glare.classList.add('gone'))); };
// from room 1 with a valid escape time: straight into the garage
if (!HEIST_WAIT){ const h = heistArrival(); if (h) heistBegin(h); clearGlare(); }
// a saved online login is checked only now: while the world is being built the page is too busy to answer in time
if (net && net.user) setTimeout(afterSignIn, 0);
if (!HEIST_WAIT) requestAnimationFrame(frame);
else {
  // ### Loaded ahead by the heist page: prepared and standing still. When that page says go (only its message, from our own
  // ### address, counts, and only once), the escape time is read, the player arrives and the picture starts to move.
  heistPrepare();
  addEventListener('message', e => {
    if (e.origin !== location.origin || e.source !== parent || !e.data || e.data.shardHeist !== 'go' || heist.went) return;
    heist.went = true;
    const h = Core.parseHeist(readStore(Core.HEIST.key), Date.now());
    if (h) heistArrive(h, true); else backToMenu();
    clearGlare();
    requestAnimationFrame(frame);
  });
  parent.postMessage({ shardHeist: 'ready' }, location.origin);
}
})();
