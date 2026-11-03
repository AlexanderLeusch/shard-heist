// Game rules: driving, damage, police, boundary and scoring (src/core.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/core.js');
const { MODES, VEH } = Core;

const idle = { up: false, down: false, left: false, right: false, brake: false };
// Drives for `secs` with the given pedals and returns the final speed
function drive(speed, keys, secs, m = MODES.city, v = VEH.car, damage = 0){
  const max = Core.topSpeed(m, v, damage, false);
  for (let t = 0; t < secs; t += 1 / 60) speed = Core.stepSpeed(speed, keys, 1 / 60, max, v);
  return speed;
}

test('tables: every map and vehicle has the fields the game reads', () => {
  for (const m of Object.values(MODES)){
    for (const f of ['max', 'police', 'time', 'gaugeMax', 'redline', 'radar', 'shards', 'kits', 'store']) assert.ok(m[f] !== undefined, `${m.key}.${f}`);
    assert.ok(m.police < m.max, `${m.key}: police must be slower than the top speed so escape is possible`);
    assert.ok(m.redline < m.gaugeMax, `${m.key}: redline inside the gauge`);
    if (m.linear) assert.ok(m.bonus > 0, `${m.key}: open-road maps give bonus seconds`);
  }
  for (const v of Object.values(VEH)){
    for (const f of ['speed', 'accel', 'handling', 'dmg', 'ram', 'r']) assert.ok(v[f] > 0, `${v.key}.${f}`);
    assert.ok(Array.isArray(v.samples) && v.samples.length > 0);
  }
});

test('menu stats match the brief: bike fastest and most agile, truck toughest and slowest', () => {
  const s = k => Core.vehStats(VEH[k]);
  const [car, bike, truck] = [s('car'), s('bike'), s('truck')];
  for (const st of [car, bike, truck]) st.forEach(x => assert.ok(Number.isInteger(x) && x >= 1 && x <= 5));
  assert.equal(bike[0], 5); assert.equal(bike[2], 5);
  assert.equal(truck[3], 5); assert.equal(truck[4], 5);
  assert.ok(truck[0] < car[0] && car[0] < bike[0], 'top speed: truck < car < bike');
  assert.ok(Core.zeroTo80(VEH.bike, MODES.city) < Core.zeroTo80(VEH.car, MODES.city));
  assert.ok(Core.zeroTo80(VEH.car, MODES.city) < Core.zeroTo80(VEH.truck, MODES.city));
});

test('0-80 km/h on the menu card equals what the physics really does', () => {
  for (const k of Object.keys(VEH)){
    const v = VEH[k], m = MODES.highway, max = Core.topSpeed(m, v, 0, false);
    let sp = 0, t = 0;
    while (sp < 22.2 && t < 20){ sp = Core.stepSpeed(sp, { ...idle, up: true }, 0.005, max, v); t += 0.005; }
    assert.ok(Math.abs(t - Core.zeroTo80(v, m)) < 0.25, `${k}: physics ${t.toFixed(2)} s vs card ${Core.zeroTo80(v, m).toFixed(2)} s`);
  }
});

test('throttle reaches but never exceeds the top speed of the map', () => {
  for (const mk of Object.keys(MODES)) for (const vk of Object.keys(VEH)){
    const top = Core.topSpeed(MODES[mk], VEH[vk], 0, false);
    const sp = drive(0, { ...idle, up: true }, 40, MODES[mk], VEH[vk]);
    assert.ok(sp <= top + 1e-9 && sp > top * 0.9, `${mk}/${vk}: ${sp} of ${top}`);
  }
  // City top speed is about 122 km/h for the car, the highway allows 200 km/h
  assert.equal(Math.round(Core.topSpeed(MODES.city, VEH.car, 0, false) * 3.6), 122);
  assert.equal(Math.round(Core.topSpeed(MODES.highway, VEH.car, 0, false) * 3.6), 200);
});

