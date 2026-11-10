// ### Unit tests for room 1, the escape room: both endings, refused actions, lock codes, the clock and tampered saved games.
// Room 1, the escape room: story rules, accepted and rejected actions, the clock and saved games (escape-room/src/rules.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../escape-room/src/rules.js');

// Runs a list of [action, target] steps and returns the final state; every step must be accepted
function play(steps, s = R.newState()){
  for (const [a, t] of steps){
    const r = R.perform(s, a, t);
    assert.ok(r.ok, `${a} ${t || ''} was refused: ${r.message}`);
    s = r.state;
  }
  return s;
}
const turnTo = (s, code) => { for (let i = 0; i < 4; i++) while (s.lock[i] !== Number(code[i])) s = R.perform(s, 'turn', [i, 1]).state; return s; };
const START = [['start']];
const TO_HATCH = [['start'], ['go', 'stall'], ['pry'], ['take', 'carkey'], ['go', 'hatch']];
const runClock = (s, secs) => { for (let t = 0; t < secs && !s.ending; t += .5) s = R.tick(s, .5).state; return s; };

test('the story has 5 scenes, 2 items, 3 clues and 2 endings', () => {
  assert.equal(Object.keys(R.SCENES).length, 5);
  assert.deepEqual(Object.keys(R.ITEMS), ['mop', 'carkey']);
  assert.equal(Object.keys(R.CLUES).length, 3);
  assert.deepEqual(Object.keys(R.ENDINGS), ['A', 'B']);
  assert.equal(R.TIME_LIMIT, 600);
  // every exit leads to a real scene, and every "go" hotspot is a real exit
  for (const [k, sc] of Object.entries(R.SCENES)){
    sc.exits.forEach(e => assert.ok(R.SCENES[e], `${k} -> ${e}`));
    sc.hotspots.filter(h => h[0] === 'go').forEach(h => assert.ok(sc.exits.includes(h[1]), `${k}: go ${h[1]}`));
  }
});

test('a new game starts in the briefing with the full ten minutes and nothing in hand', () => {
  const s = R.newState();
  assert.equal(s.scene, 'intro');
  assert.equal(s.time, 600);
  assert.deepEqual(s.inventory, []);
  assert.deepEqual(s.lock, [0, 0, 0, 0]);
  assert.equal(s.ending, null);
});

test('Ending A: tile, car key, the code 1912, and out through the hatch', () => {
  let s = play(TO_HATCH);
  s = turnTo(s, '1912');
  const r = R.perform(s, 'try');
  assert.ok(r.ok);
  assert.equal(r.state.ending, 'A');
  assert.equal(r.state.scene, 'tunnel');
  assert.match(r.message, /Took you long enough/);
});

test('Ending B: when the clock runs out, Hale takes you back', () => {
  let s = play(START);
  s = runClock(s, 700);
  assert.equal(s.ending, 'B');
  assert.equal(s.time, 0);
  assert.equal(s.scene, 'cell');
});

test('the earlier decision: a jammed door buys exactly one extra minute, once', () => {
  let s = play([['start'], ['take', 'mop'], ['wedge']]);
  assert.equal(s.wedged, true);
  assert.deepEqual(s.inventory, [], 'the mop stays at the door');
  s = runClock(s, 600);
  assert.equal(s.ending, null, 'still in the game after ten minutes');
  assert.equal(s.graceUsed, true);
  assert.ok(s.time > 0 && s.time <= R.WEDGE_GRACE);
  s = runClock(s, 61);
  assert.equal(s.ending, 'B');
});

test('rejected: nothing happens before the briefing is done', () => {
  const s = R.newState();
  for (const [a, t] of [['go', 'sinks'], ['take', 'mop'], ['try'], ['pry']]){
    const r = R.perform(s, a, t);
    assert.equal(r.ok, false, a);
    assert.equal(r.state, s, 'a refused action returns the same state');
  }
  assert.equal(R.tick(s, 5).state, s, 'the clock does not run in the briefing');
});

test('rejected: walking where there is no way, taking what is not there or twice', () => {
  const s = play(START);
  const cases = [['go', 'hatch'], ['go', 'tunnel'], ['go', 'roof'], ['go', undefined], ['take', 'spoon'], ['take', 'key'], ['take', '__proto__'], ['take', 'carkey'], ['read', 'diary'], ['tap'], ['pry'], ['try'], ['turn', [0, 1]], ['fly'], [undefined]];
  for (const [a, t] of cases){
    const r = R.perform(s, a, t);
    assert.equal(r.ok, false, `${a} ${JSON.stringify(t)}`);
    assert.equal(r.state, s);
    assert.ok(r.message.length > 0, 'the player is told why');
  }
  const withMop = play([['take', 'mop']], s);
  const again = R.perform(withMop, 'take', 'mop');
  assert.equal(again.ok, false);
  assert.match(again.message, /already/);
});

