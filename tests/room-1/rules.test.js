// ### Unit tests for room 1, the escape room: both endings, refused actions, lock codes, the clock and tampered saved games.
// Room 1, the escape room: story rules, accepted and rejected actions, the clock and saved games (room-1-escape/js/rules.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../room-1-escape/js/rules.js');

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
const TO_HATCH = [['start'], ['go', 'stall'], ['play', 'tile'], ['win', 'tile'], ['take', 'carkey'], ['go', 'hatch']];
const runClock = (s, secs) => { for (let t = 0; t < secs && !s.ending; t += .5) s = R.tick(s, .5).state; return s; };

test('the story has 5 scenes, 2 items, 3 clues and 2 endings', () => {
  assert.equal(Object.keys(R.SCENES).length, 5);
  assert.deepEqual(Object.keys(R.ITEMS), ['mop', 'carkey']);
  assert.deepEqual(Object.keys(R.CLUES), ['tile', 'mirror', 'scratches']);
  assert.equal(R.GAMES.length, 7);
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
  for (const [a, t] of [['go', 'sinks'], ['take', 'mop'], ['try'], ['play', 'tile'], ['win', 'tile']]){
    const r = R.perform(s, a, t);
    assert.equal(r.ok, false, a);
    assert.equal(r.state, s, 'a refused action returns the same state');
  }
  assert.equal(R.tick(s, 5).state, s, 'the clock does not run in the briefing');
});