test('damage and off-road driving lower the top speed', () => {
  const full = Core.topSpeed(MODES.city, VEH.car, 0, false);
  assert.equal(Core.topSpeed(MODES.city, VEH.car, 100, false), full * 0.6);
  assert.equal(Core.topSpeed(MODES.city, VEH.car, 0, true), full * 0.55);
  // out-of-range damage is clamped
  assert.equal(Core.topSpeed(MODES.city, VEH.car, 250, false), full * 0.6);
  assert.equal(Core.topSpeed(MODES.city, VEH.car, -40, false), full);
});

test('brake stops the car, then reverses, but never faster than the reverse limit', () => {
  const stopped = drive(30, { ...idle, down: true }, 0.9);
  assert.ok(stopped < 0.5);
  const rev = drive(0, { ...idle, down: true }, 10);
  assert.equal(rev, Core.REV_SPEED);
});

test('coasting slows down to exactly zero and does not flip direction', () => {
  assert.equal(drive(20, idle, 30), 0);
  assert.equal(drive(-8, idle, 30), 0);
});

test('edge case: gas and brake together, zero and huge frame times', () => {
  const both = drive(10, { ...idle, up: true, down: true }, 5);
  assert.ok(Number.isFinite(both) && both >= Core.REV_SPEED);
  assert.equal(Core.stepSpeed(12, { ...idle, up: true }, 0, 34, VEH.car), 12);
  // a 3 second hitch is treated like one 50 ms frame, so nothing jumps
  const capped = Core.stepSpeed(0, { ...idle, up: true }, 3, 34, VEH.car);
  assert.equal(capped, Core.stepSpeed(0, { ...idle, up: true }, 0.05, 34, VEH.car));
});

test('frame time is never negative and capped at 50 ms', () => {
  assert.equal(Core.frameDt(16), 0.016);
  assert.equal(Core.frameDt(-5), 0);
  assert.equal(Core.frameDt(4000), 0.05);
  assert.equal(Core.frameDt(NaN), 0);
});

test('collisions: circles and boxes push out along the right normal', () => {
  assert.equal(Core.collidePoint(10, 0, 1, { t: 'c', x: 0, z: 0, r: 1 }), null);
  const [nx, nz, pen] = Core.collidePoint(1.5, 0, 1, { t: 'c', x: 0, z: 0, r: 1 });
  assert.deepEqual([nx, nz], [1, 0]); assert.ok(Math.abs(pen - 0.5) < 1e-9);
  const box = { x0: 0, x1: 10, z0: 0, z1: 4 };
  assert.equal(Core.collidePoint(-3, 2, 1, box), null);
  assert.deepEqual(Core.collidePoint(-0.5, 2, 1, box), [-1, 0, 0.5]);
  // centre inside the box: pushed out through the nearest side (the top, 1 m away)
  assert.deepEqual(Core.collidePoint(5, 3, 1, box), [0, 1, 2]);
  // exactly on top of a circle's centre still returns a finite push
  const same = Core.collidePoint(0, 0, 1, { t: 'c', x: 0, z: 0, r: 1 });
  assert.ok(same.every(Number.isFinite));
});

test('damage: soft bumps are free, the truck takes 55 %, damage stays within 0-100', () => {
  assert.equal(Core.crashDamage(2.9, VEH.car), 0);
  assert.equal(Core.crashDamage(13, VEH.car), 16);
  assert.ok(Math.abs(Core.crashDamage(13, VEH.truck) - 16 * 0.55) < 1e-9);
  assert.equal(Core.crashDamage(NaN, VEH.car), 0);
  assert.equal(Core.addDamage(90, 30), 100);
  assert.equal(Core.addDamage(20, -50), 20, 'negative damage is rejected');
  assert.equal(Core.repairDamage(70), 30);
  assert.equal(Core.repairDamage(25), 0);
  assert.ok(Core.isWrecked(100)); assert.ok(!Core.isWrecked(99.9));
});