test('rejected: the door needs the mop, the car key needs the tile off, the tile comes off only once', () => {
  const s = play([['start'], ['go', 'stall']]);
  assert.ok(!R.visibleHotspots(play([['go', 'sinks']], s)).some(h => h.action === 'take'), 'nothing to take at the sinks');
  const pried = R.perform(s, 'pry');
  assert.equal(pried.ok, true, 'the tile comes off by hand');
  assert.match(pried.message, /fingers/);
  assert.equal(R.perform(pried.state, 'pry').ok, false, 'the tile is already off');
  const key = R.perform(s, 'take', 'carkey');
  assert.equal(key.ok, false);
  assert.match(key.message, /still in place/);
  assert.ok(!R.visibleHotspots(s).some(h => h.target === 'carkey'), 'no car key marker while the tile is on');
  const door = play([['start']]);
  const wedge = R.perform(door, 'wedge');
  assert.equal(wedge.ok, false);
  assert.match(wedge.message, /long and solid/);
  const twice = play([['take', 'mop'], ['wedge']], door);
  assert.equal(R.perform(twice, 'wedge').ok, false);
  assert.equal(R.perform(twice, 'take', 'mop').ok, false, 'the mop is stuck in the door now');
});

test('the scratches by the door are a clue, and the car key waits behind the tile', () => {
  let s = play([['start']]);
  assert.ok(R.visibleHotspots(s).some(h => h.action === 'read' && h.target === 'scratches'), 'the scratches can be read at the door');
  s = play([['read', 'scratches']], s);
  assert.deepEqual(s.clues, ['scratches']);
  assert.equal(R.perform(play([['go', 'sinks']], s), 'read', 'scratches').ok, false, 'not from the sinks');
  s = play([['go', 'stall'], ['pry']], s);
  assert.ok(R.visibleHotspots(s).some(h => h.target === 'carkey'));
  s = play([['take', 'carkey']], s);
  assert.deepEqual(s.inventory, ['carkey']);
  assert.equal(R.perform(s, 'take', 'carkey').ok, false, 'only once');
  assert.deepEqual(R.restore(JSON.stringify(s)), s);
});

test('the mirror only shows its clue while the hot tap steams it up', () => {
  let s = play([['start'], ['go', 'sinks']]);
  const dry = R.perform(s, 'read', 'mirror');
  assert.ok(dry.ok);
  assert.deepEqual(dry.state.clues, [], 'no clue without steam');
  s = play([['tap'], ['read', 'mirror']], s);
  assert.deepEqual(s.clues, ['mirror']);
  s = play([['read', 'mirror']], s);
  assert.deepEqual(s.clues, ['mirror'], 'a clue is only counted once');
  s = play([['tap']], s);
  assert.equal(s.steam, false, 'the tap turns off again');
});

test('the lock: four wheels that wrap around, only reachable at the hatch', () => {
  let s = play(TO_HATCH);
  s = R.perform(s, 'turn', [0, -1]).state;
  assert.deepEqual(s.lock, [9, 0, 0, 0], '0 down is 9');
  s = R.perform(s, 'turn', [0, 1]).state;
  assert.deepEqual(s.lock, [0, 0, 0, 0], '9 up is 0');
  for (const bad of [[4, 1], [-1, 1], [0, 2], [0, 0], [1.5, 1], ['0', 1], null, 'x', [0]]){
    const r = R.perform(s, 'turn', bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.state, s);
  }
});

test('a wrong code is noisy: it costs 30 seconds and never takes the clock below zero', () => {
  let s = play(TO_HATCH);
  const r = R.perform(s, 'try');
  assert.ok(r.ok);
  assert.equal(r.state.ending, null);
  assert.equal(r.state.time, 600 - R.WRONG_CODE_PENALTY);
  assert.equal(r.state.wrongTries, 1);
  s = { ...r.state, time: 10 };
  s = R.perform(s, 'try').state;
  assert.equal(s.time, 0);
  s = R.tick(s, .1).state;
  assert.equal(s.ending, 'B', 'running out because of wrong codes is Ending B');
});

test('nothing but a new game works after an ending', () => {
  let s = turnTo(play(TO_HATCH), '1912');
  s = R.perform(s, 'try').state;
  for (const [a, t] of [['go', 'stall'], ['try'], ['take', 'mop'], ['start']]) assert.equal(R.perform(s, a, t).ok, false, a);
  assert.equal(R.tick(s, 5).state, s, 'the clock stops');
  const n = R.perform(s, 'new');
  assert.ok(n.ok);
  assert.deepEqual(n.state, R.newState());
});

test('the clock: warnings once each, huge or invalid frame times are safe', () => {
  let s = play(START);
  const heard = [];
  for (let t = 0; t < 600; t += .25){ const r = R.tick(s, .25); s = r.state; if (r.message) heard.push(r.message); if (s.ending) break; }
  assert.equal(heard.filter(m => /Five minutes/.test(m)).length, 1);
  assert.equal(heard.filter(m => /Thirty seconds/.test(m)).length, 1);
  const fresh = play(START);
  assert.equal(R.tick(fresh, 3600).state.time, 599, 'one tick never takes more than a second');
  for (const bad of [0, -5, NaN, undefined, Infinity * -1]) assert.equal(R.tick(fresh, bad).state, fresh, String(bad));
});

