// Shard Heist core: the rules of the game as pure functions, with no DOM, no three.js and no randomness of their own.
// ### game.js loads this file as window.ShardCore and the Node tests load it with require(). Everything the player can do
// ### that changes the score, the damage, the bust meter, the story or the menu selection is decided here, so it can be
// ### tested without a browser. Each function takes plain values and returns plain values.
(function (root, factory){
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShardCore = factory();
})(typeof self !== 'undefined' ? self : this, function (){
  'use strict';

  // ---------- Tuning tables ----------
  // ### MODES holds one entry per map (city, highway, countryside): top speed and police speed in m/s, time limit in seconds,
  // ### speedometer range, radar range, number of shards and repair kits. VEH holds the three getaway vehicles: speed,
  // ### acceleration and handling multipliers, damage taken (dmg), ramming power (ram) and the collision circles (samples, r).
  // ### Change a number here and the whole game, including the stat bars in the menu, follows it.
  const MODES = {
    city: { key: 'city', title: 'Lisbon · Baixa', eyebrow: 'Baixa · Lisbon', mission: 'Star Shards', max: 34, police: 33, time: 180, gaugeMax: 160, redline: 140, radar: 70, shards: 8, kits: 3, store: 'shard-heist-city-best' },
    highway: { key: 'highway', title: 'Highway', eyebrow: 'Highway', mission: 'Bonus Shards', max: 55.6, police: 52, time: 100, gaugeMax: 260, redline: 230, radar: 110, shards: 12, kits: 2, bonus: 4, store: 'shard-heist-highway-best', linear: true },
    country: { key: 'country', title: 'Countryside', eyebrow: 'Country roads', mission: 'Bonus Shards', max: 44, police: 41, time: 150, gaugeMax: 220, redline: 190, radar: 90, shards: 10, kits: 3, bonus: 4, store: 'shard-heist-country-best', linear: true }
  };
  const VEH = {
    car: { key: 'car', name: 'Car', cls: 'Muscle coupe', blurb: 'A fastback V8 coupe. Balanced speed and grip, average toughness.', speed: 1.0, accel: 1.0, handling: 1.0, dmg: 1.0, ram: 1.0, samples: [-1.1, 1.1], r: 1.2, cam: [10, 4.4], show: [7.5, 2.0, 0.7], light: 2.45, lightY: 0.7 },
    bike: { key: 'bike', name: 'Motorcycle', cls: 'Superbike', blurb: 'Fastest and most agile. Slips through gaps, but barely nudges a police car.', speed: 1.12, accel: 1.3, handling: 1.4, dmg: 1.0, ram: 0.4, samples: [-0.45, 0.45], r: 0.8, cam: [8.5, 3.7], show: [4.6, 1.6, 0.8], light: 1.0, lightY: 0.8 },
    truck: { key: 'truck', name: 'Truck', cls: 'Tractor unit', blurb: 'A high-roof tractor unit. Slow, but built like a tank and shoves police cars aside.', speed: 0.78, accel: 0.7, handling: 0.72, dmg: 0.55, ram: 2.4, samples: [-2.1, 0, 2.0], r: 1.4, cam: [12.5, 5.8], show: [11, 3.4, 1.9], light: 3.35, lightY: 0.92 }
  };
  const REV_SPEED = -11, REPAIR_AMOUNT = 40, MAX_DT = 0.05, STORY_ACTS = 3;
  const KEY_MAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'brake' };

  // ---------- The city map: Lisbon's Baixa ----------
  // ### The Baixa was rebuilt as a street grid after the 1755 earthquake, so it fits the game's 7 x 7 grid of roads. The names
  // ### are real and in their real order (ns: west to east, ew: north to south), checked against OpenStreetMap; the Baixa has
  // ### a few more streets than the grid has lines, so some are left out. x grows to the east, z grows to the south (the river).
  const BAIXA = Object.freeze({
    pitch: 48, halfRoad: 7,
    ns: Object.freeze(['Rua do Crucifixo', 'Rua Áurea', 'Rua dos Sapateiros', 'Rua Augusta', 'Rua dos Correeiros', 'Rua da Prata', 'Rua dos Fanqueiros']),
    ew: Object.freeze(['Rua de Santa Justa', 'Rua da Vitória', 'Rua de São Nicolau', 'Rua da Conceição', 'Rua do Comércio', 'Praça do Comércio', 'Avenida Infante Dom Henrique']),
    squares: Object.freeze([
      Object.freeze({ name: 'Praça do Comércio', x0: -41, x1: 41, z0: 103, z1: 137 }),
      Object.freeze({ name: 'Rossio', x0: -41, x1: -7, z0: -137, z1: -103 }),
      Object.freeze({ name: 'Praça da Figueira', x0: 7, x1: 41, z0: -137, z1: -103 })
    ])
  });
  // ### Trams never leave their rails: a clockwise loop through Rua da Conceição, Rua da Prata, the north side of the Praça do
  // ### Comércio and Rua Áurea. tramNext decides at each crossing: straight on while the next crossing is on the loop, else turn right.
  const TRAM_LOOP = Object.freeze({ x0: -96, x1: 96, z0: 0, z1: 96, lane: 3.5 });
  function tramNext(x, z, dx, dz){
    const T = TRAM_LOOP, nx = x + dx * BAIXA.pitch, nz = z + dz * BAIXA.pitch;
    return nx >= T.x0 && nx <= T.x1 && nz >= T.z0 && nz <= T.z1 ? 's' : 'r';
  }
  // The street or square at a point, or null on a pavement. On a crossing, the street you are driving along wins.
  function streetAt(x, z, heading){
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const square = BAIXA.squares.find(q => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1);
    if (square) return square.name;
    const kx = Math.round(x / BAIXA.pitch), kz = Math.round(z / BAIXA.pitch);
    const onNs = Math.abs(kx) <= 3 && Math.abs(x - kx * BAIXA.pitch) <= BAIXA.halfRoad && Math.abs(z) <= 3 * BAIXA.pitch + BAIXA.halfRoad;
    const onEw = Math.abs(kz) <= 3 && Math.abs(z - kz * BAIXA.pitch) <= BAIXA.halfRoad && Math.abs(x) <= 3 * BAIXA.pitch + BAIXA.halfRoad;
    if (onNs && onEw) return Math.abs(Math.sin(heading || 0)) > Math.abs(Math.cos(heading || 0)) ? BAIXA.ew[kz + 3] : BAIXA.ns[kx + 3];
    return onNs ? BAIXA.ns[kx + 3] : onEw ? BAIXA.ew[kz + 3] : null;
  }

  // ---------- Small helpers ----------
  // ### own() only accepts real table keys, so "constructor" or "__proto__" from tampered storage can never pick a mode.
  const own = (obj, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k);
  const isMode = k => own(MODES, k);
  const isVeh = k => own(VEH, k);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrapAngle = a => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
  function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function shuffle(arr, rnd){ for (let i = arr.length - 1; i > 0; i--){ const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  function fmtTime(s){ s = Number.isFinite(s) ? Math.max(0, Math.ceil(s)) : 0; return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function fmtTimeExact(s){ s = Number.isFinite(s) ? Math.max(0, s) : 0; const m = Math.floor(s / 60); return m + ':' + (s - m * 60).toFixed(1).padStart(4, '0'); }
  // Frame time in seconds, never negative (the first rAF stamp can be older than performance.now) and capped at 50 ms
  const frameDt = ms => Number.isFinite(ms) ? clamp(ms / 1000, 0, MAX_DT) : 0;

  // ---------- Stored data (input validation) ----------
  // ### localStorage belongs to the player and can hold anything. Every value read back is checked; bad values fall back
  // ### to the defaults instead of breaking the game.
  function parsePick(raw){
    const sel = { mode: 'city', veh: 'car' };
    if (typeof raw !== 'string' || raw.length > 200) return sel;
    let s; try { s = JSON.parse(raw); } catch (e) { return sel; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return sel;
    if (isMode(s.mode)) sel.mode = s.mode;
    if (isVeh(s.veh)) sel.veh = s.veh;
    return sel;
  }
  // A best time is a finite number of seconds within the longest possible run
  function parseBest(raw){
    if (typeof raw !== 'string' || !/^\d+(\.\d+)?$/.test(raw.trim())) return null;
    const v = parseFloat(raw);
    return v > 0 && v < 3600 ? v : null;
  }
  // Applies a menu pick only when both the field and the value are known
  function applyPick(sel, field, val){
    if (field === 'mode' && isMode(val)){ sel.mode = val; return true; }
    if (field === 'veh' && isVeh(val)){ sel.veh = val; return true; }
    return false;
  }

  // ---------- Menu actions (accepted and rejected) ----------
  // ### Every button on a card carries a data-action. actionAllowed decides whether it may run in the current state, so a
  // ### stale click or an Enter press on the wrong card is ignored instead of reaching a half-finished game.
  function actionAllowed(action, ctx){
    const state = ctx && ctx.state, story = ctx && ctx.story;
    if (state === 'play') return false;
    switch (action){
      case 'go': return state === 'menu';
      case 'story': return state === 'menu' || state === 'done';
      case 'again': return state === 'done' || state === 'over' || state === 'pause';
      case 'resume': return state === 'pause';
      case 'menu': return state === 'menu' || state === 'pause' || state === 'done' || state === 'over';
      case 'act': return !!story && (state === 'menu' || state === 'done');
      case 'next-act': return !!story && state === 'done' && story.act + 1 < STORY_ACTS;
      case 'retry-act': return !!story && (state === 'over' || state === 'pause');
      default: return false;
    }
  }

  // ---------- Vehicle stats for the menu ----------
  // ### Bars are each value relative to the best vehicle in that stat (1-5). zeroTo80 integrates the same throttle formula
  // ### as stepSpeed, so the number on the card is what the car really does.
  function vehStats(v){
    const top = f => Math.max(...Object.values(VEH).map(f));
    const bar = (val, best) => clamp(Math.round(val / best * 5), 1, 5);
    return [bar(v.speed, top(o => o.speed)), bar(v.accel, top(o => o.accel)), bar(v.handling, top(o => o.handling)), bar(1 / v.dmg, top(o => 1 / o.dmg)), bar(v.ram, top(o => o.ram))];
  }
  function zeroTo80(v, m){
    const maxS = m.max * v.speed; let sp = 0, t = 0;
    while (sp < 22.2 && t < 20){ sp += 24 * v.accel * (1 - Math.pow(sp / maxS, 1.6) * 0.8) * 0.005; t += 0.005; }
    return t;
  }

  // ---------- Driving ----------
  // ### Top speed falls by up to 40 % with damage and by 45 % off-road. stepSpeed applies throttle, brake/reverse, coasting
  // ### drag and the handbrake for one frame; gas and brake held together both apply, which is how a real pedal pair works.
  // ### The throttle can never push past the top speed, so the km/h on the menu card is the real maximum.
  const topSpeed = (m, v, damage, offRoad) => m.max * v.speed * (1 - 0.4 * clamp(damage, 0, 100) / 100) * (offRoad ? 0.55 : 1);
  function stepSpeed(speed, keys, dt, maxNow, v){
    dt = clamp(dt, 0, MAX_DT);
    // Throttle stops at the top speed; above it (just after taking damage) the pull-down below takes over
    if (keys.up){
      if (speed < 0) speed += 40 * dt;
      else speed = Math.max(speed, Math.min(maxNow, speed + 24 * v.accel * (1 - Math.pow(speed / maxNow, 1.6) * 0.8) * dt));
    }
    if (keys.down) speed -= (speed > 0.5 ? 46 * (v.key === 'truck' ? 0.75 : 1) : 16) * dt;
    if (!keys.up && !keys.down){ const d = Math.min(Math.abs(speed), (6 + Math.abs(speed) * 0.08) * dt); speed -= Math.sign(speed) * d; }
    if (keys.brake) speed *= Math.max(0, 1 - 3 * dt);
    if (speed > maxNow) speed += (maxNow - speed) * Math.min(1, 3 * dt);
    if (speed < REV_SPEED) speed = REV_SPEED;
    return speed;
  }

  // ### Circle against circle (c.t === 'c') or circle against box. Returns the push-out normal and depth, or null.
  function collidePoint(px, pz, r, c){
    if (c.t === 'c'){
      const dx = px - c.x, dz = pz - c.z, rr = c.r + r;
      if (Math.abs(dx) > rr || Math.abs(dz) > rr) return null;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) return null;
      const d = Math.sqrt(d2) || 0.001; return [dx / d, dz / d, rr - d];
    }
    if (px < c.x0 - r || px > c.x1 + r || pz < c.z0 - r || pz > c.z1 + r) return null;
    const qx = clamp(px, c.x0, c.x1), qz = clamp(pz, c.z0, c.z1);
    const dx = px - qx, dz = pz - qz, d2 = dx * dx + dz * dz;
    if (d2 > r * r) return null;
    if (d2 > 1e-6){ const d = Math.sqrt(d2); return [dx / d, dz / d, r - d]; }
    const l = px - c.x0, rr = c.x1 - px, t = pz - c.z0, b = c.z1 - pz, m = Math.min(l, rr, t, b);
    if (m === l) return [-1, 0, l + r];
    if (m === rr) return [1, 0, rr + r];
    if (m === t) return [0, -1, t + r];
    return [0, 1, b + r];
  }

  // ---------- Damage ----------
  // ### Impacts under 3 m/s are free; above that damage grows linearly and is scaled by the vehicle (the truck takes 55 %).
  const crashDamage = (impact, v) => Number.isFinite(impact) ? Math.max(0, (impact - 3) * 1.6 * v.dmg) : 0;
  const addDamage = (damage, add) => clamp(damage + Math.max(0, add), 0, 100);
  const repairDamage = damage => Math.max(0, damage - REPAIR_AMOUNT);
  const isWrecked = damage => damage >= 100;

  // ---------- Police pressure ----------
  // ### Heat (1-3) sets how many police cars chase you: in the city it rises every three shards, on the open roads with
  // ### distance. The bust meter fills while a cop is within 9 m and you are almost stopped, and drains otherwise.
  function heatLevel(modeKey, collected, distance){
    if (modeKey === 'city') return 1 + Math.min(2, Math.floor(Math.max(0, collected) / 3));
    return 1 + (distance > 1200 ? 1 : 0) + (distance > 2500 ? 1 : 0);
  }
  function bustStep(bust, nearestCop, speed, dt){
    dt = clamp(dt, 0, MAX_DT);
    bust = nearestCop < 9 && Math.abs(speed) < 4.5 ? bust + dt / 2.2 : Math.max(0, bust - dt / 3);
    if (bust >= 1) return { bust: 1, busted: true };
    return { bust, busted: false };
  }

  // ---------- Map boundary ----------
  // ### Distance from the player to the nearest map edge (rect = [x0, x1, z0, z1]); on the highway only the two ends count.
  function edgeDistance(rect, x, z, pad, zOnly){
    const [x0, x1, z0, z1] = rect;
    if (zOnly) return Math.min(z - z0, z1 - z) - pad;
    return Math.min(x - x0, x1 - x, z - z0, z1 - z) - pad;
  }

  // ---------- Scoring ----------
  // ### Drive time on the open-road maps adds back the bonus seconds the shards gave you, so shards never make a run look
  // ### slower. Stars come from the time; heavy damage (over 50 %) costs one star but never the last one.
  function driveTime(modeKey, m, timeLeft, collected){
    return modeKey === 'city' ? m.time - timeLeft : m.time + collected * (m.bonus || 0) - timeLeft;
  }
  function runStars(modeKey, m, timeLeft, used, damage){
    let stars;
    if (modeKey === 'city'){ const frac = timeLeft / m.time; stars = frac > 0.4 ? 3 : frac > 0.2 ? 2 : 1; }
    else if (modeKey === 'country') stars = used < 115 ? 3 : used < 135 ? 2 : 1;
    else stars = used < 88 ? 3 : used < 105 ? 2 : 1;
    if (damage > 50) stars = Math.max(1, stars - 1);
    return stars;
  }
  const isNewBest = (prev, used) => Number.isFinite(used) && used > 0 && (!prev || used < prev);

  // ---------- Story mode rules ----------
  // ### The Necklace Job: three acts on the three maps. The optional letter (act 1) decides Ending A or B; being busted,
  // ### wrecked or out of time is Ending C and lets you retry the act. Retrying restores the letter to what you had when
  // ### the act began, so a letter found in a failed attempt does not count.
  const newStory = () => ({ act: 0, letter: false, letterAtStart: false, clasp: false, times: [], cops: 0, clock: 0, radioIdx: 0 });
  function beginAct(story, i){
    if (!story || !Number.isInteger(i) || i < 0 || i >= STORY_ACTS) return false;
    story.act = i; story.clock = 0; story.radioIdx = 0; story.letterAtStart = story.letter; story.tollHint = false;
    if (i === 1) story.clasp = false;
    return true;
  }
  function retryAct(story){ story.letter = story.letterAtStart; return story.act; }
  // The toll at the end of act 2 only opens with the clasp; every other finish line is always open
  const finishOpen = story => !story || story.act !== 1 || story.clasp;
  const storyEnding = story => story.letter ? 'A' : 'B';
  // Radio lines are [seconds, text, tone]; returns the lines that are due and the next index
  function dueRadio(lines, idx, clock){
    const due = [];
    while (idx < lines.length && clock >= lines[idx][0]) due.push(lines[idx++]);
    return { due, idx };
  }

  // ---------- Engine sound ----------
  // ### ENGINES describes three real engine layouts: a cross-plane V8, an inline-four superbike and an inline-six truck diesel.
  // ### engineLoop models what makes each one sound as it does. One pressure pulse leaves the exhaust valve per firing, and
  // ### firing frequency = rpm / 60 x cylinders / 2. The pulses travel through a pipe with a reflection at its open end and a
  // ### muffler, whose resonances stay at the same frequencies whatever the rpm. Under load the pulses are strong; on overrun
  // ### they are weak and irregular. The V8's two banks fire unevenly (L R R L R L L R) into pipes of different length: its burble.
  // ### gears are the speeds in m/s at which each gear reaches max rpm.
  const ENGINES = {
    car: { layout: 'V8, cross-plane', cyl: 8, idle: 750, max: 6800, launch: 2600, gears: [12, 20, 29, 38, 48, 58], down: 0.62, shift: 0.16, rev: [9, 4, 14],
      refs: [800, 1500, 2700, 4300, 6300], loop: 1.5, banks: [0, 1, 1, 0, 1, 0, 0, 1], pipes: [0.0079, 0.0094], lag: 0.0016, reflect: -0.72, damp: 0.55,
      pulse: 0.05, pulseMax: 0.0042, rough: 0.2, spread: 0.2, jitter: 0.1, tick: 0.012, knock: 0,
      body: [[95, 1.1, 1.3], [240, 1.3, 0.8], [620, 1.6, 0.3]], direct: 0.1, lowpass: 3600, intake: [420, 1.6, 0.5], off: 0.42, drive: 1.6,
      pops: 620, turbo: 0, air: false, whine: [24, 0.012], road: 1, vol: 1 },
    bike: { layout: 'Inline four', cyl: 4, idle: 1300, max: 13000, launch: 5200, gears: [20, 30, 39, 48, 57, 66], down: 0.6, shift: 0.07, rev: [16, 7, 30],
      refs: [1400, 3000, 5500, 8500, 12000], loop: 1.2, banks: [0, 0, 0, 0], pipes: [0.0041], lag: 0, reflect: -0.62, damp: 0.75,
      pulse: 0.045, pulseMax: 0.0022, rough: 0.28, spread: 0.05, jitter: 0.05, tick: 0.03, knock: 0,
      body: [[310, 1.2, 0.9], [760, 1.5, 0.8], [1700, 1.8, 0.45]], direct: 0.22, lowpass: 7000, intake: [1050, 2.2, 0.9], off: 0.38, drive: 1.3,
      pops: 1300, turbo: 0, air: false, whine: [46, 0.007], road: 0.55, vol: 0.85 },
    truck: { layout: 'Inline-six diesel', cyl: 6, idle: 600, max: 2300, launch: 1100, gears: [6, 9, 13, 18, 24, 31, 38, 45], down: 0.72, shift: 0.42, rev: [4, 2.5, 7],
      refs: [650, 1000, 1400, 1800, 2250], loop: 1.8, banks: [0, 0, 0, 0, 0, 0], pipes: [0.0148], lag: 0, reflect: -0.8, damp: 0.42,
      pulse: 0.06, pulseMax: 0.0062, rough: 0.12, spread: 0.08, jitter: 0.05, tick: 0, knock: 0.2,
      body: [[62, 1.0, 1.4], [150, 1.2, 1.0], [370, 1.4, 0.4]], direct: 0.06, lowpass: 2400, intake: [240, 1.2, 0.35], off: 0.5, drive: 1.9,
      pops: 0, turbo: 0.03, air: true, whine: [15, 0.016], road: 1.5, vol: 1.1 }
  };
  const ENGINE_SR = 32000;

  // The gear after this frame: up at the top of a gear under power, down when the lower gear has room again, first in reverse.
  function gearFor(E, gear, speed, throttle){
    const sp = Math.abs(speed), G = E.gears;
    if (speed < -0.3) return 1;
    if (gear < G.length && throttle && sp > G[gear - 1] * 0.97) return gear + 1;
    if (gear > 1 && sp < G[gear - 2] * E.down) return gear - 1;
    return gear;
  }
  // The rpm the road speed asks for. Under power at low speed the clutch slips, so the engine holds its launch rpm.
  function engineTarget(E, gear, speed, throttle){
    const range = speed < 0 ? Math.max(E.gears[0], Math.abs(REV_SPEED) * 1.15) : E.gears[gear - 1];
    const wheel = E.max * Math.abs(speed) / range;
    return clamp(Math.max(wheel, throttle ? E.launch : E.idle), E.idle, E.max);
  }
  // A two-pole resonance with its own state, one sample at a time
  function resonance(f, Q, sr){
    const w = 2 * Math.PI * f / sr, alpha = Math.sin(w) / (2 * Q), a0 = 1 + alpha, c = Math.cos(w);
    const b = alpha / a0, a1 = -2 * c / a0, a2 = (1 - alpha) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    return x => { const y = b * x - b * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
  }
  // One seamless loop of whole engine cycles at one rpm, on load or on overrun. Everything wraps round the end of the
  // buffer, and the filters run over it twice so their state at the end matches the start.
  function engineLoop(E, rpm, onLoad, sr, seed){
    const rnd = mulberry32(seed), cycle = 120 / rpm, cycles = Math.max(2, Math.ceil(E.loop / cycle)), n = Math.round(cycle * cycles * sr);
    const flow = E.pipes.map(() => new Float32Array(n)), mech = new Float32Array(n), out = new Float32Array(n);
    const low = clamp(1 - (rpm - E.idle) / (E.max - E.idle) * 2, 0, 1); // engines run less evenly at low rpm
    const trim = []; for (let i = 0; i < E.cyl; i++) trim.push((rnd() - 0.5) * 2 * E.spread * (0.4 + 0.6 * low));
    const tau = Math.min(E.pulse * cycle, E.pulseMax), L = Math.round(tau * 9 * sr), step = 1 / (tau * sr);
    for (let c = 0; c < cycles * E.cyl; c++){
      const ci = c % E.cyl, irregular = E.jitter * (0.5 + low) * (onLoad ? 1 : 2.5);
      const amp = (onLoad ? 1 : E.off) * Math.max(0, 1 + trim[ci] + (rnd() - 0.5) * 2 * irregular);
      const s0 = Math.round(((c / E.cyl + (rnd() - 0.5) * 0.004 * (0.3 + low)) * cycle + E.banks[ci] * E.lag * (0.25 + 0.75 * low)) * sr), dest = flow[E.banks[ci] % flow.length];
      const rough = E.rough * (onLoad ? 1 : 1.5);
      let turb = 0;
      for (let k = 0; k < L; k++){
        turb += 0.12 * (rnd() * 2 - 1 - turb);
        const x = k * step, env = x * Math.exp(1 - x), v = env * amp * (1 + turb * rough * 3);
        dest[((s0 + k) % n + n) % n] += v;
      }
      // what the engine block radiates directly: diesel knock, and the valve train of a petrol engine
      const knock = E.knock * (onLoad ? 1 : 0.45) * (0.6 + 0.8 * rnd()), tick = E.tick * (0.6 + 0.8 * rnd());
      const M = Math.round(0.006 * sr);
      for (let k = 0; k < M; k++){
        const t = k / sr;
        let v = 0;
        if (knock) v += knock * Math.exp(-t * 750) * (Math.sin(2 * Math.PI * 1650 * t) + 0.7 * Math.sin(2 * Math.PI * 2750 * t) + 0.5 * (rnd() * 2 - 1));
        if (tick) v += tick * Math.exp(-t * 1400) * Math.sin(2 * Math.PI * 3300 * t);
        mech[((s0 + k) % n + n) % n] += v;
      }
    }
    const pipes = E.pipes.map(d => ({ ring: new Float32Array(Math.max(1, Math.round(d * sr))), at: 0, lp: 0 }));
    const body = E.body.map(([f, Q, g]) => ({ f: resonance(f, Q, sr), g }));
    const intake = resonance(E.intake[0], E.intake[1], sr), intakeG = onLoad ? E.intake[2] * (0.35 + 0.65 * rpm / E.max) : 0;
    const smooth = 1 - Math.exp(-2 * Math.PI * E.lowpass / sr);
    let prev = 0, lp = 0, lp2 = 0;
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++){
      let x = 0;
      for (let j = 0; j < pipes.length; j++){
        const P = pipes[j], y = flow[j][i] + E.reflect * P.lp;
        P.lp += E.damp * (P.ring[P.at] - P.lp);
        P.ring[P.at] = y; P.at = (P.at + 1) % P.ring.length;
        x += y;
      }
      const d = x - prev; prev = x; // sound is the rate of change of the flow leaving the pipe
      let v = d * E.direct;
      for (let j = 0; j < body.length; j++) v += body[j].f(d) * body[j].g;
      v += intake(d) * intakeG;
      lp += smooth * (v - lp); lp2 += smooth * (lp - lp2);
      if (pass) out[i] = lp2 + mech[i] * 0.02;
    }
    let mean = 0; for (let i = 0; i < n; i++) mean += out[i] / n;
    for (let i = 0; i < n; i++) out[i] -= mean;
    return out;
  }
  // All loops of one engine, levelled together: louder with rpm, quieter on overrun, softly saturated, with one peak for all.
  function engineLoops(E, sr, seed){
    const level = (d, target) => {
      let e = 0; for (let i = 0; i < d.length; i++) e += d[i] * d[i];
      const g = target / Math.sqrt(e / d.length || 1);
      for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * g * E.drive) / E.drive;
    };
    const loops = E.refs.map((rpm, i) => {
      const on = engineLoop(E, rpm, true, sr, seed + i * 2), off = engineLoop(E, rpm, false, sr, seed + i * 2 + 1), target = 0.1 + 0.22 * Math.pow(rpm / E.max, 0.7);
      level(on, target); level(off, target * E.off);
      return { rpm, on, off };
    });
    let peak = 0;
    for (const l of loops) for (const d of [l.on, l.off]) for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    for (const l of loops) for (const d of [l.on, l.off]) for (let i = 0; i < d.length; i++) d[i] *= 0.95 / peak;
    return loops;
  }

  return Object.freeze({
    MODES, VEH, REV_SPEED, REPAIR_AMOUNT, MAX_DT, STORY_ACTS, KEY_MAP, BAIXA, streetAt, TRAM_LOOP, tramNext,
    isMode, isVeh, clamp, wrapAngle, mulberry32, shuffle, fmtTime, fmtTimeExact, frameDt,
    parsePick, parseBest, applyPick, actionAllowed,
    vehStats, zeroTo80, topSpeed, stepSpeed, collidePoint,
    crashDamage, addDamage, repairDamage, isWrecked,
    heatLevel, bustStep, edgeDistance,
    driveTime, runStars, isNewBest,
    newStory, beginAct, retryAct, finishOpen, storyEnding, dueRadio,
    ENGINES, ENGINE_SR, gearFor, engineTarget, engineLoop, engineLoops
  });
});