test('bust meter: fills only when slow next to a cop, drains otherwise, busts at 100 %', () => {
  let b = { bust: 0, busted: false };
  for (let i = 0; i < 60; i++) b = Core.bustStep(b.bust, 5, 2, 1 / 60);
  assert.ok(b.bust > 0.4 && b.bust < 0.5 && !b.busted);
  const fast = Core.bustStep(0.5, 5, 20, 0.05);
  assert.ok(fast.bust < 0.5, 'driving away drains the meter');
  const far = Core.bustStep(0.5, 30, 0, 0.05);
  assert.ok(far.bust < 0.5, 'no cop nearby drains the meter');
  assert.equal(Core.bustStep(0, 30, 0, 0.05).bust, 0, 'never below zero');
  for (let i = 0; i < 200 && !b.busted; i++) b = Core.bustStep(b.bust, 5, 0, 1 / 60);
  assert.deepEqual(b, { bust: 1, busted: true });
});

test('heat: more police with more shards (city) or more distance (open road), never above 3', () => {
  assert.deepEqual([0, 3, 6, 9, 30].map(n => Core.heatLevel('city', n, 0)), [1, 2, 3, 3, 3]);
  assert.deepEqual([0, 1300, 2600, 9999].map(d => Core.heatLevel('highway', 0, d)), [1, 2, 3, 3]);
  assert.equal(Core.heatLevel('city', -4, 0), 1);
});

test('boundary distance shrinks towards every edge; the highway only has two ends', () => {
  const rect = [-100, 100, -50, 50];
  assert.equal(Core.edgeDistance(rect, 0, 0, 0, false), 50);
  assert.equal(Core.edgeDistance(rect, 95, 0, 0, false), 5);
  assert.equal(Core.edgeDistance(rect, 99, 0, 0, true), 50, 'sideways does not count on the highway');
  assert.ok(Core.edgeDistance(rect, 120, 0, 0, false) < 0, 'outside gives a negative distance');
});

test('scoring: drive time, stars and best time', () => {
  assert.equal(Core.driveTime('city', MODES.city, 100, 8), 80);
  assert.equal(Core.driveTime('highway', MODES.highway, 20, 5), 100, 'bonus seconds are added back');
  assert.equal(Core.runStars('city', MODES.city, 100, 80, 0), 3);
  assert.equal(Core.runStars('city', MODES.city, 50, 130, 0), 2);
  assert.equal(Core.runStars('city', MODES.city, 10, 170, 0), 1);
  assert.equal(Core.runStars('city', MODES.city, 100, 80, 60), 2, 'heavy damage costs a star');
  assert.equal(Core.runStars('city', MODES.city, 10, 170, 99), 1, 'but never the last one');
  assert.equal(Core.runStars('highway', MODES.highway, 0, 80, 0), 3);
  assert.equal(Core.runStars('country', MODES.country, 0, 140, 0), 1);
  assert.ok(Core.isNewBest(undefined, 90));
  assert.ok(Core.isNewBest(95, 90));
  assert.ok(!Core.isNewBest(85, 90));
  assert.ok(!Core.isNewBest(85, NaN));
  assert.ok(!Core.isNewBest(85, 0));
});

test('time display never shows negative or NaN time', () => {
  assert.equal(Core.fmtTime(180), '3:00');
  assert.equal(Core.fmtTime(59.2), '1:00');
  assert.equal(Core.fmtTime(-3), '0:00');
  assert.equal(Core.fmtTime(NaN), '0:00');
  assert.equal(Core.fmtTimeExact(83.44), '1:23.4');
  assert.equal(Core.fmtTimeExact(Infinity), '0:00.0');
});

test('seeded random is repeatable, so maps are always built the same way', () => {
  const a = Core.mulberry32(2026), b = Core.mulberry32(2026);
  const xs = Array.from({ length: 5 }, a), ys = Array.from({ length: 5 }, b);
  assert.deepEqual(xs, ys);
  xs.forEach(x => assert.ok(x >= 0 && x < 1));
  assert.deepEqual(Core.shuffle([1, 2, 3, 4, 5], Core.mulberry32(1)).sort(), [1, 2, 3, 4, 5]);
  for (const a0 of [-10, -Math.PI, 0, 3, 10]){ const w = Core.wrapAngle(a0); assert.ok(w >= -Math.PI && w < Math.PI); }
});
