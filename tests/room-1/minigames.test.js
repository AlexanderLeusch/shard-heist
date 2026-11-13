// ### Unit tests for the six Titanic mini games (room-1-escape/js/minigames.js): dealing, the bots, the fleets and the
// ### spot-the-difference circles. The drawing and the controls are played in the browser tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../room-1-escape/js/minigames.js');
const R = require('../../room-1-escape/js/rules.js');

// a small seeded random number generator, so every run of these tests sees the same numbers
const seeded = a => () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; };

test('there are six games, the same six the rules know, each at most 30 seconds', () => {
  assert.deepEqual(M.GAMES, R.GAMES);
  assert.equal(M.TIME, 30);
  for (const g of M.GAMES) assert.ok(M.INFO[g].title && M.INFO[g].how && M.INFO[g].name, g);
});

test('every new game deals three different mini games, and over many games all six come up', () => {
  const seen = new Set(), rand = seeded(7);
  for (let i = 0; i < 200; i++){
    const g = M.pickGames(rand);
    assert.equal(g.length, 3);
    assert.equal(new Set(g).size, 3, 'no game twice in one round');
    g.forEach(x => seen.add(x));
    assert.ok(R.perform(R.newState(), 'start', g).ok, 'the rules accept every deal');
  }
  assert.equal(seen.size, 6);
});