test('rejected: walking where there is no way, taking what is not there or twice', () => {
  const s = play(START);
  const cases = [['go', 'hatch'], ['go', 'tunnel'], ['go', 'roof'], ['go', undefined], ['take', 'spoon'], ['take', 'key'], ['take', '__proto__'], ['take', 'carkey'], ['read', 'diary'], ['tap'], ['play', 'tile'], ['win', 'tile'], ['play', 'mirror'], ['play', 'safe'], ['win', '__proto__'], ['read', 'scratches'], ['read', 'tile'], ['try'], ['turn', [0, 1]], ['fly'], [undefined]];
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
  const game = R.perform(s, 'play', 'tile');
  assert.equal(game.ok, true, 'the tile opens its mini game');
  assert.equal(game.cue, 'game');
  assert.equal(game.state, s, 'opening a mini game changes nothing');
  const pried = R.perform(s, 'win', 'tile');
  assert.equal(pried.ok, true, 'winning it takes the tile off');
  assert.equal(pried.state.tileOpen, true);
  assert.match(pried.message, /car key/);
  assert.equal(R.perform(pried.state, 'play', 'tile').ok, false, 'the tile is already off');
  assert.equal(R.perform(pried.state, 'win', 'tile').ok, false, 'and is only won once');
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

test('the scratches by the door give the last two digits after their mini game, and the car key waits behind the tile', () => {
  let s = play([['start']]);
  assert.ok(R.visibleHotspots(s).some(h => h.action === 'play' && h.target === 'scratches'), 'the scratches open a mini game at the door');
  assert.ok(!R.visibleHotspots(s).some(h => h.action === 'read' && h.target === 'scratches'), 'nothing to read before it is won');
  assert.equal(R.perform(s, 'read', 'scratches').ok, false, 'rejected: no clue before the mini game is won');
  s = play([['win', 'scratches']], s);
  assert.deepEqual(s.clues, ['scratches']);
  assert.match(R.CLUES.scratches.text, /_ _ 1 2/);
  assert.ok(R.visibleHotspots(s).some(h => h.action === 'read' && h.target === 'scratches'), 'and it can be read again');
  assert.ok(!R.visibleHotspots(s).some(h => h.action === 'play' && h.target === 'scratches'), 'but not played again');
  assert.equal(R.perform(s, 'win', 'scratches').ok, false, 'a clue is only won once');
  assert.equal(R.perform(play([['go', 'sinks']], s), 'read', 'scratches').ok, false, 'not from the sinks');
  assert.equal(R.perform(play([['go', 'sinks']], R.perform(R.newState(), 'start').state), 'win', 'scratches').ok, false, 'rejected: no win from the wrong place');
  s = play([['go', 'stall'], ['win', 'tile']], s);
  assert.ok(R.visibleHotspots(s).some(h => h.target === 'carkey'));
  s = play([['take', 'carkey']], s);
  assert.deepEqual(s.inventory, ['carkey']);
  assert.equal(R.perform(s, 'take', 'carkey').ok, false, 'only once');
  assert.deepEqual(R.restore(JSON.stringify(s)), s);
});

test('the mirror only opens its mini game while the hot tap steams it up, and gives the first two digits', () => {
  let s = play([['start'], ['go', 'sinks']]);
  const dry = R.perform(s, 'play', 'mirror');
  assert.ok(dry.ok);
  assert.notEqual(dry.cue, 'game', 'no mini game without steam');
  assert.equal(R.perform(s, 'win', 'mirror').ok, false, 'rejected: no win at a dry mirror');
  s = play([['tap']], s);
  const wet = R.perform(s, 'play', 'mirror');
  assert.equal(wet.cue, 'game');
  assert.equal(wet.message, s.games[1], 'the mirror plays the second game dealt');
  s = play([['win', 'mirror']], s);
  assert.deepEqual(s.clues, ['mirror']);
  assert.match(R.CLUES.mirror.text, /19 _ _/);
  s = play([['tap'], ['read', 'mirror']], s);
  assert.equal(s.steam, false, 'the tap turns off again, and the won clue can still be read');
});

test('each new game deals three different mini games, chosen outside the rules', () => {
  assert.deepEqual(play(START).games, R.GAMES.slice(0, 3), 'without a deal the first three');
  const dealt = play([['start', ['seagull', 'deckrun', 'spotdiff']]]);
  assert.deepEqual(dealt.games, ['seagull', 'deckrun', 'spotdiff']);
  assert.equal(R.perform(play([['go', 'stall']], dealt), 'play', 'tile').message, 'seagull');
  assert.equal(R.perform(dealt, 'play', 'scratches').message, 'spotdiff');
  for (const bad of [['seagull', 'seagull', 'deckrun'], ['seagull', 'deckrun'], ['chess', 'deckrun', 'spotdiff'], 'seagull', null, []]){
    const r = R.perform(R.newState(), 'start', bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.state.scene, 'intro');
  }
  assert.equal(R.restore(JSON.stringify({ ...dealt, games: ['seagull', 'seagull', 'deckrun'] })), null, 'a save with the same game twice');
  assert.equal(R.restore(JSON.stringify({ ...dealt, games: undefined })), null, 'a save without the games');
});

test('the graffiti in the stall is a hint, not one of the three clues', () => {
  const s = play([['start'], ['go', 'stall']]);
  const r = R.perform(s, 'read', 'graffiti');
  assert.ok(r.ok);
  assert.match(r.message, /The year opens the floor/);
  assert.deepEqual(r.state.clues, []);
  assert.equal(R.perform(play([['go', 'sinks']], s), 'read', 'graffiti').ok, false, 'not from the sinks');
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
  const s = play([['start'], ['take', 'mop'], ['go', 'sinks'], ['tap'], ['win', 'mirror']]);
  assert.deepEqual(R.restore(JSON.stringify(s)), s);
  assert.ok(R.canContinue(R.restore(JSON.stringify(s))));
  assert.equal(R.canContinue(R.restore(JSON.stringify(R.newState()))), false, 'nothing to continue from the briefing');
  const bad = [
    null, '', 'not json', '[]', '"x"', '42', 'x'.repeat(3000),
    { ...s, time: 9999 }, { ...s, time: -1 }, { ...s, time: 'soon' },
    { ...s, scene: 'roof' }, { ...s, scene: '__proto__' },
    { ...s, inventory: ['mop', 'mop'] }, { ...s, inventory: ['key'] }, { ...s, inventory: ['spoon'] }, { ...s, inventory: 'mop' },
    { ...s, clues: ['diary'] }, { ...s, clues: ['scrap'] }, { ...s, inventory: ['carkey'], tileOpen: false }, { ...s, tileOpen: true }, { ...s, clues: ['mirror', 'tile'] },
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
  assert.notEqual(R.restore(save({ tileOpen: true, clues: ['tile'], inventory: [] })), null, 'the tile open with nothing in hand');
  // a full game: after every accepted action the save must load again
  let s = R.perform(good, 'start').state;
  const steps = [['go', 'sinks'], ['tap', null], ['play', 'mirror'], ['win', 'mirror'], ['tap', null], ['read', 'mirror'], ['go', 'door'], ['take', 'mop'], ['wedge', null], ['go', 'stall'], ['read', 'graffiti'], ['play', 'tile'], ['win', 'tile'], ['take', 'carkey'], ['go', 'door'], ['win', 'scratches'], ['read', 'scratches'], ['go', 'stall'], ['go', 'hatch'], ['try', null]];
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

test('the air vent from the Openverse API: the best CC0 ventilation recording is picked, anything else is refused', () => {
  const ok = { license: 'cc0', url: 'https://cdn.freesound.org/previews/536/536942_1234-hq.mp3', duration: 45000, title: 'Ventilation hum', creator: 'someone',
    foreign_landing_url: 'https://freesound.org/people/someone/sounds/536942', tags: [{ name: 'hvac' }] };
  const v = R.pickVent({ results: [ok] });
  assert.deepEqual(v, { url: ok.url, title: 'Ventilation hum', creator: 'someone', page: ok.foreign_landing_url });
  assert.match(R.VENT_SEARCH, /^https:\/\/api\.openverse\.org\/v1\/audio\/\?q=ventilation&source=freesound&license=cc0&/);
  // words of a vent count for a recording, words of other sounds against it; among equals the API's order stays
  const plain = { ...ok, url: 'https://cdn.freesound.org/previews/1/1_1-hq.mp3', title: 'Recording 4', tags: [] };
  const talk = { ...ok, url: 'https://cdn.freesound.org/previews/2/2_2-hq.mp3', title: 'Vent with people talking' };
  assert.equal(R.pickVent({ results: [plain, ok] }).url, ok.url, 'the one that names a vent');
  assert.equal(R.pickVent({ results: [talk, plain] }).url, plain.url, 'voices count against it');
  assert.equal(R.pickVent({ results: [talk] }), null, 'nothing that fits');
  // refused: other licences, hosts, file types, lengths, and answers that are not a list
  for (const bad of [{ license: 'by' }, { url: 'https://evil.example/previews/1/1.mp3' }, { url: 'http://cdn.freesound.org/previews/1/1_1-hq.mp3' },
    { url: 'https://cdn.freesound.org/previews/1/1_1-hq.ogg' }, { url: 'https://cdn.freesound.org/previews/1/"x".mp3' }, { duration: 5000 }, { duration: 3600000 },
    { duration: '45000' }, { mature: true }]) assert.equal(R.pickVent({ results: [{ ...ok, ...bad }] }), null, JSON.stringify(bad));
  for (const body of [null, {}, { results: 'x' }, { results: [null, 3, 'x'] }, 'results']) assert.equal(R.pickVent(body), null);
  // titles and names are cut to size and lose markup characters; a landing page off Freesound is dropped
  const odd = R.pickVent({ results: [{ ...ok, title: '<b>Vent</b> ' + 'x'.repeat(200), creator: '', foreign_landing_url: 'https://evil.example/' }] });
  assert.equal(odd.title.length, 80); assert.ok(!/[<>]/.test(odd.title)); assert.equal(odd.creator, 'unknown'); assert.equal(odd.page, '');
  // the kept choice: valid for 30 days, refused when broken or tampered with
  const now = Date.UTC(2026, 10, 14), keep = at => JSON.stringify({ at, ...v });
  assert.deepEqual(R.parseVent(keep(now - 864e5), now), { ...v, at: now - 864e5 });
  assert.equal(R.parseVent(keep(now - 31 * 864e5), now), null, 'older than 30 days');
  assert.equal(R.parseVent(keep(now + 1000), now), null, 'from the future');
  for (const raw of [null, '', '{', '[]', 'null', JSON.stringify({ ...v }), JSON.stringify({ at: now, ...v, url: 'https://evil.example/a.mp3' }),
    JSON.stringify({ at: now, ...v, title: '<script>' }), JSON.stringify({ at: String(now), ...v })]) assert.equal(R.parseVent(raw, now), null, 'refused: ' + raw);
});
