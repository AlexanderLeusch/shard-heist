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
    city: { key: 'city', title: 'City traffic', eyebrow: 'Downtown', mission: 'Star Shards', max: 34, police: 33, time: 180, gaugeMax: 160, redline: 140, radar: 70, shards: 8, kits: 3, store: 'shard-heist-city-best' },
    highway: { key: 'highway', title: 'Highway', eyebrow: 'Highway', mission: 'Bonus Shards', max: 55.6, police: 52, time: 100, gaugeMax: 260, redline: 230, radar: 110, shards: 12, kits: 2, bonus: 4, store: 'shard-heist-highway-best', linear: true },
    country: { key: 'country', title: 'Countryside', eyebrow: 'Country roads', mission: 'Bonus Shards', max: 44, police: 41, time: 150, gaugeMax: 220, redline: 190, radar: 90, shards: 10, kits: 3, bonus: 4, store: 'shard-heist-country-best', linear: true }
  };
  const VEH = {
    car: { key: 'car', name: 'Car', cls: 'Muscle coupe', blurb: 'A fastback V8 coupe. Balanced speed and grip, average toughness.', speed: 1.0, accel: 1.0, handling: 1.0, dmg: 1.0, ram: 1.0, samples: [-1.1, 1.1], r: 1.2, cam: [10, 4.4], show: [7.5, 2.0, 0.7], pitch: 1.0, wave: 'sawtooth', light: 2.45, lightY: 0.7 },
    bike: { key: 'bike', name: 'Motorcycle', cls: 'Superbike', blurb: 'Fastest and most agile. Slips through gaps, but barely nudges a police car.', speed: 1.12, accel: 1.3, handling: 1.4, dmg: 1.0, ram: 0.4, samples: [-0.45, 0.45], r: 0.8, cam: [8.5, 3.7], show: [4.6, 1.6, 0.8], pitch: 1.55, wave: 'sawtooth', light: 1.0, lightY: 0.93 },
    truck: { key: 'truck', name: 'Truck', cls: 'Tractor unit', blurb: 'A high-roof tractor unit. Slow, but built like a tank and shoves police cars aside.', speed: 0.78, accel: 0.7, handling: 0.72, dmg: 0.55, ram: 2.4, samples: [-2.1, 0, 2.0], r: 1.4, cam: [12.5, 5.8], show: [11, 3.4, 1.9], pitch: 0.58, wave: 'square', light: 3.35, lightY: 0.92 }
  };
  const REV_SPEED = -11, REPAIR_AMOUNT = 40, MAX_DT = 0.05, STORY_ACTS = 3;
  const KEY_MAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'brake' };

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

  return Object.freeze({
    MODES, VEH, REV_SPEED, REPAIR_AMOUNT, MAX_DT, STORY_ACTS, KEY_MAP,
    isMode, isVeh, clamp, wrapAngle, mulberry32, shuffle, fmtTime, fmtTimeExact, frameDt,
    parsePick, parseBest, applyPick, actionAllowed,
    vehStats, zeroTo80, topSpeed, stepSpeed, collidePoint,
    crashDamage, addDamage, repairDamage, isWrecked,
    heatLevel, bustStep, edgeDistance,
    driveTime, runStars, isNewBest,
    newStory, beginAct, retryAct, finishOpen, storyEnding, dueRadio
  });
});