test('tic-tac-toe: lines, draws, and a bot that always wins when it can and can be beaten', () => {
  assert.equal(M.tttWinner(['X', 'X', 'X', '', '', '', '', '', '']), 'X');
  assert.equal(M.tttWinner(['O', '', '', '', 'O', '', '', '', 'O']), 'O');
  assert.equal(M.tttWinner(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']), 'draw');
  assert.equal(M.tttWinner(Array(9).fill('')), null);
  assert.equal(M.tttBot(['O', 'O', '', 'X', 'X', '', '', '', ''], () => .99), 2, 'takes the win instead of blocking');
  assert.equal(M.tttBot(['X', 'X', '', '', 'O', '', '', '', ''], () => 0), 2, 'blocks when it decides to');
  assert.equal(M.tttBot(Array(9).fill('X'), Math.random), -1, 'no move on a full board');
  // a player who plays the first free cell that wins, else blocks, else the centre, else the first free: wins some games
  const rand = seeded(3); let wins = 0;
  for (let n = 0; n < 200; n++){
    const b = Array(9).fill('');
    while (!M.tttWinner(b)){
      const free = b.map((c, i) => c ? -1 : i).filter(i => i >= 0);
      const fin = who => free.find(i => { const t = b.slice(); t[i] = who; return M.tttWinner(t) === who; });
      let m = fin('X'); if (m === undefined) m = fin('O'); if (m === undefined) m = !b[4] ? 4 : free[0];
      b[m] = 'X';
      if (M.tttWinner(b)) break;
      const bm = M.tttBot(b, rand);
      assert.equal(b[bm], '', 'the bot plays a free cell');
      b[bm] = 'O';
    }
    if (M.tttWinner(b) === 'X') wins++;
  }
  assert.ok(wins > 40, `the bot can be beaten (${wins} of 200)`);
});

test('battleship: fleets of three straight ships that never overlap or touch, and a bot that only fires at new cells', () => {
  const rand = seeded(11);
  for (let i = 0; i < 100; i++){
    const f = M.placeFleet(6, [3, 2, 2], rand);
    assert.deepEqual(f.map(s => s.length), [3, 2, 2]);
    const all = f.flat();
    assert.equal(new Set(all).size, 7, 'no two ships on one cell');
    assert.ok(all.every(c => c >= 0 && c < 36));
    for (const s of f){
      const rows = new Set(s.map(c => Math.floor(c / 6))), cols = new Set(s.map(c => c % 6));
      assert.ok(rows.size === 1 || cols.size === 1, 'straight');
      const step = rows.size === 1 ? 1 : 6;
      s.slice(1).forEach((c, k) => assert.equal(c - s[k], step, 'no gaps'));
    }
    // the real rule: ships never touch, not even at a corner
    for (const sh of f) for (const c of sh) for (const nb of M.around(6, c)) assert.ok(sh.includes(nb) || !all.includes(nb), 'ships touch at cell ' + c);
    const shots = new Set();
    while (!M.fleetSunk(f, shots)){ const c = M.bsBot(6, f, shots, rand); assert.ok(!shots.has(c) && c >= 0 && c < 36); shots.add(c); }
    assert.ok(shots.size <= 36);
  }
});

test('battleship: the water around a sunk ship is marked, and only around sunk ships', () => {
  assert.deepEqual(M.around(6, 0).sort((a, b) => a - b), [1, 6, 7], 'a corner has three neighbours');
  assert.equal(M.around(6, 14).length, 8);
  const ships = [[0, 1, 2], [20, 26]];
  assert.equal(M.waterAround(6, ships, new Set([0, 1])).size, 0, 'nothing while the ship still floats');
  assert.deepEqual([...M.waterAround(6, ships, new Set([0, 1, 2]))].sort((a, b) => a - b), [3, 6, 7, 8, 9]);
});

test('deck climb: five levels from the engine room up to the boat deck', () => {
  assert.deepEqual(M.CLIMB_LEVELS.map(l => l.name), ['Engine room', 'Crew quarters', 'Second class', 'First class', 'Boat deck']);
});

test('seagull: the clouds above a gap leave no way through, end exactly at the gap, and the icebergs are hit by their outline', () => {
  const rand = seeded(9);
  for (let n = 0; n < 200; n++){
    const gap = 95 + rand() * 47, clouds = M.cloudStack(gap, rand);
    assert.ok(clouds.length >= 2, 'more than one cloud');
    const lowest = Math.max(...clouds.flatMap(c => c.puffs.map(p => c.dy + p.dy + p.r)));
    assert.ok(Math.abs(lowest - gap) < 1e-9, 'the lowest cloud ends at the gap');
    // from the top of the screen down to just above the gap, the seagull (radius 6) hits a cloud somewhere in the column
    for (let y = 16; y < gap - 10; y += 2){
      let blocked = false;
      for (let x = -20; x <= 20 && !blocked; x += 2) blocked = M.hitsClouds(clouds, 0, x, y, 6);
      assert.ok(blocked, `a way through the clouds at y = ${y} (gap at ${gap.toFixed(1)})`);
    }
    assert.ok(!M.hitsClouds(clouds, 0, 0, gap + 64, 6), 'the middle of the gap is free');
  }
  const berg = M.icebergPoly(0, 300, 54, 100);
  assert.ok(M.inPoly(berg, 25, 290), 'inside near the base');
  assert.ok(M.inPoly(berg, 24, 205), 'just under the peak');
  assert.ok(!M.inPoly(berg, 3, 220), 'not in the empty corner beside the peak');
  assert.ok(!M.inPoly(berg, 25, 195), 'not above the peak');
});

test('deck run: every obstacle is a plain box, so what you see is exactly what knocks you down', () => {
  for (const [k, b] of Object.entries(M.RUN_KINDS)){
    assert.ok(Number.isInteger(b.w) && Number.isInteger(b.h) && b.w > 0 && b.h > 0, k);
    assert.ok(b.h <= 30, `${k} can be jumped`);
  }
});

test('deck run: first the portholes along the side of the ship, then the open deck with its rings, and the bow after the finish', () => {
  const { PROMENADE_END: PE, LEN, BOW0, BOW } = M.RUN;
  for (const seed of [1, 2, 3]){
    const L = M.runLayout(seeded(seed));
    assert.ok(L.portholes.length > 20 && L.portholes.every(x => x < PE), 'portholes only along the covered side');
    for (const k of ['rings', 'benches', 'vents', 'bollards', 'boats']){
      assert.ok(L[k].length > 0 && L[k].every(x => x > PE && x < LEN), `${k} on the open deck`);
    }
    assert.ok(L.funnel > PE && L.mast > PE && L.mast < LEN, 'funnel and mast on the open deck');
  }
  // the deck only narrows to the stem beyond the finish, so the sailor never runs out over the sea
  assert.ok(BOW0 > LEN && BOW > BOW0);
});

test('spot the difference: five differences each game, found only once and only near the right place', () => {
  const d = M.pickDiffs(seeded(5));
  assert.equal(d.length, 5);
  assert.equal(new Set(d.map(x => x.id)).size, 5);
  const found = d.map(() => false);
  assert.equal(M.hitDiff(d, found, d[2].x + 3, d[2].y - 3), 2);
  found[2] = true;
  assert.equal(M.hitDiff(d, found, d[2].x, d[2].y), -1, 'a found difference does not count twice');
  assert.equal(M.hitDiff(d, found, -100, -100), -1, 'a click far away is wrong');
  assert.ok(M.DIFFS.every(x => x.x - x.r >= 0 && x.x + x.r <= 310 && x.y - x.r >= 0 && x.y + x.r <= 290), 'every circle lies inside the picture');
});

test('overlap of two boxes, used by the three action games', () => {
  assert.ok(M.overlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }));
  assert.ok(!M.overlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 }), 'touching edges do not count');
});