test('accepted actions return a new state and never change the old one', () => {
  const s = play(START);
  const frozen = JSON.stringify(s);
  R.perform(s, 'go', 'sinks'); R.perform(s, 'take', 'mop'); R.tick(s, 1);
  assert.equal(JSON.stringify(s), frozen);
});

test('saved games: a real save is restored, anything else is rejected', () => {
  const s = play([['start'], ['take', 'mop'], ['go', 'sinks'], ['tap'], ['read', 'mirror']]);
  assert.deepEqual(R.restore(JSON.stringify(s)), s);
  assert.ok(R.canContinue(R.restore(JSON.stringify(s))));
  assert.equal(R.canContinue(R.restore(JSON.stringify(R.newState()))), false, 'nothing to continue from the briefing');
  const bad = [
    null, '', 'not json', '[]', '"x"', '42', 'x'.repeat(3000),
    { ...s, time: 9999 }, { ...s, time: -1 }, { ...s, time: 'soon' },
    { ...s, scene: 'roof' }, { ...s, scene: '__proto__' },
    { ...s, inventory: ['mop', 'mop'] }, { ...s, inventory: ['key'] }, { ...s, inventory: ['spoon'] }, { ...s, inventory: 'mop' },
    { ...s, clues: ['diary'] }, { ...s, clues: ['scrap'] }, { ...s, inventory: ['carkey'], tileOpen: false },
    { ...s, lock: [1, 9, 1] }, { ...s, lock: [1, 9, 1, 12] }, { ...s, lock: [1, 9, 1, 2.5] },
    { ...s, wedged: true, inventory: ['mop'] }, { ...s, steam: 'yes' }, { ...s, ending: 'C' }, { ...s, wrongTries: -1 }, { ...s, warned: [99] }
  ];
  for (const b of bad){
    const raw = typeof b === 'string' || b === null ? b : JSON.stringify(b);
    assert.equal(R.restore(raw), null, String(raw).slice(0, 60));
  }
});

test('audit: a hand-edited save that no game can produce is refused, and every real save is kept', () => {
  const good = R.newState();
  const save = o => JSON.stringify({ ...R.perform(good, 'start').state, ...o });
  assert.equal(R.restore(save({ scene: 'cell', ending: null })), null, 'the cell without an ending');
  assert.equal(R.restore(save({ scene: 'tunnel', ending: null })), null, 'the tunnel without an ending');
  assert.equal(R.restore(save({ scene: 'door', ending: 'A' })), null, 'an ending somewhere else');
  assert.equal(R.restore(save({ clues: ['mirror', 'mirror'] })), null, 'the same clue twice');
  assert.equal(R.restore(save({ graceUsed: true, wedged: false })), null, 'grace minute without the jammed door');
  assert.notEqual(R.restore(save({ tileOpen: true, inventory: [] })), null, 'the tile open with nothing in hand');
  // a full game: after every accepted action the save must load again
  let s = R.perform(good, 'start').state;
  const steps = [['go', 'sinks'], ['tap', null], ['read', 'mirror'], ['tap', null], ['go', 'door'], ['take', 'mop'], ['wedge', null], ['go', 'stall'], ['read', 'graffiti'], ['pry', null], ['take', 'carkey'], ['go', 'door'], ['read', 'scratches'], ['go', 'stall'], ['go', 'hatch'], ['try', null]];
  for (const [a, b] of steps){
    const r = R.perform(s, a, b);
    assert.ok(r.ok, a + ' ' + b + ' must be accepted: ' + r.message);
    s = r.state;
    assert.notEqual(R.restore(JSON.stringify(s)), null, 'after ' + a + ' ' + b);
  }
  assert.equal(s.wedged, true); assert.equal(s.wrongTries, 1);
  // the clock runs out at the jammed door: the grace minute, then Ending B, and each of them loads
  while (!s.graceUsed){ s = R.tick(s, 1).state; assert.notEqual(R.restore(JSON.stringify(s)), null, 'at ' + s.time); }
  assert.equal(s.time, R.WEDGE_GRACE);
  while (s.ending === null) s = R.tick(s, 1).state;
  assert.equal(s.ending, 'B');
  assert.notEqual(R.restore(JSON.stringify(s)), null, 'an ending');
  // the volume is stored as text: only a number from 0 to 1 is taken
  assert.equal(R.parseVolume('0.35'), 0.35); assert.equal(R.parseVolume('0'), 0); assert.equal(R.parseVolume('1'), 1);
  for (const bad of [null, '', '2', '-0.5', '0.5x', 'NaN', ' 0.5', '1.5', '1e-3']) assert.equal(R.parseVolume(bad), 1, 'refused: ' + bad);
  // and these never happen in a real game
  assert.equal(R.restore(save({ wedged: true, graceUsed: true, time: 600 })), null, 'the grace minute with a full clock');
  assert.equal(R.restore(save({ wrongTries: 3, time: 600 })), null, 'wrong codes that cost nothing');
  assert.equal(R.restore(save({ wrongTries: 99, time: 0 })), null, 'more wrong codes than the clock allows');
  assert.equal(R.restore(save({ warned: [60], time: 500 })), null, 'a warning before its time');
});
